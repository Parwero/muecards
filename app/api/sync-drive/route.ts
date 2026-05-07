import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, readdirSync, existsSync, mkdirSync, renameSync } from 'fs';
import { join, basename, extname } from 'path';
import sharp from 'sharp';
import heicDecode from 'heic-decode';
import { getServiceClient, STORAGE_BUCKET } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_WATCH = 'G:\\Mi unidad\\Poke\\Por Subir';
const DEFAULT_DONE  = 'G:\\Mi unidad\\Poke\\Subidas';
const IMAGE_EXTS    = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp',
  '.heic': 'image/heic', '.heif': 'image/heif',
};

export async function POST(_req: NextRequest) {
  const watchFolder = process.env.WATCH_FOLDER ?? DEFAULT_WATCH;
  const doneFolder  = process.env.DONE_FOLDER  ?? DEFAULT_DONE;

  if (!existsSync(watchFolder)) {
    return NextResponse.json(
      { error: `Carpeta no accesible desde el servidor: ${watchFolder}` },
      { status: 400 },
    );
  }

  let files: string[];
  try {
    files = readdirSync(watchFolder);
  } catch (err) {
    return NextResponse.json(
      { error: `No se puede leer la carpeta: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  const images = files.filter((f) => IMAGE_EXTS.has(extname(f).toLowerCase()));
  if (images.length === 0) {
    return NextResponse.json({ ok: true, uploaded: 0, results: [] });
  }

  try { mkdirSync(doneFolder, { recursive: true }); } catch {}

  const supabase = getServiceClient();
  const results: { file: string; ok: boolean; error?: string }[] = [];

  for (const file of images) {
    const filePath = join(watchFolder, file);
    const ext      = extname(file).toLowerCase();
    const caption  = basename(file, ext);

    try {
      const raw    = readFileSync(filePath);
      const isHeic = ext === '.heic' || ext === '.heif';

      let finalBuffer: Buffer;
      let contentType: string;
      let outExt: string;

      if (isHeic) {
        const { width, height, data } = await heicDecode({ buffer: raw });
        finalBuffer = await sharp(
          Buffer.from(data.buffer, data.byteOffset, data.byteLength),
          { raw: { width, height, channels: 4 } },
        ).jpeg({ quality: 95 }).toBuffer();
        contentType = 'image/jpeg';
        outExt = 'jpg';
      } else {
        finalBuffer = raw;
        contentType = MIME[ext] ?? 'image/jpeg';
        outExt = ext === '.png' ? 'png' : ext === '.webp' ? 'webp' : 'jpg';
      }

      const objectName  = `${Date.now()}-${crypto.randomUUID()}.${outExt}`;
      const storagePath = `local_queued/${objectName}`;

      const { error: uploadErr } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, new Uint8Array(finalBuffer), {
          contentType, cacheControl: '3600', upsert: false,
        });

      if (uploadErr) throw new Error(uploadErr.message);

      const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
      if (!urlData.publicUrl) {
        await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]).catch(() => {});
        throw new Error('No se pudo obtener URL pública.');
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
        throw new Error(insertErr.message);
      }

      // Move file to done folder — must happen after successful DB insert
      renameSync(filePath, join(doneFolder, file));

      results.push({ file, ok: true });
    } catch (err) {
      results.push({ file, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({
    ok: true,
    uploaded: results.filter((r) => r.ok).length,
    results,
  });
}
