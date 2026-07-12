import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

const originalEnv = { ...process.env };

function request(url: string, headers?: HeadersInit) {
  return new NextRequest(new URL(url), { headers });
}

describe("private beta middleware", () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("allows requests when no private beta token is configured", () => {
    delete process.env.APP_ACCESS_TOKEN;

    const response = middleware(request("https://sayve.test/"));

    expect(response.status).toBe(200);
  });

  it("stores a cookie and removes access_token from the URL", () => {
    process.env.APP_ACCESS_TOKEN = "secret";

    const response = middleware(request("https://sayve.test/?access_token=secret"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://sayve.test/");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(response.cookies.get("sayve_access")?.value).toBe("secret");
  });

  it("stores an admin cookie and removes admin token from the Founder Console URL", () => {
    delete process.env.APP_ACCESS_TOKEN;
    process.env.ADMIN_CONSOLE_TOKEN = "admin-secret";

    const response = middleware(request("https://sayve.test/admin?token=admin-secret"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://sayve.test/admin");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(response.cookies.get("sayve_admin")?.value).toBe("admin-secret");
    expect(response.cookies.get("sayve_admin")?.httpOnly).toBe(true);
  });

  it("can set private beta and admin cookies in one clean Founder Console redirect", () => {
    process.env.APP_ACCESS_TOKEN = "app-secret";
    process.env.ADMIN_CONSOLE_TOKEN = "admin-secret";

    const response = middleware(request("https://sayve.test/admin?access_token=app-secret&token=admin-secret"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://sayve.test/admin");
    expect(response.cookies.get("sayve_access")?.value).toBe("app-secret");
    expect(response.cookies.get("sayve_admin")?.value).toBe("admin-secret");
  });

  it("keeps invite tokens when private beta access is accepted from the URL", () => {
    process.env.APP_ACCESS_TOKEN = "secret";

    const response = middleware(request("https://sayve.test/invite?token=invite-token&access_token=secret"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://sayve.test/invite?token=invite-token");
    expect(response.cookies.get("sayve_access")?.value).toBe("secret");
  });

  it("allows API calls with the private beta header", () => {
    process.env.APP_ACCESS_TOKEN = "secret";

    const response = middleware(request("https://sayve.test/api/captures/text", { "x-app-access-token": "secret" }));

    expect(response.status).toBe(200);
  });

  it("rejects API access_token query strings so tokens do not remain in API URLs", async () => {
    process.env.APP_ACCESS_TOKEN = "secret";

    const response = middleware(request("https://sayve.test/api/captures/text?access_token=secret"));
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(json.error).toBe("private_beta_access_required");
  });

  it("allows API calls with the private beta cookie", () => {
    process.env.APP_ACCESS_TOKEN = "secret";

    const response = middleware(request("https://sayve.test/api/captures/text", { cookie: "sayve_access=secret" }));

    expect(response.status).toBe(200);
  });

  it("returns JSON for blocked API calls", async () => {
    process.env.APP_ACCESS_TOKEN = "secret";

    const response = middleware(request("https://sayve.test/api/captures/text"));
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(json.error).toBe("private_beta_access_required");
  });

  it("returns no-store headers for blocked private beta pages", () => {
    process.env.APP_ACCESS_TOKEN = "secret";

    const response = middleware(request("https://sayve.test/"));

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
  });
});
