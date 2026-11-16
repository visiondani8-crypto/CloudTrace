import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const PUBLIC_PATHS = ["/login"];

/**
 * Redirects unauthenticated page requests to /login (preserving a safe
 * returnTo path). API routes perform their own session checks and return
 * JSON 401s. This is a convenience layer — authorisation is enforced on the
 * server for every data access.
 */
export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-ct-pathname", `${pathname}${search}`);

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!isPublic) {
    const secret =
      process.env.AUTH_SECRET ||
      process.env.NEXTAUTH_SECRET ||
      (process.env.NODE_ENV !== "production" ? "cloudtrace-insecure-development-secret-change-me" : undefined);
    const token = await getToken({ req, secret });
    if (!token) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.search = `?returnTo=${encodeURIComponent(`${pathname}${search}`)}`;
      return NextResponse.redirect(url);
    }
  }
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)"],
};
