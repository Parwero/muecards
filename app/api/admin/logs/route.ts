import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const level = searchParams.get('level'); // filter: error | warn | info
  const limit = Math.min(Number(searchParams.get('limit') ?? 100), 500);

  const supabase = getServiceClient();

  let query = supabase
    .from('app_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (level) query = query.eq('level', level);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ logs: data ?? [] });
}
