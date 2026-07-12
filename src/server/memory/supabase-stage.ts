import { buildSupabaseImportPlan, buildSupabaseImportPlanAsync } from "@/server/memory/supabase-export";
import { dryRunSupabaseImport } from "@/server/memory/supabase-dry-run";
import { validateSupabaseImportPlan } from "@/server/memory/supabase-import-validator";
import { createSupabaseServiceClient } from "@/server/supabase/service-client";

type StageResult = {
  configured: boolean;
  staged: boolean;
  batchId?: string;
  tableCounts?: Record<string, number>;
  validation?: ReturnType<typeof validateSupabaseImportPlan>;
  dryRun?: Awaited<ReturnType<typeof dryRunSupabaseImport>>;
  error?: string;
};

function tableCounts(plan: ReturnType<typeof buildSupabaseImportPlan>): Record<string, number> {
  return Object.fromEntries(Object.entries(plan.tables).map(([table, rows]) => [table, rows.length]));
}

export async function stageCurrentMemoryForSupabase(): Promise<StageResult> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return {
      configured: false,
      staged: false,
      error: "Supabase service env is not configured."
    };
  }

  const plan = await buildSupabaseImportPlanAsync();
  const validation = validateSupabaseImportPlan(plan);
  const dryRun = await dryRunSupabaseImport(plan);
  if (!validation.valid) {
    return {
      configured: true,
      staged: false,
      tableCounts: validation.tableCounts,
      validation,
      dryRun,
      error: "Import plan failed validation."
    };
  }

  const households = plan.tables.households as Array<{ external_id?: string }>;
  const externalHouseholdId = households[0]?.external_id ?? "household_demo";
  const { data, error } = await supabase
    .from("memory_import_batches")
    .insert({
      source: plan.source,
      status: "staged",
      external_household_id: externalHouseholdId,
      payload: plan
    })
    .select("id")
    .single();

  if (error) {
    return {
      configured: true,
      staged: false,
      tableCounts: tableCounts(plan),
      validation,
      dryRun,
      error: error.message
    };
  }

  return {
    configured: true,
    staged: true,
    batchId: data?.id,
    tableCounts: tableCounts(plan),
    validation,
    dryRun
  };
}
