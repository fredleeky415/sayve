import { buildSupabaseImportPlanAsync } from "@/server/memory/supabase-export";
import { dryRunSupabaseImport, type DryRunResult } from "@/server/memory/supabase-dry-run";
import { validateSupabaseImportPlan, type ValidationResult } from "@/server/memory/supabase-import-validator";
import { getSupabaseMigrationInventory } from "@/server/memory/supabase-migration-inventory";
import { readAppliedSupabaseMigrations, type AppliedSupabaseMigrationsResult } from "@/server/memory/supabase-applied-migrations";
import { getMemoryRepository, type AiTelemetryEvent, type MemoryStoreState } from "@/server/memory/store";
import { runCaptureMediaStorageSmokeTest, type CaptureMediaStorageSmokeResult } from "@/server/media/storage-smoke";
import { createSupabaseServiceClient } from "@/server/supabase/service-client";
import { createHash } from "node:crypto";
import setupArtifactSpec from "@/shared/setup-artifacts-spec.json";

const DAY_MS = 24 * 60 * 60 * 1000;

function todayPrefix() {
  return new Date().toISOString().slice(0, 10);
}

function monthPrefix() {
  return new Date().toISOString().slice(0, 7);
}

function pct(part: number, total: number): number {
  return total === 0 ? 0 : Number(((part / total) * 100).toFixed(1));
}

function money(value: number): number {
  return Number(value.toFixed(6));
}

function sumCost(events: AiTelemetryEvent[]): number {
  return money(events.reduce((sum, event) => sum + (event.estimatedCostUsd ?? 0), 0));
}

function sumTokens(events: AiTelemetryEvent[]): number {
  return events.reduce((sum, event) => sum + (event.totalTokens ?? 0), 0);
}

function avgDuration(events: AiTelemetryEvent[]): number {
  const durations = events.map((event) => event.durationMs).filter((duration): duration is number => typeof duration === "number");
  if (durations.length === 0) return 0;
  return Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length);
}

function p95Duration(events: AiTelemetryEvent[]): number {
  const durations = events
    .map((event) => event.durationMs)
    .filter((duration): duration is number => typeof duration === "number")
    .sort((a, b) => a - b);
  if (durations.length === 0) return 0;
  return durations[Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1)] ?? 0;
}

function missingTelemetryCount(events: AiTelemetryEvent[], field: "totalTokens" | "estimatedCostUsd" | "durationMs"): number {
  return events.filter((event) => typeof event[field] !== "number").length;
}

function metadataText(event: AiTelemetryEvent, key: string): string {
  const value = event.metadata?.[key];
  return typeof value === "string" ? value : "";
}

function metadataBoolean(event: AiTelemetryEvent, key: string): boolean {
  return event.metadata?.[key] === true;
}

function metadataNumber(event: AiTelemetryEvent, key: string): number | null {
  const value = event.metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function groupCount<T extends string>(values: T[]): Array<{ label: T; count: number; percent: number }> {
  const total = values.length;
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count, percent: pct(count, total) }))
    .sort((a, b) => b.count - a.count);
}

function topStrings(values: string[], limit = 8): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const normalized = value.trim().replace(/\s+/g, " ").slice(0, 80);
    if (!normalized) continue;
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function slowestTelemetryPhase(events: AiTelemetryEvent[]): { phase: string; averageDurationMs: number } {
  const phaseDurations = new Map<string, number[]>();
  for (const event of events) {
    if (typeof event.durationMs !== "number") continue;
    const values = phaseDurations.get(event.phase) ?? [];
    values.push(event.durationMs);
    phaseDurations.set(event.phase, values);
  }

  const [phase, durations] =
    [...phaseDurations.entries()]
      .map(([label, values]) => [label, values] as const)
      .sort((a, b) => b[1].reduce((sum, value) => sum + value, 0) / b[1].length - a[1].reduce((sum, value) => sum + value, 0) / a[1].length)[0] ??
    ["", [] as number[]];

  if (!phase || durations.length === 0) return { phase: "", averageDurationMs: 0 };
  return {
    phase,
    averageDurationMs: Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length)
  };
}

function compactId(id?: string): string {
  return id ? id.slice(0, 12) : "";
}

function jsonCell(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function sourceTextForCaptureId(store: MemoryStoreState, captureId: string): string {
  const capture = store.captures.find((item) => item.id === captureId);
  return (capture?.rawText ?? capture?.transcript ?? String(capture?.metadata.description ?? "")).slice(0, 120);
}

function captureDebugText(capture: MemoryStoreState["captures"][number], key: string): string {
  const value = capture.metadata?.[key];
  return typeof value === "string" ? value : "";
}

function emptyMemoryStoreState(): MemoryStoreState {
  return {
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
  };
}

type FounderDefaultHouseholdBinding = {
  configured: boolean;
  householdId: string;
  exists: boolean;
  memberCount: number;
  ownerCount: number;
  issue: string;
};

type FounderOnboardingHealth = {
  configured: boolean;
  totalInvites: number;
  pendingInvites: number;
  acceptedInvites: number;
  expiredInvites: number;
  emailLockedInvites: number;
  recentInvites: Array<{
    householdId: string;
    email: string;
    role: string;
    status: "pending" | "accepted" | "expired";
    expiresAt: string;
    acceptedAt: string;
  }>;
  issue: string;
};

type FounderHouseholdRosterRow = RawTableRow;
type FounderMigrationInspection = {
  validation: ValidationResult;
  dryRun: DryRunResult;
  applied: AppliedSupabaseMigrationsResult;
};
type FounderLiveRolloutRow = RawTableRow;
type FounderLaunchReadinessSnapshot = {
  configReadyForPrivateBeta: boolean;
  liveSmokeVerified: boolean;
  readyForPublicLaunch: boolean;
};

export type FounderSetupBundle = {
  generatedAt: string;
  signature: string;
  launchReadiness: FounderLaunchReadinessSnapshot;
  launchReadinessChecks: Array<{ id: string; label: string; status: "pass" | "warn" | "fail"; detail: string }>;
  defaultHouseholdBinding: FounderDefaultHouseholdBinding;
  onboardingHealth: FounderOnboardingHealth;
  nextActions: string[];
  commands: {
    privateBeta: string;
    strictPrivateBeta: string;
    strictPrivateBetaProof: string;
    publicLaunch: string;
  };
  views: {
    liveRollout: RawTableRow[];
    liveProofGaps: RawTableRow[];
    launchCompletionAudit: RawTableRow[];
    launchBlockers: RawTableRow[];
    publicLaunchChecks: RawTableRow[];
    schemaMigrationProof: RawTableRow[];
    migrationInventory: RawTableRow[];
    privateBetaSetupGate: RawTableRow[];
    executionChecklist: RawTableRow[];
    onboardingProofSteps: RawTableRow[];
    integrationReadiness: RawTableRow[];
    integrationPackage: RawTableRow[];
    providerSetup: RawTableRow[];
    authSetup: RawTableRow[];
    envSetup: RawTableRow[];
    envTemplate: RawTableRow[];
    deployEnvTemplate: RawTableRow[];
    deploySmokeEnvTemplate: RawTableRow[];
    repositorySmokeGuide: RawTableRow[];
    oauthChecklist: RawTableRow[];
    smokeTokenGuide: RawTableRow[];
  };
};

export type FounderIntegrationBundle = {
  generatedAt: string;
  signature: string;
  launchReadiness: FounderLaunchReadinessSnapshot;
  launchReadinessChecks: Array<{ id: string; label: string; status: "pass" | "warn" | "fail"; detail: string }>;
  nextActions: string[];
  commands: {
    privateBeta: string;
    strictPrivateBeta: string;
    strictPrivateBetaProof: string;
    publicLaunch: string;
  };
  views: {
    launchCompletionAudit: RawTableRow[];
    launchBlockers: RawTableRow[];
    liveProofGaps: RawTableRow[];
    schemaMigrationProof: RawTableRow[];
    migrationInventory: RawTableRow[];
    privateBetaSetupGate: RawTableRow[];
    executionChecklist: RawTableRow[];
    onboardingProofSteps: RawTableRow[];
    integrationReadiness: RawTableRow[];
    integrationPackage: RawTableRow[];
    providerSetup: RawTableRow[];
    authSetup: RawTableRow[];
    envSetup: RawTableRow[];
    envTemplate: RawTableRow[];
    deployEnvTemplate: RawTableRow[];
    deploySmokeEnvTemplate: RawTableRow[];
    oauthChecklist: RawTableRow[];
    smokeTokenGuide: RawTableRow[];
  };
};

export type FounderLiveProofBundle = {
  generatedAt: string;
  signature: string;
  launchReadiness: FounderLaunchReadinessSnapshot;
  launchReadinessChecks: Array<{ id: string; label: string; status: "pass" | "warn" | "fail"; detail: string }>;
  defaultHouseholdBinding: FounderDefaultHouseholdBinding;
  onboardingHealth: FounderOnboardingHealth;
  nextActions: string[];
  commands: {
    privateBeta: string;
    strictPrivateBeta: string;
    strictPrivateBetaProof: string;
    publicLaunch: string;
  };
  views: {
    liveRollout: RawTableRow[];
    liveProofGaps: RawTableRow[];
    onboardingProofSteps: RawTableRow[];
    launchCompletionAudit: RawTableRow[];
    launchBlockers: RawTableRow[];
    publicLaunchChecks: RawTableRow[];
    schemaMigrationProof: RawTableRow[];
    migrationInventory: RawTableRow[];
    deployEnvTemplate: RawTableRow[];
    deploySmokeEnvTemplate: RawTableRow[];
    smokeTokenGuide: RawTableRow[];
  };
};

function normalizeMemoryStoreState(value: unknown): MemoryStoreState {
  const parsed = structuredClone((value ?? {}) as Partial<MemoryStoreState>);
  return {
    captures: parsed.captures ?? [],
    memoryObjects: parsed.memoryObjects ?? [],
    interpretations: parsed.interpretations ?? [],
    facts: parsed.facts ?? [],
    contexts: parsed.contexts ?? [],
    relationships: parsed.relationships ?? [],
    revisions: parsed.revisions ?? [],
    insights: parsed.insights ?? [],
    conversationMessages: parsed.conversationMessages ?? [],
    usage: (parsed.usage ?? []).map((bucket) => ({ ...bucket, dashboardViews: bucket.dashboardViews ?? 0 })),
    aiTelemetry: parsed.aiTelemetry ?? [],
    categories: parsed.categories ?? []
  };
}

export function combineMemoryStoreStates(states: MemoryStoreState[]): MemoryStoreState {
  const combined = emptyMemoryStoreState();
  for (const state of states) {
    combined.captures.push(...state.captures);
    combined.memoryObjects.push(...state.memoryObjects);
    combined.interpretations.push(...state.interpretations);
    combined.facts.push(...state.facts);
    combined.contexts.push(...state.contexts);
    combined.relationships.push(...state.relationships);
    combined.revisions.push(...state.revisions);
    combined.insights.push(...state.insights);
    combined.conversationMessages.push(...state.conversationMessages);
    combined.usage.push(...state.usage);
    combined.aiTelemetry.push(...state.aiTelemetry);
    combined.categories.push(...state.categories);
  }
  return combined;
}

async function readFounderMemoryStore(): Promise<MemoryStoreState> {
  if (process.env.MEMORY_REPOSITORY !== "supabase") return getMemoryRepository().readAsync();

  const supabase = createSupabaseServiceClient();
  if (!supabase) return emptyMemoryStoreState();

  const { data, error } = await supabase.from("memory_store_snapshots").select("state");
  if (error || !data) return emptyMemoryStoreState();

  return combineMemoryStoreStates(data.map((row: { state: unknown }) => normalizeMemoryStoreState(row.state)));
}

async function readFounderDefaultHouseholdBinding(): Promise<FounderDefaultHouseholdBinding> {
  const householdId = process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID?.trim() ?? "";
  const supabase = createSupabaseServiceClient();

  if (!householdId) {
    return {
      configured: false,
      householdId: "",
      exists: false,
      memberCount: 0,
      ownerCount: 0,
      issue: "SUPABASE_DEFAULT_HOUSEHOLD_ID is not configured."
    };
  }

  if (!supabase) {
    return {
      configured: false,
      householdId,
      exists: false,
      memberCount: 0,
      ownerCount: 0,
      issue: "Supabase service env is not configured."
    };
  }

  const household = await supabase.from("households").select("id,name").eq("id", householdId).maybeSingle();
  if (household.error) {
    return {
      configured: true,
      householdId,
      exists: false,
      memberCount: 0,
      ownerCount: 0,
      issue: household.error.message
    };
  }

  if (!household.data?.id) {
    return {
      configured: true,
      householdId,
      exists: false,
      memberCount: 0,
      ownerCount: 0,
      issue: "Configured household id does not exist in Supabase."
    };
  }

  const members = await supabase.from("household_members").select("user_id,role").eq("household_id", householdId);
  if (members.error) {
    return {
      configured: true,
      householdId,
      exists: true,
      memberCount: 0,
      ownerCount: 0,
      issue: members.error.message
    };
  }

  const memberRows = members.data ?? [];
  const ownerCount = memberRows.filter((row) => row.role === "owner").length;
  const issue =
    memberRows.length === 0
      ? "Household exists but has no members yet."
      : ownerCount === 0
        ? "Household exists but has no owner member yet."
        : "";

  return {
    configured: true,
    householdId,
    exists: true,
    memberCount: memberRows.length,
    ownerCount,
    issue
  };
}

async function readFounderOnboardingHealth(): Promise<FounderOnboardingHealth> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return {
      configured: false,
      totalInvites: 0,
      pendingInvites: 0,
      acceptedInvites: 0,
      expiredInvites: 0,
      emailLockedInvites: 0,
      recentInvites: [],
      issue: "Supabase service env is not configured."
    };
  }

  const invites = await supabase
    .from("invites")
    .select("household_id,email,role,expires_at,accepted_at,created_at")
    .order("created_at", { ascending: false })
    .limit(20);

  if (invites.error) {
    return {
      configured: true,
      totalInvites: 0,
      pendingInvites: 0,
      acceptedInvites: 0,
      expiredInvites: 0,
      emailLockedInvites: 0,
      recentInvites: [],
      issue: invites.error.message
    };
  }

  const rows = (invites.data ?? []) as Array<{
    household_id?: string | null;
    email?: string | null;
    role?: string | null;
    expires_at?: string | null;
    accepted_at?: string | null;
    created_at?: string | null;
  }>;
  const now = Date.now();
  const normalized: FounderOnboardingHealth["recentInvites"] = rows.map((row) => {
    const expiresAt = row.expires_at ?? "";
    const acceptedAt = row.accepted_at ?? "";
    const expired = !acceptedAt && expiresAt ? new Date(expiresAt).getTime() < now : false;
    const status: FounderOnboardingHealth["recentInvites"][number]["status"] = acceptedAt ? "accepted" : expired ? "expired" : "pending";
    return {
      householdId: row.household_id ?? "",
      email: row.email ?? "",
      role: row.role ?? "",
      status,
      expiresAt,
      acceptedAt
    };
  });

  return {
    configured: true,
    totalInvites: normalized.length,
    pendingInvites: normalized.filter((invite) => invite.status === "pending").length,
    acceptedInvites: normalized.filter((invite) => invite.status === "accepted").length,
    expiredInvites: normalized.filter((invite) => invite.status === "expired").length,
    emailLockedInvites: normalized.filter((invite) => invite.email.trim().length > 0).length,
    recentInvites: normalized.slice(0, 8),
    issue: ""
  };
}

async function readFounderHouseholdRoster(): Promise<FounderHouseholdRosterRow[]> {
  const householdId = process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID?.trim() ?? "";
  const supabase = createSupabaseServiceClient();

  if (!householdId) {
    return [
      {
        rowType: "binding",
        householdId: "",
        householdName: "",
        userId: "",
        role: "",
        inviteEmail: "",
        inviteStatus: "",
        acceptedAt: "",
        expiresAt: "",
        issue: "SUPABASE_DEFAULT_HOUSEHOLD_ID is not configured."
      }
    ];
  }

  if (!supabase) {
    return [
      {
        rowType: "binding",
        householdId,
        householdName: "",
        userId: "",
        role: "",
        inviteEmail: "",
        inviteStatus: "",
        acceptedAt: "",
        expiresAt: "",
        issue: "Supabase service env is not configured."
      }
    ];
  }

  const [household, members, invites] = await Promise.all([
    supabase.from("households").select("id,name").eq("id", householdId).maybeSingle(),
    supabase.from("household_members").select("user_id,role").eq("household_id", householdId),
    supabase.from("invites").select("email,role,expires_at,accepted_at,created_at").eq("household_id", householdId).order("created_at", { ascending: false }).limit(20)
  ]);

  if (household.error) {
    return [
      {
        rowType: "binding",
        householdId,
        householdName: "",
        userId: "",
        role: "",
        inviteEmail: "",
        inviteStatus: "",
        acceptedAt: "",
        expiresAt: "",
        issue: household.error.message
      }
    ];
  }

  const householdName = household.data?.name ?? "";
  const rows: FounderHouseholdRosterRow[] = [
    {
      rowType: "binding",
      householdId,
      householdName,
      userId: "",
      role: "",
      inviteEmail: "",
      inviteStatus: "",
      acceptedAt: "",
      expiresAt: "",
      issue: household.data?.id ? "" : "Configured household id does not exist in Supabase."
    }
  ];

  if (members.error) {
    rows.push({
      rowType: "member_error",
      householdId,
      householdName,
      userId: "",
      role: "",
      inviteEmail: "",
      inviteStatus: "",
      acceptedAt: "",
      expiresAt: "",
      issue: members.error.message
    });
  } else {
    for (const member of members.data ?? []) {
      rows.push({
        rowType: "member",
        householdId,
        householdName,
        userId: member.user_id ?? "",
        role: member.role ?? "",
        inviteEmail: "",
        inviteStatus: "",
        acceptedAt: "",
        expiresAt: "",
        issue: ""
      });
    }
  }

  if (invites.error) {
    rows.push({
      rowType: "invite_error",
      householdId,
      householdName,
      userId: "",
      role: "",
      inviteEmail: "",
      inviteStatus: "",
      acceptedAt: "",
      expiresAt: "",
      issue: invites.error.message
    });
  } else {
    const now = Date.now();
    for (const invite of invites.data ?? []) {
      const acceptedAt = invite.accepted_at ?? "";
      const expiresAt = invite.expires_at ?? "";
      const expired = !acceptedAt && expiresAt ? new Date(expiresAt).getTime() < now : false;
      rows.push({
        rowType: "invite",
        householdId,
        householdName,
        userId: "",
        role: invite.role ?? "",
        inviteEmail: invite.email ?? "",
        inviteStatus: acceptedAt ? "accepted" : expired ? "expired" : "pending",
        acceptedAt,
        expiresAt,
        issue: ""
      });
    }
  }

  return rows;
}

