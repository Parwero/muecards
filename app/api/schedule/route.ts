import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, STORAGE_BUCKET } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/schedule
 *
 * Accepts multipart/form-data with:
 *   - image:           File  (JPG | PNG | WEBP, <= 8 MB)
 *   - caption:         string
 *   - scheduled_time:  ISO-8601 timestamp
 *
 * Flow:
 *   1. Validate payload.
 *   2. Upload the image to the `post-images` Supabase Storage bucket.
 *   3. Resolve its public URL.
 *   4. Insert a row in `scheduled_posts` with status = 'pending'.
 *
 * On failure at step 3/4 we delete the just-uploaded object to avoid orphans.
 */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();

    const image = form.get('image');
    const title = form.get('title');
    const caption = form.get('caption');
    const scheduledTime = form.get('scheduled_time');

    // ---- Validation ------------------------------------------------------
    if (!(image instanceof File)) {
      return NextResponse.json({ error: 'Falta el archivo de imagen.' }, { status: 400 });
    }
    if (typeof caption !== 'string' || caption.trim().length === 0) {
      return NextResponse.json({ error: 'El caption es obligatorio.' }, { status: 400 });
    }
    if (caption.length > 2200) {
      return NextResponse.json(
        { error: 'El caption supera el límite de Instagram (2.200 caracteres).' },
        { status: 400 },
      );
    }
    if (typeof scheduledTime !== 'string' || Number.isNaN(Date.parse(scheduledTime))) {
      return NextResponse.json(
        { error: 'scheduled_time inválido (se esperaba ISO-8601).' },
        { status: 400 },
      );
    }
    if (new Date(scheduledTime).getTime() < Date.now()) {
      return NextResponse.json(
        { error: 'La fecha de programación debe estar en el futuro.' },
        { status: 400 },
      );
    }

    const MAX_BYTES = 8 * 1024 * 1024;
    if (image.size > MAX_BYTES) {
      return NextResponse.json({ error: 'Imagen supera 8 MB.' }, { status: 400 });
    }
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(image.type)) {
      return NextResponse.json(
        { error: 'Formato no permitido. Usa JPG, PNG o WEBP.' },
        { status: 400 },
      );
    }

    // ---- 1) Upload to Storage -------------------------------------------
    const supabase = getServiceClient();

    const ext = image.type === 'image/png' ? 'png' : image.type === 'image/webp' ? 'webp' : 'jpg';
    const objectName = `${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const storagePath = `pending/${objectName}`;

    const bytes = new Uint8Array(await image.arrayBuffer());

    const { error: uploadErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, bytes, {
        contentType: image.type,
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadErr) {
      console.error('[schedule] upload error', uploadErr);
      return NextResponse.json(
        { error: `No se pudo subir la imagen: ${uploadErr.message}` },
        { status: 500 },
      );
    }

    // ---- 2) Public URL ---------------------------------------------------
    // NOTE: Instagram requires a PUBLICLY fetchable URL. Either the bucket
    // must be public, or you must use a signed URL (getPublicUrl only works
    // with a public bucket). Easiest: make `post-images` public.
    const { data: publicUrlData } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(storagePath);

    const imageUrl = publicUrlData.publicUrl;
    if (!imageUrl) {
      // rollback
      await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
      return NextResponse.json(
        { error: 'No se pudo obtener la URL pública de la imagen.' },
        { status: 500 },
      );
    }

    // ---- 3) Insert row ---------------------------------------------------
    const { data: inserted, error: insertErr } = await supabase
      .from('scheduled_posts')
      .insert({
        image_url: imageUrl,
        title: typeof title === 'string' ? title.trim() : null,
        caption: caption.trim(),
        scheduled_time: new Date(scheduledTime).toISOString(),
        status: 'pending',
        storage_path: storagePath,
      })
      .select()
      .single();

    if (insertErr) {
      console.error('[schedule] insert error', insertErr);
      // rollback the uploaded asset
      await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
      return NextResponse.json(
        { error: `No se pudo guardar el registro: ${insertErr.message}` },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, post: inserted }, { status: 201 });
  } catch (err) {
    console.error('[schedule] unexpected', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado.' },
      { status: 500 },
    );
  }
}
