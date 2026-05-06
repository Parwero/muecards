import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, STORAGE_BUCKET } from '@/lib/supabase';
import sharp from 'sharp';
import heicDecode from 'heic-decode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/local-upload
 *
 * Called by the local folder-watcher script.
 * Auth: Authorization: Bearer <CRON_SECRET>
 * Body: multipart/form-data  { image: File, caption?: string }
 *   - caption defaults to the filename without extension
 *   - scheduled_time is auto-calculated (last pending + 48 h)
 */
export async function POST(req: NextRequest) {
  // --- Auth ---
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization') ?? '';
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const form = await req.formData();
    const image = form.get('image');
    const captionRaw = form.get('caption');

    if (!(image instanceof File)) {
      return NextResponse.json({ error: 'Falta el archivo de imagen.' }, { status: 400 });
    }

    const caption =
      typeof captionRaw === 'string' && captionRaw.trim().length > 0
        ? captionRaw.trim()
        : image.name.replace(/\.[^/.]+$/, ''); // filename without extension

    if (caption.length > 2200) {
      return NextResponse.json(
        { error: 'Caption supera los 2.200 caracteres.' },
        { status: 400 },
      );
    }

    const MAX_BYTES = 8 * 1024 * 1024;
    if (image.size > MAX_BYTES) {
      return NextResponse.json({ error: 'Imagen supera 8 MB.' }, { status: 400 });
    }

    // --- Convert image ---
    const rawBuffer = Buffer.from(await image.arrayBuffer());
    const name = image.name.toLowerCase();
    const isHeic =
      image.type === 'image/heic' ||
      image.type === 'image/heif' ||
      name.endsWith('.heic') ||
      name.endsWith('.heif');

    let finalBuffer: Buffer;
    let contentType: string;
    let ext: string;

    if (isHeic) {
      const { width, height, data } = await heicDecode({ buffer: rawBuffer });
      finalBuffer = await sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), {
        raw: { width, height, channels: 4 },
      })
        .jpeg({ quality: 95 })
        .toBuffer();
      contentType = 'image/jpeg';
      ext = 'jpg';
    } else {
      finalBuffer = rawBuffer;
      contentType = image.type;
      ext = image.type === 'image/png' ? 'png' : image.type === 'image/webp' ? 'webp' : 'jpg';
    }

    const supabase = getServiceClient();

    // --- Upload to storage ---
    const objectName = `${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const storagePath = `pending/${objectName}`;

    const { error: uploadErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, new Uint8Array(finalBuffer), {
        contentType,
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadErr) {
      return NextResponse.json(
        { error: `Upload failed: ${uploadErr.message}` },
        { status: 500 },
      );
    }

    const { data: publicUrlData } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(storagePath);

    const imageUrl = publicUrlData.publicUrl;
    if (!imageUrl) {
      await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
      return NextResponse.json({ error: 'No se pudo obtener URL pública.' }, { status: 500 });
    }

    // --- Auto-schedule: last pending + 24 h ---
    const { data: lastPost } = await supabase
      .from('scheduled_posts')
      .select('scheduled_time')
      .eq('status', 'pending')
      .order('scheduled_time', { ascending: false })
      .limit(1)
      .single();

    const DAY_MS = 24 * 60 * 60 * 1000;
    const base = lastPost?.scheduled_time
      ? new Date(lastPost.scheduled_time).getTime()
      : Date.now();
    const scheduledTime = new Date(base + DAY_MS).toISOString();

    // --- Insert row ---
    const { data: inserted, error: insertErr } = await supabase
      .from('scheduled_posts')
      .insert({ image_url: imageUrl, caption, scheduled_time: scheduledTime, status: 'pending', storage_path: storagePath })
      .select()
      .single();

    if (insertErr) {
      await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, post: inserted, scheduled_time: scheduledTime }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado.' },
      { status: 500 },
    );
  }
}
