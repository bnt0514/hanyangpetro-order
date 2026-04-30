/**
 * Edge middleware — protects /admin/* and /portal/* routes.
 *
 * Note: NextAuth v5 with Credentials provider stores JWT cookies; we just check
 * for the presence of a session cookie here (no DB call in edge runtime).
 * Per-route role checks are done in server components via `auth()`.
 */
import { NextResponse, type NextRequest } from 'next/server';

const PROTECTED = [/^\/admin(\/|$)/, /^\/portal(\/|$)/];

export function middleware(req: NextRequest) {
    const { pathname } = req.nextUrl;
    const isProtected = PROTECTED.some((p) => p.test(pathname));
    if (!isProtected) return NextResponse.next();

    // Check for any auth.js session cookie (covers both __Secure- prefix variants)
    const cookieNames = ['authjs.session-token', '__Secure-authjs.session-token'];
    const hasSession = cookieNames.some((name) => req.cookies.get(name));
    if (!hasSession) {
        const loginUrl = new URL('/login', req.url);
        loginUrl.searchParams.set('redirect', pathname);
        return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
}

export const config = {
    matcher: ['/admin/:path*', '/portal/:path*'],
};
