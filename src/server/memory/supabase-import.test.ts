import { beforeEach, describe, expect, it } from "vitest";
import { captureMemory, correctMemory, resetStore } from "./test-helpers";
import { buildSupabaseImportPlan, type SupabaseImportPlan } from "./supabase-export";
import { validateSupabaseImportPlan } from "./supabase-import-validator";
import { dryRunSupabaseImport } from "./supabase-dry-run";
import { checkSupabaseSchema } from "./supabase-schema-check";
import { addHouseholdCategory } from "./categories";
import { applySupabaseImportPlan, loadCurrentMemoryIntoSupabase } from "./supabase-load";

function schemaMock(
  failingTable?: string,
  policyCount = 0,
  rolePolicyStatus: Record<string, number> = { broadPolicyCount: 0, writerPolicyCount: 11, interpretationWriterPolicyCount: 1 },
  invitePolicyCount = 0,
  inviteAcceptFunctionCount = 1,
  factPayloadConstraintStatus: Record<string, number> = { directionConstraintCount: 1, ownershipConstraintCount: 1, moneyShapeConstraintCount: 1 },
  telemetryConstraintStatus: Record<string, number> = {
    phaseConstraintCount: 1,
    providerConstraintCount: 1,
    statusConstraintCount: 1,
    tokenMetricsConstraintCount: 1,
    costLatencyConstraintCount: 1
  },
  mediaBucketError?: { message: string },
  mediaBucketPublic = false
) {
  return {
    storage: {
      async getBucket() {
        return { data: mediaBucketError ? null : { id: process.env.SUPABASE_MEDIA_BUCKET, public: mediaBucketPublic }, error: mediaBucketError ?? null };
      }
    },
    async rpc(fn: string) {
      if (fn === "sayve_memory_store_snapshot_policy_count") return { data: policyCount, error: null };
      if (fn === "sayve_household_role_policy_status") return { data: rolePolicyStatus, error: null };
      if (fn === "sayve_invite_policy_count") return { data: invitePolicyCount, error: null };
      if (fn === "sayve_invite_accept_rpc_status") return { data: { acceptFunctionCount: inviteAcceptFunctionCount }, error: null };
      if (fn === "sayve_memory_fact_payload_constraint_status") return { data: factPayloadConstraintStatus, error: null };
      if (fn === "sayve_ai_telemetry_constraint_status") return { data: telemetryConstraintStatus, error: null };
      return { data: null, error: { message: `unknown rpc ${fn}` } };
    },
    from(table: string) {
      return {
        select(columns: string) {
          return {
            async limit() {
              if (table === failingTable) {
                return { data: null, error: { message: `missing column while selecting ${columns}` } };
              }
              return { data: [], error: null };
            }
          };
        }
      };
    }
  };
}

function loaderMock(seed: Record<string, Array<Record<string, unknown>>> = {}) {
  const tables: Record<string, Array<Record<string, unknown>>> = structuredClone(seed);
  let idCounter = 0;

  return {
    tables,
    from(table: string) {
      tables[table] ??= [];
      return {
        select() {
          return {
            async in(field: string, ids: string[]) {
              const idSet = new Set(ids);
              return {
                data: tables[table]!
                  .filter((row) => idSet.has(String(row[field] ?? "")))
                  .map((row) => ({ id: row.id, external_id: row.external_id })),
                error: null
              };
            }
          };
        },
        insert(rows: Record<string, unknown>[]) {
          const inserted: Array<Record<string, unknown> & { id: string }> = rows.map((row) => ({
            id: `${table}_${++idCounter}`,
            ...row
          }));
          tables[table]!.push(...inserted);
          return {
            async select() {
              return {
                data: inserted.map((row) => ({ id: row.id, external_id: row.external_id })),
                error: null
              };
            }
          };
        }
      };
    }
  };
}

