import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const membershipRoles = vi.hoisted(() => new Map<string, string>());

vi.mock("@/server/supabase/service-client", () => ({
  createSupabaseAnonClient: () => ({
    auth: {
      async getUser(token: string) {
        return token.startsWith("user:")
          ? { data: { user: { id: token.replace("user:", "") } }, error: null }
          : { data: { user: null }, error: { message: "invalid token" } };
      }
    }
  }),
  createSupabaseServiceClient: () => ({
    from() {
      const filters = new Map<string, unknown>();
      const query = {
        select() {
          return query;
        },
        eq(field: string, value: unknown) {
          filters.set(field, value);
          return query;
        },
        async maybeSingle() {
          const householdId = String(filters.get("household_id") ?? "");
          const userId = String(filters.get("user_id") ?? "");
          const role = membershipRoles.get(`${householdId}:${userId}`);
          return {
            data: role ? { role } : null,
            error: null
          };
        }
      };
      return query;
    }
  })
}));

import { resolveRequestAuthContext } from "./request-context";

function memberRequest(userId: string) {
  return new Request("http://sayve.test/api/captures/text", {
    headers: {
      "x-household-id": "household_lee",
      "x-user-id": userId
    }
  });
}

function bearerMemberRequest(userId: string) {
  return new Request("http://sayve.test/api/captures/text", {
    headers: {
      authorization: `Bearer user:${userId}`,
      "x-household-id": "household_lee"
    }
  });
}

function bearerWithoutHouseholdRequest(userId: string) {
  return new Request("http://sayve.test/api/captures/text", {
    headers: {
      authorization: `Bearer user:${userId}`
    }
  });
}

describe("request household auth context", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.SUPABASE_AUTH_REQUIRED = "1";
    membershipRoles.clear();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("allows viewers to read household memory but blocks memory writes", async () => {
    membershipRoles.set("household_lee:viewer", "viewer");

    const read = await resolveRequestAuthContext(bearerMemberRequest("viewer"), undefined, { access: "read" });
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.context.role).toBe("viewer");

    const write = await resolveRequestAuthContext(bearerMemberRequest("viewer"));
    expect(write.ok).toBe(false);
    if (!write.ok) {
      expect(write.response.status).toBe(403);
      const body = await write.response.json();
      expect(body.current_state).toBe("household_write_denied");
    }
  });

  it("allows household owners and members to update shared family memory", async () => {
    membershipRoles.set("household_lee:fred", "owner");
    membershipRoles.set("household_lee:partner", "member");

    const owner = await resolveRequestAuthContext(bearerMemberRequest("fred"));
    const partner = await resolveRequestAuthContext(bearerMemberRequest("partner"));

    expect(owner.ok).toBe(true);
    expect(partner.ok).toBe(true);
    if (owner.ok) expect(owner.context.role).toBe("owner");
    if (partner.ok) expect(partner.context.role).toBe("member");
  });

  it("does not accept prototype x-user-id when Supabase auth is required", async () => {
    membershipRoles.set("household_lee:fred", "owner");

    const result = await resolveRequestAuthContext(memberRequest("fred"));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      const body = await result.response.json();
      expect(body.current_state).toBe("auth_required");
    }
  });

  it("requires an explicit household id for real authenticated requests", async () => {
    process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID = "household_fallback";

    const result = await resolveRequestAuthContext(bearerWithoutHouseholdRequest("fred"));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      const body = await result.response.json();
      expect(body.current_state).toBe("household_required");
    }
  });

  it("keeps prototype x-user-id available when Supabase auth is not required", async () => {
    process.env.SUPABASE_AUTH_REQUIRED = "0";

    const result = await resolveRequestAuthContext(memberRequest("fred"));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context.userId).toBe("fred");
      expect(result.context.source).toBe("prototype_header");
    }
  });
});
