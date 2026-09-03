import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Edge middleware: reject any non-public route without a signed session cookie.
 *
 * `getSessionCookie` performs a *signature* check (not just existence), so a
 * client cannot forge a cookie value. Auth itself is enforced by the API
 * routes; middleware is the early gate that prevents page renders and
 * protects against CSRF-style probes.
 *
 * The previous version bypassed auth in development and only checked for
 * cookie existence in production. Both are gone.
 */

const PUBLIC_PATHNAMES = [
  "/login",
  "/signup",
  "/api/auth", // Better Auth handlers
  "/api/health",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHNAMES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  try {
    const sessionCookie = getSessionCookie(request);
    if (!sessionCookie) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          { error: "unauthenticated" },
          { status: 401 }
        );
      }
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("redirect", pathname);
      return NextResponse.redirect(loginUrl);
    }
  } catch {
    // Cookie present but invalid signature → treat as unauthenticated.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "invalid_session" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Run on everything except Next internals and static assets.
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
