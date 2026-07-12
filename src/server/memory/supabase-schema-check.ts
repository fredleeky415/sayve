import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/server/supabase/service-client";
import { captureMediaBucket } from "@/server/media/storage";

export type SupabaseSchemaTableCheck = {
  table: string;
  columns: string[];
};

export type SupabaseSchemaIssue = {
  table: string;
  columns: string[];
  message: string;
};

export type SupabaseSecurityCheck = {
  id: string;
  ok: boolean;
  message: string;
  requiredMigrations?: string[];
  recommendedAction?: string;
};

export type SupabaseSchemaCheckResult = {
  configured: boolean;
  ok: boolean;
  checkedTables: number;
  securityChecks: SupabaseSecurityCheck[];
  issues: SupabaseSchemaIssue[];
  requiredMigrations: string[];
  recommendedActions: string[];
};

type SupabaseSchemaClient = Pick<SupabaseClient, "from"> & {
  rpc?: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  storage?: {
    getBucket?: (id: string) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  };
};

function numberFromRecord(value: unknown, key: string): number {
  if (!value || typeof value !== "object") return Number.NaN;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "number" ? raw : Number(raw);
}

function bucketPublicFlag(value: unknown): boolean | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = (value as Record<string, unknown>).public;
  return typeof raw === "boolean" ? raw : undefined;
}

export const REQUIRED_SUPABASE_SCHEMA: SupabaseSchemaTableCheck[] = [
  { table: "households", columns: ["id", "external_id", "name", "default_currency", "locale", "created_at"] },
  { table: "household_members", columns: ["household_id", "user_id", "role", "created_at"] },
  {
    table: "household_categories",
    columns: ["id", "external_id", "household_id", "name", "color", "created_by", "created_by_user_id", "archived_at", "created_at"]
  },
  { table: "invites", columns: ["id", "household_id", "email", "role", "token", "expires_at", "accepted_at", "created_at"] },
  { table: "captures", columns: ["id", "external_id", "household_id", "source_type", "raw_text", "transcript", "file_refs", "metadata", "created_by", "created_at"] },
  {
    table: "memory_objects",
    columns: ["id", "external_id", "household_id", "domain", "title", "current_state", "confidence", "status", "source_refs", "created_at", "updated_at"]
  },
  {
    table: "memory_interpretations",
    columns: [
      "id",
      "external_id",
      "memory_object_id",
      "model",
      "prompt_version",
      "intent",
      "structured_output",
      "confidence",
      "confidence_band",
      "reasoning_summary",
      "source_refs",
      "created_at"
    ]
  },
  { table: "memory_facts", columns: ["id", "external_id", "household_id", "memory_object_id", "domain", "payload", "source_refs", "immutable", "created_at"] },
  {
    table: "household_context",
    columns: ["id", "external_id", "household_id", "domain", "subject", "state", "current_state", "confidence", "source_refs", "effective_from", "updated_at"]
  },
  {
    table: "memory_relationships",
    columns: ["id", "external_id", "household_id", "from_type", "from_id", "to_type", "to_id", "relationship_type", "confidence", "reason", "created_at"]
  },
  {
    table: "memory_revisions",
    columns: ["id", "external_id", "household_id", "memory_object_id", "revision_type", "actor", "actor_user_id", "reason", "diff", "created_at"]
  },
  { table: "insights", columns: ["id", "external_id", "household_id", "severity", "title", "explanation", "source_refs", "dismissed", "created_at"] },
  { table: "conversation_messages", columns: ["id", "external_id", "household_id", "role", "content", "created_by", "confidence", "source_refs", "created_at"] },
  {
    table: "ai_jobs",
    columns: ["id", "household_id", "job_type", "status", "input", "output", "model", "prompt_version", "error", "created_at", "completed_at"]
  },
  {
    table: "ai_telemetry_events",
    columns: [
      "id",
      "external_id",
      "household_id",
      "phase",
      "model",
      "provider",
      "source_type",
      "memory_object_id",
      "capture_id",
      "conversation_message_id",
      "status",
      "confidence",
      "prompt_tokens",
      "completion_tokens",
      "total_tokens",
      "estimated_cost_usd",
      "duration_ms",
      "metadata",
      "created_at"
    ]
  },
  {
    table: "usage_buckets",
    columns: ["id", "external_id", "household_id", "month", "captures", "receipt_captures", "voice_captures", "conversation_turns", "dashboard_views", "ai_interpretations", "limit_events", "updated_at"]
  },
  { table: "memory_import_batches", columns: ["id", "household_id", "source", "status", "external_household_id", "payload", "error", "created_at", "completed_at"] },
  { table: "memory_store_snapshots", columns: ["household_id", "state", "revision", "updated_at"] }
];