async function readFounderMigrationInspection(): Promise<FounderMigrationInspection> {
  const plan = await buildSupabaseImportPlanAsync();
  const validation = validateSupabaseImportPlan(plan);
  const dryRun = await dryRunSupabaseImport(plan);
  const applied = await readAppliedSupabaseMigrations();
  return { validation, dryRun, applied };
}

const databaseFieldDictionary = [
  { table: "captures", field: "rawText / transcript / metadata.rawTranscript / metadata.cleanedTranscript / fileRefs", purpose: "保存 user 原始 dump，不改寫", aiUse: "AI extraction 的原始來源，可重跑理解，亦可 audit voice transcript 清洗" },
  { table: "memory_objects", field: "title / status / confidence / currentState", purpose: "一件 Memory 的目前狀態", aiUse: "判斷 auto-confirm、review later、needs input、merged" },
  { table: "memory_interpretations", field: "intent / structuredOutput / reasoningSummary", purpose: "AI 對 capture 的理解版本", aiUse: "用來 audit AI 點解咁分類，以及之後 model reprocess" },
  { table: "memory_facts", field: "payload.eventDate / merchant / money / category", purpose: "不可覆寫的財務事實", aiUse: "SQL 查數、Dashboard、Conversation exact facts" },
  { table: "household_context", field: "subject / state / currentState / effectiveFrom", purpose: "家庭目前狀態", aiUse: "例如 Netflix 已取消，之後再出現就觸發 insight" },
  { table: "memory_relationships", field: "from / to / relationshipType / reason", purpose: "連結 capture、fact、context、memory", aiUse: "merge、同一件事、context contradiction、引用來源" },
  { table: "memory_revisions", field: "revisionType / actor / actorUserId / diff / reason", purpose: "所有修正、merge、reprocess audit trail", aiUse: "避免覆寫歷史，讓 AI 學習 user correction" },
  { table: "household_categories", field: "name / color / createdBy / createdByUserId", purpose: "家庭自定義分類", aiUse: "影響 AI 之後點樣分類，同時保留邊個教過 AI" },
  { table: "ai_telemetry", field: "phase / model / tokens / cost / duration", purpose: "每次 AI call 的成本與品質紀錄", aiUse: "Founder 判斷 AI 是否貴、慢、準" }
];

type RawTableName =
  | "captures"
  | "memories"
  | "interpretations"
  | "facts"
  | "contexts"
  | "relationships"
  | "revisions"
  | "categories"
  | "conversations"
  | "telemetry";
type RawTableRow = Record<string, string | number>;
type ReadableViewName =
  | "schemaDictionary"
  | "ledger"
  | "contextState"
  | "qualityQueue"
  | "aiWorkTrace"
  | "captureDebug"
  | "householdSetup"
  | "householdRoster"
  | "supabaseMigration"
  | "schemaMigrationProof"
  | "launchCompletionAudit"
  | "launchBlockers"
  | "liveProofGaps"
  | "publicLaunchChecks"
  | "migrationInventory"
  | "privateBetaSetupGate"
  | "executionChecklist"
  | "onboardingProofSteps"
  | "integrationReadiness"
  | "integrationPackage"
  | "providerSetup"
  | "envSetup"
  | "authSetup"
  | "envTemplate"
  | "deployEnvTemplate"
  | "deploySmokeEnvTemplate"
  | "repositorySmokeGuide"
  | "oauthChecklist"
  | "smokeTokenGuide"
  | "liveSmokeEvidence"
  | "liveRollout";
type FounderExportScope = "raw" | "view";
type SetupTemplateSpecRow = {
  env: string;
  requiredFor: string;
  detail: string;
  fallback: string;
};

export function founderConsoleEnabled(): boolean {
  return process.env.FOUNDER_CONSOLE_ENABLED !== "0";
}

export function founderTokenRequired(): boolean {
  return Boolean(process.env.ADMIN_CONSOLE_TOKEN);
}

export function canAccessFounderConsole(token?: string | null): boolean {
  if (!founderConsoleEnabled()) return false;
  const expected = process.env.ADMIN_CONSOLE_TOKEN;
  return expected ? token === expected : true;
}

