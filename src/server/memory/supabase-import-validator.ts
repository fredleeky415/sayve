import type { SupabaseImportPlan } from "@/server/memory/supabase-export";
import { FinancialFactPayloadSchema } from "@/shared/memory/types";

export type ValidationIssue = {
  severity: "error" | "warning";
  table: string;
  message: string;
  externalId?: string;
};

export type ValidationResult = {
  valid: boolean;
  issues: ValidationIssue[];
  tableCounts: Record<string, number>;
};

type Row = Record<string, unknown>;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const REQUIRED_TABLES = [
  "households",
  "household_categories",
  "captures",
  "memory_objects",
  "memory_interpretations",
  "memory_facts",
  "household_context",
  "memory_relationships",
  "memory_revisions",
  "insights",
  "conversation_messages",
  "usage_buckets",
  "ai_telemetry_events"
];

function rowsFor(plan: SupabaseImportPlan, table: string): Row[] {
  return (plan.tables[table] ?? []) as Row[];
}

function idSet(plan: SupabaseImportPlan, table: string): Set<string> {
  return new Set(rowsFor(plan, table).map((row) => String(row.external_id ?? "")).filter(Boolean));
}

function addDuplicateIssues(issues: ValidationIssue[], table: string, rows: Row[]) {
  const seen = new Set<string>();
  for (const row of rows) {
    const externalId = String(row.external_id ?? "");
    if (!externalId) {
      issues.push({ severity: "error", table, message: "Missing external_id." });
      continue;
    }
    if (seen.has(externalId)) {
      issues.push({ severity: "error", table, externalId, message: "Duplicate external_id." });
    }
    seen.add(externalId);
  }
}

function addMissingReferenceIssues(input: {
  issues: ValidationIssue[];
  table: string;
  rows: Row[];
  field: string;
  targetTable: string;
  targetIds: Set<string>;
  optional?: boolean;
}) {
  for (const row of input.rows) {
    const value = row[input.field];
    if (!value && input.optional) continue;
    const externalId = String(row.external_id ?? "");
    const targetExternalId = String(value ?? "");
    if (!targetExternalId || !input.targetIds.has(targetExternalId)) {
      input.issues.push({
        severity: "error",
        table: input.table,
        externalId,
        message: `Missing ${input.targetTable} reference from ${input.field}: ${targetExternalId || "(empty)"}.`
      });
    }
  }
}

function addInvalidUuidIssues(input: {
  issues: ValidationIssue[];
  table: string;
  rows: Row[];
  field: string;
}) {
  for (const row of input.rows) {
    const value = row[input.field];
    if (!value) continue;
    const externalId = String(row.external_id ?? "");
    if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
      input.issues.push({
        severity: "error",
        table: input.table,
        externalId,
        message: `${input.field} must be a Supabase auth user UUID when present.`
      });
    }
  }
}

function addRequiredNonNegativeNumberIssues(input: {
  issues: ValidationIssue[];
  table: string;
  rows: Row[];
  field: string;
}) {
  for (const row of input.rows) {
    const value = row[input.field];
    const externalId = String(row.external_id ?? "");
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      input.issues.push({
        severity: "error",
        table: input.table,
        externalId,
        message: `${input.field} must be a non-negative number.`
      });
    }
  }
}

function metadataObject(row: Row): Record<string, unknown> | undefined {
  const metadata = row.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  return metadata as Record<string, unknown>;
}

function addCaptureDecisionTelemetryIssues(issues: ValidationIssue[], rows: Row[]) {
  for (const row of rows) {
    if (row.phase !== "capture_interpretation") continue;
    const externalId = String(row.external_id ?? "");
    const metadata = metadataObject(row);

    if (!row.capture_external_id) {
      issues.push({
        severity: "error",
        table: "ai_telemetry_events",
        externalId,
        message: "capture_interpretation telemetry must include capture_external_id."
      });
    }

    if (!row.memory_object_external_id) {
      issues.push({
        severity: "error",
        table: "ai_telemetry_events",
        externalId,
        message: "capture_interpretation telemetry must include memory_object_external_id."
      });
    }

    if (!metadata) {
      issues.push({
        severity: "error",
        table: "ai_telemetry_events",
        externalId,
        message: "capture_interpretation telemetry metadata must be an object."
      });
      continue;
    }

    const decision = typeof metadata.decision === "string" ? metadata.decision : metadata.memoryStatus;
    const requirements = [
      ["intent", typeof metadata.intent === "string" && metadata.intent.length > 0],
      ["decision", typeof decision === "string" && decision.length > 0],
      ["confidenceBand", typeof metadata.confidenceBand === "string" && metadata.confidenceBand.length > 0],
      ["needsUserInput", typeof metadata.needsUserInput === "boolean"]
    ] as const;

    for (const [field, ok] of requirements) {
      if (!ok) {
        issues.push({
          severity: "error",
          table: "ai_telemetry_events",
          externalId,
          message: `capture_interpretation telemetry metadata.${field} is required for AI Decisions analytics.`
        });
      }
    }
  }
}

