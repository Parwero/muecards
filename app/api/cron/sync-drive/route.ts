import { NextRequest, NextResponse } from 'next/server';
import { getGoogleAccessToken } from '@/lib/google-auth';
import {
  driveListImages,
  driveDownload,
  driveMove,
  convertHeicToJpeg,
  EXT_FOR_MIME,
} from '@/lib/google-drive';
import { getServiceClient, STORAGE_BUCKET } from '@/lib/supabase';
import { log } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Honoured on Pro; Hobby hard-limits to 10 s

const DAY_MS       = 24 * 60 * 60 * 1000;
const PUBLISH_HOUR = 9;

/**
 * GET /api/cron/sync-drive
 *
 * Two-phase Drive agent — runs daily at 07:00 UTC (before the 08:00 UTC publish cron).
 *
 * Phase A — resolve pending "drive:*" posts
 *   Posts created by /api/drive-queue have storage_path = "drive:<fileId>:<mime>".
 *   For each, this step downloads the file, uploads to Supabase Storage, updates
 *   image_url + storage_path, and moves the file in Drive: Por Subir → Subidas.
 *   One post is processed per invocation to stay within Vercel Hobby's 10-second limit.
 *
 * Phase B — auto-pick new files from "Por Subir"
 *   Any file still in the Drive "Por Subir" folder that has no matching DB row
 *   is imported automatically with the next available scheduling slot.
 *
 * Security: Vercel injects  Authorization: Bearer <CRON_SECRET>  automatically.
 * Add CRON_SECRET to Vercel → Settings → Environment Variables.
 */
