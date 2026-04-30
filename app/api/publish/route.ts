import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, STORAGE_BUCKET } from '@/lib/supabase';
import type { ScheduledPost } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // seconds

/**
 * GET /api/publish
 *
 * Triggered HOURLY by Vercel Cron (see vercel.json).
 * Vercel signs cron requests with `Authorization: Bearer <CRON_SECRET>`.
 *
 * For every `pending` post whose `scheduled_time <= now`:
 *   1. Create a media container via Instagram Graph API.
 *   2. Publish the container.
 *   3. On success → mark as `published`, store ig_media_id, delete the
 *      image from Storage to save space.
 *   4. On failure → mark as `failed` with the error message.
 *
 * We iterate sequentially to stay well within IG's rate limits.
 */
export async function GET(req: NextRequest) {
  // ---- 0) Auth -----------------------------------------------------------
  const auth = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const igUserId = process.env.IG_USER_ID;
  const igToken = process.env.IG_ACCESS_TOKEN;
  const graphVersion = process.env.IG_GRAPH_VERSION ?? 'v21.0';

  if (!igUserId || !igToken) {
    return NextResponse.json(
      { error: 'Missing IG_USER_ID or IG_ACCESS_TOKEN env vars.' },
      { status: 500 },
    );
  }

  const supabase = getServiceClient();

  // ---- 1) Fetch due posts -----------------------------------------------
  const nowIso = new Date().toISOString();
  const { data: duePosts, error: fetchErr } = await supabase
    .from('scheduled_posts')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_time', nowIso)
    .order('scheduled_time', { ascending: true })
    .limit(25);

  if (fetchErr) {
    console.error('[publish] fetch error', fetchErr);
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  if (!duePosts || duePosts.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, message: 'Nothing due.' });
  }

  const results: Array<{
    id: string;
    status: 'published' | 'failed';
    error?: string;
    ig_media_id?: string;
  }> = [];

  // ---- 2) Iterate --------------------------------------------------------
  for (const post of duePosts as ScheduledPost[]) {
    try {
      const mediaId = await publishToInstagram({
        igUserId,
        igToken,
        graphVersion,
        imageUrl: post.image_url,
        caption: post.caption,
      });

      // Success → update DB
      const { error: updErr } = await supabase
        .from('scheduled_posts')
        .update({
          status: 'published',
          ig_media_id: mediaId,
          error_message: null,
        })
        .eq('id', post.id);

      if (updErr) throw new Error(`DB update failed: ${updErr.message}`);

      // Success → delete storage object
      if (post.storage_path) {
        const { error: delErr } = await supabase.storage
          .from(STORAGE_BUCKET)
          .remove([post.storage_path]);
        if (delErr) console.warn('[publish] storage cleanup failed', delErr);
      }

      results.push({ id: post.id, status: 'published', ig_media_id: mediaId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[publish] post ${post.id} failed:`, message);

      await supabase
        .from('scheduled_posts')
        .update({ status: 'failed', error_message: message.slice(0, 500) })
        .eq('id', post.id);

      results.push({ id: post.id, status: 'failed', error: message });
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}

/**
 * Two-step Instagram Graph API publish flow:
 *
 *   Step 1 — POST /{ig-user-id}/media
 *            → returns { id }   (this is the container/creation ID)
 *   Step 2 — POST /{ig-user-id}/media_publish
 *            body: { creation_id }
 *            → returns { id }   (the final published IG media ID)
 *
 * Docs: https://developers.facebook.com/docs/instagram-api/guides/content-publishing
 */
async function publishToInstagram(args: {
  igUserId: string;
  igToken: string;
  graphVersion: string;
  imageUrl: string;
  caption: string;
}): Promise<string> {
  const { igUserId, igToken, graphVersion, imageUrl, caption } = args;
  const base = `https://graph.facebook.com/${graphVersion}`;

  // --- Step 1: create media container ---
  const createUrl = new URL(`${base}/${igUserId}/media`);
  createUrl.searchParams.set('image_url', imageUrl);
  createUrl.searchParams.set('caption', caption);
  createUrl.searchParams.set('access_token', igToken);

  const createRes = await fetch(createUrl, { method: 'POST' });
  const createJson = await createRes.json();
  if (!createRes.ok || !createJson?.id) {
    throw new Error(
      `IG media create failed: ${createJson?.error?.message ?? createRes.statusText}`,
    );
  }
  const creationId: string = createJson.id;

  // Optional: container status poll. IG usually processes quickly for still
  // images, but we give it a short grace window.
  await waitForContainerReady({ base, creationId, igToken });

  // --- Step 2: publish container ---
  const publishUrl = new URL(`${base}/${igUserId}/media_publish`);
  publishUrl.searchParams.set('creation_id', creationId);
  publishUrl.searchParams.set('access_token', igToken);

  const publishRes = await fetch(publishUrl, { method: 'POST' });
  const publishJson = await publishRes.json();
  if (!publishRes.ok || !publishJson?.id) {
    throw new Error(
      `IG media publish failed: ${publishJson?.error?.message ?? publishRes.statusText}`,
    );
  }

  return publishJson.id as string;
}

/**
 * Poll the container's status_code until it's FINISHED.
 * Max ~15 s of waiting for still-image containers.
 */
async function waitForContainerReady(args: {
  base: string;
  creationId: string;
  igToken: string;
}) {
  const { base, creationId, igToken } = args;
  const maxAttempts = 5;
  const delayMs = 3000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const url = new URL(`${base}/${creationId}`);
    url.searchParams.set('fields', 'status_code');
    url.searchParams.set('access_token', igToken);

    const res = await fetch(url);
    const json = await res.json();
    const code: string | undefined = json?.status_code;

    if (code === 'FINISHED') return;
    if (code === 'ERROR' || code === 'EXPIRED') {
      throw new Error(`IG container status: ${code}`);
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  // Fall through — some endpoints skip the polling step and still work.
}
