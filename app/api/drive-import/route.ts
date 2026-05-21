import { NextRequest, NextResponse } from 'next/server';
import { getGoogleAccessToken } from '@/lib/google-auth';
import { driveDownload, driveMove, convertHeicToJpeg, EXT_FOR_MIME } from '@/lib/google-drive';
import { getServiceClient, STORAGE_BUCKET } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/drive-import
 *
 * Imports a single Google Drive file into the publishing queue.
 * Called when the user confirms a Drive file from the "Por subir" panel.
 *
 * Body: { driveFileId, driveName, driveFileMime, scheduledTime }
 *
 * Steps:
 *   1. Download the file from Drive
 *   2. Convert HEIC → JPEG if needed
 *   3. Upload to Supabase Storage
 *   4. Insert DB row with the real scheduled_time
 *   5. Move the file in Drive: Por Subir → Subidas
 */
export async function POST(req: NextRequest) {
  let body: { driveFileId?: string; driveName?: string; driveFileMime?: string; scheduledTime?: string };
  try {
    body = await req.json() as typeof body;
  } catch {
    return NextResponse.json({ error: 'JSON inválido en el cuerpo de la petición.' }, { status: 400 });
  }

  const { driveFileId, driveName, driveFileMime, scheduledTime } = body;

  if (!driveFileId || !driveName || !driveFileMime || !scheduledTime) {
    return NextResponse.json(
      { error: 'Faltan campos: driveFileId, driveName, driveFileMime, scheduledTime.' },
      { status: 400 },
    );
  }

  // Validate scheduledTime is a real future date (not 2099)
  const scheduled = new Date(scheduledTime);
  if (isNaN(scheduled.getTime())) {
    return NextResponse.json({ error: 'scheduledTime no es una fecha válida.' }, { status: 400 });
  }

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
      { status: 400 },
    );
  }

  let token: string;
  try {
    token = await getGoogleAccessToken(credsJson!);
  } catch (e) {
    return NextResponse.json(
      { error: `Error autenticando con Google: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }

  try {
    // 1. Download from Drive
    const rawBuffer = await driveDownload(token, driveFileId);
    const isHeic    = driveFileMime === 'image/heic' || driveFileMime === 'image/heif';

    // 2. Convert if needed
    let finalBuffer: Buffer;
    let contentType: string;
    let outExt: string;

    if (isHeic) {
      finalBuffer = await convertHeicToJpeg(rawBuffer);
      contentType = 'image/jpeg';
      outExt      = 'jpg';
    } else {
      finalBuffer = rawBuffer;
      contentType = driveFileMime;
      outExt      = EXT_FOR_MIME[driveFileMime] ?? 'jpg';
    }

    // 3. Upload to Supabase Storage
    const supabase    = getServiceClient();
    const objectName  = `${Date.now()}-${crypto.randomUUID()}.${outExt}`;
    const storagePath = `pending/${objectName}`;
    const caption     = driveName.replace(/\.[^/.]+$/, '');

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

    // 4. Insert DB row with the real scheduled date
    const { data: inserted, error: insertErr } = await supabase
      .from('scheduled_posts')
      .insert({
        image_url:      urlData.publicUrl,
        caption,
        scheduled_time: scheduled.toISOString(),
        status:         'pending',
        storage_path:   storagePath,
      })
      .select()
      .single();

    if (insertErr) {
      await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]).catch(() => {});
      throw new Error(`DB insert: ${insertErr.message}`);
    }

    // 5. Move in Drive: Por Subir → Subidas (failure here is non-fatal)
    let moved = true;
    let moveWarning: string | undefined;
    try {
      await driveMove(token, driveFileId, porSubirId!, subidasId!);
    } catch (moveErr) {
      moved = false;
      moveWarning = moveErr instanceof Error ? moveErr.message : String(moveErr);
    }

    return NextResponse.json({ ok: true, post: inserted, moved, warning: moveWarning });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
