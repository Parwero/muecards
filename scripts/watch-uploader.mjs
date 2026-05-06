/**
 * watch-uploader.mjs
 *
 * Watches a local folder and auto-uploads new images to the Muecards scheduler.
 * The filename (without extension) becomes the Instagram caption.
 * Each uploaded file is moved to a "subidas/" subfolder.
 *
 * Usage:
 *   node scripts/watch-uploader.mjs
 *
 * Config — set these in .env.local or as environment variables:
 *   MUECARDS_URL   = https://muecards2.vercel.app   (your Vercel URL)
 *   CRON_SECRET    = <your CRON_SECRET value>
 *   WATCH_FOLDER   = G:\Mi unidad\Poke\Subidas      (optional, this is the default)
 *   POLL_INTERVAL  = 30                             (seconds, optional)
 */

import { readFileSync, readdirSync, existsSync, mkdirSync, renameSync } from 'fs';
import { join, extname, basename, resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load .env.local ───────────────────────────────────────────────────────────
function loadEnv() {
  const envFile = resolve(__dirname, '../.env.local');
  if (!existsSync(envFile)) return;
  const lines = readFileSync(envFile, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnv();

// ── Config ────────────────────────────────────────────────────────────────────
const MUECARDS_URL = (process.env.MUECARDS_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const CRON_SECRET  = process.env.CRON_SECRET ?? '';
const WATCH_FOLDER = process.env.WATCH_FOLDER ?? 'G:\\Mi unidad\\Poke\\Subidas';
const DONE_FOLDER  = join(WATCH_FOLDER, 'subidas');
const POLL_SECS    = parseInt(process.env.POLL_INTERVAL ?? '30', 10);

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
};

// ── Validate ──────────────────────────────────────────────────────────────────
if (!CRON_SECRET) {
  console.error('❌  CRON_SECRET is not set. Add it to .env.local or set it as an env var.');
  process.exit(1);
}

if (!existsSync(WATCH_FOLDER)) {
  console.error(`❌  Watch folder not found: ${WATCH_FOLDER}`);
  process.exit(1);
}

if (!existsSync(DONE_FOLDER)) {
  mkdirSync(DONE_FOLDER, { recursive: true });
  console.log(`📁  Created done folder: ${DONE_FOLDER}`);
}

// ── Upload one file ───────────────────────────────────────────────────────────
async function uploadFile(filePath, fileName) {
  const caption = basename(fileName, extname(fileName));
  const ext     = extname(fileName).toLowerCase();
  const mime    = MIME[ext] ?? 'application/octet-stream';
  const bytes   = readFileSync(filePath);

  const form = new FormData();
  form.append('image', new File([bytes], fileName, { type: mime }));
  form.append('caption', caption);

  const res = await fetch(`${MUECARDS_URL}/api/local-upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
    body: form,
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const d = await res.json(); msg = d.error ?? msg; } catch {}
    throw new Error(msg);
  }

  const data = await res.json();
  return data.scheduled_time;
}

// ── Scan folder ───────────────────────────────────────────────────────────────
async function scan() {
  let files;
  try {
    files = readdirSync(WATCH_FOLDER);
  } catch {
    return;
  }

  const images = files.filter(f => IMAGE_EXTS.has(extname(f).toLowerCase()));
  if (images.length === 0) return;

  console.log(`\n🔍  Found ${images.length} image(s) to upload…`);

  for (const file of images) {
    const src  = join(WATCH_FOLDER, file);
    const dest = join(DONE_FOLDER, file);

    process.stdout.write(`   ↑  ${file} … `);
    try {
      const scheduledAt = await uploadFile(src, file);
      renameSync(src, dest);
      console.log(`✓  programada para ${new Date(scheduledAt).toLocaleString('es-ES')}`);
    } catch (err) {
      console.log(`✗  ${err.message}`);
    }
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────────
console.log('┌─────────────────────────────────────────────────');
console.log(`│  Muecards folder watcher`);
console.log(`│  Carpeta:   ${WATCH_FOLDER}`);
console.log(`│  Servidor:  ${MUECARDS_URL}`);
console.log(`│  Intervalo: cada ${POLL_SECS}s`);
console.log('└─────────────────────────────────────────────────');
console.log('Ctrl+C para detener.\n');

scan();
setInterval(scan, POLL_SECS * 1000);
