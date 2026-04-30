import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import type { PostStatus } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/posts?status=pending
 *
 * Lists posts from the `scheduled_posts` table. Used by the dashboard queue.
 * Accepts an optional `status` query param (pending | published | failed).
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = getServiceClient();
    const statusParam = req.nextUrl.searchParams.get('status') as PostStatus | null;

    let query = supabase
      .from('scheduled_posts')
      .select('*')
      .order('scheduled_time', { ascending: true })
      .limit(100);

    if (statusParam && ['pending', 'published', 'failed'].includes(statusParam)) {
      query = query.eq('status', statusParam);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ posts: data ?? [] });
  } catch (err) {
    console.error('[posts] error', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unexpected error' },
      { status: 500 },
    );
  }
}
