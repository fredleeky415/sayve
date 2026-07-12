import { afterEach, describe, expect, it, vi } from "vitest";

async function responseJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("household onboarding route stability", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unmock("@/server/admin/founder-console");
    vi.unmock("@/server/households/onboarding");
    vi.unmock("@/server/auth/request-context");
  });

  it("returns stable admin JSON when founder household creation throws unexpectedly", async () => {
    vi.doMock("@/server/admin/founder-console", () => ({
      canAccessFounderConsole: () => true
    }));
    vi.doMock("@/server/households/onboarding", () => ({
      createFounderHousehold: vi.fn(async () => {
        throw new Error("db offline");
      })
    }));

    const { POST } = await import("./households/create/route");
    const response = await POST(
      new Request("http://sayve.test/api/households/create", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-admin-token": "admin"
        },
        body: JSON.stringify({
          name: "Lee Home",
          ownerUserId: "00000000-0000-0000-0000-000000000001"
        })
      })
    );
    const json = await responseJson(response);

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(json).toEqual(
      expect.objectContaining({
        configured: true,
        ok: false,
        error: "unexpected_admin_error",
        message: "db offline"
      })
    );
  });

  it("returns stable product JSON when owner invite creation throws unexpectedly", async () => {
    vi.doMock("@/server/auth/request-context", () => ({
      resolveRequestAuthContext: vi.fn(async () => ({
        ok: true,
        context: {
          householdId: "household_lee",
          userId: "fred",
          role: "owner",
          source: "supabase_auth"
        }
      }))
    }));
    vi.doMock("@/server/households/onboarding", () => ({
      createHouseholdInvite: vi.fn(async () => {
        throw new Error("invite writer exploded");
      })
    }));

    const { POST } = await import("./households/members/invite/route");
    const response = await POST(
      new Request("http://sayve.test/api/households/members/invite", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          email: "partner@example.com",
          role: "member"
        })
      })
    );
    const json = await responseJson(response);

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(json).toEqual(
      expect.objectContaining({
        current_state: "temporary_unavailable",
        needs_user_input: true,
        data: expect.objectContaining({
          error: "unexpected_server_error"
        })
      })
    );
  });
});
