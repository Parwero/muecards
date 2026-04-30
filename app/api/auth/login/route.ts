import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();

  const validUser = process.env.AUTH_USERNAME;
  const validPass = process.env.AUTH_PASSWORD;
  const secret    = process.env.AUTH_SECRET;

  if (!validUser || !validPass || !secret) {
    return NextResponse.json({ error: 'Auth not configured.' }, { status: 500 });
  }

  if (username !== validUser || password !== validPass) {
    return NextResponse.json({ error: 'Credenciales incorrectas.' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set('mue_session', secret, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  });
  return res;
}
