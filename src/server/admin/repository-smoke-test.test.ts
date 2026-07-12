import { describe, expect, it } from "vitest";
import { runRepositorySmokeTest } from "./repository-smoke-test";

function createRepositoryFactory() {
  return () =>
    ({
      readAsync: async () => ({
        captures: [],
        memoryObjects: [],
        interpretations: [],
        facts: [],
        contexts: [],
        relationships: [],
        revisions: [],
        insights: [],
        conversationMessages: [],
        usage: [],
        aiTelemetry: [],
        categories: []
      }),
      commitAsync: async () => {}
    }) as never;
}

describe("repository smoke test", () => {
  it("can verify a targeted household snapshot plus household health", async () => {
    process.env.MEMORY_REPOSITORY = "supabase";
    const supabase = {
      from(table: string) {
        if (table === "memory_store_snapshots") {
          return {
            select() {
              return this;
            },
            eq() {
              return this;
            },
            async maybeSingle() {
              return { data: { household_id: "household_live" }, error: null };
            }
          };
        }
        if (table === "households") {
          return {
            select() {
              return this;
            },
            eq() {
              return this;
            },
            async maybeSingle() {
              return { data: { id: "household_live" }, error: null };
            }
          };
        }
        if (table === "household_members") {
          return {
            select() {
              return this;
            },
            async eq() {
              return { data: [{ role: "owner" }, { role: "member" }], error: null };
            }
          };
        }
        if (table === "invites") {
          return {
            select() {
              return this;
            },
            async eq() {
              return {
                data: [
                  {
                    role: "viewer",
                    email: "viewer@example.com",
                    accepted_at: "",
                    expires_at: "2099-01-01T00:00:00.000Z"
                  }
                ],
                error: null
              };
            }
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }
    } as never;

    const result = await runRepositorySmokeTest({
      householdId: "household_live",
      supabase,
      repositoryFactory: createRepositoryFactory()
    });

    expect(result.ok).toBe(true);
    expect(result.targetHouseholdId).toBe("household_live");
    expect(result.householdExists).toBe(true);
    expect(result.memberCount).toBe(2);
    expect(result.ownerCount).toBe(1);
    expect(result.viewerCount).toBe(0);
    expect(result.onboarding).toEqual(
      expect.objectContaining({
        pendingInvites: 1,
        acceptedInvites: 0,
        expiredInvites: 0,
        emailLockedInvites: 1,
        memberInvites: 0,
        viewerInvites: 1
      })
    );
    expect(result.persistedSnapshot).toBe(true);
  });

  it("fails when the targeted household snapshot exists but the household has no owner", async () => {
    process.env.MEMORY_REPOSITORY = "supabase";
    const supabase = {
      from(table: string) {
        if (table === "memory_store_snapshots") {
          return {
            select() {
              return this;
            },
            eq() {
              return this;
            },
            async maybeSingle() {
              return { data: { household_id: "household_live" }, error: null };
            }
          };
        }
        if (table === "households") {
          return {
            select() {
              return this;
            },
            eq() {
              return this;
            },
            async maybeSingle() {
              return { data: { id: "household_live" }, error: null };
            }
          };
        }
        if (table === "household_members") {
          return {
            select() {
              return this;
            },
            async eq() {
              return { data: [{ role: "member" }], error: null };
            }
          };
        }
        if (table === "invites") {
          return {
            select() {
              return this;
            },
            async eq() {
              return {
                data: [
                  {
                    role: "member",
                    email: "",
                    accepted_at: "2026-07-01T00:00:00.000Z",
                    expires_at: "2099-01-01T00:00:00.000Z"
                  }
                ],
                error: null
              };
            }
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }
    } as never;

    const result = await runRepositorySmokeTest({
      householdId: "household_live",
      supabase,
      repositoryFactory: createRepositoryFactory()
    });

    expect(result.ok).toBe(false);
    expect(result.persistedSnapshot).toBe(true);
    expect(result.householdExists).toBe(true);
    expect(result.memberCount).toBe(1);
    expect(result.ownerCount).toBe(0);
    expect(result.viewerCount).toBe(0);
    expect(result.onboarding).toEqual(
      expect.objectContaining({
        pendingInvites: 0,
        acceptedInvites: 1,
        expiredInvites: 0,
        emailLockedInvites: 0,
        memberInvites: 1,
        viewerInvites: 0
      })
    );
    expect(result.error).toContain("no owner member");
  });
  it("fails fast when real auth mode is enabled but storage is still local", async () => {
    delete process.env.MEMORY_REPOSITORY;
    process.env.SUPABASE_AUTH_REQUIRED = "1";

    const result = await runRepositorySmokeTest({
      householdId: "household_live",
      supabase: undefined,
      repositoryFactory: createRepositoryFactory()
    });

    expect(result.ok).toBe(false);
    expect(result.configured).toBe(false);
    expect(result.repositoryMode).toBe("local_file");
    expect(result.error).toContain("MEMORY_REPOSITORY is not set to supabase");

    delete process.env.SUPABASE_AUTH_REQUIRED;
  });

});
