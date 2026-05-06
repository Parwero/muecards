import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, STORAGE_BUCKET } from '@/lib/supabase';
import { log } from '@/lib/logger';
import sharp from 'sharp';
import heicDecode from 'heic-decode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();

    const image = form.get('image');
    const title = form.get('title');
    const caption = form.get('caption');
    const scheduledTime = form.get('scheduled_time');

    // ---- Validation -------------------------------------------------------
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

    const isHeic =
      image.type === 'image/heic' ||
      image.type === 'image/heif' ||
      image.name.toLowerCase().endsWith('.heic') ||
      image.name.toLowerCase().endsWith('.heif');

    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    if (!allowed.includes(image.type) && !isHeic) {
      return NextResponse.json(
        { error: 'Formato no permitido. Usa JPG, PNG, WEBP o HEIC.' },
        { status: 400 },
      );
    }

    // ---- 1) Convert / prepare buffer -------------------------------------
    const rawBuffer = Buffer.from(await image.arrayBuffer());
    let finalBuffer: Buffer;
    let contentType: string;
    let ext: string;

    if (isHeic) {
      try {
        // heic-decode uses WASM libheif-js → supports both AVC and HEVC HEIC
        const { width, height, data } = await heicDecode({ buffer: rawBuffer });
        finalBuffer = await sharp(Buffer.from(data.buffer), {
          raw: { width, height, channels: 4 },
        })
          .jpeg({ quality: 95 })
          .toBuffer();
        contentType = 'image/jpeg';
        ext = 'jpg';
      } catch (convErr) {
        await log({
          level: 'error',
          route: '/api/schedule',
          message: 'HEIC→JPEG conversion failed',
          details: { filename: image.name, size: image.size, error: String(convErr) },
        });
        return NextResponse.json(
          {
            error:
              'No se pudo convertir la imagen HEIC. Abre la foto en Fotos, exporta como JPG e inténtalo de nuevo.',
          },
          { status: 400 },
        );
      }
    } else {
      finalBuffer = rawBuffer;
      contentType = image.type;
      ext = image.type === 'image/png' ? 'png' : image.type === 'image/webp' ? 'webp' : 'jpg';
    }

    // ---- 2) Upload to Storage --------------------------------------------
    const supabase = getServiceClient();
    const objectName = `${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const storagePath = `pending/${objectName}`;
    const bytes = new Uint8Array(finalBuffer);

    const { error: uploadErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, bytes, { contentType, cacheControl: '3600', upsert: false });

    if (uploadErr) {
      await log({
        level: 'error',
        route: '/api/schedule',
        message: 'Storage upload failed',
        details: { storagePath, error: uploadErr.message },
      });
      return NextResponse.json(
        { error: `No se pudo subir la imagen: ${uploadErr.message}` },
        { status: 500 },
      );
    }

    // ---- 3) Public URL ---------------------------------------------------
    const { data: publicUrlData } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(storagePath);

    const imageUrl = publicUrlData.publicUrl;
    if (!imageUrl) {
      await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
      await log({
        level: 'error',
        route: '/api/schedule',
        message: 'Could not get public URL',
        details: { storagePath },
      });
      return NextResponse.json(
        { error: 'No se pudo obtener la URL pública de la imagen.' },
        { status: 500 },
      );
    }

    // ---- 4) Insert row ---------------------------------------------------
    const { data: inserted, error: insertErr } = await supabase
      .from('scheduled_posts')
      .insert({
        image_url: imageUrl,
        caption: caption.trim(),
        scheduled_time: new Date(scheduledTime).toISOString(),
        status: 'pending',
        storage_path: storagePath,
        // title is optional — only included when the column exists in the DB
        ...(typeof title === 'string' && title.trim() ? { title: title.trim() } : {}),
      })
      .select()
      .single();

    if (insertErr) {
      await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
      await log({
        level: 'error',
        route: '/api/schedule',
        message: 'DB insert failed',
        details: { error: insertErr.message, code: insertErr.code },
      });
      return NextResponse.json(
        { error: `No se pudo guardar el registro: ${insertErr.message}` },
        { status: 500 },
      );
    }

    await log({
      level: 'info',
      route: '/api/schedule',
      message: 'Post scheduled',
      details: { id: inserted.id, scheduledTime, storagePath },
    });

    return NextResponse.json({ ok: true, post: inserted }, { status: 201 });
  } catch (err) {
    await log({
      level: 'error',
      route: '/api/schedule',
      message: 'Unexpected error',
      details: { error: err instanceof Error ? err.message : String(err) },
    }).catch(() => {});
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado.' },
      { status: 500 },
    );
  }
}
