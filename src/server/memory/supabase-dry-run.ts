import { buildSupabaseImportPlanAsync, type SupabaseImportPlan } from "@/server/memory/supabase-export";
import { validateSupabaseImportPlan, type ValidationResult } from "@/server/memory/supabase-import-validator";
import { createSupabaseServiceClient } from "@/server/supabase/service-client";
import { createHash } from "node:crypto";

type TableDryRun = {
  rowsInPlan: number;
  existingRows: number;
  rowsToInsert: number;
  sampleExistingExternalIds: string[];
  sampleInsertExternalIds: string[];
};

export type DryRunResult = {
  configured: boolean;
  valid: boolean;
  validation: ValidationResult;
  tables: Record<string, TableDryRun>;
  planSignature: string;
  error?: string;
};

type RowWithExternalId = {
  external_id?: string;
};

const QUERYABLE_TABLES = [
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

function externalIdsFor(plan: SupabaseImportPlan, table: string): string[] {
  return ((plan.tables[table] ?? []) as RowWithExternalId[]).map((row) => row.external_id).filter((id): id is string => Boolean(id));
}

function emptyTableResult(plan: SupabaseImportPlan): Record<string, TableDryRun> {
  return Object.fromEntries(
    QUERYABLE_TABLES.map((table) => {
      const externalIds = externalIdsFor(plan, table);
      return [
        table,
        {
          rowsInPlan: externalIds.length,
          existingRows: 0,
          rowsToInsert: externalIds.length,
          sampleExistingExternalIds: [],
          sampleInsertExternalIds: externalIds.slice(0, 5)
        }
      ];
    })
  );
}

function createPlanSignature(input: {
  source: string;
  valid: boolean;
  tableCounts: Record<string, TableDryRun>;
}): string {
  const payload = {
    source: input.source,
    valid: input.valid,
    tables: Object.fromEntries(
      Object.entries(input.tableCounts)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([table, summary]) => [
          table,
          {
            rowsInPlan: summary.rowsInPlan,
            existingRows: summary.existingRows,
            rowsToInsert: summary.rowsToInsert,
            sampleExistingExternalIds: summary.sampleExistingExternalIds,
            sampleInsertExternalIds: summary.sampleInsertExternalIds
          }
        ])
    )
  };

  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export async function dryRunSupabaseImport(plan?: SupabaseImportPlan): Promise<DryRunResult> {
  const importPlan = plan ?? (await buildSupabaseImportPlanAsync());
  const validation = validateSupabaseImportPlan(importPlan);
  const supabase = createSupabaseServiceClient();
  if (!supabase || !validation.valid) {
    const tables = emptyTableResult(importPlan);
    return {
      configured: Boolean(supabase),
      valid: validation.valid,
      validation,
      tables,
      planSignature: createPlanSignature({
        source: importPlan.source,
        valid: validation.valid,
        tableCounts: tables
      }),
      error: !supabase ? "Supabase service env is not configured." : "Import plan failed validation."
    };
  }

  const tables: Record<string, TableDryRun> = {};
  for (const table of QUERYABLE_TABLES) {
    const externalIds = externalIdsFor(importPlan, table);
    if (externalIds.length === 0) {
      tables[table] = {
        rowsInPlan: 0,
        existingRows: 0,
        rowsToInsert: 0,
        sampleExistingExternalIds: [],
        sampleInsertExternalIds: []
      };
      continue;
    }

    const { data, error } = await supabase.from(table).select("external_id").in("external_id", externalIds);
    if (error) {
      return {
        configured: true,
        valid: false,
        validation,
        tables,
        planSignature: createPlanSignature({
          source: importPlan.source,
          valid: false,
          tableCounts: tables
        }),
        error: `Could not query ${table}. Check migrations and service-role access. ${error.message}`
      };
    }

    const existing = new Set((data ?? []).map((row) => String(row.external_id)).filter(Boolean));
    const toInsert = externalIds.filter((externalId) => !existing.has(externalId));
    tables[table] = {
      rowsInPlan: externalIds.length,
      existingRows: existing.size,
      rowsToInsert: toInsert.length,
      sampleExistingExternalIds: [...existing].slice(0, 5),
      sampleInsertExternalIds: toInsert.slice(0, 5)
    };
  }

  return {
    configured: true,
    valid: true,
    validation,
    tables,
    planSignature: createPlanSignature({
      source: importPlan.source,
      valid: true,
      tableCounts: tables
    })
  };
}
