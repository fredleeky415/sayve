export const ADMIN_NO_STORE_HEADERS = {
  "cache-control": "no-store, max-age=0",
  "x-robots-tag": "noindex"
};

export const ADMIN_COOKIE = "sayve_admin";

function cookieValue(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rawValue.join("="));
  }
  return undefined;
}

export function adminTokenFromRequest(request: Request): string | undefined {
  return request.headers.get("x-admin-token") ?? cookieValue(request, ADMIN_COOKIE);
}

export function adminJson(data: unknown, init: ResponseInit = {}): Response {
  return Response.json(data, {
    ...init,
    headers: {
      ...ADMIN_NO_STORE_HEADERS,
      ...(init.headers ?? {})
    }
  });
}

export function unexpectedAdminErrorResponse(error: unknown, init: ResponseInit = {}): Response {
  return adminJson(
    {
      configured: true,
      ok: false,
      error: "unexpected_admin_error",
      message: error instanceof Error ? error.message : String(error)
    },
    {
      ...init,
      status: init.status ?? 500
    }
  );
}

export function adminResponse(body: BodyInit | null, init: ResponseInit = {}): Response {
  return new Response(body, {
    ...init,
    headers: {
      ...ADMIN_NO_STORE_HEADERS,
      ...(init.headers ?? {})
    }
  });
}
