import { afterEach, describe, expect, it, vi } from "vitest";

async function responseJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("household status route", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unmock("@/server/auth/request-context");
    vi.unmock("@/server/supabase/service-client");
  });

  it("returns a stable family status snapshot for the selected household", async () => {
    vi.doMock("@/server/auth/request-context", () => ({
      resolveRequestAuthContext: vi.fn(async () => ({
        ok: true,
        context: {
          householdId: "household_lee",
          userId: "fred_user",
          role: "owner"
        }
      }))
    }));

    vi.doMock("@/server/supabase/service-client", () => ({
      createSupabaseServiceClient: () => ({
        from(table: string) {
          if (table === "households") {
            return {
              select() {
                return {
                  eq() {
                    return {
                      async maybeSingle() {
                        return { data: { name: "LeeFam" }, error: null };
                      }
                    };
                  }
                };
              }
            };
          }

          if (table === "household_members") {
            return {
              select() {
                return {
                  eq() {
                    return {
                      order() {
                        return Promise.resolve({
                          data: [
                            { user_id: "fred_user", role: "owner", created_at: "2026-07-01T00:00:00.000Z" },
                            { user_id: "wife_user", role: "member", created_at: "2026-07-02T00:00:00.000Z" }
                          ],
                          error: null
                        });
                      }
                    };
                  }
                };
              }
            };
          }

          if (table === "invites") {
            return {
              select() {
                return {
                  eq() {
                    return {
                      order() {
                        return {
                          async limit() {
                            return {
                              data: [
                                {
                                  email: "partner@example.com",
                                  role: "member",
                                  expires_at: "2099-08-01T00:00:00.000Z",
                                  accepted_at: null,
                                  created_at: "2026-07-03T00:00:00.000Z"
                                },
                                {
                                  email: "old@example.com",
                                  role: "viewer",
                                  expires_at: "2020-08-01T00:00:00.000Z",
                                  accepted_at: null,
                                  created_at: "2026-07-01T00:00:00.000Z"
                                }
                              ],
                              error: null
                            };
                          }
                        };
                      }
                    };
                  }
                };
              }
            };
          }

          throw new Error(`unexpected table ${table}`);
        }
      })
    }));

    const { GET } = await import("./households/status/route");
    const response = await GET(new Request("http://sayve.test/api/households/status?householdId=household_lee"));
    const json = await responseJson(response);

    expect(response.status).toBe(200);
    expect(json).toEqual(
      expect.objectContaining({
        configured: true,
        ok: true,
        data: expect.objectContaining({
          householdId: "household_lee",
          householdName: "LeeFam",
          memberCount: 2,
          ownerCount: 1,
          memberRoleCount: 1,
          viewerCount: 0,
          pendingInviteCount: 1,
          expiredInviteCount: 1,
          members: [
            expect.objectContaining({ label: "你", role: "owner", isCurrentUser: true }),
            expect.objectContaining({ label: "Member 2", role: "member", isCurrentUser: false })
          ],
          pendingInvites: [expect.objectContaining({ email: "partner@example.com", role: "member" })]
        })
      })
    );
  });
});
