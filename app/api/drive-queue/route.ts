import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/drive-queue
 *
 * Fast path: saves a Drive file's scheduled date to the queue in < 1 second.
 * No file download or conversion happens here — the heavy work is deferred to
 * the daily cron (GET /api/cron/sync-drive), which runs at 07:00 UTC before
 * the 08:00 UTC publish window.
 *
 * The post appears immediately in the "En cola" section with a thumbnail
 * served via /api/drive-thumbnail (a lightweight Google-authenticated proxy).
 * The cron later replaces image_url with the final Supabase Storage URL and
 * moves the file in Drive: Por Subir → Subidas.
 *
 * storage_path convention for drive-pending posts:
 *   "drive:<driveFileId>:<mimeType>"
 */
export async function POST(req: NextRequest) {
  let body: {
    driveFileId?: string;
    driveName?: string;
    driveFileMime?: string;
    scheduledTime?: string;
  };

  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 });
  }

  const { driveFileId, driveName, driveFileMime, scheduledTime } = body;

  if (!driveFileId || !driveName || !driveFileMime || !scheduledTime) {
    return NextResponse.json(
      { error: 'Faltan campos: driveFileId, driveName, driveFileMime, scheduledTime.' },
      { status: 400 },
    );
  }

  const scheduled = new Date(scheduledTime);
  if (isNaN(scheduled.getTime())) {
    return NextResponse.json({ error: 'scheduledTime no es una fecha válida.' }, { status: 400 });
  }

  try {
    const supabase = getServiceClient();
    const caption  = driveName.replace(/\.[^/.]+$/, '');

    // Thumbnail proxy URL — renders immediately in the browser queue
    const imageUrl = `/api/drive-thumbnail?id=${driveFileId}&mime=${encodeURIComponent(driveFileMime)}`;

    // Marker for the cron: "this post still needs its real image downloaded from Drive"
    const storagePath = `drive:${driveFileId}:${driveFileMime}`;

    const { data: inserted, error: insertErr } = await supabase
      .from('scheduled_posts')
      .insert({
        image_url:      imageUrl,
        caption,
        scheduled_time: scheduled.toISOString(),
        status:         'pending',
        storage_path:   storagePath,
      })
      .select()
      .single();

    if (insertErr) throw new Error(`DB insert: ${insertErr.message}`);
    if (!inserted)  throw new Error('No se pudo insertar el post.');

    return NextResponse.json({ ok: true, post: inserted });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
