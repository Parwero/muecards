/**
 * diagnose-delete.mjs
 *
 * Queries Supabase directly to show ALL posts (any status) and
 * attempts to delete pending ones, reporting exactly what happens.
 *
 * Usage:
 *   node scripts/diagnose-delete.mjs
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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌  Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  console.log('┌─────────────────────────────────────────────────');
  console.log('│  Muecards DELETE Diagnostics');
  console.log('└─────────────────────────────────────────────────\n');

  // 1. Show ALL rows in scheduled_posts
  const { data: all, error: listErr } = await supabase
    .from('scheduled_posts')
    .select('id, status, image_url, caption, scheduled_time, storage_path')
    .order('scheduled_time', { ascending: true });

  if (listErr) { console.error('❌  Fetch error:', listErr.message); process.exit(1); }

  console.log(`📋  ${all?.length ?? 0} row(s) in scheduled_posts:\n`);
  for (const p of all ?? []) {
    console.log(`  [${p.status.toUpperCase().padEnd(9)}] ${p.id}`);
    console.log(`    caption:  ${(p.caption ?? '').slice(0, 60)}`);
    console.log(`    image:    ${p.image_url ? p.image_url.slice(0, 80) : '⚠️  NULL'}`);
    console.log(`    storage:  ${p.storage_path ?? '(none)'}`);
    console.log(`    time:     ${new Date(p.scheduled_time).toLocaleString('es-ES')}`);
    console.log();
  }

  // 2. Attempt direct Supabase delete on each pending row
  const pending = (all ?? []).filter(p => p.status === 'pending');
  if (pending.length === 0) {
    console.log('ℹ️   No pending posts — nothing to delete-test.\n');
    return;
  }

  console.log(`\n🧪  Testing direct delete on ${pending.length} pending row(s)...\n`);
  for (const p of pending) {
    process.stdout.write(`  → ${p.id.slice(0, 8)}… "${(p.caption ?? '').slice(0, 30)}" … `);

    const { data: deleted, error: delErr } = await supabase
      .from('scheduled_posts')
      .delete()
      .eq('id', p.id)
      .eq('status', 'pending')
      .select('id');

    if (delErr) {
      console.log(`❌  error: ${delErr.message}`);
      continue;
    }
    if (!deleted || deleted.length === 0) {
      console.log('⚠️   0 rows affected — status must have changed mid-flight');
      const { data: cur } = await supabase
        .from('scheduled_posts').select('status').eq('id', p.id).single();
      console.log(`     current status in DB: ${cur?.status ?? 'ROW GONE'}`);
    } else {
      console.log(`✓  deleted`);
    }
  }
  console.log('\n✓  Done.\n');
}

main().catch(err => { console.error(err); process.exit(1); });
