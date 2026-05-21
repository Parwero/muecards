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

const DAY_MS      = 24 * 60 * 60 * 1000;
const PUBLISH_HOUR = 9; // Hour at which Instagram posts are published

/**
 * GET /api/cron/sync-drive
 *
 * Automated agent that keeps Google Drive ↔ Supabase queue in sync.
 *
 * Each invocation:
 *   1. Lists images in the "Por Subir" Drive folder.
 *   2. Picks the FIRST unprocessed file.
 *   3. Downloads it, converts HEIC → JPEG if needed, uploads to Supabase Storage.
 *   4. Inserts a `scheduled_posts` row with the next available date slot.
 *   5. Moves the file in Drive: Por Subir → Subidas.
 *
 * Processing one file per invocation keeps execution time within Vercel Hobby's
 * 10-second limit. To drain a batch of files quickly, run this cron hourly or
 * more often (requires Vercel Pro; Hobby allows at most one daily cron).
 *
 * Security: Vercel automatically injects
 *   Authorization: Bearer <CRON_SECRET>
 * when calling cron routes. Set CRON_SECRET in Vercel → Settings → Env Vars.
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

  try {
    // ── Step 1: Auth + list ──────────────────────────────────────────────────
    const token = await getGoogleAccessToken(credsJson!);
    const files  = await driveListImages(token, porSubirId!);

    if (files.length === 0) {
      return NextResponse.json({
        ok: true,
        processed: 0,
        message: 'No hay fotos en la carpeta Por Subir.',
      });
    }

    // Process only the first file to stay within function-duration limits.
    // The next cron run will pick up the second file, etc.
    const file   = files[0];
    const isHeic = file.mimeType === 'image/heic' || file.mimeType === 'image/heif';

    // ── Step 2: Calculate next scheduling slot ───────────────────────────────
    const supabase = getServiceClient();

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

    // ── Step 3: Download + convert ───────────────────────────────────────────
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

    // ── Step 4: Upload to Supabase Storage ───────────────────────────────────
    const objectName  = `${Date.now()}-${crypto.randomUUID()}.${outExt}`;
    const storagePath = `pending/${objectName}`;
    const caption     = file.name.replace(/\.[^/.]+$/, '');

    const { error: uploadErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, new Uint8Array(finalBuffer), {
        contentType, cacheControl: '3600', upsert: false,
      });

    if (uploadErr) throw new Error(`Supabase Storage: ${uploadErr.message}`);

    const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
    if (!urlData.publicUrl) {
      await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]).catch(() => {});
      throw new Error('No se pudo obtener la URL pública de Supabase.');
    }

    // ── Step 5: Insert DB row ────────────────────────────────────────────────
    const { error: insertErr } = await supabase
      .from('scheduled_posts')
      .insert({
        image_url:      urlData.publicUrl,
        caption,
        scheduled_time: nextSlot.toISOString(),
        status:         'pending',
        storage_path:   storagePath,
      });

    if (insertErr) {
      await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]).catch(() => {});
      throw new Error(`DB insert: ${insertErr.message}`);
    }

    // ── Step 6: Move in Drive ────────────────────────────────────────────────
    let moved = true;
    let moveWarning: string | undefined;
    try {
      await driveMove(token, file.id, porSubirId!, subidasId!);
    } catch (moveErr) {
      moved       = false;
      moveWarning = moveErr instanceof Error ? moveErr.message : String(moveErr);
    }

    await log({
      level: 'info',
      route: '/api/cron/sync-drive',
      message: 'Auto-imported file from Drive',
      details: {
        fileName:    file.name,
        scheduledAt: nextSlot.toISOString(),
        moved,
        remaining:   files.length - 1,
        warning:     moveWarning,
      },
    });

    return NextResponse.json({
      ok:          true,
      processed:   1,
      file:        file.name,
      scheduledAt: nextSlot.toISOString(),
      remaining:   files.length - 1,
      moved,
      warning:     moveWarning,
    });

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
