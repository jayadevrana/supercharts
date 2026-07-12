import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth-constants';

/**
 * Gate the terminal behind a session. This is a fast presence check on the session cookie —
 * full validation happens API-side (every data route returns 401 without a live session). An
 * expired-but-present cookie still passes here; the client guard in the terminal handles that
 * rarer case by bouncing to /login when /api/auth/me resolves to no user.
 */
export function middleware(req: NextRequest) {
  if (!req.cookies.has(SESSION_COOKIE)) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/terminal', '/terminal/:path*'],
};