export async function checkSupabaseSchema(
  supabase: SupabaseSchemaClient | undefined | null = createSupabaseServiceClient()
): Promise<SupabaseSchemaCheckResult> {
  if (!supabase) {
    return {
      configured: false,
      ok: false,
      checkedTables: 0,
      securityChecks: [],
      issues: [{ table: "supabase", columns: [], message: "Supabase service env is not configured." }],
      requiredMigrations: [],
      recommendedActions: ["Configure Supabase service env before running live schema/security checks."]
    };
  }

  const issues: SupabaseSchemaIssue[] = [];
  const securityChecks: SupabaseSecurityCheck[] = [];
  for (const check of REQUIRED_SUPABASE_SCHEMA) {
    const { error } = await supabase.from(check.table).select(check.columns.join(",")).limit(1);
    if (error) {
      issues.push({
        table: check.table,
        columns: check.columns,
        message: error.message
      });
    }
  }

  if (typeof supabase.rpc !== "function") {
    securityChecks.push({
      id: "memory_store_snapshots_service_role_only",
      ok: false,
      message: "Could not verify memory_store_snapshots policy hardening because Supabase RPC is unavailable.",
      requiredMigrations: ["004_restrict_snapshot_table_access"],
      recommendedAction: "Redeploy the schema-check route with RPC support and verify migration 004 is applied."
    });
    securityChecks.push({
      id: "household_role_policies",
      ok: false,
      message: "Could not verify household role policies because Supabase RPC is unavailable.",
      requiredMigrations: ["005_harden_household_role_policies", "007_harden_memory_interpretation_writer_policy"],
      recommendedAction: "Redeploy the schema-check route with RPC support and verify migrations 005 and 007 are applied."
    });
    securityChecks.push({
      id: "invites_service_role_only",
      ok: false,
      message: "Could not verify invite policy hardening because Supabase RPC is unavailable.",
      requiredMigrations: ["006_harden_invite_access"],
      recommendedAction: "Redeploy the schema-check route with RPC support and verify migration 006 is applied."
    });
    securityChecks.push({
      id: "invites_atomic_acceptance",
      ok: false,
      message: "Could not verify atomic invite acceptance because Supabase RPC is unavailable.",
      requiredMigrations: ["008_atomic_invite_acceptance"],
      recommendedAction: "Redeploy the schema-check route with RPC support and verify migration 008 is applied."
    });
    securityChecks.push({
      id: "memory_facts_payload_shape",
      ok: false,
      message: "Could not verify memory_facts payload constraints because Supabase RPC is unavailable.",
      requiredMigrations: ["011_harden_memory_fact_payload_constraints"],
      recommendedAction: "Redeploy the schema-check route with RPC support and verify migration 011 is applied."
    });
    securityChecks.push({
      id: "ai_telemetry_shape",
      ok: false,
      message: "Could not verify ai_telemetry_events constraints because Supabase RPC is unavailable.",
      requiredMigrations: ["012_harden_ai_telemetry_constraints"],
      recommendedAction: "Redeploy the schema-check route with RPC support and verify migration 012 is applied."
    });
  } else {
    const { data, error } = await supabase.rpc("sayve_memory_store_snapshot_policy_count");
    const policyCount = typeof data === "number" ? data : Number(data);
    if (error || !Number.isFinite(policyCount)) {
      securityChecks.push({
        id: "memory_store_snapshots_service_role_only",
        ok: false,
        message: `Could not verify memory_store_snapshots policy hardening. ${error?.message ?? "Invalid RPC response."}`,
        requiredMigrations: ["004_restrict_snapshot_table_access"],
        recommendedAction: "Verify migration 004 and the snapshot policy count RPC are both deployed."
      });
    } else {
      securityChecks.push({
        id: "memory_store_snapshots_service_role_only",
        ok: policyCount === 0,
        message:
          policyCount === 0
            ? "memory_store_snapshots has no direct client policies; Sayve API service role owns MemoryStoreState reads/writes."
            : `memory_store_snapshots still has ${policyCount} direct policy/policies. Apply migration 004 before private beta.`,
        requiredMigrations: policyCount === 0 ? [] : ["004_restrict_snapshot_table_access"],
        recommendedAction: policyCount === 0 ? "" : "Apply migration 004 and rerun the live schema check."
      });
    }

    const invitePolicy = await supabase.rpc("sayve_invite_policy_count");
    const invitePolicyCount = typeof invitePolicy.data === "number" ? invitePolicy.data : Number(invitePolicy.data);
    if (invitePolicy.error || !Number.isFinite(invitePolicyCount)) {
      securityChecks.push({
        id: "invites_service_role_only",
        ok: false,
        message: `Could not verify invite policy hardening. ${invitePolicy.error?.message ?? "Invalid RPC response."}`,
        requiredMigrations: ["006_harden_invite_access"],
        recommendedAction: "Verify migration 006 and the invite policy count RPC are both deployed."
      });
    } else {
      securityChecks.push({
        id: "invites_service_role_only",
        ok: invitePolicyCount === 0,
        message:
          invitePolicyCount === 0
            ? "invites has no direct client policies; Sayve API service role owns invite creation and acceptance."
            : `invites still has ${invitePolicyCount} direct policy/policies. Apply migration 006 before private beta.`,
        requiredMigrations: invitePolicyCount === 0 ? [] : ["006_harden_invite_access"],
        recommendedAction: invitePolicyCount === 0 ? "" : "Apply migration 006 and rerun the live schema check."
      });
    }

    const rolePolicy = await supabase.rpc("sayve_household_role_policy_status");
    const broadPolicyCount = numberFromRecord(rolePolicy.data, "broadPolicyCount");
    const writerPolicyCount = numberFromRecord(rolePolicy.data, "writerPolicyCount");
    const interpretationWriterPolicyCount = numberFromRecord(rolePolicy.data, "interpretationWriterPolicyCount");
    if (
      rolePolicy.error ||
      !Number.isFinite(broadPolicyCount) ||
      !Number.isFinite(writerPolicyCount) ||
      !Number.isFinite(interpretationWriterPolicyCount)
    ) {
      securityChecks.push({
        id: "household_role_policies",
        ok: false,
        message: `Could not verify household role policy hardening. ${rolePolicy.error?.message ?? "Invalid RPC response. Apply migration 007 if interpretationWriterPolicyCount is missing."}`,
        requiredMigrations: ["005_harden_household_role_policies", "007_harden_memory_interpretation_writer_policy"],
        recommendedAction: "Verify migrations 005 and 007 plus the household role policy status RPC are all deployed."
      });
    } else {
      const rolePoliciesOk = broadPolicyCount === 0 && writerPolicyCount >= 11 && interpretationWriterPolicyCount === 1;
      securityChecks.push({
        id: "household_role_policies",
        ok: rolePoliciesOk,
        message:
          rolePoliciesOk
            ? "Household RLS policies are role-aware; viewer is read-only and owner/member can write normalized Memory projections."
            : `Household RLS policies are not fully hardened. broadPolicyCount=${broadPolicyCount}, writerPolicyCount=${writerPolicyCount}, interpretationWriterPolicyCount=${interpretationWriterPolicyCount}. Apply migrations 005 and 007 before private beta.`,
        requiredMigrations: rolePoliciesOk ? [] : ["005_harden_household_role_policies", "007_harden_memory_interpretation_writer_policy"],
        recommendedAction: rolePoliciesOk ? "" : "Apply migrations 005 and 007, then rerun the live schema check."
      });
    }

    const inviteAcceptRpc = await supabase.rpc("sayve_invite_accept_rpc_status");
    const acceptFunctionCount = numberFromRecord(inviteAcceptRpc.data, "acceptFunctionCount");
    if (inviteAcceptRpc.error || !Number.isFinite(acceptFunctionCount)) {
      securityChecks.push({
        id: "invites_atomic_acceptance",
        ok: false,
        message: `Could not verify atomic invite acceptance RPC. ${inviteAcceptRpc.error?.message ?? "Invalid RPC response. Apply migration 008."}`,
        requiredMigrations: ["008_atomic_invite_acceptance"],
        recommendedAction: "Verify migration 008 and the invite acceptance RPC are both deployed."
      });
    } else {
      securityChecks.push({
        id: "invites_atomic_acceptance",
        ok: acceptFunctionCount === 1,
        message:
          acceptFunctionCount === 1
            ? "Invite acceptance is handled by a service-role RPC with row locking, so one invite token can only be accepted once."
            : `Atomic invite acceptance RPC is missing or duplicated. acceptFunctionCount=${acceptFunctionCount}. Apply migration 008 before private beta.`,
        requiredMigrations: acceptFunctionCount === 1 ? [] : ["008_atomic_invite_acceptance"],
        recommendedAction: acceptFunctionCount === 1 ? "" : "Apply migration 008 and rerun the live schema check."
      });
    }

    const factPayloadConstraints = await supabase.rpc("sayve_memory_fact_payload_constraint_status");
    const directionConstraintCount = numberFromRecord(factPayloadConstraints.data, "directionConstraintCount");
    const ownershipConstraintCount = numberFromRecord(factPayloadConstraints.data, "ownershipConstraintCount");
    const moneyShapeConstraintCount = numberFromRecord(factPayloadConstraints.data, "moneyShapeConstraintCount");
    if (
      factPayloadConstraints.error ||
      !Number.isFinite(directionConstraintCount) ||
      !Number.isFinite(ownershipConstraintCount) ||
      !Number.isFinite(moneyShapeConstraintCount)
    ) {
      securityChecks.push({
        id: "memory_facts_payload_shape",
        ok: false,
        message: `Could not verify memory_facts payload constraints. ${factPayloadConstraints.error?.message ?? "Invalid RPC response. Apply migration 011."}`,
        requiredMigrations: ["011_harden_memory_fact_payload_constraints"],
        recommendedAction: "Verify migration 011 and the payload constraint RPC are both deployed."
      });
    } else {
      const payloadConstraintsOk = directionConstraintCount === 1 && ownershipConstraintCount === 1 && moneyShapeConstraintCount === 1;
      securityChecks.push({
        id: "memory_facts_payload_shape",
        ok: payloadConstraintsOk,
        message: payloadConstraintsOk
          ? "memory_facts payload constraints are installed; direction, ownershipScope, and money shape are guarded in Postgres."
          : `memory_facts payload constraints are missing. directionConstraintCount=${directionConstraintCount}, ownershipConstraintCount=${ownershipConstraintCount}, moneyShapeConstraintCount=${moneyShapeConstraintCount}. Apply migration 011 before private beta.`,
        requiredMigrations: payloadConstraintsOk ? [] : ["011_harden_memory_fact_payload_constraints"],
        recommendedAction: payloadConstraintsOk ? "" : "Apply migration 011 and rerun the live schema check."
      });
    }

    const telemetryConstraints = await supabase.rpc("sayve_ai_telemetry_constraint_status");
    const phaseConstraintCount = numberFromRecord(telemetryConstraints.data, "phaseConstraintCount");
    const providerConstraintCount = numberFromRecord(telemetryConstraints.data, "providerConstraintCount");
    const statusConstraintCount = numberFromRecord(telemetryConstraints.data, "statusConstraintCount");
    const tokenMetricsConstraintCount = numberFromRecord(telemetryConstraints.data, "tokenMetricsConstraintCount");
    const costLatencyConstraintCount = numberFromRecord(telemetryConstraints.data, "costLatencyConstraintCount");
    if (
      telemetryConstraints.error ||
      !Number.isFinite(phaseConstraintCount) ||
      !Number.isFinite(providerConstraintCount) ||
      !Number.isFinite(statusConstraintCount) ||
      !Number.isFinite(tokenMetricsConstraintCount) ||
      !Number.isFinite(costLatencyConstraintCount)
    ) {
      securityChecks.push({
        id: "ai_telemetry_shape",
        ok: false,
        message: `Could not verify ai_telemetry_events constraints. ${telemetryConstraints.error?.message ?? "Invalid RPC response. Apply migration 012."}`,
        requiredMigrations: ["012_harden_ai_telemetry_constraints"],
        recommendedAction: "Verify migration 012 and the telemetry constraint RPC are both deployed."
      });
    } else {
      const telemetryConstraintsOk =
        phaseConstraintCount === 1 &&
        providerConstraintCount === 1 &&
        statusConstraintCount === 1 &&
        tokenMetricsConstraintCount === 1 &&
        costLatencyConstraintCount === 1;
      securityChecks.push({
        id: "ai_telemetry_shape",
        ok: telemetryConstraintsOk,
        message: telemetryConstraintsOk
          ? "ai_telemetry_events constraints are installed; phase/provider/status and non-negative metrics are guarded in Postgres."
          : `ai_telemetry_events constraints are missing. phaseConstraintCount=${phaseConstraintCount}, providerConstraintCount=${providerConstraintCount}, statusConstraintCount=${statusConstraintCount}, tokenMetricsConstraintCount=${tokenMetricsConstraintCount}, costLatencyConstraintCount=${costLatencyConstraintCount}. Apply migration 012 before private beta.`,
        requiredMigrations: telemetryConstraintsOk ? [] : ["012_harden_ai_telemetry_constraints"],
        recommendedAction: telemetryConstraintsOk ? "" : "Apply migration 012 and rerun the live schema check."
      });
    }
  }

  const mediaBucket = captureMediaBucket();
  if (!mediaBucket) {
    securityChecks.push({
      id: "media_storage_bucket",
      ok: true,
      message: "SUPABASE_MEDIA_BUCKET is not configured; private beta may keep receipt/voice file names only, while Launch Readiness blocks public launch."
    });
  } else if (typeof supabase.storage?.getBucket !== "function") {
    securityChecks.push({
      id: "media_storage_bucket",
      ok: false,
      message: "Could not verify Supabase media storage bucket because the Storage API is unavailable."
    });
  } else {
    const bucket = await supabase.storage.getBucket(mediaBucket);
    const isPublicBucket = bucketPublicFlag(bucket.data);
    const bucketOk = !bucket.error && isPublicBucket === false;
    securityChecks.push({
      id: "media_storage_bucket",
      ok: bucketOk,
      message: bucket.error
        ? `Could not find or access Supabase media storage bucket '${mediaBucket}'. ${bucket.error.message}`
        : isPublicBucket === true
          ? `Supabase media storage bucket '${mediaBucket}' is public. Receipt/voice source files must be stored in a private bucket.`
          : isPublicBucket === false
            ? `Supabase media storage bucket '${mediaBucket}' is private and accessible for receipt/voice source files.`
            : `Could not verify whether Supabase media storage bucket '${mediaBucket}' is private.`
    });
  }

  const requiredMigrations = [...new Set(securityChecks.flatMap((check) => check.ok ? [] : (check.requiredMigrations ?? [])))];
  const recommendedActions = [
    ...new Set(securityChecks.filter((check) => !check.ok).map((check) => check.recommendedAction || check.message)),
  ];

  return {
    configured: true,
    ok: issues.length === 0 && securityChecks.every((check) => check.ok),
    checkedTables: REQUIRED_SUPABASE_SCHEMA.length,
    securityChecks,
    issues,
    requiredMigrations,
    recommendedActions
  };
}
