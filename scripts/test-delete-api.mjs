/**
 * test-delete-api.mjs
 *
 * Calls the actual DELETE /api/posts/:id endpoint through the HTTP stack
 * (middleware, Next.js handler, Supabase) and verifies the row is gone.
 *
 * Usage:
 *   node scripts/test-delete-api.mjs             # picks the first pending post
 *   node scripts/test-delete-api.mjs <POST_ID>   # target a specific post
 *
 * Requires AUTH_SECRET in .env.local (used as the mue_session cookie).
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

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

const MUECARDS_URL  = (process.env.MUECARDS_URL  ?? 'http://localhost:3000').replace(/\/$/, '');
const AUTH_SECRET   = process.env.AUTH_SECRET;
const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!AUTH_SECRET)              { console.error('❌  AUTH_SECRET missing from .env.local'); process.exit(1); }
if (!SUPABASE_URL||!SERVICE_KEY){ console.error('❌  Supabase credentials missing'); process.exit(1); }

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  console.log('┌─────────────────────────────────────────────────');
  console.log('│  Muecards DELETE API Test');
  console.log(`│  Target: ${MUECARDS_URL}`);
  console.log('└─────────────────────────────────────────────────\n');

  let postId = process.argv[2];

  if (!postId) {
    const { data } = await supabase
      .from('scheduled_posts')
      .select('id, caption, status, image_url')
      .eq('status', 'pending')
      .order('scheduled_time', { ascending: true })
      .limit(1);
    if (!data?.length) { console.error('❌  No pending posts to test.'); process.exit(1); }
    postId = data[0].id;
    console.log(`📌  Selected first pending post: ${postId}`);
    console.log(`    caption: ${data[0].caption}`);
    console.log(`    image:   ${data[0].image_url ? '✓' : '⚠️  NULL'}\n`);
  }

  // State before
  const { data: before } = await supabase
    .from('scheduled_posts').select('id, status').eq('id', postId).single();
  if (!before) { console.error(`❌  Post ${postId} not in DB.`); process.exit(1); }
  console.log(`📍  Before: status='${before.status}'\n`);

  // Call the API
  const url = `${MUECARDS_URL}/api/posts/${postId}`;
  console.log(`🗑️   DELETE ${url}`);
  console.log(`    Cookie: mue_session=${AUTH_SECRET.slice(0, 10)}…\n`);

  const res = await fetch(url, {
    method: 'DELETE',
    redirect: 'manual',
    headers: { Cookie: `mue_session=${AUTH_SECRET}` },
  });

  console.log(`📤  Response: ${res.status} ${res.statusText}  (type=${res.type})`);
  let body = '(empty)';
  try { body = JSON.stringify(await res.json(), null, 2); } catch {
    try { body = await res.text(); } catch {}
  }
  console.log(`    Body: ${body}\n`);

  // State after
  const { data: after } = await supabase
    .from('scheduled_posts').select('id, status').eq('id', postId).single();
  if (!after) {
    console.log('✅  Row is GONE from DB — delete succeeded.\n');
  } else {
    console.log(`❌  Row STILL EXISTS with status='${after.status}'\n`);
    console.log('    → The API returned ok but the row was not deleted.\n');
    console.log('    → Possible causes:');
    console.log('      1. The DELETE route hit an auth redirect (check type=opaqueredirect)');
    console.log('      2. Supabase delete returned 0 rows silently');
    console.log('      3. The row status is not "pending" — check diagnose-delete.mjs\n');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
