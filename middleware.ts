import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  const session = req.cookies.get('mue_session')?.value;
  const secret = process.env.AUTH_SECRET;

  if (!secret || session !== secret) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!login|api/auth|api/publish|api/preview|_next/static|_next/image|favicon.ico).*)',
  ],
};