describe("Supabase import path", () => {
  beforeEach(() => {
    resetStore();
    delete process.env.SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_MEDIA_BUCKET;
  });

  it("exports a valid import plan with prototype ids preserved as external ids", async () => {
    await captureMemory({ sourceType: "text", text: "今日喺大家樂食飯 HK$300" });

    const plan = buildSupabaseImportPlan();
    const validation = validateSupabaseImportPlan(plan);
    const memory = (plan.tables.memory_objects as Array<{ external_id?: string }>)[0];
    const fact = (plan.tables.memory_facts as Array<{ memory_object_external_id?: string; payload?: { ownershipScope?: string } }>)[0];

    expect(validation.valid).toBe(true);
    expect(memory.external_id).toMatch(/^mem_/);
    expect(fact.memory_object_external_id).toBe(memory.external_id);
    expect(fact.payload?.ownershipScope).toBe("shared");
  });

  it("exports revision actor user ids when they are Supabase UUIDs", async () => {
    const actorUserId = "00000000-0000-4000-8000-000000000123";
    const captured = await captureMemory({ sourceType: "text", text: "屋企雜費 HK$99" });
    await correctMemory({
      memoryObjectId: String(captured.memory_object_id),
      actorUserId,
      action: "category",
      value: "Utilities",
      correction: "應該係 Utilities"
    });

    const plan = buildSupabaseImportPlan();
    const revision = (plan.tables.memory_revisions as Array<{ actor_user_id?: string; diff?: { actorUserId?: string } }>).find(
      (row) => row.actor_user_id === actorUserId
    );

    expect(revision?.actor_user_id).toBe(actorUserId);
    expect(revision?.diff?.actorUserId).toBe(actorUserId);
  });

  it("does not project prototype member labels into Supabase auth foreign-key columns", async () => {
    await captureMemory({ sourceType: "text", text: "今日百佳 HK$80", actorUserId: "lan" });

    const plan = buildSupabaseImportPlan();
    const capture = (plan.tables.captures as Array<{ created_by?: string; metadata?: { actorUserId?: string } }>)[0];
    const validation = validateSupabaseImportPlan(plan);

    expect(capture?.created_by).toBeUndefined();
    expect(capture?.metadata?.actorUserId).toBe("lan");
    expect(validation.valid).toBe(true);
  });

  it("exports category actor user ids only when they are Supabase UUIDs", () => {
    const actorUserId = "00000000-0000-4000-8000-000000000456";
    addHouseholdCategory({ householdId: "household_lee", name: "BB 學費", actorUserId });
    addHouseholdCategory({ householdId: "household_lee", name: "Prototype Label Category", actorUserId: "lan" });

    const plan = buildSupabaseImportPlan();
    const validation = validateSupabaseImportPlan(plan);
    const categories = plan.tables.household_categories as Array<{
      name?: string;
      created_by?: string;
      created_by_user_id?: string;
    }>;

    expect(categories.find((category) => category.name === "BB 學費")?.created_by).toBe("user");
    expect(categories.find((category) => category.name === "BB 學費")?.created_by_user_id).toBe(actorUserId);
    expect(categories.find((category) => category.name === "Prototype Label Category")?.created_by_user_id).toBeUndefined();
    expect(validation.valid).toBe(true);
  });

  it("rejects invalid Supabase auth foreign-key ids in import plans", async () => {
    await captureMemory({ sourceType: "text", text: "今日百佳 HK$80" });

    const plan = structuredClone(buildSupabaseImportPlan()) as SupabaseImportPlan;
    const captures = plan.tables.captures as Array<{ created_by?: string }>;
    captures[0]!.created_by = "lan";

    const validation = validateSupabaseImportPlan(plan);

    expect(validation.valid).toBe(false);
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "captures",
          message: "created_by must be a Supabase auth user UUID when present."
        })
      ])
    );
  });

  it("rejects telemetry rows without complete token cost and latency metrics", async () => {
    await captureMemory({ sourceType: "text", text: "今日百佳 HK$80" });

    const plan = structuredClone(buildSupabaseImportPlan()) as SupabaseImportPlan;
    const telemetry = plan.tables.ai_telemetry_events as Array<{ duration_ms?: number; estimated_cost_usd?: number }>;
    delete telemetry[0]!.duration_ms;
    telemetry[0]!.estimated_cost_usd = -1;

    const validation = validateSupabaseImportPlan(plan);

    expect(validation.valid).toBe(false);
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "ai_telemetry_events",
          message: "duration_ms must be a non-negative number."
        }),
        expect.objectContaining({
          table: "ai_telemetry_events",
          message: "estimated_cost_usd must be a non-negative number."
        })
      ])
    );
  });

  it("rejects capture interpretation telemetry without AI decision metadata", async () => {
    await captureMemory({ sourceType: "text", text: "今日百佳 HK$80" });

    const plan = structuredClone(buildSupabaseImportPlan()) as SupabaseImportPlan;
    const telemetry = plan.tables.ai_telemetry_events as Array<{
      phase?: string;
      capture_external_id?: string;
      metadata?: Record<string, unknown>;
    }>;
    const captureEvent = telemetry.find((event) => event.phase === "capture_interpretation");
    expect(captureEvent).toBeTruthy();
    delete captureEvent!.capture_external_id;
    captureEvent!.metadata = {
      intent: "financial_event",
      confidenceBand: "high"
    };

    const validation = validateSupabaseImportPlan(plan);

    expect(validation.valid).toBe(false);
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "ai_telemetry_events",
          message: "capture_interpretation telemetry must include capture_external_id."
        }),
        expect.objectContaining({
          table: "ai_telemetry_events",
          message: "capture_interpretation telemetry metadata.decision is required for AI Decisions analytics."
        }),
        expect.objectContaining({
          table: "ai_telemetry_events",
          message: "capture_interpretation telemetry metadata.needsUserInput is required for AI Decisions analytics."
        })
      ])
    );
  });

  it("rejects invalid financial fact payloads before Supabase staging", async () => {
    await captureMemory({ sourceType: "text", text: "今日百佳 HK$80" });

    const plan = structuredClone(buildSupabaseImportPlan()) as SupabaseImportPlan;
    const facts = plan.tables.memory_facts as Array<{ payload?: { ownershipScope?: string; direction?: string; money?: { amount?: unknown } } }>;
    facts[0]!.payload = {
      ...facts[0]!.payload,
      ownershipScope: "fred",
      direction: "spent",
      money: { amount: "80" }
    };

    const validation = validateSupabaseImportPlan(plan);

    expect(validation.valid).toBe(false);
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "memory_facts",
          message: expect.stringContaining("payload must match FinancialFactPayloadSchema")
        })
      ])
    );
    expect(validation.issues.map((issue) => issue.message).join("\n")).toContain("ownershipScope");
  });

  it("blocks plans with broken relationship references before staging", async () => {
    await captureMemory({ sourceType: "text", text: "今日喺大家樂食飯 HK$300" });

    const plan = structuredClone(buildSupabaseImportPlan()) as SupabaseImportPlan;
    const relationships = plan.tables.memory_relationships as Array<{ to_external_id?: string }>;
    relationships[0]!.to_external_id = "missing_memory";

    const validation = validateSupabaseImportPlan(plan);

    expect(validation.valid).toBe(false);
    expect(validation.issues.some((issue) => issue.table === "memory_relationships")).toBe(true);
  });

  it("dry-runs locally without Supabase env", async () => {
    await captureMemory({ sourceType: "text", text: "今日喺大家樂食飯 HK$300" });

    const result = await dryRunSupabaseImport();

    expect(result.configured).toBe(false);
    expect(result.valid).toBe(true);
    expect(result.planSignature).toHaveLength(64);
    expect(result.tables.memory_objects.rowsToInsert).toBeGreaterThan(0);
  });

  it("requires the latest dry-run plan signature before loading normalized tables", async () => {
    await captureMemory({ sourceType: "text", text: "今日百佳 HK$80" });

    const missingConfirmation = await loadCurrentMemoryIntoSupabase();
    expect(missingConfirmation.loaded).toBe(false);
    expect(missingConfirmation.requiresConfirmation).toBe(true);
    expect(missingConfirmation.planSignature).toHaveLength(64);

    const staleConfirmation = await loadCurrentMemoryIntoSupabase({
      confirmLoad: true,
      planSignature: "stale-signature"
    });
    expect(staleConfirmation.loaded).toBe(false);
    expect(staleConfirmation.requiresConfirmation).toBe(true);
    expect(staleConfirmation.error).toContain("Re-run dry-run");
  });

  it("loads a valid import plan into normalized Supabase tables and resolves foreign keys", async () => {
    await captureMemory({ householdId: "household_lee", actorUserId: "00000000-0000-4000-8000-000000000789", sourceType: "text", text: "今日百佳 HK$80" });

    const plan = buildSupabaseImportPlan();
    const client = loaderMock();
    const result = await applySupabaseImportPlan(plan, client as never);

    expect(result.loaded).toBe(true);
    expect(result.insertedCounts?.memory_objects).toBeGreaterThan(0);
    expect(client.tables.memory_facts?.[0]?.household_id).toBe(client.tables.households?.find((row) => row.external_id === "household_lee")?.id);
    expect(client.tables.memory_facts?.[0]?.memory_object_id).toBe(client.tables.memory_objects?.[0]?.id);
    expect(client.tables.memory_facts?.[0]).not.toHaveProperty("memory_object_external_id");
    expect(client.tables.memory_relationships?.[0]?.from_id).toBeTruthy();
    expect(client.tables.ai_telemetry_events?.[0]?.capture_id).toBe(client.tables.captures?.[0]?.id);
    expect(client.tables.ai_telemetry_events?.[0]?.memory_object_id).toBe(client.tables.memory_objects?.[0]?.id);
    expect(client.tables.ai_telemetry_events?.[0]?.metadata).toEqual(
      expect.objectContaining({
        intent: "financial_event",
        decision: "auto_confirmed",
        confidenceBand: "high",
        needsUserInput: false
      })
    );
    expect(client.tables.ai_telemetry_events?.[0]).not.toHaveProperty("capture_external_id");
    expect(client.tables.ai_telemetry_events?.[0]).not.toHaveProperty("memory_object_external_id");

    const second = await applySupabaseImportPlan(plan, client as never);
    const secondInsertedRows = Object.values(second.insertedCounts ?? {}).reduce((total, count) => total + count, 0);

    expect(second.loaded).toBe(true);
    expect(secondInsertedRows).toBe(0);
  });

  it("reports schema check as unconfigured without Supabase env", async () => {
    const result = await checkSupabaseSchema();

    expect(result.configured).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.table).toBe("supabase");
    expect(result.requiredMigrations).toEqual([]);
    expect(result.recommendedActions[0]).toContain("Configure Supabase service env");
  });

  it("checks required Supabase migration tables and columns", async () => {
    const result = await checkSupabaseSchema(schemaMock() as never);

    expect(result.configured).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.checkedTables).toBeGreaterThan(10);
    expect(result.securityChecks).toEqual([
      expect.objectContaining({
        id: "memory_store_snapshots_service_role_only",
        ok: true
      }),
      expect.objectContaining({
        id: "invites_service_role_only",
        ok: true
      }),
      expect.objectContaining({
        id: "household_role_policies",
        ok: true
      }),
      expect.objectContaining({
        id: "invites_atomic_acceptance",
        ok: true
      }),
      expect.objectContaining({
        id: "memory_facts_payload_shape",
        ok: true
      }),
      expect.objectContaining({
        id: "ai_telemetry_shape",
        ok: true
      }),
      expect.objectContaining({
        id: "media_storage_bucket",
        ok: true
      })
    ]);
  });

  it("reports missing live Supabase schema columns before deployment smoke", async () => {
    const result = await checkSupabaseSchema(schemaMock("captures") as never);

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "captures"
        })
      ])
    );
  });

  it("fails live Supabase schema check when snapshot client policies are still present", async () => {
    const result = await checkSupabaseSchema(schemaMock(undefined, 1) as never);

    expect(result.ok).toBe(false);
    expect(result.securityChecks).toEqual([
      expect.objectContaining({
        id: "memory_store_snapshots_service_role_only",
        ok: false
      }),
      expect.objectContaining({
        id: "invites_service_role_only",
        ok: true
      }),
      expect.objectContaining({
        id: "household_role_policies",
        ok: true
      }),
      expect.objectContaining({
        id: "invites_atomic_acceptance",
        ok: true
      }),
      expect.objectContaining({
        id: "memory_facts_payload_shape",
        ok: true
      }),
      expect.objectContaining({
        id: "ai_telemetry_shape",
        ok: true
      }),
      expect.objectContaining({
        id: "media_storage_bucket",
        ok: true
      })
    ]);
    expect(result.securityChecks[0]?.message).toContain("Apply migration 004");
  });

  it("fails live Supabase schema check when household role policies are not hardened", async () => {
    const result = await checkSupabaseSchema(schemaMock(undefined, 0, { broadPolicyCount: 1, writerPolicyCount: 0, interpretationWriterPolicyCount: 0 }) as never);

    expect(result.ok).toBe(false);
    expect(result.securityChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "household_role_policies",
          ok: false
        })
      ])
    );
    expect(result.securityChecks.find((check) => check.id === "household_role_policies")?.message).toContain("005");
    expect(result.securityChecks.find((check) => check.id === "household_role_policies")?.requiredMigrations).toEqual([
      "005_harden_household_role_policies",
      "007_harden_memory_interpretation_writer_policy"
    ]);
    expect(result.requiredMigrations).toEqual(
      expect.arrayContaining(["005_harden_household_role_policies", "007_harden_memory_interpretation_writer_policy"])
    );
  });

  it("fails live Supabase schema check when interpretation writer policy is missing", async () => {
    const result = await checkSupabaseSchema(schemaMock(undefined, 0, { broadPolicyCount: 0, writerPolicyCount: 10, interpretationWriterPolicyCount: 0 }) as never);

    expect(result.ok).toBe(false);
    expect(result.securityChecks.find((check) => check.id === "household_role_policies")).toEqual(
      expect.objectContaining({
        ok: false
      })
    );
    expect(result.securityChecks.find((check) => check.id === "household_role_policies")?.message).toContain("007");
  });

  it("fails live Supabase schema check when role policy RPC is still pre-migration-007", async () => {
    const result = await checkSupabaseSchema(schemaMock(undefined, 0, { broadPolicyCount: 0, writerPolicyCount: 11 }) as never);

    expect(result.ok).toBe(false);
    expect(result.securityChecks.find((check) => check.id === "household_role_policies")).toEqual(
      expect.objectContaining({
        ok: false
      })
    );
    expect(result.securityChecks.find((check) => check.id === "household_role_policies")?.message).toContain("007");
  });

  it("fails live Supabase schema check when invite client policies are still present", async () => {
    const result = await checkSupabaseSchema(schemaMock(undefined, 0, { broadPolicyCount: 0, writerPolicyCount: 11, interpretationWriterPolicyCount: 1 }, 1) as never);

    expect(result.ok).toBe(false);
    expect(result.securityChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "invites_service_role_only",
          ok: false
        })
      ])
    );
    expect(result.securityChecks.find((check) => check.id === "invites_service_role_only")?.message).toContain("Apply migration 006");
  });

  it("fails live Supabase schema check when atomic invite acceptance RPC is missing", async () => {
    const result = await checkSupabaseSchema(
      schemaMock(undefined, 0, { broadPolicyCount: 0, writerPolicyCount: 11, interpretationWriterPolicyCount: 1 }, 0, 0) as never
    );

    expect(result.ok).toBe(false);
    expect(result.securityChecks.find((check) => check.id === "invites_atomic_acceptance")).toEqual(
      expect.objectContaining({
        ok: false
      })
    );
    expect(result.securityChecks.find((check) => check.id === "invites_atomic_acceptance")?.message).toContain("Apply migration 008");
  });

  it("fails live Supabase schema check when memory fact payload constraints are missing", async () => {
    const result = await checkSupabaseSchema(
      schemaMock(
        undefined,
        0,
        { broadPolicyCount: 0, writerPolicyCount: 11, interpretationWriterPolicyCount: 1 },
        0,
        1,
        { directionConstraintCount: 1, ownershipConstraintCount: 0, moneyShapeConstraintCount: 1 }
      ) as never
    );

    expect(result.ok).toBe(false);
    expect(result.securityChecks.find((check) => check.id === "memory_facts_payload_shape")).toEqual(
      expect.objectContaining({
        ok: false
      })
    );
    expect(result.securityChecks.find((check) => check.id === "memory_facts_payload_shape")?.message).toContain("migration 011");
  });

  it("fails live Supabase schema check when AI telemetry constraints are missing", async () => {
    const result = await checkSupabaseSchema(
      schemaMock(
        undefined,
        0,
        { broadPolicyCount: 0, writerPolicyCount: 11, interpretationWriterPolicyCount: 1 },
        0,
        1,
        { directionConstraintCount: 1, ownershipConstraintCount: 1, moneyShapeConstraintCount: 1 },
        { phaseConstraintCount: 1, providerConstraintCount: 1, statusConstraintCount: 1, tokenMetricsConstraintCount: 0, costLatencyConstraintCount: 1 }
      ) as never
    );

    expect(result.ok).toBe(false);
    expect(result.securityChecks.find((check) => check.id === "ai_telemetry_shape")).toEqual(
      expect.objectContaining({
        ok: false
      })
    );
    expect(result.securityChecks.find((check) => check.id === "ai_telemetry_shape")?.message).toContain("migration 012");
  });

  it("verifies the configured Supabase media storage bucket", async () => {
    process.env.SUPABASE_MEDIA_BUCKET = "sayve-capture-media";

    const result = await checkSupabaseSchema(schemaMock() as never);

    expect(result.ok).toBe(true);
    expect(result.securityChecks.find((check) => check.id === "media_storage_bucket")).toEqual(
      expect.objectContaining({
        ok: true,
        message: expect.stringContaining("private")
      })
    );
  });

  it("fails live Supabase schema check when the configured media bucket is public", async () => {
    process.env.SUPABASE_MEDIA_BUCKET = "sayve-capture-media";

    const result = await checkSupabaseSchema(
      schemaMock(
        undefined,
        0,
        { broadPolicyCount: 0, writerPolicyCount: 11, interpretationWriterPolicyCount: 1 },
        0,
        1,
        { directionConstraintCount: 1, ownershipConstraintCount: 1, moneyShapeConstraintCount: 1 },
        { phaseConstraintCount: 1, providerConstraintCount: 1, statusConstraintCount: 1, tokenMetricsConstraintCount: 1, costLatencyConstraintCount: 1 },
        undefined,
        true
      ) as never
    );

    expect(result.ok).toBe(false);
    expect(result.securityChecks.find((check) => check.id === "media_storage_bucket")).toEqual(
      expect.objectContaining({
        ok: false,
        message: expect.stringContaining("public")
      })
    );
  });

  it("fails live Supabase schema check when the configured media bucket is missing", async () => {
    process.env.SUPABASE_MEDIA_BUCKET = "sayve-capture-media";

    const result = await checkSupabaseSchema(
      schemaMock(
        undefined,
        0,
        { broadPolicyCount: 0, writerPolicyCount: 11, interpretationWriterPolicyCount: 1 },
        0,
        1,
        { directionConstraintCount: 1, ownershipConstraintCount: 1, moneyShapeConstraintCount: 1 },
        { phaseConstraintCount: 1, providerConstraintCount: 1, statusConstraintCount: 1, tokenMetricsConstraintCount: 1, costLatencyConstraintCount: 1 },
        { message: "Bucket not found" }
      ) as never
    );

    expect(result.ok).toBe(false);
    expect(result.securityChecks.find((check) => check.id === "media_storage_bucket")).toEqual(
      expect.objectContaining({
        ok: false,
        message: expect.stringContaining("Bucket not found")
      })
    );
  });
});
