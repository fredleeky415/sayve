export const NO_STORE_HEADERS = {
  "cache-control": "no-store, max-age=0",
  "x-robots-tag": "noindex"
};

export function noStoreJson(data: unknown, init: ResponseInit = {}): Response {
  return Response.json(data, {
    ...init,
    headers: {
      ...NO_STORE_HEADERS,
      ...(init.headers ?? {})
    }
  });
}