function addFinancialFactPayloadIssues(issues: ValidationIssue[], rows: Row[]) {
  for (const row of rows) {
    const externalId = String(row.external_id ?? "");
    const result = FinancialFactPayloadSchema.safeParse(row.payload);
    if (!result.success) {
      const details = result.error.issues.map((issue) => `${issue.path.join(".") || "payload"}: ${issue.message}`).join("; ");
      issues.push({
        severity: "error",
        table: "memory_facts",
        externalId,
        message: `payload must match FinancialFactPayloadSchema. ${details}`
      });
    }
  }
}

export function validateSupabaseImportPlan(plan: SupabaseImportPlan): ValidationResult {
  const issues: ValidationIssue[] = [];
  const tableCounts = Object.fromEntries(REQUIRED_TABLES.map((table) => [table, rowsFor(plan, table).length]));

  if (plan.formatVersion !== "sayve.supabase-import-plan.v1") {
    issues.push({ severity: "error", table: "import_plan", message: `Unsupported format version: ${plan.formatVersion}.` });
  }

  for (const table of REQUIRED_TABLES) {
    if (!Array.isArray(plan.tables[table])) {
      issues.push({ severity: "error", table, message: "Missing table array." });
      continue;
    }
    addDuplicateIssues(issues, table, rowsFor(plan, table));
  }

  const householdIds = idSet(plan, "households");
  const memoryObjectIds = idSet(plan, "memory_objects");
  const captureIds = idSet(plan, "captures");
  const conversationIds = idSet(plan, "conversation_messages");
  const factIds = idSet(plan, "memory_facts");
  const contextIds = idSet(plan, "household_context");
  const insightIds = idSet(plan, "insights");

  for (const table of REQUIRED_TABLES.filter((table) => table !== "households" && table !== "memory_interpretations")) {
    addMissingReferenceIssues({
      issues,
      table,
      rows: rowsFor(plan, table),
      field: "household_external_id",
      targetTable: "households",
      targetIds: householdIds
    });
  }

  for (const table of ["memory_interpretations", "memory_facts", "memory_revisions"]) {
    addMissingReferenceIssues({
      issues,
      table,
      rows: rowsFor(plan, table),
      field: "memory_object_external_id",
      targetTable: "memory_objects",
      targetIds: memoryObjectIds
    });
  }

  addMissingReferenceIssues({
    issues,
    table: "ai_telemetry_events",
    rows: rowsFor(plan, "ai_telemetry_events"),
    field: "capture_external_id",
    targetTable: "captures",
    targetIds: captureIds,
    optional: true
  });

  addMissingReferenceIssues({
    issues,
    table: "ai_telemetry_events",
    rows: rowsFor(plan, "ai_telemetry_events"),
    field: "memory_object_external_id",
    targetTable: "memory_objects",
    targetIds: memoryObjectIds,
    optional: true
  });

  addMissingReferenceIssues({
    issues,
    table: "ai_telemetry_events",
    rows: rowsFor(plan, "ai_telemetry_events"),
    field: "conversation_message_external_id",
    targetTable: "conversation_messages",
    targetIds: conversationIds,
    optional: true
  });

  for (const relationship of rowsFor(plan, "memory_relationships")) {
    const externalId = String(relationship.external_id ?? "");
    const fromType = String(relationship.from_type ?? "");
    const toType = String(relationship.to_type ?? "");
    const fromTarget = { capture: captureIds, memory: memoryObjectIds, fact: factIds, context: contextIds, insight: insightIds, conversation: conversationIds }[
      fromType
    ];
    const toTarget = { capture: captureIds, memory: memoryObjectIds, fact: factIds, context: contextIds, insight: insightIds, conversation: conversationIds }[
      toType
    ];
    if (!fromTarget?.has(String(relationship.from_external_id ?? ""))) {
      issues.push({ severity: "error", table: "memory_relationships", externalId, message: "Missing from_external_id target." });
    }
    if (!toTarget?.has(String(relationship.to_external_id ?? ""))) {
      issues.push({ severity: "error", table: "memory_relationships", externalId, message: "Missing to_external_id target." });
    }
  }

  addInvalidUuidIssues({ issues, table: "captures", rows: rowsFor(plan, "captures"), field: "created_by" });
  addInvalidUuidIssues({ issues, table: "household_categories", rows: rowsFor(plan, "household_categories"), field: "created_by_user_id" });
  addInvalidUuidIssues({ issues, table: "conversation_messages", rows: rowsFor(plan, "conversation_messages"), field: "created_by" });
  addInvalidUuidIssues({ issues, table: "memory_revisions", rows: rowsFor(plan, "memory_revisions"), field: "actor_user_id" });
  addFinancialFactPayloadIssues(issues, rowsFor(plan, "memory_facts"));
  for (const field of ["total_tokens", "estimated_cost_usd", "duration_ms"]) {
    addRequiredNonNegativeNumberIssues({
      issues,
      table: "ai_telemetry_events",
      rows: rowsFor(plan, "ai_telemetry_events"),
      field
    });
  }
  addCaptureDecisionTelemetryIssues(issues, rowsFor(plan, "ai_telemetry_events"));

  return {
    valid: issues.every((issue) => issue.severity !== "error"),
    issues,
    tableCounts
  };
}
