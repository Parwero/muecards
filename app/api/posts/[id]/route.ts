import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, STORAGE_BUCKET } from '@/lib/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 60 * 60 * 1000;

async function rescheduleRemaining(supabase: SupabaseClient) {
  const { data: posts } = await supabase
    .from('scheduled_posts')
    .select('id, scheduled_time')
    .eq('status', 'pending')
    .order('scheduled_time', { ascending: true });

  if (!posts || posts.length < 2) return;
  const base = new Date(posts[0].scheduled_time).getTime();
  for (let i = 1; i < posts.length; i++) {
    const desired = new Date(base + i * DAY_MS).toISOString();
    if (desired !== posts[i].scheduled_time) {
      await supabase
        .from('scheduled_posts')
        .update({ scheduled_time: desired })
        .eq('id', posts[i].id);
    }
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const supabase = getServiceClient();
    const { id } = params;

    // Delete directly — no status check, no pre-fetch.
    // .select() forces Supabase to return affected rows so we know if it worked.
    const { data: deleted, error } = await supabase
      .from('scheduled_posts')
      .delete()
      .eq('id', id)
      .select('id, storage_path');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Row already gone — treat as success so the UI removes it cleanly
    if (!deleted || deleted.length === 0) {
      return NextResponse.json({ ok: true, already_gone: true });
    }

    const row = deleted[0] as { id: string; storage_path?: string | null };
    if (row.storage_path) {
      await supabase.storage
        .from(STORAGE_BUCKET)
        .remove([row.storage_path])
        .catch(() => {});
    }

    await rescheduleRemaining(supabase);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado.' },
      { status: 500 },
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const supabase = getServiceClient();
    const { id } = params;
    const body = (await req.json()) as { scheduled_time?: string };

    if (!body.scheduled_time || Number.isNaN(Date.parse(body.scheduled_time))) {
      return NextResponse.json({ error: 'scheduled_time inválido.' }, { status: 400 });
    }

    // Al confirmar un post local_queued, mover el storage_path a 'pending/'
    const { data: current } = await supabase
      .from('scheduled_posts')
      .select('storage_path')
      .eq('id', id)
      .single();

    const updates: Record<string, unknown> = {
      scheduled_time: new Date(body.scheduled_time).toISOString(),
    };
    if (current?.storage_path?.startsWith('local_queued/')) {
      updates.storage_path = current.storage_path.replace('local_queued/', 'pending/');
    }

    const { error } = await supabase
      .from('scheduled_posts')
      .update(updates)
      .eq('id', id)
      .eq('status', 'pending');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado.' },
      { status: 500 },
    );
  }
}
