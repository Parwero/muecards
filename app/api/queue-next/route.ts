import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/queue-next
 *
 * Returns the next available slot for the "every 2 days" auto-queue mode.
 * Logic: last pending post's scheduled_time + 48 h.
 * If no pending posts exist, defaults to now + 48 h.
 */
export async function GET() {
  try {
    const supabase = getServiceClient();

    const { data, error } = await supabase
      .from('scheduled_posts')
      .select('scheduled_time')
      .eq('status', 'pending')
      .order('scheduled_time', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = "no rows found" — that's fine, not an error
      throw error;
    }

    const TWO_DAYS_MS = 48 * 60 * 60 * 1000;

    const base = data?.scheduled_time
      ? new Date(data.scheduled_time).getTime()
      : Date.now();

    const nextSlot = new Date(base + TWO_DAYS_MS);

    return NextResponse.json({ next_slot: nextSlot.toISOString() });
  } catch (err) {
    console.error('[queue-next] error', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unexpected error' },
      { status: 500 },
    );
  }
}
