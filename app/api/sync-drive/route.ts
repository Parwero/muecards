import { NextRequest, NextResponse } from 'next/server';
import { getGoogleAccessToken } from '@/lib/google-auth';
import { driveListImages, driveDownload, driveMove, convertHeicToJpeg, EXT_FOR_MIME } from '@/lib/google-drive';
import { getServiceClient, STORAGE_BUCKET } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/sync-drive  (legacy bulk import — kept for backwards compatibility)
 *
 * Downloads ALL images from the "Por Subir" Drive folder, uploads them to Supabase
 * with a sentinel date (2099) and moves them to "Subidas" in Drive.
 *
 * The preferred flow is now:
 *   GET  /api/drive-list      → list files without downloading
 *   POST /api/drive-import    → import one file with a real scheduled date
 *
 * This endpoint is kept so any existing integrations or manual calls keep working.
 */
export async function POST(_req: NextRequest) {
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
      { error: `Faltan variables de entorno en Vercel: ${missing.join(', ')}. Ve a Vercel → Settings → Environment Variables y añádelas.` },
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

  let files;
  try {
    files = await driveListImages(token, porSubirId!);
  } catch (e) {
    return NextResponse.json(
      { error: `No se pudo leer "Por Subir" en Drive: ${e instanceof Error ? e.message : String(e)}. ¿Compartiste la carpeta con la cuenta de servicio?` },
      { status: 500 },
    );
  }

  if (files.length === 0) {
    return NextResponse.json({ ok: true, uploaded: 0, moved: 0, results: [] });
  }

  const supabase = getServiceClient();
  const results: { file: string; ok: boolean; moved: boolean; error?: string }[] = [];

  for (const file of files) {
    const caption = file.name.replace(/\.[^/.]+$/, '');
    const isHeic  = file.mimeType === 'image/heic' || file.mimeType === 'image/heif';

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
      const storagePath = `local_queued/${objectName}`;

      const { error: uploadErr } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, new Uint8Array(finalBuffer), {
          contentType, cacheControl: '3600', upsert: false,
        });

      if (uploadErr) throw new Error(`Supabase upload: ${uploadErr.message}`);

      const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
      if (!urlData.publicUrl) {
        await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]).catch(() => {});
        throw new Error('No se pudo obtener URL pública de Supabase.');
      }

      const { error: insertErr } = await supabase
        .from('scheduled_posts')
        .insert({
          image_url:      urlData.publicUrl,
          caption,
          scheduled_time: '2099-01-01T09:00:00.000Z',
          status:         'pending',
          storage_path:   storagePath,
        });

      if (insertErr) {
        await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]).catch(() => {});
        throw new Error(`DB insert: ${insertErr.message}`);
      }

      try {
        await driveMove(token, file.id, porSubirId!, subidasId!);
        results.push({ file: file.name, ok: true, moved: true });
      } catch (moveErr) {
        results.push({
          file: file.name, ok: true, moved: false,
          error: `Subido OK, no movido en Drive: ${moveErr instanceof Error ? moveErr.message : String(moveErr)}`,
        });
      }
    } catch (err) {
      results.push({
        file: file.name, ok: false, moved: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    ok:       true,
    uploaded: results.filter((r) => r.ok).length,
    moved:    results.filter((r) => r.moved).length,
    warnings: results.filter((r) => r.ok && !r.moved).map((r) => r.error),
    results,
  });
}
