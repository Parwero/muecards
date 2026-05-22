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
    // Exclude: public auth routes, cron endpoints (they use CRON_SECRET, not session cookie),
    // and Next.js internals.
    '/((?!login|api/auth|api/publish|api/cron|api/preview|api/local-upload|api/test-drive|api/fix-heic|_next/static|_next/image|favicon.ico).*)',
  ],
};
