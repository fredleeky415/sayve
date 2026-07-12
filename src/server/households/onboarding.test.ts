import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HouseholdOnboardingResult } from "./onboarding";

type HouseholdRow = { id: string; name: string; default_currency?: string; locale?: string };
type MemberRow = { household_id: string; user_id: string; role: string };
type InviteRow = {
  id: string;
  household_id: string;
  email?: string;
  role: string;
  token: string;
  expires_at: string;
  accepted_at: string | null;
};
type SnapshotRow = { household_id: string; state: unknown; updated_at?: string };

const mockState = vi.hoisted(() => ({
  households: [] as HouseholdRow[],
  members: [] as MemberRow[],
  invites: [] as InviteRow[],
  snapshots: [] as SnapshotRow[],
  nextHouseholdId: 1,
  nextInviteId: 1,
  inviteRoleOverride: undefined as string | undefined
}));

function expectOkResult(result: HouseholdOnboardingResult): asserts result is Extract<HouseholdOnboardingResult, { configured: true }> & {
  ok: true;
  data: Record<string, unknown>;
} {
  expect(result.configured).toBe(true);
  expect(result.ok).toBe(true);
  expect("data" in result ? result.data : undefined).toBeDefined();
}

vi.mock("@/server/supabase/service-client", () => ({
  createSupabaseServiceClient: () => ({
    async rpc(fn: string, args: Record<string, unknown>) {
      if (fn !== "sayve_accept_household_invite") {
        return { data: null, error: { message: `unexpected rpc ${fn}` } };
      }

      const token = String(args.invite_token ?? "");
      const userId = String(args.accepting_user_id ?? "");
      const invite = mockState.invites.find((row) => row.token === token);
      if (!invite) {
        return {
          data: [{ ok: false, error_code: "invite_not_found", error_message: "Invite not found.", household_id: null, user_id: null, role: null }],
          error: null
        };
      }

      const role = mockState.inviteRoleOverride ?? invite.role;
      if (invite.accepted_at) {
        return {
          data: [
            {
              ok: false,
              error_code: "invite_already_accepted",
              error_message: "Invite was already accepted.",
              household_id: invite.household_id,
              user_id: userId,
              role
            }
          ],
          error: null
        };
      }

      if (new Date(invite.expires_at).getTime() < Date.now()) {
        return {
          data: [
            {
              ok: false,
              error_code: "invite_expired",
              error_message: "Invite expired.",
              household_id: invite.household_id,
              user_id: userId,
              role
            }
          ],
          error: null
        };
      }

      if (role !== "member" && role !== "viewer") {
        return {
          data: [
            {
              ok: false,
              error_code: "invite_invalid_role",
              error_message: "Invite role is invalid.",
              household_id: invite.household_id,
              user_id: userId,
              role
            }
          ],
          error: null
        };
      }

      const existing = mockState.members.find((member) => member.household_id === invite.household_id && member.user_id === userId);
      if (existing) existing.role = role;
      else mockState.members.push({ household_id: invite.household_id, user_id: userId, role });
      invite.accepted_at = new Date().toISOString();

      return {
        data: [{ ok: true, error_code: null, error_message: null, household_id: invite.household_id, user_id: userId, role }],
        error: null
      };
    },
    from(table: string) {
      const filters = new Map<string, unknown>();
      let insertRow: Record<string, unknown> | undefined;
      let upsertRow: Record<string, unknown> | undefined;
      let updatePatch: Record<string, unknown> | undefined;

      const query = {
        insert(row: Record<string, unknown>) {
          insertRow = row;
          return query;
        },
        upsert(row: Record<string, unknown>) {
          upsertRow = row;
          if (table === "household_members") {
            const existing = mockState.members.find(
              (member) => member.household_id === row.household_id && member.user_id === row.user_id
            );
            if (existing) existing.role = String(row.role);
            else {
              mockState.members.push({
                household_id: String(row.household_id),
                user_id: String(row.user_id),
                role: String(row.role)
              });
            }
          }
          if (table === "memory_store_snapshots") {
            const existing = mockState.snapshots.find((snapshot) => snapshot.household_id === row.household_id);
            if (existing) {
              existing.state = row.state;
              existing.updated_at = String(row.updated_at ?? "");
            } else {
              mockState.snapshots.push({
                household_id: String(row.household_id),
                state: row.state,
                updated_at: String(row.updated_at ?? "")
              });
            }
          }
          return Promise.resolve({ error: null });
        },
        select() {
          return query;
        },
        update(patch: Record<string, unknown>) {
          updatePatch = patch;
          return query;
        },
        eq(field: string, value: unknown) {
          filters.set(field, value);
          return query;
        },
        async maybeSingle() {
          if (table !== "invites") return { data: null, error: null };
          const token = filters.get("token");
          const invite = mockState.invites.find((row) => row.token === token);
          if (!invite) return { data: null, error: null };
          const household = mockState.households.find((row) => row.id === invite.household_id);
          return {
            data: {
              ...invite,
              role: mockState.inviteRoleOverride ?? invite.role,
              households: household ? { name: household.name } : null
            },
            error: null
          };
        },
        async single() {
          if (!insertRow) return { data: null, error: { message: "missing insert row" } };

          if (table === "households") {
            const household = {
              id: `household_${mockState.nextHouseholdId++}`,
              name: String(insertRow.name),
              default_currency: String(insertRow.default_currency ?? "HKD"),
              locale: String(insertRow.locale ?? "zh-Hant-HK")
            };
            mockState.households.push(household);
            return { data: { id: household.id, name: household.name }, error: null };
          }

          if (table === "invites") {
            const invite = {
              id: `invite_${mockState.nextInviteId++}`,
              household_id: String(insertRow.household_id),
              email: typeof insertRow.email === "string" ? insertRow.email : undefined,
              role: String(insertRow.role ?? "member"),
              token: String(insertRow.token),
              expires_at: String(insertRow.expires_at),
              accepted_at: null
            };
            mockState.invites.push(invite);
            return { data: invite, error: null };
          }

          return { data: null, error: { message: `unexpected single on ${table}` } };
        },
        then(resolve: (value: { error: null }) => void) {
          if (table === "household_members" && insertRow) {
            mockState.members.push({
              household_id: String(insertRow.household_id),
              user_id: String(insertRow.user_id),
              role: String(insertRow.role)
            });
          }
          if (table === "invites" && updatePatch) {
            const id = filters.get("id");
            const invite = mockState.invites.find((row) => row.id === id);
            if (invite && typeof updatePatch.accepted_at === "string") invite.accepted_at = updatePatch.accepted_at;
          }
          resolve({ error: null });
        }
      };

      return query;
    }
  })
}));