export function buildDeploymentSmokeCommands(defaultHouseholdId = ""): {
  privateBeta: string;
  strictPrivateBeta: string;
  strictPrivateBetaProof: string;
  publicLaunch: string;
} {
  const deployUrl = process.env.SAYVE_DEPLOY_URL?.trim() || "";
  const appAccessToken = process.env.APP_ACCESS_TOKEN?.trim() || "";
  const adminConsoleToken = process.env.ADMIN_CONSOLE_TOKEN?.trim() || "";
  const founderToken = process.env.SAYVE_TEST_SUPABASE_ACCESS_TOKEN?.trim() || "";
  const partnerToken = process.env.SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN?.trim() || "";
  const viewerToken = process.env.SAYVE_TEST_VIEWER_SUPABASE_ACCESS_TOKEN?.trim() || "";
  const inviteAcceptToken = process.env.SAYVE_TEST_INVITE_ACCEPT_SUPABASE_ACCESS_TOKEN?.trim() || "";
  const bootstrapToken = process.env.SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN?.trim() || "";
  const householdId = process.env.SAYVE_TEST_HOUSEHOLD_ID?.trim() || defaultHouseholdId || "";

  return {
    privateBeta: [
      `SAYVE_DEPLOY_URL=${deployUrl || "https://your-domain"}`,
      `APP_ACCESS_TOKEN=${appAccessToken || "..."}`,
      `ADMIN_CONSOLE_TOKEN=${adminConsoleToken || "..."}`,
      "pnpm run verify:deploy:private-beta"
    ].join(" "),
    strictPrivateBeta: [
      `SAYVE_DEPLOY_URL=${deployUrl || "https://your-domain"}`,
      `APP_ACCESS_TOKEN=${appAccessToken || "..."}`,
      `ADMIN_CONSOLE_TOKEN=${adminConsoleToken || "..."}`,
      `SAYVE_TEST_SUPABASE_ACCESS_TOKEN=${founderToken || "<owner-session-token>"}`,
      `SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN=${partnerToken || "<member-session-token>"}`,
      `SAYVE_TEST_VIEWER_SUPABASE_ACCESS_TOKEN=${viewerToken || "<viewer-session-token>"}`,
      `SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN=${bootstrapToken || "<fresh-no-household-session-token>"}`,
      `SAYVE_TEST_HOUSEHOLD_ID=${householdId || "<household-uuid>"}`,
      "pnpm run verify:deploy:strict-private-beta"
    ].join(" \\\n"),
    strictPrivateBetaProof: [
      "SAYVE_DEPLOY_PROOF_REPORT_PATH=outputs/setup/deploy-proof-report.json",
      `SAYVE_DEPLOY_URL=${deployUrl || "https://your-domain"}`,
      `APP_ACCESS_TOKEN=${appAccessToken || "..."}`,
      `ADMIN_CONSOLE_TOKEN=${adminConsoleToken || "..."}`,
      `SAYVE_TEST_SUPABASE_ACCESS_TOKEN=${founderToken || "<owner-session-token>"}`,
      `SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN=${partnerToken || "<member-session-token>"}`,
      `SAYVE_TEST_VIEWER_SUPABASE_ACCESS_TOKEN=${viewerToken || "<viewer-session-token>"}`,
      `SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN=${bootstrapToken || "<fresh-no-household-session-token>"}`,
      `SAYVE_TEST_HOUSEHOLD_ID=${householdId || "<household-uuid>"}`,
      "pnpm run verify:deploy:strict-private-beta:proof"
    ].join(" \\\n"),
    publicLaunch: [
      `SAYVE_DEPLOY_URL=${deployUrl || "https://your-domain"}`,
      `APP_ACCESS_TOKEN=${appAccessToken || "..."}`,
      `ADMIN_CONSOLE_TOKEN=${adminConsoleToken || "..."}`,
      `SAYVE_TEST_SUPABASE_ACCESS_TOKEN=${founderToken || "<owner-session-token>"}`,
      `SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN=${partnerToken || "<member-session-token>"}`,
      `SAYVE_TEST_VIEWER_SUPABASE_ACCESS_TOKEN=${viewerToken || "<viewer-session-token>"}`,
      `SAYVE_TEST_INVITE_ACCEPT_SUPABASE_ACCESS_TOKEN=${inviteAcceptToken || "<fresh-unjoined-session-token>"}`,
      `SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN=${bootstrapToken || "<fresh-no-household-session-token>"}`,
      `SAYVE_TEST_HOUSEHOLD_ID=${householdId || "<household-uuid>"}`,
      "pnpm run verify:deploy:public-launch"
    ].join(" \\\n")
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function createFounderBundleSignature(
  bundle:
    | Omit<FounderSetupBundle, "generatedAt" | "signature">
    | Omit<FounderIntegrationBundle, "generatedAt" | "signature">
    | Omit<FounderLiveProofBundle, "generatedAt" | "signature">
): string {
  return createHash("sha256").update(stableStringify(bundle)).digest("hex");
}

function templateValueForEnv(env: string, fallback: string): string {
  switch (env) {
    case "SAYVE_ENV_TARGET":
      return fallback;
    case "MEMORY_REPOSITORY":
      return process.env.MEMORY_REPOSITORY?.trim() || fallback;
    case "NEXT_PUBLIC_APP_URL":
      return process.env.NEXT_PUBLIC_APP_URL?.trim() || fallback;
    case "NEXT_PUBLIC_SUPABASE_URL":
      return process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || fallback;
    case "NEXT_PUBLIC_SUPABASE_ANON_KEY":
      return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ? "configured" : fallback;
    case "SUPABASE_URL":
      return process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || fallback;
    case "SUPABASE_SERVICE_ROLE_KEY":
      return process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ? "configured" : fallback;
    case "SUPABASE_DEFAULT_HOUSEHOLD_ID":
      return process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID?.trim() || fallback;
    case "SUPABASE_AUTH_REQUIRED":
      return process.env.SUPABASE_AUTH_REQUIRED?.trim() || fallback;
    case "APP_ACCESS_TOKEN":
      return process.env.APP_ACCESS_TOKEN?.trim() ? "configured" : fallback;
    case "ADMIN_CONSOLE_TOKEN":
      return process.env.ADMIN_CONSOLE_TOKEN?.trim() ? "configured" : fallback;
    case "OPENAI_API_KEY":
      return process.env.OPENAI_API_KEY?.trim() ? "configured" : fallback;
    case "SUPABASE_MEDIA_BUCKET":
      return process.env.SUPABASE_MEDIA_BUCKET?.trim() || fallback;
    case "RECEIPT_UPLOAD_MAX_BYTES":
      return process.env.RECEIPT_UPLOAD_MAX_BYTES?.trim() || fallback;
    case "VOICE_UPLOAD_MAX_BYTES":
      return process.env.VOICE_UPLOAD_MAX_BYTES?.trim() || fallback;
    case "SAYVE_DEPLOY_URL":
      return process.env.SAYVE_DEPLOY_URL?.trim() || fallback;
    case "SAYVE_DEPLOYMENT_SMOKE_VERIFIED":
      return process.env.SAYVE_DEPLOYMENT_SMOKE_VERIFIED?.trim() || fallback;
    case "SAYVE_DEPLOYMENT_SMOKE_VERIFIED_AT":
      return process.env.SAYVE_DEPLOYMENT_SMOKE_VERIFIED_AT?.trim() || fallback;
    case "SAYVE_DEPLOYMENT_SMOKE_TARGET":
      return process.env.SAYVE_DEPLOYMENT_SMOKE_TARGET?.trim() || fallback;
    default:
      return process.env[env]?.trim() || fallback;
  }
}

function buildTemplateRows(view: "env_template" | "deploy_env_template", specRows: SetupTemplateSpecRow[]): RawTableRow[] {
  return specRows.map((row, index) => ({
    view,
    line: index + 1,
    env: row.env,
    value: templateValueForEnv(row.env, row.fallback),
    requiredFor: row.requiredFor,
    detail: row.detail
  }));
}

function buildFounderSetupNextActions(input: {
  defaultHouseholdBinding: FounderDefaultHouseholdBinding;
  onboardingHealth: FounderOnboardingHealth;
  launchReadiness: FounderLaunchReadinessSnapshot;
}): string[] {
  const actions: string[] = [];

  if (!input.defaultHouseholdBinding.exists) {
    actions.push("Create or bind the founder household, then verify SUPABASE_DEFAULT_HOUSEHOLD_ID.");
  }
  if (input.defaultHouseholdBinding.ownerCount === 0) {
    actions.push("Attach at least one owner to the founder household.");
  }
  if (input.defaultHouseholdBinding.memberCount < 2) {
    if (input.onboardingHealth.pendingInvites > 0) {
      actions.push("Finish the pending partner invite so the second member joins the shared household.");
    } else {
      actions.push("Create a partner invite and complete second-member onboarding.");
    }
  }
  if (!input.launchReadiness.configReadyForPrivateBeta) {
    actions.push("Resolve Launch Readiness blockers until private beta config is ready.");
  }
  if (!input.launchReadiness.liveSmokeVerified) {
    actions.push("Run pnpm run verify:deploy:private-beta on the live deployment.");
  }
  if (input.launchReadiness.liveSmokeVerified && !input.launchReadiness.readyForPublicLaunch) {
    actions.push("After private beta smoke passes, finish remaining public launch blockers and rerun public-ready smoke.");
  }

  return actions.length > 0 ? actions.slice(0, 5) : ["Private beta handoff is aligned; next step is real household usage on the live deployment."];
}

function getFounderRawTablesFromStore(store: MemoryStoreState): Record<RawTableName, RawTableRow[]> {
  return {
    captures: store.captures.map((capture) => ({
      id: capture.id,
      time: capture.createdAt,
      household: capture.householdId,
      source: capture.sourceType,
      rawText: capture.rawText ?? "",
      transcript: capture.transcript ?? "",
      rawTranscript: captureDebugText(capture, "rawTranscript"),
      cleanedTranscript: captureDebugText(capture, "cleanedTranscript"),
      files: capture.fileRefs.join(", "),
      createdBy: capture.createdBy ?? "",
      actorUserId: String(capture.metadata.actorUserId ?? ""),
      authSource: String(capture.metadata.authSource ?? ""),
      metadata: jsonCell(capture.metadata)
    })),
    memories: store.memoryObjects.map((memory) => ({
      id: memory.id,
      household: memory.householdId,
      domain: memory.domain,
      title: memory.title,
      currentState: memory.currentState,
      status: memory.status,
      confidence: memory.confidence,
      sourceRefs: jsonCell(memory.sourceRefs),
      created: memory.createdAt,
      updated: memory.updatedAt
    })),
    interpretations: store.interpretations.map((interpretation) => ({
      id: interpretation.id,
      memory: interpretation.memoryObjectId,
      model: interpretation.model,
      promptVersion: interpretation.promptVersion,
      intent: interpretation.intent,
      confidence: interpretation.confidence,
      band: interpretation.confidenceBand,
      reasoning: interpretation.reasoningSummary,
      sourceRefs: jsonCell(interpretation.sourceRefs),
      structuredOutput: jsonCell(interpretation.structuredOutput),
      created: interpretation.createdAt
    })),
    facts: store.facts.map((fact) => ({
      id: fact.id,
      household: fact.householdId,
      memory: fact.memoryObjectId,
      domain: fact.domain,
      date: fact.payload.eventDate,
      merchant: fact.payload.merchant ?? "",
      amount: fact.payload.money?.amount ?? "",
      currency: fact.payload.money?.currency ?? "",
      category: fact.payload.category ?? "",
      direction: fact.payload.direction,
      recurring: String(fact.payload.recurringHint),
      participants: fact.payload.participants.join(", "),
      note: fact.payload.note ?? "",
      immutable: String(fact.immutable),
      sourceRefs: jsonCell(fact.sourceRefs),
      created: fact.createdAt
    })),
    contexts: store.contexts.map((context) => ({
      id: context.id,
      household: context.householdId,
      domain: context.domain,
      subject: context.subject,
      state: context.state,
      current: context.currentState,
      confidence: context.confidence,
      effectiveFrom: context.effectiveFrom ?? "",
      sourceRefs: jsonCell(context.sourceRefs),
      updated: context.updatedAt
    })),
    relationships: store.relationships.map((relationship) => ({
      id: relationship.id,
      household: relationship.householdId,
      from: `${relationship.fromType}:${relationship.fromId}`,
      to: `${relationship.toType}:${relationship.toId}`,
      relationshipType: relationship.relationshipType,
      confidence: relationship.confidence,
      reason: relationship.reason,
      created: relationship.createdAt
    })),
    revisions: store.revisions.map((revision) => ({
      id: revision.id,
      household: revision.householdId,
      memory: revision.memoryObjectId,
      type: revision.revisionType,
      actor: revision.actor,
      actorUserId: revision.actorUserId ?? String(revision.diff.actorUserId ?? ""),
      reason: revision.reason,
      diff: jsonCell(revision.diff),
      created: revision.createdAt
    })),
    categories: store.categories.map((category) => ({
      id: category.id,
      household: category.householdId,
      name: category.name,
      color: category.color ?? "",
      createdBy: category.createdBy,
      createdByUserId: category.createdByUserId ?? "",
      archivedAt: category.archivedAt ?? "",
      created: category.createdAt
    })),
    conversations: store.conversationMessages.map((message) => ({
      id: message.id,
      household: message.householdId,
      role: message.role,
      content: message.content,
      createdBy: message.createdBy ?? "",
      confidence: message.confidence ?? "",
      sourceRefs: jsonCell(message.sourceRefs),
      created: message.createdAt
    })),
    telemetry: store.aiTelemetry.map((event) => ({
      id: event.id,
      time: event.createdAt,
      household: event.householdId,
      phase: event.phase,
      model: event.model,
      provider: event.provider,
      sourceType: event.sourceType ?? "",
      intent: metadataText(event, "intent"),
      decision: metadataText(event, "decision") || metadataText(event, "memoryStatus"),
      confidenceBand: metadataText(event, "confidenceBand"),
      needsUserInput: metadataBoolean(event, "needsUserInput") ? "yes" : "",
      memory: event.memoryObjectId ?? "",
      capture: event.captureId ?? "",
      status: event.status,
      confidence: event.confidence ?? "",
      promptTokens: event.promptTokens ?? 0,
      completionTokens: event.completionTokens ?? 0,
      tokens: event.totalTokens ?? 0,
      costUsd: event.estimatedCostUsd ?? 0,
      durationMs: event.durationMs ?? "",
      metadata: jsonCell(event.metadata)
    }))
  };
}

export async function getFounderRawTables(): Promise<Record<RawTableName, RawTableRow[]>> {
  const store = await readFounderMemoryStore();
  return getFounderRawTablesFromStore(store);
}

function getReadableViews(
  store: MemoryStoreState,
  options: {
    defaultHouseholdBinding?: FounderDefaultHouseholdBinding;
    onboardingHealth?: FounderOnboardingHealth;
    householdRoster?: FounderHouseholdRosterRow[];
    migrationInspection?: FounderMigrationInspection;
    liveRollout?: FounderLiveRolloutRow[];
    aiRuntimeHealth?: {
      openAiEvents: number;
      openAiSuccessRate: number;
      openAiFallbackRate: number;
      openAiErrorEvents: number;
      telemetryCompletenessPercent: number;
      budgetCoveragePercent: number;
      budgetOverrunEvents: number;
    };
    launchReadiness?: FounderLaunchReadinessSnapshot;
    launchReadinessChecks?: Array<{ id: string; label: string; status: "pass" | "warn" | "fail"; detail: string }>;
  } = {}
) {
  const memoriesById = new Map(store.memoryObjects.map((memory) => [memory.id, memory]));
  const interpretationsByMemory = new Map(store.interpretations.map((interpretation) => [interpretation.memoryObjectId, interpretation]));

  const ledger = store.facts
    .map((fact) => {
      const memory = memoriesById.get(fact.memoryObjectId);
      const sourceCaptureRef = fact.sourceRefs.find((ref) => ref.type === "capture");
      return {
        date: fact.payload.eventDate,
        type: fact.payload.direction,
        amount: fact.payload.money?.amount ?? "",
        currency: fact.payload.money?.currency ?? "HKD",
        merchant: fact.payload.merchant ?? "",
        category: fact.payload.category ?? "",
        recurring: fact.payload.recurringHint ? "yes" : "no",
        note: fact.payload.note ?? "",
        confidence: memory?.confidence ?? "",
        status: memory?.status ?? "",
        memory: compactId(fact.memoryObjectId),
        source: sourceCaptureRef ? compactId(sourceCaptureRef.id) : "",
        originalDump: sourceCaptureRef ? sourceTextForCaptureId(store, sourceCaptureRef.id) : ""
      };
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 50);

  const contextState = store.contexts
    .map((context) => {
      const sourceCaptureRef = context.sourceRefs.find((ref) => ref.type === "capture");
      return {
        subject: context.subject,
        state: context.state,
        current: context.currentState,
        confidence: context.confidence,
        effectiveFrom: context.effectiveFrom ?? "",
        source: sourceCaptureRef ? compactId(sourceCaptureRef.id) : "",
        originalDump: sourceCaptureRef ? sourceTextForCaptureId(store, sourceCaptureRef.id) : "",
        updated: context.updatedAt
      };
    })
    .slice(0, 50);

  const qualityQueue = store.memoryObjects
    .map((memory) => {
      const interpretation = interpretationsByMemory.get(memory.id);
      const sourceCaptureRef = memory.sourceRefs.find((ref) => ref.type === "capture");
      return {
        title: memory.title,
        status: memory.status,
        state: memory.currentState,
        confidence: memory.confidence,
        intent: interpretation?.intent ?? "",
        band: interpretation?.confidenceBand ?? "",
        reason: interpretation?.reasoningSummary ?? "",
        source: sourceCaptureRef ? compactId(sourceCaptureRef.id) : "",
        originalDump: sourceCaptureRef ? sourceTextForCaptureId(store, sourceCaptureRef.id) : "",
        updated: memory.updatedAt
      };
    })
    .sort((a, b) => Number(a.confidence) - Number(b.confidence))
    .slice(0, 50);

  const aiWorkTrace = store.captures
    .map((capture) => {
      const sourceRefMatches = (refs: Array<{ type: string; id: string }>) => refs.some((ref) => ref.type === "capture" && ref.id === capture.id);
      const memory = store.memoryObjects.find((item) => sourceRefMatches(item.sourceRefs));
      const interpretation = memory ? interpretationsByMemory.get(memory.id) : undefined;
      const fact = store.facts.find((item) => sourceRefMatches(item.sourceRefs));
      const context = store.contexts.find((item) => sourceRefMatches(item.sourceRefs));
      const telemetry = store.aiTelemetry.find((event) => event.captureId === capture.id);
      const relationship = store.relationships.find((item) => item.fromId === capture.id || item.toId === capture.id);
      return {
        time: capture.createdAt,
        source: capture.sourceType,
        originalDump: capture.rawText ?? capture.transcript ?? String(capture.metadata.description ?? ""),
        rawTranscript: captureDebugText(capture, "rawTranscript"),
        cleanedTranscript: captureDebugText(capture, "cleanedTranscript") || capture.transcript || "",
        intent: interpretation?.intent ?? "",
        model: interpretation?.model ?? telemetry?.model ?? "",
        confidence: memory?.confidence ?? telemetry?.confidence ?? "",
        decision: memory?.status ?? "",
        memoryState: memory?.currentState ?? "",
        reasoning: interpretation?.reasoningSummary ?? "",
        structuredOutput: interpretation ? jsonCell(interpretation.structuredOutput) : "",
        fact: fact ? `${fact.payload.direction} ${fact.payload.money?.currency ?? ""}${fact.payload.money?.amount ?? ""} ${fact.payload.merchant ?? ""}` : "",
        context: context ? `${context.subject}: ${context.state}` : "",
        relationship: relationship ? `${relationship.relationshipType}: ${relationship.reason}` : "",
        costUsd: telemetry?.estimatedCostUsd ?? 0,
        tokens: telemetry?.totalTokens ?? 0,
        durationMs: telemetry?.durationMs ?? ""
      };
    })
    .slice(0, 50);

  const migrationInspection = options.migrationInspection;
  const launchSchemaCheck = options.launchReadinessChecks?.find((check) => check.id === "supabase_schema_security");
  const requiredMigrationMatches = Array.from(new Set((launchSchemaCheck?.detail.match(/\b\d{3}_[a-z0-9_]+\b/g) ?? [])));
  const schemaMigrationProof: RawTableRow[] = [
    ...(launchSchemaCheck
      ? [
          {
            view: "live_schema_check",
            status: launchSchemaCheck.status,
            source: "launch_readiness",
            requiredMigrations: requiredMigrationMatches.join(", "),
            recommendedAction: launchSchemaCheck.detail
          }
        ]
      : []),
    ...(migrationInspection
      ? [
          ...(migrationInspection.applied.accessible
            ? migrationInspection.applied.rows.map((row) => ({
                view: "applied_migration",
                version: row.version,
                file: row.file,
                requiredFor: row.requiredFor,
                checksum: row.shortChecksum,
                status: row.applied ? "ok" : "missing",
                source: "supabase_migrations.schema_migrations",
                requiredMigrations: row.applied ? "" : row.file,
                recommendedAction: row.applied
                  ? `${row.version} applied as ${row.remoteName || row.expectedName}; local checksum ${row.shortChecksum}.`
                  : `${row.version} expected ${row.expectedName} but live project has ${row.remoteName || "nothing"}.`
              }))
            : [
                {
                  view: "applied_migration",
                  status: "needs_attention",
                  source: "supabase_migrations.schema_migrations",
                  requiredMigrations: migrationInspection.applied.missingVersions.join(", "),
                  recommendedAction: migrationInspection.applied.issue || "Could not read live applied migration history."
                }
              ]),
          ...(migrationInspection.applied.unexpectedRemoteVersions.length > 0
            ? [
                {
                  view: "applied_migration",
                  status: "needs_attention",
                  source: "supabase_migrations.schema_migrations",
                  requiredMigrations: "",
                  recommendedAction: `Live project has unexpected migration versions: ${migrationInspection.applied.unexpectedRemoteVersions.join(", ")}`
                }
              ]
            : []),
          ...(migrationInspection.validation.valid
            ? [
                {
                  view: "schema_migration_proof",
                  status: "ok",
                  source: "validation",
                  requiredMigrations: "",
                  recommendedAction: "Current import plan validates cleanly."
                }
              ]
            : migrationInspection.validation.issues.map((issue) => ({
                view: "schema_migration_proof",
                status: "needs_attention",
                source: "validation",
                requiredMigrations: "",
                recommendedAction: JSON.stringify(issue)
              }))),
          ...Object.entries(migrationInspection.dryRun.tables ?? {}).map(([table, count]) => ({
            view: "dry_run_table",
            status: "planned",
            source: "dry_run",
            requiredMigrations: "",
            recommendedAction: `${table}: ${String(count)} row(s) in normalized import plan`
          }))
        ]
      : [])
  ];

  const captureDebug = store.captures
    .map((capture) => {
      const sourceRefMatches = (refs: Array<{ type: string; id: string }>) => refs.some((ref) => ref.type === "capture" && ref.id === capture.id);
      const memory = store.memoryObjects.find((item) => sourceRefMatches(item.sourceRefs));
      const interpretation = memory ? interpretationsByMemory.get(memory.id) : undefined;
      const telemetry = store.aiTelemetry.find((event) => event.captureId === capture.id && event.phase === "capture_interpretation");
      return {
        time: capture.createdAt,
        source: capture.sourceType,
        capture: compactId(capture.id),
        rawInput: capture.rawText ?? "",
        rawTranscript: captureDebugText(capture, "rawTranscript"),
        cleanedTranscript: captureDebugText(capture, "cleanedTranscript") || capture.transcript || "",
        finalWorkingText: capture.rawText ?? capture.transcript ?? String(capture.metadata.description ?? ""),
        intent: interpretation?.intent ?? "",
        reasoning: interpretation?.reasoningSummary ?? "",
        confidence: memory?.confidence ?? telemetry?.confidence ?? "",
        band: interpretation?.confidenceBand ?? "",
        decision: memory?.status ?? metadataText(telemetry ?? { metadata: {} } as AiTelemetryEvent, "decision"),
        model: interpretation?.model ?? telemetry?.model ?? "",
        structuredOutput: interpretation ? jsonCell(interpretation.structuredOutput) : "",
        captureMetadata: jsonCell(capture.metadata)
      };
    })
    .slice(0, 50);

  const householdSetup: RawTableRow[] = [];
  const binding = options.defaultHouseholdBinding;
  if (binding) {
    householdSetup.push({
      view: "default_household_binding",
      householdId: binding.householdId || "",
      configured: binding.configured ? "yes" : "no",
      exists: binding.exists ? "yes" : "no",
      members: binding.memberCount,
      owners: binding.ownerCount,
      status: binding.issue ? "needs_attention" : binding.exists ? "ready" : "pending",
      email: "",
      role: "",
      inviteStatus: "",
      expiresAt: "",
      acceptedAt: "",
      issue: binding.issue || ""
    });
  }

  const onboarding = options.onboardingHealth;
  if (onboarding) {
    householdSetup.push({
      view: "invite_summary",
      householdId: binding?.householdId || "",
      configured: onboarding.configured ? "yes" : "no",
      exists: "",
      members: onboarding.totalInvites,
      owners: onboarding.emailLockedInvites,
      status: onboarding.issue ? "needs_attention" : "ready",
      email: "",
      role: "",
      inviteStatus: `${onboarding.pendingInvites} pending / ${onboarding.acceptedInvites} accepted / ${onboarding.expiredInvites} expired`,
      expiresAt: "",
      acceptedAt: "",
      issue: onboarding.issue || ""
    });

    for (const invite of onboarding.recentInvites) {
      householdSetup.push({
        view: "recent_invite",
        householdId: invite.householdId,
        configured: onboarding.configured ? "yes" : "no",
        exists: "",
        members: "",
        owners: "",
        status: invite.status,
        email: invite.email || "no email",
        role: invite.role,
        inviteStatus: invite.status,
        expiresAt: invite.expiresAt,
        acceptedAt: invite.acceptedAt,
        issue: ""
      });
    }
  }

  const householdRoster = (options.householdRoster ?? []).slice(0, 50);
  const launchReadiness = options.launchReadiness ?? {
    configReadyForPrivateBeta: false,
    liveSmokeVerified: process.env.SAYVE_DEPLOYMENT_SMOKE_VERIFIED === "1",
    readyForPublicLaunch: false
  };
  const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || "";
  const supabaseMigration: RawTableRow[] = migrationInspection
    ? Object.entries(migrationInspection.validation.tableCounts)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([table, rowsInPlan]) => {
          const dryRunTable = migrationInspection.dryRun.tables[table];
          const issues = migrationInspection.validation.issues.filter((issue) => issue.table === table);
          return {
            table,
            rowsInPlan,
            valid: migrationInspection.validation.valid ? "yes" : "no",
            rowsToInsert: dryRunTable?.rowsToInsert ?? 0,
            existingRows: dryRunTable?.existingRows ?? 0,
            configured: migrationInspection.dryRun.configured ? "yes" : "no",
            dryRunValid: migrationInspection.dryRun.valid ? "yes" : "no",
            sampleInsertIds: (dryRunTable?.sampleInsertExternalIds ?? []).join(", "),
            sampleExistingIds: (dryRunTable?.sampleExistingExternalIds ?? []).join(", "),
            issueCount: issues.length,
            appliedMigrationsAccessible: migrationInspection.applied.accessible ? "yes" : "no",
            missingMigrationVersions: migrationInspection.applied.missingVersions.join(", "),
            issues: issues.slice(0, 3).map((issue) => issue.message).join(" | ")
          };
        })
    : [];
  const liveRollout = options.liveRollout ?? [];
  const launchCompletionAudit: RawTableRow[] = [
    {
      view: "launch_completion_audit",
      line: 1,
      requirement: "production_storage_boundary",
      status: "locally_proven",
      evidence: "src/server/memory/store.ts + repository/auth-boundary tests",
      liveProof: "Run real auth mode against deployed Supabase/Vercel runtime.",
      nextAction: launchReadiness.liveSmokeVerified ? "Monitor ongoing live usage." : "Prove on deployed runtime with verify:deploy + real auth/session flow."
    },
    {
      view: "launch_completion_audit",
      line: 2,
      requirement: "supabase_migration_path",
      status: "locally_proven",
      evidence: "supabase-schema-check + launch readiness + import validate/dry-run + deploy verifier",
      liveProof: "Apply migrations 001-012 to the real Supabase project and pass /api/admin/import/supabase/schema-check.",
      nextAction: "Run the live schema/security endpoint against the real project after deployment."
    },
    {
      view: "launch_completion_audit",
      line: 3,
      requirement: "ai_telemetry_admin_monitoring",
      status: "locally_proven",
      evidence: "Founder Console telemetry views, completeness gates, import/export validation, telemetry tests",
      liveProof: "Observe real deployed OpenAI token/cost/latency data in /admin.",
      nextAction: process.env.OPENAI_API_KEY?.trim() ? "Create a real capture and ask flow on deployed infra, then confirm telemetry appears." : "Configure OPENAI_API_KEY plus pinned model/pricing env before public launch proof."
    },
    {
      view: "launch_completion_audit",
      line: 4,
      requirement: "core_api_stability",
      status: "locally_proven",
      evidence: "API contract tests + deploy verifier coverage for capture/dashboard/timeline/detail/sources/insights/privacy/onboarding",
      liveProof: "Run verify:deploy against the real URL and confirm all smoke checks pass.",
      nextAction: launchReadiness.liveSmokeVerified ? "Keep using the same verifier for regression proof." : "Run pnpm run verify:deploy:private-beta on the real deployment."
    },
    {
      view: "launch_completion_audit",
      line: 5,
      requirement: "test_and_deploy_preparation",
      status: launchReadiness.configReadyForPrivateBeta ? (launchReadiness.liveSmokeVerified ? "nearly_complete" : "config_ready_live_proof_pending") : "config_incomplete",
      evidence: "package scripts + vercel config + CI + setup artifacts + env templates + founder handoff bundles",
      liveProof: "Deploy latest build, collect owner/member/viewer/bootstrap tokens, then rerun deploy smoke.",
      nextAction: launchReadiness.configReadyForPrivateBeta ? (launchReadiness.liveSmokeVerified ? "Mark smoke proof envs after public-launch smoke passes." : "Collect live tokens and finish deployment smoke.") : "Resolve Launch Readiness failures before claiming private beta readiness."
    },
    {
      view: "launch_completion_audit",
      line: 6,
      requirement: "overall_readout",
      status: launchReadiness.readyForPublicLaunch ? "public_launch_proven" : launchReadiness.liveSmokeVerified ? "private_beta_proven_public_pending" : "live_proof_pending",
      evidence: "docs/launch-completion-audit.md + Founder Console rollout views",
      liveProof: "Founder + partner + viewer + fresh-no-household onboarding must all complete on live infra.",
      nextAction: launchReadiness.readyForPublicLaunch ? "Maintain proof with every deploy." : "Finish real infra hookup and rerun smoke before claiming launch-ready."
    }
  ];
  const publicLaunchChecks: RawTableRow[] = (options.launchReadinessChecks ?? [])
    .filter((check) => check.status !== "pass")
    .map((check, index) => ({
      view: "public_launch_checks",
      line: index + 1,
      id: check.id,
      label: check.label,
      status: check.status,
      detail: check.detail
    }));
  const migrationInventory: RawTableRow[] = getSupabaseMigrationInventory().map((row) => ({
    view: "migration_inventory",
    line: row.line,
    version: row.version,
    file: row.file,
    requiredFor: row.requiredFor,
    checksum: row.shortChecksum,
    purpose: row.purpose
  }));
  const privateBetaSetupGate: RawTableRow[] = [
    {
      view: "private_beta_setup_gate",
      step: 1,
      item: "Supabase project env",
      status:
        process.env.MEMORY_REPOSITORY === "supabase" &&
        process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() &&
        process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
          ? "ready"
          : "open",
      owner: "founder",
      source: "Env Setup Matrix",
      detail:
        process.env.MEMORY_REPOSITORY === "supabase" &&
        process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() &&
        process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
          ? "Supabase browser/server env is configured."
          : "Set repository=supabase plus browser/server Supabase env before real rollout."
    },
    {
      view: "private_beta_setup_gate",
      step: 2,
      item: "Google OAuth redirect targets",
      status: appBaseUrl ? "ready" : "open",
      owner: "founder",
      source: "Auth Setup Targets",
      detail: appBaseUrl
        ? `Use ${appBaseUrl} and ${appBaseUrl}/invite in Supabase Auth + Google OAuth allow-list.`
        : "Set NEXT_PUBLIC_APP_URL first, then copy root + /invite redirect targets."
    },
    {
      view: "private_beta_setup_gate",
      step: 3,
      item: "Founder household binding",
      status: binding?.exists ? "ready" : "open",
      owner: "founder",
      source: "Default Household Binding",
      detail: binding?.exists
        ? `Bound to ${binding.householdId} with ${binding.memberCount} member(s) and ${binding.ownerCount} owner(s).`
        : binding?.issue || "Create founder household and bind SUPABASE_DEFAULT_HOUSEHOLD_ID."
    },
    {
      view: "private_beta_setup_gate",
      step: 4,
      item: "Owner role confirmed",
      status: (binding?.ownerCount ?? 0) > 0 ? "ready" : "open",
      owner: "founder",
      source: "Default Household Binding",
      detail: (binding?.ownerCount ?? 0) > 0 ? "At least one owner is attached." : "Attach founder as owner before invites and shared usage."
    },
    {
      view: "private_beta_setup_gate",
      step: 5,
      item: "Partner joined household",
      status: (binding?.memberCount ?? 0) >= 2 ? "ready" : onboarding?.pendingInvites ? "pending" : "open",
      owner: "partner",
      source: "Onboarding Health / Household Roster View",
      detail:
        (binding?.memberCount ?? 0) >= 2
          ? "Second household member is already present."
          : onboarding?.pendingInvites
            ? `${onboarding.pendingInvites} pending invite(s) exist; finish partner login + accept invite.`
            : "Create partner invite and complete second-member onboarding."
    },
    {
      view: "private_beta_setup_gate",
      step: 6,
      item: "Smoke tokens collected",
      status:
        process.env.SAYVE_TEST_SUPABASE_ACCESS_TOKEN?.trim() &&
        process.env.SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN?.trim() &&
        (process.env.SAYVE_TEST_HOUSEHOLD_ID?.trim() || binding?.householdId)
          ? "ready"
          : "open",
      owner: "founder",
      source: "Smoke Token Guide",
      detail:
        process.env.SAYVE_TEST_SUPABASE_ACCESS_TOKEN?.trim() &&
        process.env.SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN?.trim() &&
        (process.env.SAYVE_TEST_HOUSEHOLD_ID?.trim() || binding?.householdId)
          ? "Owner token, partner token, and household id are available for live smoke."
          : "Collect owner + partner session tokens and the household id from browser localStorage."
    },
    {
      view: "private_beta_setup_gate",
      step: 7,
      item: "Private beta launch readiness",
      status: launchReadiness.configReadyForPrivateBeta ? "ready" : "blocked",
      owner: "system",
      source: "Launch Readiness",
      detail: launchReadiness.configReadyForPrivateBeta
        ? "Current config passes the private beta gate."
        : "Resolve Launch Readiness failures before treating rollout as a real private beta."
    },
    {
      view: "private_beta_setup_gate",
      step: 8,
      item: "Live deployment smoke",
      status: launchReadiness.liveSmokeVerified ? "ready" : "open",
      owner: "founder",
      source: "Deploy Smoke Guide",
      detail: launchReadiness.liveSmokeVerified
        ? "verify:deploy:private-beta has already been proven on the deployed app."
        : "Run pnpm run verify:deploy:private-beta against the real deployment."
    }
  ];
  const integrationReadiness: RawTableRow[] = [
    {
      view: "integration_readiness",
      system: "supabase",
      stage: "private_beta",
      status:
        process.env.MEMORY_REPOSITORY === "supabase" &&
        process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() &&
        process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
          ? "ready"
          : "open",
      required: "repository + browser/server keys",
      source: "Env Setup Matrix",
      detail:
        process.env.MEMORY_REPOSITORY === "supabase" &&
        process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() &&
        process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
          ? "Supabase project env is configured for Sayve runtime and admin checks."
          : "Set MEMORY_REPOSITORY=supabase plus NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY."
    },
    {
      view: "integration_readiness",
      system: "google_oauth",
      stage: "private_beta",
      status: appBaseUrl ? "ready" : "open",
      required: "site url + root/invite redirects",
      source: "Auth Setup Targets / Google OAuth Checklist",
      detail: appBaseUrl
        ? `Use ${appBaseUrl} and ${appBaseUrl}/invite as the OAuth allow-list targets.`
        : "Set NEXT_PUBLIC_APP_URL so Supabase Auth and Google OAuth have stable redirect targets."
    },
    {
      view: "integration_readiness",
      system: "vercel",
      stage: "private_beta",
      status:
        process.env.SAYVE_DEPLOY_URL?.trim() &&
        process.env.APP_ACCESS_TOKEN?.trim() &&
        process.env.ADMIN_CONSOLE_TOKEN?.trim()
          ? "ready"
          : "open",
      required: "deploy url + gate/admin tokens",
      source: "Deploy Smoke Guide",
      detail:
        process.env.SAYVE_DEPLOY_URL?.trim() &&
        process.env.APP_ACCESS_TOKEN?.trim() &&
        process.env.ADMIN_CONSOLE_TOKEN?.trim()
          ? "Deployment URL and deploy-time gate tokens are configured."
          : "Set SAYVE_DEPLOY_URL, APP_ACCESS_TOKEN, and ADMIN_CONSOLE_TOKEN before live smoke."
    },
    {
      view: "integration_readiness",
      system: "household_onboarding",
      stage: "private_beta",
      status: (binding?.memberCount ?? 0) >= 2 ? "ready" : onboarding?.pendingInvites ? "pending" : "open",
      required: "founder owner + partner member",
      source: "Default Household Binding / Onboarding Health",
      detail:
        (binding?.memberCount ?? 0) >= 2
          ? "Founder and partner are already in the same household."
          : onboarding?.pendingInvites
            ? `${onboarding.pendingInvites} pending invite(s) exist; complete partner join.`
            : "Create partner invite and accept it from a separate Google account."
    },
    {
      view: "integration_readiness",
      system: "smoke_tokens",
      stage: "private_beta",
      status:
        process.env.SAYVE_TEST_SUPABASE_ACCESS_TOKEN?.trim() &&
        process.env.SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN?.trim() &&
        (process.env.SAYVE_TEST_HOUSEHOLD_ID?.trim() || binding?.householdId)
          ? "ready"
          : "open",
      required: "owner token + partner token + household id",
      source: "Smoke Token Guide",
      detail:
        process.env.SAYVE_TEST_SUPABASE_ACCESS_TOKEN?.trim() &&
        process.env.SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN?.trim() &&
        (process.env.SAYVE_TEST_HOUSEHOLD_ID?.trim() || binding?.householdId)
          ? "Owner/partner tokens and household id are ready for live deployment smoke."
          : "Collect owner token, partner token, and household id from browser localStorage."
    },
    {
      view: "integration_readiness",
      system: "openai",
      stage: "public_launch",
      status: process.env.OPENAI_API_KEY?.trim() ? "ready" : "open",
      required: "api key + pinned models + pricing env",
      source: "Env Setup Matrix / Launch Readiness",
      detail: process.env.OPENAI_API_KEY?.trim()
        ? "OpenAI key is present; pinned models and pricing env should still be completed before public launch."
        : "Keep heuristic fallback for private beta, but set OPENAI_API_KEY plus model/pricing env before public launch."
    }
  ];
  const integrationPackage: RawTableRow[] = [
    {
      view: "integration_package",
      system: "supabase",
      field: "project_url",
      stage: "private_beta",
      status: process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ? "ready" : "open",
      value: process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "<supabase-project-url>",
      target: "Supabase project / browser env",
      detail: "Map to NEXT_PUBLIC_SUPABASE_URL."
    },
    {
      view: "integration_package",
      system: "supabase",
      field: "anon_key",
      stage: "private_beta",
      status: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ? "ready" : "open",
      value: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ? "configured" : "<supabase-anon-key>",
      target: "Vercel env",
      detail: "Map to NEXT_PUBLIC_SUPABASE_ANON_KEY."
    },
    {
      view: "integration_package",
      system: "supabase",
      field: "service_role_key",
      stage: "private_beta",
      status: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ? "ready" : "open",
      value: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ? "configured" : "<supabase-service-role-key>",
      target: "Vercel env / server runtime",
      detail: "Map to SUPABASE_SERVICE_ROLE_KEY."
    },
    {
      view: "integration_package",
      system: "google_oauth",
      field: "site_url",
      stage: "private_beta",
      status: appBaseUrl ? "ready" : "open",
      value: appBaseUrl || "https://your-domain.com",
      target: "Supabase Auth Site URL",
      detail: "Use NEXT_PUBLIC_APP_URL."
    },
    {
      view: "integration_package",
      system: "google_oauth",
      field: "redirect_root",
      stage: "private_beta",
      status: appBaseUrl ? "ready" : "open",
      value: appBaseUrl || "https://your-domain.com",
      target: "Supabase Auth / Google redirect allow-list",
      detail: "Add root Sayve URL."
    },
    {
      view: "integration_package",
      system: "google_oauth",
      field: "redirect_invite",
      stage: "private_beta",
      status: appBaseUrl ? "ready" : "open",
      value: appBaseUrl ? `${appBaseUrl}/invite` : "https://your-domain.com/invite",
      target: "Supabase Auth / Google redirect allow-list",
      detail: "Add /invite for partner onboarding."
    },
    {
      view: "integration_package",
      system: "vercel",
      field: "deploy_url",
      stage: "private_beta",
      status: process.env.SAYVE_DEPLOY_URL?.trim() ? "ready" : "open",
      value: process.env.SAYVE_DEPLOY_URL?.trim() || "https://your-domain.com",
      target: "Deployment smoke / handoff",
      detail: "Map to SAYVE_DEPLOY_URL."
    },
    {
      view: "integration_package",
      system: "vercel",
      field: "app_access_token",
      stage: "private_beta",
      status: process.env.APP_ACCESS_TOKEN?.trim() ? "ready" : "open",
      value: process.env.APP_ACCESS_TOKEN?.trim() ? "configured" : "<private-beta-access-token>",
      target: "Vercel env",
      detail: "Private beta gate token."
    },
    {
      view: "integration_package",
      system: "vercel",
      field: "admin_console_token",
      stage: "private_beta",
      status: process.env.ADMIN_CONSOLE_TOKEN?.trim() ? "ready" : "open",
      value: process.env.ADMIN_CONSOLE_TOKEN?.trim() ? "configured" : "<admin-console-token>",
      target: "Vercel env",
      detail: "Founder/admin console protection."
    },
    {
      view: "integration_package",
      system: "openai",
      field: "api_key",
      stage: "public_launch",
      status: process.env.OPENAI_API_KEY?.trim() ? "ready" : "open",
      value: process.env.OPENAI_API_KEY?.trim() ? "configured" : "<openai-api-key>",
      target: "Vercel env",
      detail: "Required before public launch."
    },
    {
      view: "integration_package",
      system: "openai",
      field: "capture_model",
      stage: "public_launch",
      status: process.env.OPENAI_CAPTURE_MODEL?.trim() ? "ready" : "open",
      value: process.env.OPENAI_CAPTURE_MODEL?.trim() || "gpt-5.4-mini",
      target: "Vercel env",
      detail: "Pinned capture interpretation model."
    },
    {
      view: "integration_package",
      system: "openai",
      field: "capture_output_budget",
      stage: "public_launch",
      status: process.env.OPENAI_CAPTURE_MAX_OUTPUT_TOKENS?.trim() ? "ready" : "open",
      value: process.env.OPENAI_CAPTURE_MAX_OUTPUT_TOKENS?.trim() || "220",
      target: "Vercel env",
      detail: "Max output tokens for capture interpretation."
    },
    {
      view: "integration_package",
      system: "openai",
      field: "conversation_model",
      stage: "public_launch",
      status: process.env.OPENAI_CONVERSATION_MODEL?.trim() ? "ready" : "open",
      value: process.env.OPENAI_CONVERSATION_MODEL?.trim() || "gpt-5.4-mini",
      target: "Vercel env",
      detail: "Pinned concise conversation model."
    },
    {
      view: "integration_package",
      system: "openai",
      field: "conversation_output_budget",
      stage: "public_launch",
      status: process.env.OPENAI_CONVERSATION_MAX_OUTPUT_TOKENS?.trim() ? "ready" : "open",
      value: process.env.OPENAI_CONVERSATION_MAX_OUTPUT_TOKENS?.trim() || "120",
      target: "Vercel env",
      detail: "Max output tokens for short Sayve answers."
    }
  ];
  const launchBlockers: RawTableRow[] = [];
  const schemaSecurityCheck = (options.launchReadinessChecks ?? []).find((check) => check.id === "supabase_schema_security");
  const budgetDisciplineCheck = (options.launchReadinessChecks ?? []).find((check) => check.id === "ai_budget_discipline");
  const aiRuntimeHealth = options.aiRuntimeHealth;
  if (binding && !binding.exists) {
    launchBlockers.push({
      level: "critical",
      area: "founder_household",
      status: "open",
      blocker: "Founder household is not bound",
      detail: binding.issue || "SUPABASE_DEFAULT_HOUSEHOLD_ID is not bound to a real household.",
      action: "Create or bind the founder household and verify SUPABASE_DEFAULT_HOUSEHOLD_ID."
    });
  }
  if (binding && binding.exists && binding.ownerCount === 0) {
    launchBlockers.push({
      level: "critical",
      area: "ownership",
      status: "open",
      blocker: "Founder household has no owner",
      detail: "The bound household exists but no owner member is attached.",
      action: "Attach at least one owner to the founder household."
    });
  }
  if (binding && binding.exists && binding.memberCount < 2) {
    launchBlockers.push({
      level: onboarding?.pendingInvites ? "warn" : "critical",
      area: "second_member",
      status: onboarding?.pendingInvites ? "pending" : "open",
      blocker: onboarding?.pendingInvites ? "Second member invite is still pending" : "Second member is missing",
      detail:
        onboarding?.pendingInvites
          ? `${onboarding.pendingInvites} pending invite(s) exist, but the second household member has not joined yet.`
          : "Shared household beta is not validated until a second member joins the same household.",
      action: onboarding?.pendingInvites
        ? "Finish partner onboarding and confirm shared dashboard access."
        : "Create a partner invite and complete second-member onboarding."
    });
  }
  if (onboarding?.issue) {
    launchBlockers.push({
      level: "warn",
      area: "onboarding_health",
      status: "open",
      blocker: "Invite health has an issue",
      detail: onboarding.issue,
      action: "Fix invite querying/health visibility before rollout."
    });
  }
  if (schemaSecurityCheck && schemaSecurityCheck.status !== "pass") {
    launchBlockers.push({
      level: schemaSecurityCheck.status === "fail" ? "critical" : "warn",
      area: "supabase_schema_security",
      status: "open",
      blocker: "Supabase schema/security proof is incomplete",
      detail: schemaSecurityCheck.detail,
      action: "Apply the listed migrations / RPC fixes, then rerun the live schema check."
    });
  }
  if (budgetDisciplineCheck && budgetDisciplineCheck.status !== "pass") {
    launchBlockers.push({
      level: budgetDisciplineCheck.status === "fail" ? "critical" : "warn",
      area: "ai_budget_discipline",
      status: "open",
      blocker: "AI output-budget discipline is not proven yet",
      detail: budgetDisciplineCheck.detail,
      action: "Run live capture/conversation smoke and confirm output-budget coverage is 100% with zero overruns."
    });
  }
  if (process.env.OPENAI_API_KEY?.trim() && aiRuntimeHealth) {
    if (aiRuntimeHealth.openAiEvents === 0) {
      launchBlockers.push({
        level: "critical",
        area: "openai_live_telemetry",
        status: "open",
        blocker: "OpenAI has no live founder-visible telemetry yet",
        detail: "Founder Console still shows zero OpenAI events, so deployed provider health is not proven.",
        action: "Run live capture + conversation smoke and confirm OpenAI events appear in AI Runtime Health."
      });
    } else if (aiRuntimeHealth.openAiSuccessRate <= 0 || aiRuntimeHealth.openAiErrorEvents > 0) {
      launchBlockers.push({
        level: "warn",
        area: "openai_live_telemetry",
        status: "open",
        blocker: "OpenAI runtime health is not clean yet",
        detail: `OpenAI events=${aiRuntimeHealth.openAiEvents}, success=${aiRuntimeHealth.openAiSuccessRate}%, fallback=${aiRuntimeHealth.openAiFallbackRate}%, errors=${aiRuntimeHealth.openAiErrorEvents}.`,
        action: "Re-run live capture/conversation smoke until Founder Console shows healthy OpenAI success with no runtime errors."
      });
    }
  }
  if (!launchReadiness.configReadyForPrivateBeta) {
    launchBlockers.push({
      level: "critical",
      area: "private_beta_gate",
      status: "open",
      blocker: "Private beta gate is not ready",
      detail: "Launch Readiness still reports at least one fail-level blocker for private beta.",
      action: "Resolve the fail-level Launch Readiness checks first."
    });
  }
  if (!launchReadiness.liveSmokeVerified) {
    launchBlockers.push({
      level: "warn",
      area: "deploy_smoke",
      status: "open",
      blocker: "Live deployment smoke is not verified",
      detail: "No verified deploy-smoke proof has been recorded yet.",
      action: "Run pnpm run verify:deploy:private-beta against the real deployment."
    });
  }
  if (launchReadiness.liveSmokeVerified && !launchReadiness.readyForPublicLaunch) {
    launchBlockers.push({
      level: "warn",
      area: "public_launch_gate",
      status: "pending",
      blocker: "Public launch gate is not ready yet",
      detail: "Private beta smoke is proven, but public-launch requirements are still incomplete.",
      action: "Finish the remaining public-launch blockers, then rerun public-ready smoke."
    });
  }
  const liveProofGaps: RawTableRow[] = [
    {
      view: "live_proof_gaps",
      area: "supabase_live_schema",
      proofType: "external_live_proof",
      status: schemaSecurityCheck?.status === "pass" ? "proven" : "pending",
      detail:
        schemaSecurityCheck?.status === "pass"
          ? "Live Supabase schema/security endpoint has reported pass."
          : schemaSecurityCheck?.detail || "Real Supabase project migrations and schema checks still need live proof.",
      nextAction:
        schemaSecurityCheck?.status === "pass"
          ? "No action."
          : "Apply missing migrations to the live Supabase project and rerun the schema check."
    },
    {
      view: "live_proof_gaps",
      area: "deployed_smoke",
      proofType: "external_live_proof",
      status: launchReadiness.liveSmokeVerified ? "proven" : "pending",
      detail: launchReadiness.liveSmokeVerified
        ? "Deployed Sayve smoke proof has been recorded."
        : "No verified deploy-smoke proof has been recorded for the real app URL yet.",
      nextAction: launchReadiness.liveSmokeVerified ? "No action." : "Run pnpm run verify:deploy:private-beta against the deployed Sayve URL."
    },
    {
      view: "live_proof_gaps",
      area: "two_member_household",
      proofType: "real_user_proof",
      status: (binding?.memberCount ?? 0) >= 2 ? "proven" : onboarding?.pendingInvites ? "in_progress" : "pending",
      detail:
        (binding?.memberCount ?? 0) >= 2
          ? "Founder and partner are already attached to the same household."
          : onboarding?.pendingInvites
            ? `${onboarding.pendingInvites} partner invite(s) exist, but live join proof is still incomplete.`
            : "A real second household member has not been proven on live infra yet.",
      nextAction:
        (binding?.memberCount ?? 0) >= 2
          ? "No action."
          : onboarding?.pendingInvites
            ? "Complete partner login and invite acceptance, then verify both members write to the same household."
            : "Create a partner invite and complete second-member onboarding on the real deployment."
    },
    {
      view: "live_proof_gaps",
      area: "bootstrap_zero_household",
      proofType: "real_user_proof",
      status: process.env.SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN?.trim() ? "ready_to_test" : "pending",
      detail: process.env.SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN?.trim()
        ? "Fresh zero-household token is available, but real bootstrap proof still depends on live smoke."
        : "Fresh zero-household bootstrap proof has not been prepared yet.",
      nextAction: process.env.SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN?.trim()
        ? "Use the bootstrap token during verify:deploy and confirm first-run household creation on the real deployment."
        : "Collect a fresh zero-household browser session token for bootstrap smoke."
    },
    {
      view: "live_proof_gaps",
      area: "openai_live_telemetry",
      proofType: "external_live_proof",
      status:
        process.env.OPENAI_API_KEY?.trim() &&
        budgetDisciplineCheck?.status === "pass" &&
        launchReadiness.liveSmokeVerified &&
        (aiRuntimeHealth?.openAiEvents ?? 0) > 0 &&
        (aiRuntimeHealth?.openAiSuccessRate ?? 0) > 0 &&
        (aiRuntimeHealth?.openAiErrorEvents ?? 0) === 0
          ? "proven"
          : process.env.OPENAI_API_KEY?.trim()
            ? "pending"
            : "open",
      detail:
        process.env.OPENAI_API_KEY?.trim()
          ? budgetDisciplineCheck?.status === "pass" &&
            launchReadiness.liveSmokeVerified &&
            (aiRuntimeHealth?.openAiEvents ?? 0) > 0 &&
            (aiRuntimeHealth?.openAiSuccessRate ?? 0) > 0 &&
            (aiRuntimeHealth?.openAiErrorEvents ?? 0) === 0
            ? "Live OpenAI telemetry has enough event volume, success rate, and budget proof for founder monitoring."
            : aiRuntimeHealth
              ? `OpenAI events=${aiRuntimeHealth.openAiEvents}, success=${aiRuntimeHealth.openAiSuccessRate}%, fallback=${aiRuntimeHealth.openAiFallbackRate}%, errors=${aiRuntimeHealth.openAiErrorEvents}, telemetry=${aiRuntimeHealth.telemetryCompletenessPercent}%, budget=${aiRuntimeHealth.budgetCoveragePercent}%.`
              : budgetDisciplineCheck?.detail || "OpenAI is configured, but live capture/conversation telemetry proof is still incomplete."
          : "OpenAI key is not configured yet for real deployed telemetry.",
      nextAction:
        process.env.OPENAI_API_KEY?.trim()
          ? "Run live capture + conversation smoke and confirm provider=openai, positive OpenAI success rate, complete token/cost/latency, and zero runtime errors or budget overruns."
          : "Set OPENAI_API_KEY plus pinned model/pricing env before trying live OpenAI smoke."
    }
  ];
  const envSetup: RawTableRow[] = [
    {
      view: "env_setup",
      group: "core",
      env: "MEMORY_REPOSITORY",
      requiredFor: "private_beta",
      status: process.env.MEMORY_REPOSITORY === "supabase" ? "ready" : "open",
      value: process.env.MEMORY_REPOSITORY?.trim() || "",
      note: "Set to supabase before real household rollout."
    },
    {
      view: "env_setup",
      group: "core",
      env: "NEXT_PUBLIC_APP_URL",
      requiredFor: "private_beta",
      status: appBaseUrl ? "ready" : "open",
      value: appBaseUrl,
      note: "Stable app origin for browser auth and invite redirects."
    },
    {
      view: "env_setup",
      group: "supabase",
      env: "NEXT_PUBLIC_SUPABASE_URL",
      requiredFor: "private_beta",
      status: process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ? "ready" : "open",
      value: process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "",
      note: "Public browser auth project URL."
    },
    {
      view: "env_setup",
      group: "supabase",
      env: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      requiredFor: "private_beta",
      status: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ? "ready" : "open",
      value: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ? "configured" : "",
      note: "Browser auth anon key."
    },
    {
      view: "env_setup",
      group: "supabase",
      env: "SUPABASE_URL",
      requiredFor: "private_beta_optional",
      status: process.env.SUPABASE_URL?.trim() ? "ready" : "optional",
      value: process.env.SUPABASE_URL?.trim() || "",
      note: "Optional server override; if set, must match NEXT_PUBLIC_SUPABASE_URL host."
    },
    {
      view: "env_setup",
      group: "supabase",
      env: "SUPABASE_SERVICE_ROLE_KEY",
      requiredFor: "private_beta",
      status: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ? "ready" : "open",
      value: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ? "configured" : "",
      note: "Server-only storage/admin key."
    },
    {
      view: "env_setup",
      group: "supabase",
      env: "SUPABASE_DEFAULT_HOUSEHOLD_ID",
      requiredFor: "private_beta",
      status: process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID?.trim() ? "ready" : "open",
      value: process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID?.trim() || "",
      note: "Founder default household binding and smoke fallback."
    },
    {
      view: "env_setup",
      group: "auth",
      env: "SUPABASE_AUTH_REQUIRED",
      requiredFor: "private_beta",
      status: process.env.SUPABASE_AUTH_REQUIRED === "1" ? "ready" : "open",
      value: process.env.SUPABASE_AUTH_REQUIRED?.trim() || "0",
      note: "Must be 1 before real family login usage."
    },
    {
      view: "env_setup",
      group: "auth",
      env: "APP_ACCESS_TOKEN",
      requiredFor: "private_beta",
      status: process.env.APP_ACCESS_TOKEN?.trim() ? "ready" : "open",
      value: process.env.APP_ACCESS_TOKEN?.trim() ? "configured" : "",
      note: "Private beta access gate token."
    },
    {
      view: "env_setup",
      group: "auth",
      env: "ADMIN_CONSOLE_TOKEN",
      requiredFor: "private_beta",
      status: process.env.ADMIN_CONSOLE_TOKEN?.trim() ? "ready" : "open",
      value: process.env.ADMIN_CONSOLE_TOKEN?.trim() ? "configured" : "",
      note: "Founder/admin console protection."
    },
    {
      view: "env_setup",
      group: "ai",
      env: "OPENAI_API_KEY",
      requiredFor: "public_launch",
      status: process.env.OPENAI_API_KEY?.trim() ? "ready" : "open",
      value: process.env.OPENAI_API_KEY?.trim() ? "configured" : "",
      note: "Required before public launch."
    },
    {
      view: "env_setup",
      group: "media",
      env: "SUPABASE_MEDIA_BUCKET",
      requiredFor: "public_launch",
      status: process.env.SUPABASE_MEDIA_BUCKET?.trim() ? "ready" : "open",
      value: process.env.SUPABASE_MEDIA_BUCKET?.trim() || "",
      note: "Private receipt/voice source-file bucket."
    },
    {
      view: "env_setup",
      group: "media",
      env: "RECEIPT_UPLOAD_MAX_BYTES",
      requiredFor: "public_launch",
      status: process.env.RECEIPT_UPLOAD_MAX_BYTES?.trim() ? "ready" : "open",
      value: process.env.RECEIPT_UPLOAD_MAX_BYTES?.trim() || "",
      note: "Receipt source-file upload guardrail."
    },
    {
      view: "env_setup",
      group: "media",
      env: "VOICE_UPLOAD_MAX_BYTES",
      requiredFor: "public_launch",
      status: process.env.VOICE_UPLOAD_MAX_BYTES?.trim() ? "ready" : "open",
      value: process.env.VOICE_UPLOAD_MAX_BYTES?.trim() || "",
      note: "Voice source-file upload guardrail."
    },
    {
      view: "env_setup",
      group: "deploy",
      env: "SAYVE_DEPLOY_URL",
      requiredFor: "deploy_smoke",
      status: process.env.SAYVE_DEPLOY_URL?.trim() ? "ready" : "open",
      value: process.env.SAYVE_DEPLOY_URL?.trim() || "",
      note: "Target URL for deployment smoke."
    },
    {
      view: "env_setup",
      group: "deploy",
      env: "SAYVE_DEPLOYMENT_SMOKE_VERIFIED",
      requiredFor: "public_launch",
      status: process.env.SAYVE_DEPLOYMENT_SMOKE_VERIFIED === "1" ? "ready" : "open",
      value: process.env.SAYVE_DEPLOYMENT_SMOKE_VERIFIED?.trim() || "0",
      note: "Set only after live deploy smoke passes."
    }
  ];
  const authSetup: RawTableRow[] = [
    {
      view: "auth_setup",
      item: "app_base_url",
      status: appBaseUrl ? "ready" : "open",
      value: appBaseUrl,
      target: appBaseUrl,
      detail: appBaseUrl ? "Use this as the stable Sayve origin." : "Set NEXT_PUBLIC_APP_URL first."
    },
    {
      view: "auth_setup",
      item: "supabase_site_url",
      status: appBaseUrl ? "ready" : "open",
      value: appBaseUrl,
      target: appBaseUrl,
      detail: appBaseUrl ? "Set this as Supabase Auth Site URL." : "Missing until NEXT_PUBLIC_APP_URL is set."
    },
    {
      view: "auth_setup",
      item: "supabase_redirect_url_root",
      status: appBaseUrl ? "ready" : "open",
      value: appBaseUrl,
      target: appBaseUrl,
      detail: appBaseUrl ? "Add to Supabase Auth redirect allow list." : "Missing until NEXT_PUBLIC_APP_URL is set."
    },
    {
      view: "auth_setup",
      item: "supabase_redirect_url_invite",
      status: appBaseUrl ? "ready" : "open",
      value: appBaseUrl ? `${appBaseUrl}/invite` : "",
      target: appBaseUrl ? `${appBaseUrl}/invite` : "",
      detail: appBaseUrl ? "Add to Supabase Auth redirect allow list for partner invite acceptance." : "Missing until NEXT_PUBLIC_APP_URL is set."
    }
  ];
  const envTemplate = buildTemplateRows("env_template", setupArtifactSpec.privateBetaEnvTemplate as SetupTemplateSpecRow[]);
  const deployEnvTemplate = buildTemplateRows("deploy_env_template", setupArtifactSpec.deploymentEnvTemplate as SetupTemplateSpecRow[]);
  const oauthChecklist: RawTableRow[] = [
    {
      view: "oauth_checklist",
      step: 1,
      item: "Enable Google provider",
      target: "Supabase Auth -> Providers -> Google",
      detail: "Turn on Google and paste the Google client id / secret."
    },
    {
      view: "oauth_checklist",
      step: 2,
      item: "Set Supabase Site URL",
      target: appBaseUrl || "https://your-domain.com",
      detail: appBaseUrl ? "Use NEXT_PUBLIC_APP_URL as the Site URL." : "Set NEXT_PUBLIC_APP_URL first, then copy it here."
    },
    {
      view: "oauth_checklist",
      step: 3,
      item: "Add root redirect allow-list entry",
      target: appBaseUrl || "https://your-domain.com",
      detail: "Add the root Sayve URL to Supabase Auth redirect allow list."
    },
    {
      view: "oauth_checklist",
      step: 4,
      item: "Add invite redirect allow-list entry",
      target: appBaseUrl ? `${appBaseUrl}/invite` : "https://your-domain.com/invite",
      detail: "Add /invite so partner onboarding can finish after login."
    },
    {
      view: "oauth_checklist",
      step: 5,
      item: "Founder sanity check",
      target: appBaseUrl ? `${appBaseUrl}/invite?token=<invite-token>` : "https://your-domain.com/invite?token=<invite-token>",
      detail: "Confirm founder login works, then test invite acceptance with a separate partner account."
    }
  ];
  const smokeTokenGuide: RawTableRow[] = [
    {
      view: "smoke_token_guide",
      role: "owner",
      env: "SAYVE_TEST_SUPABASE_ACCESS_TOKEN",
      where: `${appBaseUrl || "https://your-domain"}?access_token=APP_ACCESS_TOKEN`,
      action: "Login as founder/owner, open browser localStorage, copy sayve_access_token.",
      extra: "Keep the same household selected, then copy sayve_household_id for SAYVE_TEST_HOUSEHOLD_ID."
    },
    {
      view: "smoke_token_guide",
      role: "partner",
      env: "SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN",
      where: `${appBaseUrl || "https://your-domain"}/invite?token=<invite-token>`,
      action: "Use a second browser profile or incognito, login as partner, accept invite, then copy sayve_access_token.",
      extra: "After acceptance, confirm dashboard shows the same shared household before using the token."
    },
    {
      view: "smoke_token_guide",
      role: "viewer",
      env: "SAYVE_TEST_VIEWER_SUPABASE_ACCESS_TOKEN",
      where: `${appBaseUrl || "https://your-domain"}/invite?token=<viewer-invite-token>`,
      action: "Create a viewer invite, login in a clean browser profile, accept invite, then copy sayve_access_token.",
      extra: "Viewer smoke expects reads to work and writes to fail."
    },
    {
      view: "smoke_token_guide",
      role: "fresh_unjoined",
      env: "SAYVE_TEST_INVITE_ACCEPT_SUPABASE_ACCESS_TOKEN",
      where: `${appBaseUrl || "https://your-domain"}/invite?token=<fresh-invite-token>`,
      action: "Login with an account that has not yet joined the target household, copy sayve_access_token before pressing join.",
      extra: "Use this only when you want deployment smoke to prove live invite acceptance."
    },
    {
      view: "smoke_token_guide",
      role: "fresh_no_household",
      env: "SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN",
      where: `${appBaseUrl || "https://your-domain"}?access_token=APP_ACCESS_TOKEN`,
      action: "Login with a fresh account that belongs to zero households, copy sayve_access_token before first-run initialization creates a household.",
      extra: "Use this to prove /api/households/bootstrap can create the first owner household on a real deployment."
    },
    {
      view: "smoke_token_guide",
      role: "storage_keys",
      env: "browser localStorage",
      where: "DevTools -> Application -> Local Storage",
      action: "Read sayve_access_token, sayve_user_id, sayve_user_email, and sayve_household_id from browser localStorage.",
      extra: "Use separate browser profiles so tokens do not overwrite each other."
    }
  ];
  const liveSmokeEvidence: RawTableRow[] = [
    {
      view: "live_smoke_evidence",
      item: "production_storage_boundary",
      status: launchReadiness.liveSmokeVerified ? "prove_on_live" : "pending",
      evidence: "verify:deploy + authenticated household capture/dashboard/timeline reads",
      source: "Launch Completion Audit / Deploy Smoke Guide",
      nextAction: launchReadiness.liveSmokeVerified
        ? "Keep one recent smoke record plus proof summary archived."
        : "Run live smoke on deployed Supabase + Vercel runtime."
    },
    {
      view: "live_smoke_evidence",
      item: "supabase_migration_path",
      status: (options.launchReadinessChecks ?? []).some((check) => check.id === "supabase_schema_security" && check.status === "pass") ? "prove_on_live" : "pending",
      evidence: "/api/admin/import/supabase/schema-check + applied migration proof rows",
      source: "Schema Migration Proof",
      nextAction: "Confirm live schema-check passes against the real Supabase project."
    },
    {
      view: "live_smoke_evidence",
      item: "partner_same_household",
      status: (binding?.memberCount ?? 0) >= 2 ? "ready" : onboarding?.pendingInvites ? "in_progress" : "pending",
      evidence: "founder + partner both appear in household roster and shared household writes succeed",
      source: "Onboarding Health / Household Roster",
      nextAction:
        (binding?.memberCount ?? 0) >= 2
          ? "Use owner/member smoke to prove both users can write to the same household."
          : onboarding?.pendingInvites
            ? "Complete partner invite acceptance."
            : "Create a partner invite on the live deployment."
    },
    {
      view: "live_smoke_evidence",
      item: "viewer_read_only",
      status: process.env.SAYVE_TEST_VIEWER_SUPABASE_ACCESS_TOKEN?.trim() ? "ready_to_test" : "pending",
      evidence: "viewer can read dashboard/timeline but cannot capture or create categories",
      source: "Smoke Token Guide / Deploy Smoke Guide",
      nextAction: process.env.SAYVE_TEST_VIEWER_SUPABASE_ACCESS_TOKEN?.trim()
        ? "Run strict private beta or public-launch smoke with viewer token."
        : "Collect viewer session token from a clean viewer account."
    },
    {
      view: "live_smoke_evidence",
      item: "invite_acceptance_fresh_account",
      status: process.env.SAYVE_TEST_INVITE_ACCEPT_SUPABASE_ACCESS_TOKEN?.trim() ? "ready_to_test" : "pending",
      evidence: "fresh unjoined account accepts invite and joins the intended household",
      source: "Smoke Token Guide / Onboarding Proof Status",
      nextAction: process.env.SAYVE_TEST_INVITE_ACCEPT_SUPABASE_ACCESS_TOKEN?.trim()
        ? "Turn on invite acceptance smoke and verify end-to-end join."
        : "Collect a fresh unjoined account token."
    },
    {
      view: "live_smoke_evidence",
      item: "bootstrap_zero_household",
      status: process.env.SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN?.trim() ? "ready_to_test" : "pending",
      evidence: "fresh zero-household account can create the first owner household on live infra",
      source: "Smoke Token Guide / Live Proof Gaps",
      nextAction: process.env.SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN?.trim()
        ? "Run strict private beta smoke and verify bootstrap proof."
        : "Collect a fresh zero-household token."
    },
    {
      view: "live_smoke_evidence",
      item: "openai_live_telemetry",
      status:
        process.env.OPENAI_API_KEY?.trim() &&
        launchReadiness.liveSmokeVerified &&
        (options.aiRuntimeHealth?.openAiEvents ?? 0) > 0
          ? "prove_on_live"
          : process.env.OPENAI_API_KEY?.trim()
            ? "pending"
            : "open",
      evidence: "Founder Console shows real token / cost / latency / success data from deployed traffic",
      source: "AI Runtime Health / Launch Completion Audit",
      nextAction: process.env.OPENAI_API_KEY?.trim()
        ? "Run live capture + conversation and confirm telemetry appears."
        : "Configure OPENAI_API_KEY plus pinned models before public launch proof."
    }
  ];
  const deploySmokeEnvTemplate: RawTableRow[] = [
    {
      view: "deploy_smoke_env_template",
      line: 1,
      env: "SAYVE_DEPLOY_URL",
      value: process.env.SAYVE_DEPLOY_URL?.trim() || "https://your-domain",
      requiredFor: "deploy_smoke",
      detail: "Live deployment URL. Public-ready smoke must use an HTTPS non-local URL."
    },
    {
      view: "deploy_smoke_env_template",
      line: 2,
      env: "APP_ACCESS_TOKEN",
      value: process.env.APP_ACCESS_TOKEN?.trim() ? "configured" : "<private-beta-access-token>",
      requiredFor: "deploy_smoke",
      detail: "Private beta access gate token used by deployment smoke."
    },
    {
      view: "deploy_smoke_env_template",
      line: 3,
      env: "ADMIN_CONSOLE_TOKEN",
      value: process.env.ADMIN_CONSOLE_TOKEN?.trim() ? "configured" : "<admin-console-token>",
      requiredFor: "deploy_smoke",
      detail: "Founder/admin token used by launch-readiness, schema, and repository smoke endpoints."
    },
    {
      view: "deploy_smoke_env_template",
      line: 4,
      env: "SAYVE_REQUIRE_AUTH_SMOKE",
      value: "1",
      requiredFor: "authenticated_smoke",
      detail: "Require authenticated household API smoke instead of only private-beta gate checks."
    },
    {
      view: "deploy_smoke_env_template",
      line: 5,
      env: "SAYVE_REQUIRE_TWO_MEMBER_SMOKE",
      value: "1",
      requiredFor: "public_launch",
      detail: "Require founder + partner writing into the same shared household."
    },
    {
      view: "deploy_smoke_env_template",
      line: 6,
      env: "SAYVE_REQUIRE_VIEWER_SMOKE",
      value: "1",
      requiredFor: "public_launch",
      detail: "Require viewer read-only proof for dashboard/timeline/category boundaries."
    },
    {
      view: "deploy_smoke_env_template",
      line: 7,
      env: "SAYVE_REQUIRE_INVITE_SMOKE",
      value: "1",
      requiredFor: "public_launch",
      detail: "Require product invite creation and partner invite preflight proof."
    },
    {
      view: "deploy_smoke_env_template",
      line: 8,
      env: "SAYVE_REQUIRE_INVITE_ACCEPT_SMOKE",
      value: process.env.SAYVE_TEST_INVITE_ACCEPT_SUPABASE_ACCESS_TOKEN?.trim() ? "1" : "0",
      requiredFor: "optional_strict_smoke",
      detail: "Turn on only when you want smoke to prove end-to-end invite acceptance with a fresh unjoined account."
    },
    {
      view: "deploy_smoke_env_template",
      line: 9,
      env: "SAYVE_REQUIRE_BOOTSTRAP_SMOKE",
      value: "1",
      requiredFor: "public_launch",
      detail: "Require first-run household bootstrap proof for a fresh zero-household account."
    },
    {
      view: "deploy_smoke_env_template",
      line: 10,
      env: "SAYVE_REQUIRE_OPENAI_SMOKE",
      value: "1",
      requiredFor: "public_launch",
      detail: "Require provider=openai and status=success for capture and conversation telemetry."
    },
    {
      view: "deploy_smoke_env_template",
      line: 11,
      env: "SAYVE_REQUIRE_PRIVACY_SMOKE",
      value: "1",
      requiredFor: "public_launch",
      detail: "Require live privacy redaction proof for memory detail, telemetry, and sourced Q/A."
    },
    {
      view: "deploy_smoke_env_template",
      line: 12,
      env: "SAYVE_TEST_SUPABASE_ACCESS_TOKEN",
      value: process.env.SAYVE_TEST_SUPABASE_ACCESS_TOKEN?.trim() ? "configured" : "<owner-session-token>",
      requiredFor: "authenticated_smoke",
      detail: "Owner session token collected from browser localStorage."
    },
    {
      view: "deploy_smoke_env_template",
      line: 13,
      env: "SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN",
      value: process.env.SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN?.trim() ? "configured" : "<member-session-token>",
      requiredFor: "public_launch",
      detail: "Partner/member session token for two-member shared-household smoke."
    },
    {
      view: "deploy_smoke_env_template",
      line: 14,
      env: "SAYVE_TEST_VIEWER_SUPABASE_ACCESS_TOKEN",
      value: process.env.SAYVE_TEST_VIEWER_SUPABASE_ACCESS_TOKEN?.trim() ? "configured" : "<viewer-session-token>",
      requiredFor: "public_launch",
      detail: "Viewer session token for read-only boundary verification."
    },
    {
      view: "deploy_smoke_env_template",
      line: 15,
      env: "SAYVE_TEST_INVITE_ACCEPT_SUPABASE_ACCESS_TOKEN",
      value: process.env.SAYVE_TEST_INVITE_ACCEPT_SUPABASE_ACCESS_TOKEN?.trim() ? "configured" : "<fresh-unjoined-session-token>",
      requiredFor: "optional_strict_smoke",
      detail: "Fresh unjoined account token used only when invite acceptance smoke is enabled."
    },
    {
      view: "deploy_smoke_env_template",
      line: 16,
      env: "SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN",
      value: process.env.SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN?.trim() ? "configured" : "<fresh-no-household-session-token>",
      requiredFor: "public_launch",
      detail: "Fresh zero-household account token used to prove first-run household bootstrap."
    },
    {
      view: "deploy_smoke_env_template",
      line: 17,
      env: "SAYVE_TEST_HOUSEHOLD_ID",
      value: process.env.SAYVE_TEST_HOUSEHOLD_ID?.trim() || process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID?.trim() || "<household-uuid>",
      requiredFor: "authenticated_smoke",
      detail: "Shared household id copied from browser localStorage after correct household selection."
    }
  ];
  const repositorySmokeGuide: RawTableRow[] = [
    {
      view: "repository_smoke_guide",
      step: 1,
      item: "Endpoint",
      target: "/api/admin/repository/smoke-test",
      detail: "Use the founder/admin endpoint after Supabase env is configured and migrations are applied."
    },
    {
      view: "repository_smoke_guide",
      step: 2,
      item: "Headers",
      target: "x-admin-token: ADMIN_CONSOLE_TOKEN",
      detail: "Repository smoke is founder-only and should not use product household auth headers."
    },
    {
      view: "repository_smoke_guide",
      step: 3,
      item: "Body",
      target: binding?.householdId ? `{ \"householdId\": \"${binding.householdId}\" }` : '{ "householdId": "<target-household-id>" }',
      detail: "Pass the real household you want to verify so rollout does not accidentally smoke only the fallback binding."
    },
    {
      view: "repository_smoke_guide",
      step: 4,
      item: "Expected fields",
      target: "ok, persistedSnapshot, householdExists, memberCount, ownerCount, viewerCount, onboarding.pendingInvites, onboarding.acceptedInvites",
      detail: "Success means the snapshot row exists and founder can also inspect member/viewer presence plus invite/onboarding drift."
    },
    {
      view: "repository_smoke_guide",
      step: 5,
      item: "Failure meaning",
      target: "snapshot exists but household/setup is unhealthy",
      detail: "If ok=false but repositoryMode=supabase, treat it as setup drift: wrong household id, no members, or no owner."
    }
  ];
  const executionChecklist: RawTableRow[] = privateBetaSetupGate.map((row) => ({
    view: "execution_checklist",
    step: row.step,
    status: row.status,
    owner: row.owner,
    item: row.item,
    detail: row.detail,
    source: row.source
  }));
  const onboardingProofSteps: RawTableRow[] = [
    {
      view: "onboarding_proof_steps",
      step: 1,
      actor: "founder",
      item: "Login as founder",
      status: process.env.SAYVE_TEST_SUPABASE_ACCESS_TOKEN?.trim() ? "ready" : "open",
      where: appBaseUrl || "https://your-domain.com",
      proof:
        process.env.SAYVE_TEST_SUPABASE_ACCESS_TOKEN?.trim()
          ? "Founder session token is already collected."
          : "Sign in on the deployed Sayve app, select the household, then copy sayve_access_token.",
      nextAction:
        process.env.SAYVE_TEST_SUPABASE_ACCESS_TOKEN?.trim()
          ? "Keep this token for deploy smoke."
          : "Collect owner session token from browser localStorage."
    },
    {
      view: "onboarding_proof_steps",
      step: 2,
      actor: "founder",
      item: "Create/confirm shared household",
      status: binding?.exists ? "ready" : "open",
      where: "/admin -> Household Setup",
      proof:
        binding?.exists
          ? `Household ${binding.householdId || ""} exists${binding.ownerCount > 0 ? " with an owner." : ", but owner proof is still weak."}`
          : "Create the founder household first so partner onboarding has a real target.",
      nextAction: binding?.exists ? "Use the same household id for partner onboarding and smoke." : "Create household and bind founder as owner."
    },
    {
      view: "onboarding_proof_steps",
      step: 3,
      actor: "founder",
      item: "Create partner invite",
      status: onboarding?.pendingInvites ? "in_progress" : (binding?.memberCount ?? 0) >= 2 ? "ready" : "open",
      where: "/admin -> Household Setup or app invite box",
      proof:
        (binding?.memberCount ?? 0) >= 2
          ? "Partner has already joined the shared household."
          : onboarding?.pendingInvites
            ? `${onboarding.pendingInvites} pending invite(s) exist.`
            : "No partner invite proof exists yet.",
      nextAction:
        (binding?.memberCount ?? 0) >= 2
          ? "Move to partner login proof."
          : onboarding?.pendingInvites
            ? "Open the partner invite link in a clean browser profile."
            : "Create a member invite for your partner."
    },
    {
      view: "onboarding_proof_steps",
      step: 4,
      actor: "partner",
      item: "Accept invite with separate account",
      status: process.env.SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN?.trim() ? "ready" : onboarding?.pendingInvites ? "in_progress" : "open",
      where: appBaseUrl ? `${appBaseUrl}/invite?token=<invite-token>` : "https://your-domain.com/invite?token=<invite-token>",
      proof:
        process.env.SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN?.trim()
          ? "Partner session token is already collected."
          : onboarding?.pendingInvites
            ? "Invite exists, but partner accept proof still depends on a separate login."
            : "Partner acceptance cannot start until an invite exists.",
      nextAction:
        process.env.SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN?.trim()
          ? "Use this token in deploy smoke."
          : onboarding?.pendingInvites
            ? "Login with your wife’s Google account in another browser profile, accept invite, then copy sayve_access_token."
            : "Create partner invite first."
    },
    {
      view: "onboarding_proof_steps",
      step: 5,
      actor: "founder+partner",
      item: "Confirm both write to same household",
      status: (binding?.memberCount ?? 0) >= 2 && launchReadiness.liveSmokeVerified ? "ready" : (binding?.memberCount ?? 0) >= 2 ? "pending" : "open",
      where: "Dashboard + verify:deploy",
      proof:
        (binding?.memberCount ?? 0) >= 2 && launchReadiness.liveSmokeVerified
          ? "Household roster and live smoke together prove shared-memory onboarding."
          : (binding?.memberCount ?? 0) >= 2
            ? "Two members exist, but deployed write/read proof still depends on live smoke."
            : "Shared-household proof cannot happen until both members are present.",
      nextAction:
        (binding?.memberCount ?? 0) >= 2 && launchReadiness.liveSmokeVerified
          ? "No action."
          : (binding?.memberCount ?? 0) >= 2
            ? "Run verify:deploy:private-beta and confirm exact fact ids appear for both members."
            : "Finish partner onboarding first."
    },
    {
      view: "onboarding_proof_steps",
      step: 6,
      actor: "founder",
      item: "Collect bootstrap token",
      status: process.env.SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN?.trim() ? "ready" : "open",
      where: appBaseUrl || "https://your-domain.com",
      proof:
        process.env.SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN?.trim()
          ? "Fresh zero-household token is ready."
          : "Bootstrap proof still needs a fresh account that belongs to zero households.",
      nextAction:
        process.env.SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN?.trim()
          ? "Use it during deploy smoke."
          : "Login with a fresh account, before first-run household creation completes copy sayve_access_token."
    }
  ];
  const providerSetup: RawTableRow[] = [
    ...integrationPackage.map((row) => ({
      view: "provider_setup",
      provider: row.system,
      section: row.system === "openai" ? "public_launch" : "private_beta",
      field: row.field,
      status: row.status,
      value: row.value,
      target: row.target,
      detail: row.detail
    })),
    ...envSetup
      .filter((row) =>
        [
          "NEXT_PUBLIC_SUPABASE_URL",
          "NEXT_PUBLIC_SUPABASE_ANON_KEY",
          "SUPABASE_SERVICE_ROLE_KEY",
          "SUPABASE_DEFAULT_HOUSEHOLD_ID",
          "SUPABASE_AUTH_REQUIRED",
          "APP_ACCESS_TOKEN",
          "ADMIN_CONSOLE_TOKEN",
          "OPENAI_API_KEY",
          "SAYVE_DEPLOY_URL"
        ].includes(String(row.env))
      )
      .map((row) => ({
        view: "provider_setup",
        provider:
          String(row.env).startsWith("OPENAI_")
            ? "openai"
            : String(row.env).startsWith("SUPABASE") || String(row.env).startsWith("NEXT_PUBLIC_SUPABASE")
              ? "supabase"
              : String(row.env).startsWith("SAYVE_DEPLOY")
                ? "vercel"
                : "sayve",
        section: row.requiredFor,
        field: row.env,
        status: row.status,
        value: row.value,
        target: "env",
        detail: row.detail
      }))
  ];

  return {
    schemaDictionary: databaseFieldDictionary,
    ledger,
    contextState,
    qualityQueue,
    aiWorkTrace,
    captureDebug,
    schemaMigrationProof,
    launchCompletionAudit,
    householdSetup,
    householdRoster,
    supabaseMigration,
    liveProofGaps,
    launchBlockers,
    publicLaunchChecks,
    migrationInventory,
    privateBetaSetupGate,
    executionChecklist,
    onboardingProofSteps,
    integrationReadiness,
    integrationPackage,
    providerSetup,
    envSetup,
    authSetup,
    envTemplate,
    deployEnvTemplate,
    deploySmokeEnvTemplate,
    repositorySmokeGuide,
    oauthChecklist,
    smokeTokenGuide,
    liveSmokeEvidence,
    liveRollout
  };
}

export async function getFounderReadableViews(options: {
  launchReadiness?: FounderLaunchReadinessSnapshot;
  launchReadinessChecks?: Array<{ id: string; label: string; status: "pass" | "warn" | "fail"; detail: string }>;
} = {}): Promise<Record<ReadableViewName, RawTableRow[]>> {
  const store = await readFounderMemoryStore();
  const defaultHouseholdBinding = await readFounderDefaultHouseholdBinding();
  const onboardingHealth = await readFounderOnboardingHealth();
  const month = monthPrefix();
  const telemetryEvents = store.aiTelemetry.filter((event) => event.createdAt.startsWith(month)).length;
  const launchReadiness = options.launchReadiness ?? {
    configReadyForPrivateBeta: false,
    liveSmokeVerified: process.env.SAYVE_DEPLOYMENT_SMOKE_VERIFIED === "1",
    readyForPublicLaunch: false
  };
  return getReadableViews(store, {
    defaultHouseholdBinding,
    onboardingHealth,
    householdRoster: await readFounderHouseholdRoster(),
    migrationInspection: await readFounderMigrationInspection(),
    launchReadiness,
    launchReadinessChecks: options.launchReadinessChecks,
    liveRollout: buildLiveRolloutRows({
      defaultHouseholdBinding,
      onboardingHealth,
      telemetryEvents,
      configReadyForPrivateBeta: launchReadiness.configReadyForPrivateBeta,
      liveSmokeVerified: launchReadiness.liveSmokeVerified,
      readyForPublicLaunch: launchReadiness.readyForPublicLaunch
    })
  });
}

export async function getFounderTableRows(table: string): Promise<RawTableRow[] | undefined> {
  const tables = await getFounderRawTables();
  if (!Object.prototype.hasOwnProperty.call(tables, table)) return undefined;
  return tables[table as RawTableName];
}

export async function getFounderViewRows(
  view: string,
  options: {
    launchReadiness?: FounderLaunchReadinessSnapshot;
    launchReadinessChecks?: Array<{ id: string; label: string; status: "pass" | "warn" | "fail"; detail: string }>;
  } = {}
): Promise<RawTableRow[] | undefined> {
  const views = await getFounderReadableViews(options);
  if (!Object.prototype.hasOwnProperty.call(views, view)) return undefined;
  return views[view as ReadableViewName];
}

export async function getFounderExportRows(
  scope: FounderExportScope,
  name: string,
  options: {
    launchReadiness?: FounderLaunchReadinessSnapshot;
    launchReadinessChecks?: Array<{ id: string; label: string; status: "pass" | "warn" | "fail"; detail: string }>;
  } = {}
): Promise<RawTableRow[] | undefined> {
  return scope === "view" ? getFounderViewRows(name, options) : getFounderTableRows(name);
}

function csvEscape(value: string | number): string {
  const text = String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

export function rowsToCsv(rows: RawTableRow[]): string {
  if (rows.length === 0) return "";
  const columns = Object.keys(rows[0]);
  const lines = [
    columns.map(csvEscape).join(","),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column] ?? "")).join(","))
  ];
  return `${lines.join("\n")}\n`;
}

