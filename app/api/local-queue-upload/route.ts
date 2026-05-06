import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync, renameSync, mkdirSync } from 'fs';
import { join, basename, extname } from 'path';
import sharp from 'sharp';
import heicDecode from 'heic-decode';
import { getServiceClient, STORAGE_BUCKET } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_WATCH  = 'G:\\Mi unidad\\Poke\\Por Subir';
const DEFAULT_DONE   = 'G:\\Mi unidad\\Poke\\Subidas';
const IMAGE_EXTS     = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);
const DAY_MS         = 24 * 60 * 60 * 1000;

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp',
  '.heic': 'image/heic', '.heif': 'image/heif',
};

export async function POST(req: NextRequest) {
  try {
    const { name } = (await req.json()) as { name?: string };

    if (!name || basename(name) !== name) {
      return NextResponse.json({ error: 'Filename inválido.' }, { status: 400 });
    }

    const ext = extname(name).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) {
      return NextResponse.json({ error: 'Formato no soportado.' }, { status: 400 });
    }

    const watchFolder = process.env.WATCH_FOLDER ?? DEFAULT_WATCH;
    const doneFolder  = process.env.DONE_FOLDER  ?? DEFAULT_DONE;
    const filePath    = join(watchFolder, name);

    if (!existsSync(filePath)) {
      return NextResponse.json({ error: 'Archivo no encontrado en la carpeta.' }, { status: 404 });
    }

    // ── Convert image ────────────────────────────────────────────────────────
    const raw = readFileSync(filePath);
    const isHeic = ext === '.heic' || ext === '.heif';

    let finalBuffer: Buffer;
    let contentType: string;
    let outExt: string;

    if (isHeic) {
      const { width, height, data } = await heicDecode({ buffer: raw });
      finalBuffer = await sharp(
        Buffer.from(data.buffer, data.byteOffset, data.byteLength),
        { raw: { width, height, channels: 4 } },
      )
        .jpeg({ quality: 95 })
        .toBuffer();
      contentType = 'image/jpeg';
      outExt = 'jpg';
    } else {
      finalBuffer = raw;
      contentType = MIME[ext] ?? 'image/jpeg';
      outExt = ext === '.png' ? 'png' : ext === '.webp' ? 'webp' : 'jpg';
    }

    // ── Upload to Supabase Storage ───────────────────────────────────────────
    const supabase    = getServiceClient();
    const objectName  = `${Date.now()}-${crypto.randomUUID()}.${outExt}`;
    const storagePath = `local_queued/${objectName}`;

    const { error: uploadErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, new Uint8Array(finalBuffer), {
        contentType,
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadErr) {
      return NextResponse.json({ error: uploadErr.message }, { status: 500 });
    }

    const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
    const imageUrl = urlData.publicUrl;

    if (!imageUrl) {
      await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]).catch(() => {});
      return NextResponse.json({ error: 'No se pudo obtener URL pública.' }, { status: 500 });
    }

    // Fecha sentinel: el publicador solo procesa scheduled_time <= now.
    // El usuario asigna la fecha real desde el panel.
    const scheduledTime = '2099-01-01T09:00:00.000Z';
    const caption       = basename(name, ext);

    // ── Insert DB row ────────────────────────────────────────────────────────
    const { data: inserted, error: insertErr } = await supabase
      .from('scheduled_posts')
      .insert({ image_url: imageUrl, caption, scheduled_time: scheduledTime, status: 'pending', storage_path: storagePath })
      .select()
      .single();

    if (insertErr) {
      await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]).catch(() => {});
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    // ── Move file to done folder (best-effort) ───────────────────────────────
    try {
      mkdirSync(doneFolder, { recursive: true });
      renameSync(filePath, join(doneFolder, name));
    } catch {}

    return NextResponse.json({ ok: true, post: inserted }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado.' },
      { status: 500 },
    );
  }
}