export async function GET(req: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const auth = req.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Env ─────────────────────────────────────────────────────────────────────
  const credsJson  = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const porSubirId = process.env.DRIVE_FOLDER_POR_SUBIR_ID;
  const subidasId  = process.env.DRIVE_FOLDER_SUBIDAS_ID;

  const missing = [
    !credsJson  && 'GOOGLE_SERVICE_ACCOUNT_JSON',
    !porSubirId && 'DRIVE_FOLDER_POR_SUBIR_ID',
    !subidasId  && 'DRIVE_FOLDER_SUBIDAS_ID',
  ].filter(Boolean);

  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Faltan variables de entorno: ${missing.join(', ')}` },
      { status: 500 },
    );
  }

  const supabase = getServiceClient();
  const results: Record<string, unknown>[] = [];

  try {
    const token = await getGoogleAccessToken(credsJson!);

    // ══════════════════════════════════════════════════════════════════════════
    // PHASE A — Resolve posts that were queued via /api/drive-queue
    // These have storage_path = "drive:<fileId>:<mimeType>"
    // ══════════════════════════════════════════════════════════════════════════

    // Also retry previously-failed drive posts — they failed because this cron
    // was blocked by the middleware and their relative thumbnail URL was never
    // replaced with a real Supabase Storage URL.
    const { data: drivePending } = await supabase
      .from('scheduled_posts')
      .select('id, storage_path, caption, scheduled_time')
      .in('status', ['pending', 'failed'])
      .like('storage_path', 'drive:%')
      .order('scheduled_time', { ascending: true })
      .limit(5); // Process up to 5 per run; each file ~3-8 s on Hobby

    for (const row of (drivePending ?? [])) {
      const r = row as { id: string; storage_path: string; caption: string; scheduled_time: string };
      const parts = r.storage_path.split(':'); // ["drive", "<fileId>", "<mimeType>"]
      if (parts.length < 3) continue;

      const fileId   = parts[1];
      const mimeType = parts.slice(2).join(':'); // mimeType may contain ':'
      const isHeic   = mimeType === 'image/heic' || mimeType === 'image/heif';

      try {
        const rawBuffer = await driveDownload(token, fileId);

        let finalBuffer: Buffer;
        let contentType: string;
        let outExt: string;

        if (isHeic) {
          finalBuffer = await convertHeicToJpeg(rawBuffer);
          contentType = 'image/jpeg';
          outExt      = 'jpg';
        } else {
          finalBuffer = rawBuffer;
          contentType = mimeType;
          outExt      = EXT_FOR_MIME[mimeType] ?? 'jpg';
        }

        const objectName  = `${Date.now()}-${crypto.randomUUID()}.${outExt}`;
        const storagePath = `pending/${objectName}`;

        const { error: uploadErr } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(storagePath, new Uint8Array(finalBuffer), {
            contentType, cacheControl: '3600', upsert: false,
          });

        if (uploadErr) throw new Error(`Storage upload: ${uploadErr.message}`);

        const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
        if (!urlData.publicUrl) {
          await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]).catch(() => {});
          throw new Error('No se pudo obtener la URL pública.');
        }

        // Update the post with the real Supabase URL and reset to pending
        // (post may have been 'failed' if this cron was previously blocked)
        const { error: updateErr } = await supabase
          .from('scheduled_posts')
          .update({
            image_url:     urlData.publicUrl,
            storage_path:  storagePath,
            status:        'pending',
            error_message: null,
          })
          .eq('id', r.id);

        if (updateErr) throw new Error(`DB update: ${updateErr.message}`);

        // Move Drive file: Por Subir → Subidas (non-fatal if it fails)
        let moved = true;
        let moveWarning: string | undefined;
        try {
          await driveMove(token, fileId, porSubirId!, subidasId!);
        } catch (moveErr) {
          moved       = false;
          moveWarning = moveErr instanceof Error ? moveErr.message : String(moveErr);
        }

        results.push({ phase: 'A', postId: r.id, ok: true, moved, warning: moveWarning });
      } catch (fileErr) {
        const msg = fileErr instanceof Error ? fileErr.message : String(fileErr);
        results.push({ phase: 'A', postId: r.id, ok: false, error: msg });
        await log({
          level: 'error',
          route: '/api/cron/sync-drive',
          message: 'Phase A: failed to resolve drive-pending post',
          details: { postId: r.id, fileId, error: msg },
        }).catch(() => {});
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PHASE B — Auto-pick new files from "Por Subir" not yet in the DB
    // ══════════════════════════════════════════════════════════════════════════

    const driveFiles = await driveListImages(token, porSubirId!);

    if (driveFiles.length > 0) {
      // Build a set of Drive file IDs already tracked in drive-pending posts
      const { data: existingPending } = await supabase
        .from('scheduled_posts')
        .select('storage_path')
        .eq('status', 'pending')
        .like('storage_path', 'drive:%');

      const trackedIds = new Set(
        (existingPending ?? [])
          .map((r) => (r as { storage_path: string }).storage_path.split(':')[1])
          .filter(Boolean),
      );

      // Process the first untracked file (one per invocation to stay within time limits)
      const untracked = driveFiles.filter((f) => !trackedIds.has(f.id));

      if (untracked.length > 0) {
        const file   = untracked[0];
        const isHeic = file.mimeType === 'image/heic' || file.mimeType === 'image/heif';

        // Next available scheduling slot
        const { data: latestPost } = await supabase
          .from('scheduled_posts')
          .select('scheduled_time')
          .eq('status', 'pending')
          .order('scheduled_time', { ascending: false })
          .limit(1);

        const lastMs =
          latestPost && latestPost.length > 0
            ? new Date((latestPost[0] as { scheduled_time: string }).scheduled_time).getTime()
            : Date.now();

        const nextSlot = new Date(Math.max(lastMs, Date.now()) + DAY_MS);
        nextSlot.setHours(PUBLISH_HOUR, 0, 0, 0);

        try {
          const rawBuffer = await driveDownload(token, file.id);

          let finalBuffer: Buffer;
          let contentType: string;
          let outExt: string;

          if (isHeic) {
            finalBuffer = await convertHeicToJpeg(rawBuffer);
            contentType = 'image/jpeg';
            outExt      = 'jpg';
          } else {
            finalBuffer = rawBuffer;
            contentType = file.mimeType;
            outExt      = EXT_FOR_MIME[file.mimeType] ?? 'jpg';
          }

          const objectName  = `${Date.now()}-${crypto.randomUUID()}.${outExt}`;
          const storagePath = `pending/${objectName}`;
          const caption     = file.name.replace(/\.[^/.]+$/, '');

          const { error: uploadErr } = await supabase.storage
            .from(STORAGE_BUCKET)
            .upload(storagePath, new Uint8Array(finalBuffer), {
              contentType, cacheControl: '3600', upsert: false,
            });

          if (uploadErr) throw new Error(`Storage upload: ${uploadErr.message}`);

          const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
          if (!urlData.publicUrl) {
            await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]).catch(() => {});
            throw new Error('No se pudo obtener la URL pública.');
          }

          const { error: insertErr } = await supabase
            .from('scheduled_posts')
            .insert({
              image_url:      urlData.publicUrl,
              caption,
              scheduled_time: nextSlot.toISOString(),
              status:         'pending',
              storage_path:   storagePath,
            });

          if (insertErr) throw new Error(`DB insert: ${insertErr.message}`);

          let moved = true;
          let moveWarning: string | undefined;
          try {
            await driveMove(token, file.id, porSubirId!, subidasId!);
          } catch (moveErr) {
            moved       = false;
            moveWarning = moveErr instanceof Error ? moveErr.message : String(moveErr);
          }

          results.push({
            phase: 'B', file: file.name,
            scheduledAt: nextSlot.toISOString(),
            ok: true, moved, warning: moveWarning,
            remaining: untracked.length - 1,
          });
        } catch (fileErr) {
          const msg = fileErr instanceof Error ? fileErr.message : String(fileErr);
          results.push({ phase: 'B', file: file.name, ok: false, error: msg });
        }
      }
    }

    await log({
      level: 'info',
      route: '/api/cron/sync-drive',
      message: 'Cron sync-drive completed',
      details: { results },
    }).catch(() => {});

    return NextResponse.json({ ok: true, results });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await log({
      level: 'error',
      route: '/api/cron/sync-drive',
      message: 'Cron sync-drive failed',
      details: { error: msg },
    }).catch(() => {});
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
