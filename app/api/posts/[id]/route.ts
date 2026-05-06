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

    const { data: post, error: fetchErr } = await supabase
      .from('scheduled_posts')
      .select('id, status, storage_path')
      .eq('id', id)
      .single();

    if (fetchErr || !post) {
      return NextResponse.json({ error: 'Post no encontrado.' }, { status: 404 });
    }
    if (post.status !== 'pending') {
      return NextResponse.json(
        { error: 'Solo se pueden cancelar publicaciones pendientes.' },
        { status: 409 },
      );
    }

    // .select() forces Supabase to return affected rows — exposes silent no-ops
    const { data: deleted, error: deleteErr } = await supabase
      .from('scheduled_posts')
      .delete()
      .eq('id', id)
      .eq('status', 'pending')
      .select('id');

    if (deleteErr) {
      return NextResponse.json({ error: deleteErr.message }, { status: 500 });
    }

    if (!deleted || deleted.length === 0) {
      return NextResponse.json(
        { error: 'No se pudo eliminar (estado cambiado).' },
        { status: 409 },
      );
    }

    if (post.storage_path) {
      await supabase.storage.from(STORAGE_BUCKET).remove([post.storage_path]).catch(() => {});
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

    const { data: post, error: fetchErr } = await supabase
      .from('scheduled_posts')
      .select('id, status')
      .eq('id', id)
      .single();

    if (fetchErr || !post) {
      return NextResponse.json({ error: 'Post no encontrado.' }, { status: 404 });
    }
    if (post.status !== 'pending') {
      return NextResponse.json(
        { error: 'Solo se puede reprogramar publicaciones pendientes.' },
        { status: 409 },
      );
    }

    const { error: updateErr } = await supabase
      .from('scheduled_posts')
      .update({ scheduled_time: new Date(body.scheduled_time).toISOString() })
      .eq('id', id);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado.' },
      { status: 500 },
    );
  }
}