function buildLiveRolloutRows(input: {
  defaultHouseholdBinding: FounderDefaultHouseholdBinding;
  onboardingHealth: FounderOnboardingHealth;
  telemetryEvents: number;
  readyForPublicLaunch: boolean;
  configReadyForPrivateBeta: boolean;
  liveSmokeVerified: boolean;
  mediaStorageSmoke?: CaptureMediaStorageSmokeResult;
}): FounderLiveRolloutRow[] {
  const deployUrl = process.env.SAYVE_DEPLOY_URL?.trim() || "";
  const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || "";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim() || "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  const mediaBucket = process.env.SUPABASE_MEDIA_BUCKET?.trim() || "";
  const openAiKey = process.env.OPENAI_API_KEY?.trim() || "";
  const smokeVerified = process.env.SAYVE_DEPLOYMENT_SMOKE_VERIFIED === "1";
  const smokeVerifiedAt = process.env.SAYVE_DEPLOYMENT_SMOKE_VERIFIED_AT?.trim() ?? "";
  const smokeTarget = process.env.SAYVE_DEPLOYMENT_SMOKE_TARGET?.trim() ?? "";
  const authRequired = process.env.SUPABASE_AUTH_REQUIRED === "1";

  return [
    {
      item: "Vercel deploy URL",
      status: deployUrl ? "READY" : "OPEN",
      value: deployUrl || "",
      detail: deployUrl || "Set SAYVE_DEPLOY_URL to the real deployed Sayve domain."
    },
    {
      item: "App base URL",
      status: appBaseUrl ? "READY" : "OPEN",
      value: appBaseUrl || "",
      detail: appBaseUrl || "Set NEXT_PUBLIC_APP_URL so Google OAuth and invite redirects use one stable origin."
    },
    {
      item: "Supabase browser auth",
      status: supabaseUrl && anonKey ? "READY" : "OPEN",
      value: supabaseUrl && anonKey ? "configured" : "",
      detail: supabaseUrl && anonKey ? "Browser auth env is present." : "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
    },
    {
      item: "Supabase server storage",
      status: serviceKey ? "READY" : "OPEN",
      value: serviceKey ? "configured" : "",
      detail: serviceKey ? "Service-role key is present." : "Set SUPABASE_SERVICE_ROLE_KEY for repository and admin checks."
    },
    {
      item: "Household binding",
      status: input.defaultHouseholdBinding.exists ? "READY" : "OPEN",
      value: input.defaultHouseholdBinding.householdId || "",
      detail: input.defaultHouseholdBinding.exists
        ? `${input.defaultHouseholdBinding.memberCount} member(s), ${input.defaultHouseholdBinding.ownerCount} owner(s).`
        : input.defaultHouseholdBinding.issue || "Bind a real SUPABASE_DEFAULT_HOUSEHOLD_ID."
    },
    {
      item: "Partner onboarding",
      status: input.defaultHouseholdBinding.memberCount >= 2 ? "READY" : "OPEN",
      value: `${input.onboardingHealth.pendingInvites} pending / ${input.onboardingHealth.acceptedInvites} accepted`,
      detail:
        input.defaultHouseholdBinding.memberCount >= 2
          ? "Second household member is present."
          : input.onboardingHealth.pendingInvites > 0
            ? `${input.onboardingHealth.pendingInvites} pending invite(s) exist; finish partner join.`
            : "Create and complete one partner invite."
    },
    {
      item: "Supabase Auth required",
      status: authRequired ? "READY" : "OPEN",
      value: authRequired ? "1" : "0",
      detail: authRequired ? "Real household writes require bearer auth." : "Set SUPABASE_AUTH_REQUIRED=1 before live family usage."
    },
    {
      item: "Google OAuth allow list",
      status: appBaseUrl ? "CHECK" : "OPEN",
      value: appBaseUrl ? `${appBaseUrl}, ${appBaseUrl}/invite` : "",
      detail: appBaseUrl
        ? `Confirm Supabase Auth redirect allow list includes ${appBaseUrl} and ${appBaseUrl}/invite.`
        : "Set NEXT_PUBLIC_APP_URL first, then add it and /invite to Supabase Auth redirect allow list."
    },
    {
      item: "AI provider",
      status: openAiKey ? "READY" : input.readyForPublicLaunch ? "READY" : "OPEN",
      value: openAiKey ? "configured" : "",
      detail: openAiKey ? "OPENAI_API_KEY is configured." : "Add OPENAI_API_KEY before public launch or keep heuristic fallback for private beta."
    },
    {
      item: "Media storage",
      status: !mediaBucket ? "OPEN" : input.mediaStorageSmoke ? (input.mediaStorageSmoke.ok ? "READY" : "CHECK") : "CHECK",
      value: mediaBucket || "",
      detail: !mediaBucket
        ? "Create a private Supabase Storage bucket for receipt / voice source files."
        : input.mediaStorageSmoke
          ? input.mediaStorageSmoke.detail
          : `${mediaBucket} is configured, but founder storage smoke proof has not been collected yet.`
    },
    {
      item: "Telemetry proof",
      status: input.telemetryEvents > 0 ? "READY" : "OPEN",
      value: String(input.telemetryEvents),
      detail: input.telemetryEvents > 0 ? `${input.telemetryEvents} AI event(s) recorded.` : "Run one real capture or ask one real question."
    },
    {
      item: "Deploy smoke",
      status: smokeVerified ? "READY" : "OPEN",
      value: smokeVerified ? smokeVerifiedAt || "verified" : "",
      detail: smokeVerified
        ? `Smoke marker set${smokeVerifiedAt ? ` at ${smokeVerifiedAt}` : ""}${smokeTarget ? ` for ${smokeTarget}` : ""}.`
        : "Run pnpm run verify:deploy:* against the live deployment, then set the smoke marker."
    },
    {
      item: "Private beta gate",
      status: input.configReadyForPrivateBeta ? "READY" : "OPEN",
      value: input.configReadyForPrivateBeta ? "pass" : "not ready",
      detail: input.configReadyForPrivateBeta ? "Current config passes private beta gate." : "Resolve Launch Readiness blockers before private beta rollout."
    },
    {
      item: "Public launch gate",
      status: input.readyForPublicLaunch ? "READY" : input.liveSmokeVerified ? "CHECK" : "OPEN",
      value: input.readyForPublicLaunch ? "pass" : "not ready",
      detail: input.readyForPublicLaunch
        ? "Current config passes public launch gate."
        : input.liveSmokeVerified
          ? "Live smoke is proven; finish remaining public launch blockers."
          : "Finish live deployment smoke before expecting public-ready status."
    }
  ];
}

