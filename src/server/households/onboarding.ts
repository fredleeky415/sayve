import { randomUUID } from "node:crypto";
import { createSupabaseServiceClient } from "@/server/supabase/service-client";

export type HouseholdOnboardingErrorCode =
  | "supabase_not_configured"
  | "household_create_failed"
  | "household_member_create_failed"
  | "household_snapshot_init_failed"
  | "invite_create_failed"
  | "invite_not_found"
  | "invite_already_accepted"
  | "invite_expired"
  | "invite_invalid_role"
  | "invite_email_required"
  | "invite_email_mismatch"
  | "invite_member_upsert_failed";

export type HouseholdOnboardingResult =
  | {
      configured: false;
      ok: false;
      error: string;
      errorCode: HouseholdOnboardingErrorCode;
    }
  | {
      configured: true;
      ok: boolean;
      data?: Record<string, unknown>;
      error?: string;
      errorCode?: HouseholdOnboardingErrorCode;
    };

export type HouseholdInvitePreviewResult =
  | {
      configured: false;
      ok: false;
      error: string;
      status: "supabase_not_configured";
    }
  | {
      configured: true;
      ok: false;
      error: string;
      status: "missing_token" | "invite_not_found" | "invite_expired" | "invite_already_accepted";
    }
  | {
      configured: true;
      ok: true;
      status: "pending";
      data: {
        householdId: string;
        householdName: string;
        role: string;
        invitedEmailMasked: string;
        expiresAt: string;
      };
    };

function missingSupabase(): HouseholdOnboardingResult {
  return {
    configured: false,
    ok: false,
    error: "Supabase service env is not configured.",
    errorCode: "supabase_not_configured"
  };
}

function missingSupabasePreview(): HouseholdInvitePreviewResult {
  return {
    configured: false,
    ok: false,
    error: "Supabase service env is not configured.",
    status: "supabase_not_configured"
  };
}

function maskEmail(email?: string | null): string {
  const value = email?.trim() ?? "";
  if (!value) return "";
  const [localPart, domain] = value.split("@");
  if (!localPart || !domain) return value;
  const visibleLocal = localPart.slice(0, 1);
  return `${visibleLocal}***@${domain}`;
}

export async function createFounderHousehold(input: {
  name: string;
  ownerUserId: string;
  defaultCurrency?: string;
  locale?: string;
}): Promise<HouseholdOnboardingResult> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return missingSupabase();

  const { data: household, error: householdError } = await supabase
    .from("households")
    .insert({
      name: input.name,
      default_currency: input.defaultCurrency ?? "HKD",
      locale: input.locale ?? "zh-Hant-HK"
    })
    .select("id, name")
    .single();

  if (householdError || !household) {
    return { configured: true, ok: false, error: householdError?.message ?? "Could not create household.", errorCode: "household_create_failed" };
  }

  const { error: memberError } = await supabase.from("household_members").insert({
    household_id: household.id,
    user_id: input.ownerUserId,
    role: "owner"
  });

  if (memberError) {
    return { configured: true, ok: false, error: memberError.message, errorCode: "household_member_create_failed", data: { household } };
  }

  const { error: snapshotError } = await supabase.from("memory_store_snapshots").upsert(
    {
      household_id: household.id,
      state: {},
      updated_at: new Date().toISOString()
    },
    { onConflict: "household_id" }
  );

  if (snapshotError) {
    return {
      configured: true,
      ok: false,
      error: snapshotError.message,
      errorCode: "household_snapshot_init_failed",
      data: { household }
    };
  }

  return {
    configured: true,
    ok: true,
    data: {
      household,
      ownerUserId: input.ownerUserId
    }
  };
}

export async function createHouseholdInvite(input: {
  householdId: string;
  email?: string;
  role?: "member" | "viewer";
  expiresInDays?: number;
}): Promise<HouseholdOnboardingResult> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return missingSupabase();

  const token = randomUUID();
  const expiresAt = new Date(Date.now() + (input.expiresInDays ?? 14) * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("invites")
    .insert({
      household_id: input.householdId,
      email: input.email,
      role: input.role ?? "member",
      token,
      expires_at: expiresAt
    })
    .select("id, household_id, email, role, token, expires_at")
    .single();

  if (error || !data) {
    return { configured: true, ok: false, error: error?.message ?? "Could not create invite.", errorCode: "invite_create_failed" };
  }

  return {
    configured: true,
    ok: true,
    data
  };
}