describe("household onboarding", () => {
  beforeEach(() => {
    mockState.households = [];
    mockState.members = [];
    mockState.invites = [];
    mockState.snapshots = [];
    mockState.nextHouseholdId = 1;
    mockState.nextInviteId = 1;
    mockState.inviteRoleOverride = undefined;
  });

  it("creates a founder household with an owner member and initialized memory snapshot", async () => {
    const { createFounderHousehold } = await import("./onboarding");

    const result = await createFounderHousehold({
      name: "Lee Home",
      ownerUserId: "00000000-0000-0000-0000-000000000001"
    });

    expectOkResult(result);
    expect(result.data?.household).toEqual({ id: "household_1", name: "Lee Home" });
    expect(mockState.members).toEqual([
      {
        household_id: "household_1",
        user_id: "00000000-0000-0000-0000-000000000001",
        role: "owner"
      }
    ]);
    expect(mockState.snapshots).toEqual([expect.objectContaining({ household_id: "household_1", state: {} })]);
  });

  it("creates and accepts a partner member invite into the same household", async () => {
    const { createFounderHousehold, createHouseholdInvite, acceptHouseholdInvite } = await import("./onboarding");

    const household = await createFounderHousehold({
      name: "Lee Home",
      ownerUserId: "00000000-0000-0000-0000-000000000001"
    });
    expectOkResult(household);
    const householdId = (household.data.household as { id: string }).id;

    const invite = await createHouseholdInvite({
      householdId,
      email: "partner@example.com",
      role: "member",
      expiresInDays: 7
    });
    expectOkResult(invite);
    expect(invite.data).toEqual(expect.objectContaining({ household_id: householdId, email: "partner@example.com", role: "member" }));

    const accepted = await acceptHouseholdInvite({
      token: String(invite.data?.token),
      userId: "00000000-0000-0000-0000-000000000002",
      userEmail: "partner@example.com"
    });

    expectOkResult(accepted);
    expect(accepted.data).toEqual({
      householdId,
      userId: "00000000-0000-0000-0000-000000000002",
      role: "member",
      invitedEmail: "partner@example.com"
    });
    expect(mockState.members).toEqual([
      expect.objectContaining({ household_id: householdId, user_id: "00000000-0000-0000-0000-000000000001", role: "owner" }),
      expect.objectContaining({ household_id: householdId, user_id: "00000000-0000-0000-0000-000000000002", role: "member" })
    ]);
    expect(mockState.invites[0]?.accepted_at).toEqual(expect.any(String));
  });

  it("can preview a pending invite before login", async () => {
    const { createFounderHousehold, createHouseholdInvite, getHouseholdInvitePreview } = await import("./onboarding");

    const created = await createFounderHousehold({
      name: "Lee Home",
      ownerUserId: "00000000-0000-0000-0000-000000000001"
    });
    expectOkResult(created);

    const invite = await createHouseholdInvite({
      householdId: "household_1",
      email: "wife@example.com",
      role: "member"
    });
    expectOkResult(invite);

    const result = await getHouseholdInvitePreview(String(invite.data.token));

    expect(result).toEqual({
      configured: true,
      ok: true,
      status: "pending",
      data: {
        householdId: "household_1",
        householdName: "Lee Home",
        role: "member",
        invitedEmailMasked: "w***@example.com",
        expiresAt: expect.any(String)
      }
    });
  });

  it("reports missing, accepted, and expired invite preview states", async () => {
    const { createFounderHousehold, createHouseholdInvite, getHouseholdInvitePreview, acceptHouseholdInvite } = await import("./onboarding");

    const created = await createFounderHousehold({
      name: "Lee Home",
      ownerUserId: "00000000-0000-0000-0000-000000000001"
    });
    expectOkResult(created);

    const acceptedInvite = await createHouseholdInvite({ householdId: "household_1", role: "member" });
    const expiredInvite = await createHouseholdInvite({ householdId: "household_1", role: "member", expiresInDays: -1 });
    expectOkResult(acceptedInvite);
    expectOkResult(expiredInvite);

    await acceptHouseholdInvite({
      token: String(acceptedInvite.data.token),
      userId: "00000000-0000-0000-0000-000000000002"
    });

    await expect(getHouseholdInvitePreview("")).resolves.toEqual({
      configured: true,
      ok: false,
      error: "token is required.",
      status: "missing_token"
    });
    await expect(getHouseholdInvitePreview("missing-token")).resolves.toEqual({
      configured: true,
      ok: false,
      error: "Invite not found.",
      status: "invite_not_found"
    });
    await expect(getHouseholdInvitePreview(String(acceptedInvite.data.token))).resolves.toEqual({
      configured: true,
      ok: false,
      error: "Invite was already accepted.",
      status: "invite_already_accepted"
    });
    await expect(getHouseholdInvitePreview(String(expiredInvite.data.token))).resolves.toEqual({
      configured: true,
      ok: false,
      error: "Invite expired.",
      status: "invite_expired"
    });
  });

  it("rejects invalid invite roles before creating household membership", async () => {
    const { createHouseholdInvite, acceptHouseholdInvite } = await import("./onboarding");
    const invite = await createHouseholdInvite({ householdId: "household_1", role: "member" });
    mockState.inviteRoleOverride = "owner";

    expectOkResult(invite);
    const result = await acceptHouseholdInvite({
      token: String(invite.data.token),
      userId: "00000000-0000-0000-0000-000000000001",
      userEmail: "partner@example.com"
    });

    expect(result.configured).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Invite role is invalid.");
    expect(result.errorCode).toBe("invite_invalid_role");
    expect(mockState.members).toHaveLength(0);
  });

  it("keeps invite acceptance single-use so one token cannot add two users", async () => {
    const { createHouseholdInvite, acceptHouseholdInvite } = await import("./onboarding");
    const invite = await createHouseholdInvite({ householdId: "household_1", role: "member" });
    expectOkResult(invite);

    const first = await acceptHouseholdInvite({
      token: String(invite.data.token),
      userId: "00000000-0000-0000-0000-000000000001"
    });
    expectOkResult(first);

    const second = await acceptHouseholdInvite({
      token: String(invite.data.token),
      userId: "00000000-0000-0000-0000-000000000002"
    });
    expect(second.configured).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.errorCode).toBe("invite_already_accepted");
    expect(mockState.members).toEqual([
      expect.objectContaining({ household_id: "household_1", user_id: "00000000-0000-0000-0000-000000000001", role: "member" })
    ]);
  });

  it("returns stable invite acceptance error codes for user-facing invite states", async () => {
    const { createHouseholdInvite, acceptHouseholdInvite } = await import("./onboarding");
    const acceptedInvite = await createHouseholdInvite({ householdId: "household_1", role: "member" });
    const expiredInvite = await createHouseholdInvite({ householdId: "household_1", role: "member", expiresInDays: -1 });
    expectOkResult(acceptedInvite);
    expectOkResult(expiredInvite);

    const missing = await acceptHouseholdInvite({ token: "missing-token", userId: "00000000-0000-0000-0000-000000000001" });
    expect(missing.ok).toBe(false);
    expect(missing.errorCode).toBe("invite_not_found");

    const firstAccept = await acceptHouseholdInvite({
      token: String(acceptedInvite.data.token),
      userId: "00000000-0000-0000-0000-000000000001"
    });
    expectOkResult(firstAccept);

    const alreadyAccepted = await acceptHouseholdInvite({
      token: String(acceptedInvite.data.token),
      userId: "00000000-0000-0000-0000-000000000002"
    });
    expect(alreadyAccepted.ok).toBe(false);
    expect(alreadyAccepted.errorCode).toBe("invite_already_accepted");

    const expired = await acceptHouseholdInvite({
      token: String(expiredInvite.data.token),
      userId: "00000000-0000-0000-0000-000000000003"
    });
    expect(expired.ok).toBe(false);
    expect(expired.errorCode).toBe("invite_expired");
  });

  it("rejects invite acceptance when the logged-in email does not match the invited email", async () => {
    const { createHouseholdInvite, acceptHouseholdInvite } = await import("./onboarding");
    const invite = await createHouseholdInvite({ householdId: "household_1", email: "wife@example.com", role: "member" });
    expectOkResult(invite);

    const result = await acceptHouseholdInvite({
      token: String(invite.data.token),
      userId: "00000000-0000-0000-0000-000000000001",
      userEmail: "someoneelse@example.com"
    });

    expect(result.configured).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("invite_email_mismatch");
    expect(result.error).toContain("wife@example.com");
    expect(mockState.members).toHaveLength(0);
  });

  it("rejects email-locked invite acceptance when the login session exposes no email", async () => {
    const { createHouseholdInvite, acceptHouseholdInvite } = await import("./onboarding");
    const invite = await createHouseholdInvite({ householdId: "household_1", email: "wife@example.com", role: "member" });
    expectOkResult(invite);

    const result = await acceptHouseholdInvite({
      token: String(invite.data.token),
      userId: "00000000-0000-0000-0000-000000000001"
    });

    expect(result.configured).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("invite_email_required");
    expect(result.error).toContain("did not expose an email address");
    expect(mockState.members).toHaveLength(0);
  });
});
