/**
 * test-local-files.mjs
 *
 * Verifies that /api/local-files and /api/local-file-preview work correctly
 * against a running local dev server (http://localhost:3000).
 *
 * Usage:
 *   node scripts/test-local-files.mjs
 *
 * Requires AUTH_SECRET in .env.local.
 * The Next.js app must be running: npm run dev
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const envFile = resolve(__dirname, '../.env.local');
  if (!existsSync(envFile)) { console.error('❌  .env.local not found'); process.exit(1); }
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

const BASE  = 'http://localhost:3000';
const AUTH  = process.env.AUTH_SECRET ?? '';
const WATCH = process.env.WATCH_FOLDER ?? 'G:\\Mi unidad\\Poke\\Por Subir';

if (!AUTH) { console.error('❌  AUTH_SECRET missing from .env.local'); process.exit(1); }

const COOKIE = `mue_session=${AUTH}`;
const HEADERS = { Cookie: COOKIE };

let passed = 0;
let failed = 0;

function ok(msg)  { console.log(`  ✅  ${msg}`); passed++; }
function fail(msg) { console.log(`  ❌  ${msg}`); failed++; }

async function test(label, fn) {
  process.stdout.write(`\n[${label}]\n`);
  try { await fn(); }
  catch (e) { fail(`Unexpected error: ${e.message}`); }
}

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('┌─────────────────────────────────────────────────');
  console.log('│  Local-files feature tests');
  console.log(`│  Target: ${BASE}`);
  console.log(`│  Folder: ${WATCH}`);
  console.log('└─────────────────────────────────────────────────');

  // ── 1. /api/local-files returns JSON ──────────────────────────────────────
  await test('GET /api/local-files — returns 200 + JSON', async () => {
    const res = await fetch(`${BASE}/api/local-files`, { headers: HEADERS });
    if (res.status === 200) ok(`Status 200`);
    else fail(`Expected 200, got ${res.status}`);

    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) ok('Content-Type is application/json');
    else fail(`Content-Type: ${ct}`);

    const data = await res.json();
    if (typeof data.available === 'boolean') ok(`"available" field present: ${data.available}`);
    else fail('"available" field missing');

    if (Array.isArray(data.files)) ok(`"files" is array (${data.files.length} items)`);
    else fail('"files" is not an array');

    if (data.available && data.files.length > 0) {
      const first = data.files[0];
      if (first.name) ok(`First file: ${first.name} (${(first.size/1024).toFixed(0)} KB)`);
      else fail('File entry missing "name" field');
    } else if (!data.available) {
      ok(`Folder not accessible (running on Vercel or WATCH_FOLDER not set) — that's expected`);
    } else {
      ok('Folder is accessible but empty');
    }

    // Return for further tests
    return data;
  });

  // ── 2. Files list shape ───────────────────────────────────────────────────
  await test('GET /api/local-files — file entries have correct shape', async () => {
    const res = await fetch(`${BASE}/api/local-files`, { headers: HEADERS });
    const data = await res.json();
    if (!data.available || data.files.length === 0) {
      ok('Skipped (no files available)');
      return;
    }
    for (const f of data.files.slice(0, 3)) {
      if (typeof f.name === 'string' && typeof f.size === 'number') ok(`${f.name}: name+size OK`);
      else fail(`${JSON.stringify(f)}: missing fields`);
    }
  });

  // ── 3. /api/local-file-preview serves an image ────────────────────────────
  await test('GET /api/local-file-preview — returns image/jpeg for first file', async () => {
    const listRes = await fetch(`${BASE}/api/local-files`, { headers: HEADERS });
    const listData = await listRes.json();

    if (!listData.available || listData.files.length === 0) {
      ok('Skipped (no files available)');
      return;
    }

    const firstName = listData.files[0].name;
    const url = `${BASE}/api/local-file-preview?name=${encodeURIComponent(firstName)}`;
    const imgRes = await fetch(url, { headers: HEADERS });

    if (imgRes.status === 200) ok(`Status 200 for "${firstName}"`);
    else fail(`Expected 200, got ${imgRes.status} for "${firstName}"`);

    const ct = imgRes.headers.get('content-type') ?? '';
    if (ct.includes('image/jpeg')) ok('Content-Type is image/jpeg');
    else fail(`Content-Type: ${ct}`);

    const buf = await imgRes.arrayBuffer();
    if (buf.byteLength > 100) ok(`Image size: ${(buf.byteLength/1024).toFixed(1)} KB`);
    else fail(`Image too small: ${buf.byteLength} bytes`);
  });

  // ── 4. Path traversal protection ──────────────────────────────────────────
  await test('GET /api/local-file-preview — blocks path traversal', async () => {
    const res = await fetch(
      `${BASE}/api/local-file-preview?name=..%2F..%2Fpasswd`,
      { headers: HEADERS },
    );
    if (res.status === 400) ok('Blocked ../../../passwd with 400');
    else fail(`Expected 400, got ${res.status}`);
  });

  // ── 5. Missing file returns 404 ───────────────────────────────────────────
  await test('GET /api/local-file-preview — returns 404 for unknown file', async () => {
    const res = await fetch(
      `${BASE}/api/local-file-preview?name=no_existe_abc123.jpg`,
      { headers: HEADERS },
    );
    if (res.status === 404) ok('Returns 404 for non-existent file');
    else fail(`Expected 404, got ${res.status}`);
  });

  // ── 6. Auth required (unauthenticated request is redirected) ──────────────
  await test('GET /api/local-files — requires authentication', async () => {
    const res = await fetch(`${BASE}/api/local-files`, { redirect: 'manual' });
    // Middleware redirects to /login → 307/302, or returns 200 with login HTML
    if (res.status === 307 || res.status === 302 || res.status === 0) {
      ok(`Unauthenticated request redirected (${res.status})`);
    } else if (res.status === 200) {
      const text = await res.text();
      if (text.includes('login') || text.includes('Login')) ok('Unauthenticated: got login page');
      else fail(`Unauthenticated got 200 with non-login content`);
    } else {
      ok(`Got ${res.status} without auth (acceptable)`);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  console.log('\n─────────────────────────────────────────────────');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) { console.log('  ⚠️  Some tests failed — see above.'); process.exit(1); }
  else console.log('  ✅  All tests passed.');
  console.log('─────────────────────────────────────────────────\n');
}

main().catch(err => { console.error(err); process.exit(1); });
