/**
 * test-local-files.mjs
 *
 * Tests the local-files feature logic directly (no HTTP server needed).
 * Verifies folder reading, file filtering, and thumbnail generation.
 *
 * Usage:
 *   node scripts/test-local-files.mjs
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { extname, join, basename, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const envFile = resolve(__dirname, '../.env.local');
  if (!existsSync(envFile)) return;
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnv();

const WATCH_FOLDER = process.env.WATCH_FOLDER ?? 'G:\\Mi unidad\\Poke\\Por Subir';
const IMAGE_EXTS   = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']);

let passed = 0;
let failed = 0;

function ok(msg)   { console.log(`  ✅  ${msg}`); passed++; }
function fail(msg) { console.log(`  ❌  ${msg}`); failed++; }
function skip(msg) { console.log(`  ⏭️   ${msg} (skipped)`); }

async function test(label, fn) {
  console.log(`\n[${label}]`);
  try { await fn(); }
  catch (e) { fail(`Unexpected error: ${e.message}`); }
}

// ─────────────────────────────────────────────────────────────────────────────

await test('WATCH_FOLDER is configured', () => {
  if (WATCH_FOLDER) ok(`WATCH_FOLDER = ${WATCH_FOLDER}`);
  else fail('WATCH_FOLDER is not set');
});

await test('WATCH_FOLDER exists on disk', () => {
  if (existsSync(WATCH_FOLDER)) ok('Folder exists');
  else fail(`Folder not found: ${WATCH_FOLDER}`);
});

let imageFiles = [];

await test('Lists image files in WATCH_FOLDER', () => {
  if (!existsSync(WATCH_FOLDER)) { skip('Folder missing'); return; }
  const entries = readdirSync(WATCH_FOLDER);
  imageFiles = entries.filter(f => IMAGE_EXTS.has(extname(f).toLowerCase()));
  ok(`Found ${imageFiles.length} image file(s) out of ${entries.length} total`);
  imageFiles.forEach(f => {
    const s = statSync(join(WATCH_FOLDER, f));
    console.log(`       - ${f} (${(s.size/1024).toFixed(0)} KB)`);
  });
});

await test('Path traversal prevention', () => {
  const evil = ['../passwd', '..\\windows\\system32', './../../etc/shadow', 'sub/file.jpg'];
  for (const name of evil) {
    if (basename(name) !== name) ok(`Blocked: "${name}"`);
    else if (name.includes('/') || name.includes('\\')) fail(`Not blocked: "${name}"`);
    else ok(`Plain filename accepted: "${name}"`);
  }
});

await test('Image MIME type detection', () => {
  const cases = [
    ['.jpg', true], ['.jpeg', true], ['.png', true],
    ['.webp', true], ['.heic', true], ['.heif', true],
    ['.gif', false], ['.txt', false], ['.pdf', false],
  ];
  for (const [ext, expected] of cases) {
    const result = IMAGE_EXTS.has(ext.toLowerCase());
    if (result === expected) ok(`${ext} → ${result ? 'accepted' : 'rejected'}`);
    else fail(`${ext}: expected ${expected}, got ${result}`);
  }
});

await test('Sharp thumbnail generation for first image', async () => {
  if (imageFiles.length === 0) { skip('No image files to test'); return; }

  // Dynamically import sharp (installed as dep)
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    skip('sharp not importable in this context'); return;
  }

  const file = imageFiles[0];
  const filePath = join(WATCH_FOLDER, file);
  const ext = extname(file).toLowerCase();
  const isHeic = ext === '.heic' || ext === '.heif';

  if (isHeic) {
    try {
      const heicDecode = (await import('heic-decode')).default;
      const raw = readFileSync(filePath);
      const { width, height, data } = await heicDecode({ buffer: raw });
      const jpeg = await sharp(
        Buffer.from(data.buffer, data.byteOffset, data.byteLength),
        { raw: { width, height, channels: 4 } },
      ).resize(300, 300, { fit: 'cover' }).jpeg({ quality: 75 }).toBuffer();
      ok(`HEIC→JPEG thumbnail: ${(jpeg.length/1024).toFixed(1)} KB from "${file}"`);
    } catch (e) {
      fail(`HEIC conversion failed: ${e.message}`);
    }
  } else {
    const raw = readFileSync(filePath);
    const jpeg = await sharp(raw).resize(300, 300, { fit: 'cover' }).jpeg({ quality: 75 }).toBuffer();
    if (jpeg.length > 100) ok(`Thumbnail generated: ${(jpeg.length/1024).toFixed(1)} KB from "${file}"`);
    else fail(`Thumbnail suspiciously small: ${jpeg.length} bytes`);
    // Write thumbnail to /tmp for visual inspection
    const out = join(dirname(__dirname), 'tmp_thumb_test.jpg');
    try { writeFileSync(out, jpeg); console.log(`       Preview saved: ${out}`); } catch {}
  }
});

await test('Caption extraction (filename without extension)', () => {
  const cases = [
    ['Celebration Players Ceremony.jpg', 'Celebration Players Ceremony'],
    ['mew 151 brillo.heic', 'mew 151 brillo'],
    ['card.name.with.dots.png', 'card.name.with.dots'],
  ];
  for (const [filename, expected] of cases) {
    const result = filename.replace(/\.[^/.]+$/, '');
    if (result === expected) ok(`"${filename}" → "${result}"`);
    else fail(`"${filename}": expected "${expected}", got "${result}"`);
  }
});

await test('Supabase service role key is configured', () => {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) ok('SUPABASE_SERVICE_ROLE_KEY is set');
  else fail('SUPABASE_SERVICE_ROLE_KEY missing — uploads will fail');
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) ok('NEXT_PUBLIC_SUPABASE_URL is set');
  else fail('NEXT_PUBLIC_SUPABASE_URL missing');
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n─────────────────────────────────────────────────');
console.log(`  Results: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.log('  ⚠️   Some tests failed — see above.'); process.exit(1); }
else console.log('  ✅  All tests passed.');
console.log('─────────────────────────────────────────────────\n');
