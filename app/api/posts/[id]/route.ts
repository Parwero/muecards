import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, STORAGE_BUCKET } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const supabase = getServiceClient();
    const { id } = params;

    // Fetch the row first to get the storage_path
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

    // Delete DB row
    const { error: deleteErr } = await supabase
      .from('scheduled_posts')
      .delete()
      .eq('id', id);

    if (deleteErr) {
      return NextResponse.json({ error: deleteErr.message }, { status: 500 });
    }

    // Best-effort storage cleanup
    if (post.storage_path) {
      await supabase.storage.from(STORAGE_BUCKET).remove([post.storage_path]).catch(() => {});
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error inesperado.' },
      { status: 500 },
    );
  }
}