export async function getFounderConsoleData(
  options: {
    defaultHouseholdBinding?: () => Promise<FounderDefaultHouseholdBinding>;
    onboardingHealth?: () => Promise<FounderOnboardingHealth>;
    householdRoster?: () => Promise<FounderHouseholdRosterRow[]>;
    migrationInspection?: () => Promise<FounderMigrationInspection>;
    mediaStorageSmoke?: () => Promise<CaptureMediaStorageSmokeResult | undefined>;
    liveRollout?: (input: {
      defaultHouseholdBinding: FounderDefaultHouseholdBinding;
      onboardingHealth: FounderOnboardingHealth;
      telemetryEvents: number;
      configReadyForPrivateBeta: boolean;
      liveSmokeVerified: boolean;
      readyForPublicLaunch: boolean;
      mediaStorageSmoke?: CaptureMediaStorageSmokeResult;
    }) => Promise<FounderLiveRolloutRow[]> | FounderLiveRolloutRow[];
    launchReadiness?: {
      configReadyForPrivateBeta: boolean;
      liveSmokeVerified: boolean;
      readyForPublicLaunch: boolean;
    };
    launchReadinessChecks?: Array<{ id: string; label: string; status: "pass" | "warn" | "fail"; detail: string }>;
  } = {}
) {
  const store = await readFounderMemoryStore();
  const defaultHouseholdBinding = options.defaultHouseholdBinding
    ? await options.defaultHouseholdBinding()
    : await readFounderDefaultHouseholdBinding();
  const onboardingHealth = options.onboardingHealth ? await options.onboardingHealth() : await readFounderOnboardingHealth();
  const householdRoster = options.householdRoster ? await options.householdRoster() : await readFounderHouseholdRoster();
  const migrationInspection = options.migrationInspection ? await options.migrationInspection() : await readFounderMigrationInspection();
  const mediaStorageSmoke = options.mediaStorageSmoke
    ? await options.mediaStorageSmoke()
    : process.env.MEMORY_REPOSITORY === "supabase" && process.env.SUPABASE_MEDIA_BUCKET?.trim()
      ? await runCaptureMediaStorageSmokeTest()
      : undefined;
  const today = todayPrefix();
  const month = monthPrefix();
  const now = Date.now();
  const monthTelemetry = store.aiTelemetry.filter((event) => event.createdAt.startsWith(month));
  const todayTelemetry = store.aiTelemetry.filter((event) => event.createdAt.startsWith(today));
  const fallbackTelemetry = monthTelemetry.filter((event) => event.status === "fallback");
  const errorTelemetry = monthTelemetry.filter((event) => event.status === "error");
  const limitedTelemetry = monthTelemetry.filter((event) => event.status === "limited");
  const openAiTelemetry = monthTelemetry.filter((event) => event.provider === "openai");
  const openAiSuccessTelemetry = openAiTelemetry.filter((event) => event.status === "success");
  const openAiFallbackTelemetry = openAiTelemetry.filter((event) => event.status === "fallback");
  const openAiErrorTelemetry = openAiTelemetry.filter((event) => event.status === "error");
  const missingTokenTelemetry = missingTelemetryCount(monthTelemetry, "totalTokens");
  const missingCostTelemetry = missingTelemetryCount(monthTelemetry, "estimatedCostUsd");
  const missingDurationTelemetry = missingTelemetryCount(monthTelemetry, "durationMs");
  const telemetryCompletenessDenominator = Math.max(1, monthTelemetry.length * 3);
  const telemetryCompletenessPercent = Number(
    (
      ((telemetryCompletenessDenominator - missingTokenTelemetry - missingCostTelemetry - missingDurationTelemetry) /
        telemetryCompletenessDenominator) *
      100
    ).toFixed(1)
  );
  const slowestPhase = slowestTelemetryPhase(monthTelemetry);
  const rolloutLaunchReadiness = options.launchReadiness ?? {
    configReadyForPrivateBeta: false,
    liveSmokeVerified: process.env.SAYVE_DEPLOYMENT_SMOKE_VERIFIED === "1",
    readyForPublicLaunch: false
  };
  const liveRollout =
    typeof options.liveRollout === "function"
      ? await options.liveRollout({
          defaultHouseholdBinding,
          onboardingHealth,
          telemetryEvents: monthTelemetry.length,
          configReadyForPrivateBeta: rolloutLaunchReadiness.configReadyForPrivateBeta,
          liveSmokeVerified: rolloutLaunchReadiness.liveSmokeVerified,
          readyForPublicLaunch: rolloutLaunchReadiness.readyForPublicLaunch,
          mediaStorageSmoke
        })
      : buildLiveRolloutRows({
          defaultHouseholdBinding,
          onboardingHealth,
          telemetryEvents: monthTelemetry.length,
          configReadyForPrivateBeta: rolloutLaunchReadiness.configReadyForPrivateBeta,
          liveSmokeVerified: rolloutLaunchReadiness.liveSmokeVerified,
          readyForPublicLaunch: rolloutLaunchReadiness.readyForPublicLaunch,
          mediaStorageSmoke
        });
  const captureDecisionTelemetry = monthTelemetry.filter((event) => event.phase === "capture_interpretation");
  const decisionForEvent = (event: AiTelemetryEvent) => metadataText(event, "decision") || metadataText(event, "memoryStatus");
  const autoConfirmDecisionTelemetry = captureDecisionTelemetry.filter((event) => decisionForEvent(event) === "auto_confirmed");
  const reviewLaterDecisionTelemetry = captureDecisionTelemetry.filter((event) => decisionForEvent(event) === "review_later");
  const askUserDecisionTelemetry = captureDecisionTelemetry.filter(
    (event) => decisionForEvent(event) === "needs_user_input" || metadataBoolean(event, "needsUserInput")
  );
  const lowConfidenceDecisionTelemetry = captureDecisionTelemetry.filter(
    (event) => metadataText(event, "confidenceBand") === "low" || (typeof event.confidence === "number" && event.confidence < 0.56)
  );
  const householdIds = new Set<string>();

  for (const capture of store.captures) householdIds.add(capture.householdId);
  for (const memory of store.memoryObjects) householdIds.add(memory.householdId);
  for (const message of store.conversationMessages) householdIds.add(message.householdId);
  for (const event of store.aiTelemetry) householdIds.add(event.householdId);

  const activeHouseholds = new Set<string>();
  for (const capture of store.captures) {
    if (now - new Date(capture.createdAt).getTime() <= 30 * DAY_MS) activeHouseholds.add(capture.householdId);
  }
  for (const message of store.conversationMessages) {
    if (now - new Date(message.createdAt).getTime() <= 30 * DAY_MS) activeHouseholds.add(message.householdId);
  }

  const totalMemories = store.memoryObjects.length;
  const autoConfirmed = store.memoryObjects.filter((memory) => memory.status === "auto_confirmed").length;
  const reviewLater = store.memoryObjects.filter((memory) => memory.status === "review_later").length;
  const askUser = store.memoryObjects.filter((memory) => memory.status === "needs_user_input").length;
  const merged = store.memoryObjects.filter((memory) => memory.currentState === "merged").length;
  const duplicateRelationships = store.relationships.filter((relationship) => relationship.relationshipType === "supports_same_memory").length;
  const corrections = store.revisions.filter((revision) => revision.revisionType === "user_correction" || revision.actor === "user");
  const avgConfidence =
    totalMemories === 0
      ? 0
      : Number((store.memoryObjects.reduce((sum, memory) => sum + memory.confidence, 0) / totalMemories).toFixed(2));

  const captureCount = store.captures.length;
  const textCaptures = store.captures.filter((capture) => capture.sourceType === "text").length;
  const receiptCaptures = store.captures.filter((capture) => capture.sourceType === "receipt").length;
  const voiceCaptures = store.captures.filter((capture) => capture.sourceType === "voice").length;
  const userQuestions = store.conversationMessages.filter((message) => message.role === "user");
  const daysWithQuestions = new Set(userQuestions.map((message) => message.createdAt.slice(0, 10))).size || 1;
  const dashboardViews = store.usage.reduce((sum, bucket) => sum + (bucket.dashboardViews ?? 0), 0);
  const conversationTurns = store.usage.reduce((sum, bucket) => sum + bucket.conversationTurns, 0);

  const recurringFacts = store.facts.filter((fact) => fact.payload.recurringHint).length;
  const reprocessCount = store.revisions.filter((revision) => revision.revisionType === "reprocess").length;
  const contextUpdates = store.contexts.length;
  const merchantAliases = store.insights.filter((insight) => insight.explanation.toLowerCase().includes("alias")).length;

  const lowConfidenceMemories = store.memoryObjects.filter((memory) => memory.confidence < 0.56);
  const merchantUnknown = store.facts.filter((fact) => !fact.payload.merchant).length;
  const categoryUncertain = store.facts.filter((fact) => !fact.payload.category || fact.payload.category === "Family Living").length;
  const ocrFail = store.captures.filter(
    (capture) => capture.sourceType === "receipt" && !capture.rawText && !capture.metadata.description
  ).length;
  const correctionCounts = new Map<string, number>();
  for (const revision of corrections) {
    correctionCounts.set(revision.memoryObjectId, (correctionCounts.get(revision.memoryObjectId) ?? 0) + 1);
  }

  const heavyUsers = [...householdIds]
    .map((householdId) => ({
      householdId,
      memories: store.memoryObjects.filter((memory) => memory.householdId === householdId).length,
      captures: store.captures.filter((capture) => capture.householdId === householdId).length,
      aiCostUsd: sumCost(monthTelemetry.filter((event) => event.householdId === householdId))
    }))
    .sort((a, b) => b.captures - a.captures)
    .slice(0, 8);

  const avgCostPerHousehold = householdIds.size === 0 ? 0 : money(sumCost(monthTelemetry) / householdIds.size);
  const avgCostPerMemory = totalMemories === 0 ? 0 : money(sumCost(monthTelemetry) / totalMemories);
  const mergeSuccess = pct(duplicateRelationships, Math.max(1, duplicateRelationships + lowConfidenceMemories.length));
  const budgetTrackedEvents = monthTelemetry.filter(
    (event) => event.phase === "capture_interpretation" || event.phase === "conversation_answer"
  );
  const budgetInstrumentedEvents = budgetTrackedEvents.filter((event) => metadataNumber(event, "outputBudgetTokens") !== null);
  const budgetOverrunEvents = budgetTrackedEvents.filter((event) => {
    const budget = metadataNumber(event, "outputBudgetTokens");
    return budget !== null && typeof event.completionTokens === "number" && event.completionTokens > budget;
  });
  const aiHealthScore = Math.round(
    Math.max(
      0,
      Math.min(
        100,
        avgConfidence * 40 +
          pct(autoConfirmed, totalMemories) * 0.25 +
          mergeSuccess * 0.2 -
          pct(corrections.length, Math.max(1, totalMemories)) * 0.25 -
          pct(lowConfidenceMemories.length, Math.max(1, totalMemories)) * 0.2
      )
    )
  );

  const rawTables = getFounderRawTablesFromStore(store);
  const readableViews = getReadableViews(store, {
    defaultHouseholdBinding,
    onboardingHealth,
    householdRoster,
    migrationInspection,
    aiRuntimeHealth: {
      openAiEvents: openAiTelemetry.length,
      openAiSuccessRate: pct(openAiSuccessTelemetry.length, openAiTelemetry.length),
      openAiFallbackRate: pct(openAiFallbackTelemetry.length, openAiTelemetry.length),
      openAiErrorEvents: openAiErrorTelemetry.length,
      telemetryCompletenessPercent,
      budgetCoveragePercent: pct(budgetInstrumentedEvents.length, budgetTrackedEvents.length),
      budgetOverrunEvents: budgetOverrunEvents.length
    },
    launchReadiness: rolloutLaunchReadiness,
    launchReadinessChecks: options.launchReadinessChecks,
    liveRollout
  });

  return {
    generatedAt: new Date().toISOString(),
    kpi: {
      activeHouseholds: activeHouseholds.size,
      memoryCreatedToday: store.memoryObjects.filter((memory) => memory.createdAt.startsWith(today)).length,
      autoConfirmPercent: pct(autoConfirmed, totalMemories),
      userCorrectionPercent: pct(corrections.length, totalMemories),
      averageCostPerHouseholdUsd: avgCostPerHousehold,
      averageCostPerMemoryUsd: avgCostPerMemory,
      mergeSuccessPercent: mergeSuccess,
      aiHealthScore
    },
    aiCostAnalytics: {
      todayCostUsd: sumCost(todayTelemetry),
      monthCostUsd: sumCost(monthTelemetry),
      averageCostPerHouseholdUsd: avgCostPerHousehold,
      averageCostPerMemoryUsd: avgCostPerMemory,
      tokenUsage: sumTokens(monthTelemetry),
      visionCalls: monthTelemetry.filter((event) => event.phase === "receipt_vision").length,
      speechCalls: monthTelemetry.filter((event) => event.phase === "speech_to_text").length,
      speechDurationMs: monthTelemetry
        .filter((event) => event.phase === "speech_to_text")
        .reduce((sum, event) => sum + (event.durationMs ?? 0), 0),
      modelUsage: groupCount(monthTelemetry.map((event) => event.model)),
      phaseUsage: groupCount(monthTelemetry.map((event) => event.phase))
    },
    aiRuntimeHealth: {
      totalAiEvents: monthTelemetry.length,
      openAiEvents: openAiTelemetry.length,
      openAiSuccessRate: pct(openAiSuccessTelemetry.length, openAiTelemetry.length),
      openAiFallbackRate: pct(openAiFallbackTelemetry.length, openAiTelemetry.length),
      openAiErrorEvents: openAiErrorTelemetry.length,
      fallbackRate: pct(fallbackTelemetry.length, monthTelemetry.length),
      errorRate: pct(errorTelemetry.length, monthTelemetry.length),
      limitedRate: pct(limitedTelemetry.length, monthTelemetry.length),
      todayErrors: todayTelemetry.filter((event) => event.status === "error").length,
      averageDurationMs: avgDuration(monthTelemetry),
      p95DurationMs: p95Duration(monthTelemetry),
      slowestPhase: slowestPhase.phase || "n/a",
      slowestPhaseAverageDurationMs: slowestPhase.averageDurationMs,
      telemetryCompletenessPercent,
      budgetCoveragePercent: pct(budgetInstrumentedEvents.length, budgetTrackedEvents.length),
      budgetOverrunEvents: budgetOverrunEvents.length,
      missingTokenEvents: missingTokenTelemetry,
      missingCostEvents: missingCostTelemetry,
      missingDurationEvents: missingDurationTelemetry
    },
    aiDecisionAnalytics: {
      captureDecisionEvents: captureDecisionTelemetry.length,
      autoConfirmPercent: pct(autoConfirmDecisionTelemetry.length, captureDecisionTelemetry.length),
      reviewLaterPercent: pct(reviewLaterDecisionTelemetry.length, captureDecisionTelemetry.length),
      askUserPercent: pct(askUserDecisionTelemetry.length, captureDecisionTelemetry.length),
      lowConfidencePercent: pct(lowConfidenceDecisionTelemetry.length, captureDecisionTelemetry.length),
      intentMix: groupCount(captureDecisionTelemetry.map((event) => metadataText(event, "intent")).filter(Boolean)),
      decisionMix: groupCount(captureDecisionTelemetry.map(decisionForEvent).filter(Boolean))
    },
    memoryQuality: {
      totalMemories,
      autoConfirmPercent: pct(autoConfirmed, totalMemories),
      reviewLaterPercent: pct(reviewLater, totalMemories),
      askUserPercent: pct(askUser, totalMemories),
      mergeSuccessRate: mergeSuccess,
      duplicateDetectionCount: duplicateRelationships,
      averageConfidence: avgConfidence,
      userCorrectionRate: pct(corrections.length, totalMemories)
    },
    usageAnalytics: {
      textCapturePercent: pct(textCaptures, captureCount),
      receiptCapturePercent: pct(receiptCaptures, captureCount),
      voiceCapturePercent: pct(voiceCaptures, captureCount),
      averageDailyQuestions: Number((userQuestions.length / daysWithQuestions).toFixed(1)),
      mostAskedQuestions: topStrings(userQuestions.map((message) => message.content)),
      dashboardViews,
      conversationTurns,
      dashboardVsConversation: {
        dashboardPercent: pct(dashboardViews, dashboardViews + conversationTurns),
        conversationPercent: pct(conversationTurns, dashboardViews + conversationTurns)
      }
    },
    memoryEvolution: {
      newMerchantAliases: merchantAliases,
      recurringExpenses: recurringFacts,
      householdContexts: contextUpdates,
      reprocessCount,
      modelMix: groupCount(store.interpretations.map((interpretation) => interpretation.model))
    },
    aiQualityIssues: {
      ocrFail,
      merchantUnknown,
      categoryUncertain,
      mergeFailed: lowConfidenceMemories.filter((memory) => memory.title.toLowerCase().includes("duplicate")).length,
      lowConfidenceMemories: lowConfidenceMemories.length,
      mostCorrectedMemories: [...correctionCounts.entries()]
        .map(([memoryObjectId, count]) => ({
          memoryObjectId,
          count,
          title: store.memoryObjects.find((memory) => memory.id === memoryObjectId)?.title ?? memoryObjectId
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8)
    },
    householdAnalytics: {
      households: householdIds.size,
      activeHouseholds: activeHouseholds.size,
      averageMemoriesPerHousehold: householdIds.size === 0 ? 0 : Number((totalMemories / householdIds.size).toFixed(1)),
      averageDailyCapture: Number((captureCount / Math.max(1, new Set(store.captures.map((capture) => capture.createdAt.slice(0, 10))).size)).toFixed(1)),
      averageAiCostPerHouseholdUsd: avgCostPerHousehold,
      topHeavyUsers: heavyUsers
    },
    onboardingHealth,
    defaultHouseholdBinding,
    rawTables: {
      captures: rawTables.captures.slice(0, 50).map((row) => ({ ...row, id: compactId(String(row.id)) })),
      memories: rawTables.memories.slice(0, 50).map((row) => ({ ...row, id: compactId(String(row.id)) })),
      interpretations: rawTables.interpretations.slice(0, 50).map((row) => ({
        ...row,
        id: compactId(String(row.id)),
        memory: compactId(String(row.memory))
      })),
      facts: rawTables.facts.slice(0, 50).map((row) => ({
        ...row,
        id: compactId(String(row.id)),
        memory: compactId(String(row.memory))
      })),
      contexts: rawTables.contexts.slice(0, 50).map((row) => ({ ...row, id: compactId(String(row.id)) })),
      relationships: rawTables.relationships.slice(0, 50).map((row) => ({ ...row, id: compactId(String(row.id)) })),
      revisions: rawTables.revisions.slice(0, 50).map((row) => ({
        ...row,
        id: compactId(String(row.id)),
        memory: compactId(String(row.memory))
      })),
      categories: rawTables.categories.slice(0, 50).map((row) => ({ ...row, id: compactId(String(row.id)) })),
      conversations: rawTables.conversations.slice(0, 50).map((row) => ({ ...row, id: compactId(String(row.id)) })),
      telemetry: rawTables.telemetry.slice(0, 50).map((row) => ({ ...row, id: compactId(String(row.id)) }))
    },
    readableViews,
    recentTelemetry: store.aiTelemetry.slice(0, 20)
  };
}

export async function getFounderSetupBundle(
  launchReadiness: FounderLaunchReadinessSnapshot,
  launchReadinessChecks: Array<{ id: string; label: string; status: "pass" | "warn" | "fail"; detail: string }> = []
): Promise<FounderSetupBundle> {
  const data = await getFounderConsoleData({ launchReadiness, launchReadinessChecks });
  const unsignedBundle = {
    launchReadiness,
    launchReadinessChecks,
    defaultHouseholdBinding: data.defaultHouseholdBinding,
    onboardingHealth: data.onboardingHealth,
    nextActions: buildFounderSetupNextActions({
      defaultHouseholdBinding: data.defaultHouseholdBinding,
      onboardingHealth: data.onboardingHealth,
      launchReadiness
    }),
    commands: buildDeploymentSmokeCommands(data.defaultHouseholdBinding.householdId),
    views: {
      liveRollout: data.readableViews.liveRollout,
      liveProofGaps: data.readableViews.liveProofGaps,
      launchCompletionAudit: data.readableViews.launchCompletionAudit,
      launchBlockers: data.readableViews.launchBlockers,
      publicLaunchChecks: data.readableViews.publicLaunchChecks,
      schemaMigrationProof: data.readableViews.schemaMigrationProof,
      migrationInventory: data.readableViews.migrationInventory,
      privateBetaSetupGate: data.readableViews.privateBetaSetupGate,
      executionChecklist: data.readableViews.executionChecklist,
      onboardingProofSteps: data.readableViews.onboardingProofSteps,
      integrationReadiness: data.readableViews.integrationReadiness,
      integrationPackage: data.readableViews.integrationPackage,
      providerSetup: data.readableViews.providerSetup,
      authSetup: data.readableViews.authSetup,
      envSetup: data.readableViews.envSetup,
      envTemplate: data.readableViews.envTemplate,
      deployEnvTemplate: data.readableViews.deployEnvTemplate,
      deploySmokeEnvTemplate: data.readableViews.deploySmokeEnvTemplate,
      repositorySmokeGuide: data.readableViews.repositorySmokeGuide,
      oauthChecklist: data.readableViews.oauthChecklist,
      smokeTokenGuide: data.readableViews.smokeTokenGuide
    }
  } satisfies Omit<FounderSetupBundle, "generatedAt" | "signature">;

  return {
    generatedAt: new Date().toISOString(),
    signature: createFounderBundleSignature(unsignedBundle),
    ...unsignedBundle
  };
}

export async function getFounderIntegrationBundle(
  launchReadiness: FounderLaunchReadinessSnapshot,
  launchReadinessChecks: Array<{ id: string; label: string; status: "pass" | "warn" | "fail"; detail: string }> = []
): Promise<FounderIntegrationBundle> {
  const data = await getFounderConsoleData({ launchReadiness, launchReadinessChecks });
  const unsignedBundle = {
    launchReadiness,
    launchReadinessChecks,
    nextActions: buildFounderSetupNextActions({
      defaultHouseholdBinding: data.defaultHouseholdBinding,
      onboardingHealth: data.onboardingHealth,
      launchReadiness
    }),
    commands: buildDeploymentSmokeCommands(data.defaultHouseholdBinding.householdId),
    views: {
      launchCompletionAudit: data.readableViews.launchCompletionAudit,
      launchBlockers: data.readableViews.launchBlockers,
      liveProofGaps: data.readableViews.liveProofGaps,
      schemaMigrationProof: data.readableViews.schemaMigrationProof,
      migrationInventory: data.readableViews.migrationInventory,
      privateBetaSetupGate: data.readableViews.privateBetaSetupGate,
      executionChecklist: data.readableViews.executionChecklist,
      onboardingProofSteps: data.readableViews.onboardingProofSteps,
      integrationReadiness: data.readableViews.integrationReadiness,
      integrationPackage: data.readableViews.integrationPackage,
      providerSetup: data.readableViews.providerSetup,
      authSetup: data.readableViews.authSetup,
      envSetup: data.readableViews.envSetup,
      envTemplate: data.readableViews.envTemplate,
      deployEnvTemplate: data.readableViews.deployEnvTemplate,
      deploySmokeEnvTemplate: data.readableViews.deploySmokeEnvTemplate,
      oauthChecklist: data.readableViews.oauthChecklist,
      smokeTokenGuide: data.readableViews.smokeTokenGuide
    }
  } satisfies Omit<FounderIntegrationBundle, "generatedAt" | "signature">;

  return {
    generatedAt: new Date().toISOString(),
    signature: createFounderBundleSignature(unsignedBundle),
    ...unsignedBundle
  };
}

export async function getFounderLiveProofBundle(
  launchReadiness: FounderLaunchReadinessSnapshot,
  launchReadinessChecks: Array<{ id: string; label: string; status: "pass" | "warn" | "fail"; detail: string }> = []
): Promise<FounderLiveProofBundle> {
  const data = await getFounderConsoleData({ launchReadiness, launchReadinessChecks });
  const unsignedBundle = {
    launchReadiness,
    launchReadinessChecks,
    defaultHouseholdBinding: data.defaultHouseholdBinding,
    onboardingHealth: data.onboardingHealth,
    nextActions: buildFounderSetupNextActions({
      defaultHouseholdBinding: data.defaultHouseholdBinding,
      onboardingHealth: data.onboardingHealth,
      launchReadiness
    }),
    commands: buildDeploymentSmokeCommands(data.defaultHouseholdBinding.householdId),
    views: {
      liveRollout: data.readableViews.liveRollout,
      liveProofGaps: data.readableViews.liveProofGaps,
      onboardingProofSteps: data.readableViews.onboardingProofSteps,
      launchCompletionAudit: data.readableViews.launchCompletionAudit,
      launchBlockers: data.readableViews.launchBlockers,
      publicLaunchChecks: data.readableViews.publicLaunchChecks,
      schemaMigrationProof: data.readableViews.schemaMigrationProof,
      migrationInventory: data.readableViews.migrationInventory,
      deployEnvTemplate: data.readableViews.deployEnvTemplate,
      deploySmokeEnvTemplate: data.readableViews.deploySmokeEnvTemplate,
      smokeTokenGuide: data.readableViews.smokeTokenGuide
    }
  } satisfies Omit<FounderLiveProofBundle, "generatedAt" | "signature">;

  return {
    generatedAt: new Date().toISOString(),
    signature: createFounderBundleSignature(unsignedBundle),
    ...unsignedBundle
  };
}
