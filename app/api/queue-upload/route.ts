import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import heicDecode from 'heic-decode';
import { getServiceClient, STORAGE_BUCKET } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EXT_MAP: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'jpg', 'image/heif': 'jpg',
};

export async function POST(req: NextRequest) {
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
        : image.name.replace(/\.[^/.]+$/, '');

    if (caption.length > 2200) {
      return NextResponse.json({ error: 'Caption supera los 2.200 caracteres.' }, { status: 400 });
    }

    const MAX = 8 * 1024 * 1024;
    if (image.size > MAX) {
      return NextResponse.json({ error: 'Imagen supera 8 MB.' }, { status: 400 });
    }

    const rawBuffer = Buffer.from(await image.arrayBuffer());
    const name = image.name.toLowerCase();
    const isHeic =
      image.type === 'image/heic' || image.type === 'image/heif' ||
      name.endsWith('.heic') || name.endsWith('.heif');

    let finalBuffer: Buffer;
    let contentType: string;
    let ext: string;

    if (isHeic) {
      const { width, height, data } = await heicDecode({ buffer: rawBuffer });
      finalBuffer = await sharp(
        Buffer.from(data.buffer, data.byteOffset, data.byteLength),
        { raw: { width, height, channels: 4 } },
      ).jpeg({ quality: 95 }).toBuffer();
      contentType = 'image/jpeg';
      ext = 'jpg';
    } else {
      finalBuffer = rawBuffer;
      contentType = image.type || 'image/jpeg';
      ext = EXT_MAP[image.type] ?? 'jpg';
    }

    const supabase    = getServiceClient();
    const objectName  = `${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const storagePath = `local_queued/${objectName}`;

    const { error: uploadErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, new Uint8Array(finalBuffer), {
        contentType, cacheControl: '3600', upsert: false,
      });

    if (uploadErr) {
      return NextResponse.json({ error: uploadErr.message }, { status: 500 });
    }

    const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
    if (!urlData.publicUrl) {
      await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]).catch(() => {});
      return NextResponse.json({ error: 'No se pudo obtener URL pública.' }, { status: 500 });
    }

    const { data: inserted, error: insertErr } = await supabase
      .from('scheduled_posts')
      .insert({
        image_url:      urlData.publicUrl,
        caption,
        scheduled_time: '2099-01-01T09:00:00.000Z',
        status:         'pending',
        storage_path:   storagePath,
      })
      .select()
      .single();

    if (insertErr) {
      await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]).catch(() => {});
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, post: inserted }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado.' },
      { status: 500 },
    );
  }
}
