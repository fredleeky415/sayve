import { NextResponse, type NextRequest } from "next/server";

const ACCESS_COOKIE = "sayve_access";
const ADMIN_COOKIE = "sayve_admin";
const SENSITIVE_HEADERS = {
  "cache-control": "no-store, max-age=0",
  "x-robots-tag": "noindex"
};

function appAccessToken(): string | undefined {
  const value = process.env.APP_ACCESS_TOKEN;
  return value && value.trim() ? value : undefined;
}

function adminConsoleToken(): string | undefined {
  const value = process.env.ADMIN_CONSOLE_TOKEN;
  return value && value.trim() ? value : undefined;
}

function tokenMatches(token: string | null | undefined, expected: string): boolean {
  return Boolean(token && token === expected);
}

function addSensitiveHeaders(response: NextResponse) {
  for (const [key, value] of Object.entries(SENSITIVE_HEADERS)) response.headers.set(key, value);
}

function setSensitiveCookie(response: NextResponse, name: string, value: string) {
  response.cookies.set(name, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/"
  });
}

export function middleware(request: NextRequest) {
  const expected = appAccessToken();
  const expectedAdmin = adminConsoleToken();
  const isApi = request.nextUrl.pathname.startsWith("/api/");
  const isAdminPage = request.nextUrl.pathname === "/admin" || request.nextUrl.pathname.startsWith("/admin/");

  if (!expected) {
    if (expectedAdmin && isAdminPage && tokenMatches(request.nextUrl.searchParams.get("token"), expectedAdmin)) {
      const cleanUrl = request.nextUrl.clone();
      cleanUrl.searchParams.delete("token");
      const response = NextResponse.redirect(cleanUrl);
      addSensitiveHeaders(response);
      setSensitiveCookie(response, ADMIN_COOKIE, expectedAdmin);
      return response;
    }
    return NextResponse.next();
  }

  const provided =
    request.headers.get("x-app-access-token") ??
    (isApi ? undefined : request.nextUrl.searchParams.get("access_token")) ??
    request.cookies.get(ACCESS_COOKIE)?.value;

  if (tokenMatches(provided, expected)) {
    if (!isApi && request.nextUrl.searchParams.has("access_token")) {
      const cleanUrl = request.nextUrl.clone();
      cleanUrl.searchParams.delete("access_token");
      const adminToken = request.nextUrl.searchParams.get("token");
      const shouldSetAdminCookie = Boolean(expectedAdmin && isAdminPage && tokenMatches(adminToken, expectedAdmin));
      if (shouldSetAdminCookie) cleanUrl.searchParams.delete("token");
      const response = NextResponse.redirect(cleanUrl);
      addSensitiveHeaders(response);
      setSensitiveCookie(response, ACCESS_COOKIE, expected);
      if (shouldSetAdminCookie && expectedAdmin) setSensitiveCookie(response, ADMIN_COOKIE, expectedAdmin);
      return response;
    }

    if (expectedAdmin && isAdminPage && tokenMatches(request.nextUrl.searchParams.get("token"), expectedAdmin)) {
      const cleanUrl = request.nextUrl.clone();
      cleanUrl.searchParams.delete("token");
      const response = NextResponse.redirect(cleanUrl);
      addSensitiveHeaders(response);
      setSensitiveCookie(response, ADMIN_COOKIE, expectedAdmin);
      return response;
    }

    return NextResponse.next();
  }

  if (isApi) {
    return NextResponse.json({ error: "private_beta_access_required" }, { status: 401, headers: SENSITIVE_HEADERS });
  }

  return new NextResponse("Sayve private beta access required.", {
    status: 401,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      ...SENSITIVE_HEADERS
    }
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health).*)"]
};
