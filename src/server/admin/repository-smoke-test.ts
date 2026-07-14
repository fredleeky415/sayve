import { getMemoryRepository, resolveMemoryRepositoryMode } from "@/server/memory/store";
import { createSupabaseServiceClient } from "@/server/supabase/service-client";

export type RepositorySmokeTestResult = {
  configured: boolean;
  ok: boolean;
  repositoryMode: string;
  householdId?: string;
  targetHouseholdId?: string;
  householdExists?: boolean;
  memberCount?: number;
  ownerCount?: number;
  viewerCount?: number;
  onboarding?: {
    pendingInvites: number;
    acceptedInvites: number;
    expiredInvites: number;
    emailLockedInvites: number;
    memberInvites: number;
    viewerInvites: number;
  };
  counts?: {
    captures: number;
    memories: number;
    facts: number;
    contexts: number;
    telemetry: number;
  };
  persistedSnapshot?: boolean;
  error?: string;
};

function emptyOnboardingSummary(): NonNullable<RepositorySmokeTestResult["onboarding"]> {
  return {
    pendingInvites: 0,
    acceptedInvites: 0,
    expiredInvites: 0,
    emailLockedInvites: 0,
    memberInvites: 0,
    viewerInvites: 0
  };
}

export async function runRepositorySmokeTest(input: {
  householdId?: string;
  supabase?: ReturnType<typeof createSupabaseServiceClient>;
  repositoryFactory?: typeof getMemoryRepository;
} = {}): Promise<RepositorySmokeTestResult> {
  const repositoryMode = resolveMemoryRepositoryMode();
  const householdId = input.householdId?.trim() || process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID;
  const supabase = input.supabase ?? createSupabaseServiceClient();
  const repositoryFactory = input.repositoryFactory ?? getMemoryRepository;

  if (repositoryMode !== "supabase") {
    return {
      configured: false,
      ok: false,
      repositoryMode,
      targetHouseholdId: householdId,
      householdExists: false,
      memberCount: 0,
      ownerCount: 0,
      viewerCount: 0,
      onboarding: emptyOnboardingSummary(),
      error: "Memory repository is still local; switch runtime storage to Supabase before launch."
    };
  }

  if (!supabase || !householdId) {
    return {
      configured: false,
      ok: false,
      repositoryMode,
      householdId,
      targetHouseholdId: householdId,
      householdExists: false,
      memberCount: 0,
      ownerCount: 0,
      viewerCount: 0,
      onboarding: emptyOnboardingSummary(),
      error: "Supabase service env or SUPABASE_DEFAULT_HOUSEHOLD_ID is missing."
    };
  }

  try {
    const repository = repositoryFactory(householdId);
    const store = await repository.readAsync();
    await repository.commitAsync();

    const { data, error } = await supabase
      .from("memory_store_snapshots")
      .select("household_id, updated_at")
      .eq("household_id", householdId)
      .maybeSingle();

    if (error) {
      return {
        configured: true,
        ok: false,
        repositoryMode,
        householdId,
        targetHouseholdId: householdId,
        householdExists: false,
        memberCount: 0,
        ownerCount: 0,
        viewerCount: 0,
        onboarding: emptyOnboardingSummary(),
        error: `Could not verify memory_store_snapshots row. ${error.message}`
      };
    }

    const householdLookup = await supabase.from("households").select("id").eq("id", householdId).maybeSingle();
    if (householdLookup.error) {
      return {
        configured: true,
        ok: false,
        repositoryMode,
        householdId,
        targetHouseholdId: householdId,
        persistedSnapshot: Boolean(data),
        householdExists: false,
        memberCount: 0,
        ownerCount: 0,
        viewerCount: 0,
        onboarding: emptyOnboardingSummary(),
        error: `Could not verify household row. ${householdLookup.error.message}`
      };
    }

    const membersLookup = await supabase.from("household_members").select("role").eq("household_id", householdId);
    if (membersLookup.error) {
      return {
        configured: true,
        ok: false,
        repositoryMode,
        householdId,
        targetHouseholdId: householdId,
        persistedSnapshot: Boolean(data),
        householdExists: Boolean(householdLookup.data),
        memberCount: 0,
        ownerCount: 0,
        viewerCount: 0,
        onboarding: emptyOnboardingSummary(),
        error: `Could not verify household members. ${membersLookup.error.message}`
      };
    }

    const invitesLookup = await supabase
      .from("invites")
      .select("role,email,accepted_at,expires_at")
      .eq("household_id", householdId);
    if (invitesLookup.error) {
      return {
        configured: true,
        ok: false,
        repositoryMode,
        householdId,
        targetHouseholdId: householdId,
        persistedSnapshot: Boolean(data),
        householdExists: Boolean(householdLookup.data),
        memberCount: Array.isArray(membersLookup.data) ? membersLookup.data.length : 0,
        ownerCount: Array.isArray(membersLookup.data) ? membersLookup.data.filter((row) => row?.role === "owner").length : 0,
        viewerCount: Array.isArray(membersLookup.data) ? membersLookup.data.filter((row) => row?.role === "viewer").length : 0,
        onboarding: emptyOnboardingSummary(),
        error: `Could not verify household invites. ${invitesLookup.error.message}`
      };
    }

    const memberRows = Array.isArray(membersLookup.data) ? membersLookup.data : [];
    const ownerCount = memberRows.filter((row) => row?.role === "owner").length;
    const memberCount = memberRows.length;
    const viewerCount = memberRows.filter((row) => row?.role === "viewer").length;
    const now = Date.now();
    const inviteRows = Array.isArray(invitesLookup.data) ? invitesLookup.data : [];
    const acceptedInvites = inviteRows.filter((row) => typeof row?.accepted_at === "string" && row.accepted_at.length > 0).length;
    const expiredInvites = inviteRows.filter((row) => !row?.accepted_at && row?.expires_at && new Date(row.expires_at).getTime() < now).length;
    const pendingInvites = inviteRows.length - acceptedInvites - expiredInvites;
    const emailLockedInvites = inviteRows.filter((row) => typeof row?.email === "string" && row.email.trim().length > 0).length;
    const memberInvites = inviteRows.filter((row) => row?.role === "member").length;
    const viewerInvites = inviteRows.filter((row) => row?.role === "viewer").length;
    const householdExists = Boolean(householdLookup.data);
    const householdHealthy = householdExists && memberCount > 0 && ownerCount > 0;
    const snapshotPersisted = Boolean(data);

    return {
      configured: true,
      ok: snapshotPersisted && householdHealthy,
      repositoryMode,
      householdId,
      targetHouseholdId: householdId,
      householdExists,
      memberCount,
      ownerCount,
      viewerCount,
      onboarding: {
        pendingInvites,
        acceptedInvites,
        expiredInvites,
        emailLockedInvites,
        memberInvites,
        viewerInvites
      },
      counts: {
        captures: store.captures.length,
        memories: store.memoryObjects.length,
        facts: store.facts.length,
        contexts: store.contexts.length,
        telemetry: store.aiTelemetry.length
      },
      persistedSnapshot: snapshotPersisted,
      error: !snapshotPersisted
        ? "Repository commit completed but no memory_store_snapshots row was found."
        : !householdExists
          ? "Repository snapshot exists, but no matching household row was found."
          : memberCount === 0
            ? "Repository snapshot exists, but the household has no members yet."
            : ownerCount === 0
              ? "Repository snapshot exists, but the household has no owner member yet."
              : undefined
    };
  } catch (error) {
    return {
      configured: true,
      ok: false,
      repositoryMode,
      householdId,
      targetHouseholdId: householdId,
      householdExists: false,
      memberCount: 0,
      ownerCount: 0,
      viewerCount: 0,
      onboarding: emptyOnboardingSummary(),
      error: error instanceof Error ? error.message : "Unknown repository smoke test error."
    };
  }
}