export async function getHouseholdInvitePreview(token: string): Promise<HouseholdInvitePreviewResult> {
  const normalizedToken = token.trim();
  if (!normalizedToken) {
    return {
      configured: true,
      ok: false,
      error: "token is required.",
      status: "missing_token"
    };
  }

  const supabase = createSupabaseServiceClient();
  if (!supabase) return missingSupabasePreview();

  const inviteLookup = await supabase
    .from("invites")
    .select("household_id,email,role,expires_at,accepted_at,households(name)")
    .eq("token", normalizedToken)
    .maybeSingle();

  if (inviteLookup.error) {
    return {
      configured: true,
      ok: false,
      error: inviteLookup.error.message,
      status: "invite_not_found"
    };
  }

  const invite = inviteLookup.data as
    | {
        household_id?: string | null;
        email?: string | null;
        role?: string | null;
        expires_at?: string | null;
        accepted_at?: string | null;
        households?: { name?: string | null } | Array<{ name?: string | null }> | null;
      }
    | null;

  if (!invite?.household_id) {
    return {
      configured: true,
      ok: false,
      error: "Invite not found.",
      status: "invite_not_found"
    };
  }

  if (invite.accepted_at) {
    return {
      configured: true,
      ok: false,
      error: "Invite was already accepted.",
      status: "invite_already_accepted"
    };
  }

  const expiresAt = invite.expires_at ?? "";
  if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
    return {
      configured: true,
      ok: false,
      error: "Invite expired.",
      status: "invite_expired"
    };
  }

  const household = Array.isArray(invite.households) ? invite.households[0] : invite.households;

  return {
    configured: true,
    ok: true,
    status: "pending",
    data: {
      householdId: invite.household_id,
      householdName: household?.name?.trim() || "Family Memory",
      role: invite.role?.trim() || "member",
      invitedEmailMasked: maskEmail(invite.email),
      expiresAt
    }
  };
}

export async function acceptHouseholdInvite(input: { token: string; userId: string; userEmail?: string }): Promise<HouseholdOnboardingResult> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return missingSupabase();

  const inviteLookup = await supabase.from("invites").select("id,household_id,email,role,token,expires_at,accepted_at").eq("token", input.token).maybeSingle();
  if (inviteLookup.error) {
    return { configured: true, ok: false, error: inviteLookup.error.message, errorCode: "invite_member_upsert_failed" };
  }

  const invite = inviteLookup.data as { email?: string | null } | null;
  const invitedEmail = typeof invite?.email === "string" ? invite.email.trim().toLowerCase() : "";
  const actualEmail = typeof input.userEmail === "string" ? input.userEmail.trim().toLowerCase() : "";
  if (invitedEmail && !actualEmail) {
    return {
      configured: true,
      ok: false,
      error: `Invite is locked to ${invitedEmail}, but the current login did not expose an email address.`,
      errorCode: "invite_email_required"
    };
  }
  if (invitedEmail && actualEmail && invitedEmail !== actualEmail) {
    return {
      configured: true,
      ok: false,
      error: `Invite is for ${invitedEmail}, but the current login is ${actualEmail}.`,
      errorCode: "invite_email_mismatch"
    };
  }

  const { data, error } = await supabase.rpc("sayve_accept_household_invite", {
    invite_token: input.token,
    accepting_user_id: input.userId
  });

  if (error) {
    return { configured: true, ok: false, error: error.message, errorCode: "invite_member_upsert_failed" };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    return { configured: true, ok: false, error: "Invite acceptance returned no result.", errorCode: "invite_member_upsert_failed" };
  }

  const result = row as {
    ok?: boolean;
    error_code?: HouseholdOnboardingErrorCode | null;
    error_message?: string | null;
    household_id?: string | null;
    user_id?: string | null;
    role?: string | null;
  };

  if (!result.ok) {
    return {
      configured: true,
      ok: false,
      error: result.error_message ?? "Invite could not be accepted.",
      errorCode: result.error_code ?? "invite_member_upsert_failed",
      data: {
        householdId: result.household_id,
        userId: result.user_id,
        role: result.role,
        invitedEmail
      }
    };
  }

  return {
    configured: true,
    ok: true,
    data: {
      householdId: result.household_id,
      userId: input.userId,
      role: result.role,
      invitedEmail
    }
  };
}
