import { NextRequest, NextResponse } from 'next/server';
import {
  readFileSync, readdirSync, existsSync, mkdirSync,
  renameSync, copyFileSync, unlinkSync,
} from 'fs';
import { join, basename, extname } from 'path';
import { getServiceClient, STORAGE_BUCKET } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// NOTE: sharp and heic-decode are intentionally NOT imported at the top level.
// Top-level imports of native/WASM modules can cause the entire route module to
// fail to load if the package is missing or not yet downloaded by Google Drive.
// Instead we require() them dynamically inside the per-file try/catch so that
// a missing package only fails that one file, not the whole sync operation.

const DEFAULT_WATCH = 'G:\\Mi unidad\\Poke\\Por Subir';
const DEFAULT_DONE  = 'G:\\Mi unidad\\Poke\\Subidas';
const IMAGE_EXTS    = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp',
  '.heic': 'image/heic', '.heif': 'image/heif',
};

/**
 * Robustly moves a file: tries renameSync first (fastest), falls back to
 * copyFileSync + unlinkSync if rename fails (e.g. cross-device or cloud FS).
 * Returns null on success, or an error message string on failure.
 */
function moveFile(src: string, dst: string): string | null {
  try {
    renameSync(src, dst);
    return null;
  } catch (renameErr) {
    try {
      copyFileSync(src, dst);
      try {
        unlinkSync(src);
      } catch (unlinkErr) {
        // Copied OK but couldn't delete source — report as partial success
        return `Copiado a Subidas pero no se pudo eliminar el original: ${unlinkErr instanceof Error ? unlinkErr.message : String(unlinkErr)}`;
      }
      return null;
    } catch (copyErr) {
      return `No se pudo mover el archivo (renameSync: ${renameErr instanceof Error ? renameErr.message : String(renameErr)}; copyFileSync: ${copyErr instanceof Error ? copyErr.message : String(copyErr)})`;
    }
  }
}

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
  const results: { file: string; ok: boolean; moved: boolean; error?: string }[] = [];

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
        // Dynamically require sharp so a missing native module only fails this
        // file rather than crashing the whole route at module-load time.
        // sharp (with libvips) supports HEIC/HEIF natively — no heic-decode needed.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const sharp = require('sharp') as typeof import('sharp');
        finalBuffer = await sharp(raw).jpeg({ quality: 95 }).toBuffer();
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

      if (uploadErr) throw new Error(`Upload: ${uploadErr.message}`);

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
        throw new Error(`DB insert: ${insertErr.message}`);
      }

      // Move original file to done folder — after successful DB insert.
      // Uses renameSync first; falls back to copy+delete for Google Drive edge cases.
      const moveErr = moveFile(filePath, join(doneFolder, file));
      if (moveErr) {
        // Upload + DB insert succeeded — the card is in the queue.
        // Report the move failure as a warning, not a full error.
        results.push({ file, ok: true, moved: false, error: `Subido OK pero no movido: ${moveErr}` });
      } else {
        results.push({ file, ok: true, moved: true });
      }
    } catch (err) {
      results.push({
        file, ok: false, moved: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    uploaded: results.filter((r) => r.ok).length,
    moved:    results.filter((r) => r.moved).length,
    warnings: results.filter((r) => r.ok && !r.moved).map((r) => r.error),
    results,
  });
}
