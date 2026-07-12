import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { combineMemoryStoreStates, getFounderConsoleData, getFounderIntegrationBundle, getFounderLiveProofBundle, getFounderSetupBundle, getFounderViewRows } from "./founder-console";
import { getMemoryRepository, resetStore, type MemoryStoreState } from "@/server/memory/store";
import { recordAiTelemetry } from "@/server/memory/telemetry";
import { addHouseholdCategory } from "@/server/memory/categories";

function emptyState(): MemoryStoreState {
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

function mockMigrationInspection(overrides: Record<string, unknown> = {}) {
  return async () => ({
    validation: { valid: true, issues: [], tableCounts: {} },
    dryRun: { configured: true, valid: true, validation: { valid: true, issues: [], tableCounts: {} }, tables: {}, planSignature: "" },
    applied: {
      configured: true,
      accessible: true,
      ok: true,
      rows: [],
      missingVersions: [],
      unexpectedRemoteVersions: []
    },
    ...overrides
  });
}

describe("Founder Console", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("can combine multiple household snapshots into one founder view", () => {
    const householdA = emptyState();
    householdA.captures.push({
      id: "cap_a",
      householdId: "household_a",
      sourceType: "text",
      rawText: "A",
      fileRefs: [],
      metadata: {},
      createdAt: "2026-07-06T00:00:00.000Z"
    });

    const householdB = emptyState();
    householdB.captures.push({
      id: "cap_b",
      householdId: "household_b",
      sourceType: "voice",
      transcript: "B",
      fileRefs: [],
      metadata: {},
      createdAt: "2026-07-06T00:00:00.000Z"
    });

    const combined = combineMemoryStoreStates([householdA, householdB]);

    expect(combined.captures.map((capture) => capture.householdId)).toEqual(["household_a", "household_b"]);
  });

  it("surfaces AI runtime health from telemetry", async () => {
    resetStore();
    recordAiTelemetry({
      householdId: "household_a",
      phase: "receipt_vision",
      model: "vision-test",
      provider: "system",
      sourceType: "receipt",
      status: "fallback",
      totalTokens: 0,
      estimatedCostUsd: 0,
      durationMs: 120,
      metadata: { reason: "receipt_vision_unavailable" }
    });
    recordAiTelemetry({
      householdId: "household_a",
      phase: "capture_interpretation",
      model: "capture-test",
      provider: "heuristic",
      status: "success",
      totalTokens: 10,
      estimatedCostUsd: 0,
      durationMs: 20,
      metadata: {
        outputBudgetTokens: 220
      }
    });

    const data = await getFounderConsoleData();

    expect(data.aiRuntimeHealth.totalAiEvents).toBe(2);
    expect(data.aiRuntimeHealth.openAiEvents).toBe(0);
    expect(data.aiRuntimeHealth.openAiSuccessRate).toBe(0);
    expect(data.aiRuntimeHealth.openAiFallbackRate).toBe(0);
    expect(data.aiRuntimeHealth.openAiErrorEvents).toBe(0);
    expect(data.aiRuntimeHealth.fallbackRate).toBe(50);
    expect(data.aiRuntimeHealth.averageDurationMs).toBe(70);
    expect(data.aiRuntimeHealth.slowestPhase).toBe("receipt_vision");
    expect(data.aiRuntimeHealth.telemetryCompletenessPercent).toBe(100);
    expect(data.aiRuntimeHealth.budgetCoveragePercent).toBe(100);
    expect(data.aiRuntimeHealth.budgetOverrunEvents).toBe(0);
    expect(data.aiRuntimeHealth.missingTokenEvents).toBe(0);
    expect(data.aiRuntimeHealth.missingCostEvents).toBe(0);
    expect(data.aiRuntimeHealth.missingDurationEvents).toBe(0);
  });

  it("surfaces incomplete AI telemetry so founder can fix instrumentation", async () => {
    resetStore();
    recordAiTelemetry({
      householdId: "household_a",
      phase: "capture_interpretation",
      model: "capture-test",
      provider: "heuristic",
      status: "success",
      metadata: {}
    });

    const data = await getFounderConsoleData();

    expect(data.aiRuntimeHealth.totalAiEvents).toBe(1);
    expect(data.aiRuntimeHealth.telemetryCompletenessPercent).toBe(0);
    expect(data.aiRuntimeHealth.budgetCoveragePercent).toBe(0);
    expect(data.aiRuntimeHealth.budgetOverrunEvents).toBe(0);
    expect(data.aiRuntimeHealth.missingTokenEvents).toBe(1);
    expect(data.aiRuntimeHealth.missingCostEvents).toBe(1);
    expect(data.aiRuntimeHealth.missingDurationEvents).toBe(1);
  });

  it("surfaces output-budget coverage and overruns for short-answer discipline", async () => {
    resetStore();
    recordAiTelemetry({
      householdId: "household_a",
      phase: "capture_interpretation",
      model: "capture-test",
      provider: "openai",
      status: "success",
      completionTokens: 180,
      totalTokens: 220,
      estimatedCostUsd: 0.001,
      durationMs: 40,
      metadata: {
        outputBudgetTokens: 220
      }
    });
    recordAiTelemetry({
      householdId: "household_a",
      phase: "conversation_answer",
      model: "conversation-test",
      provider: "openai",
      status: "success",
      completionTokens: 160,
      totalTokens: 260,
      estimatedCostUsd: 0.002,
      durationMs: 60,
      metadata: {
        outputBudgetTokens: 120
      }
    });

    const data = await getFounderConsoleData();

    expect(data.aiRuntimeHealth.openAiEvents).toBe(2);
    expect(data.aiRuntimeHealth.openAiSuccessRate).toBe(100);
    expect(data.aiRuntimeHealth.openAiFallbackRate).toBe(0);
    expect(data.aiRuntimeHealth.openAiErrorEvents).toBe(0);
    expect(data.aiRuntimeHealth.budgetCoveragePercent).toBe(100);
    expect(data.aiRuntimeHealth.budgetOverrunEvents).toBe(1);
  });

  it("separates OpenAI fallback and error pressure from overall runtime health", async () => {
    resetStore();
    recordAiTelemetry({
      householdId: "household_a",
      phase: "capture_interpretation",
      model: "capture-test",
      provider: "openai",
      status: "success",
      totalTokens: 40,
      estimatedCostUsd: 0.001,
      durationMs: 30,
      metadata: {
        outputBudgetTokens: 120
      }
    });
    recordAiTelemetry({
      householdId: "household_a",
      phase: "conversation_answer",
      model: "conversation-test",
      provider: "openai",
      status: "fallback",
      totalTokens: 0,
      estimatedCostUsd: 0,
      durationMs: 22,
      metadata: {
        outputBudgetTokens: 120
      }
    });
    recordAiTelemetry({
      householdId: "household_a",
      phase: "speech_to_text",
      model: "stt-test",
      provider: "openai",
      status: "error",
      totalTokens: 12,
      estimatedCostUsd: 0.0001,
      durationMs: 80,
      metadata: {}
    });

    const data = await getFounderConsoleData();

    expect(data.aiRuntimeHealth.openAiEvents).toBe(3);
    expect(data.aiRuntimeHealth.openAiSuccessRate).toBe(33.3);
    expect(data.aiRuntimeHealth.openAiFallbackRate).toBe(33.3);
    expect(data.aiRuntimeHealth.openAiErrorEvents).toBe(1);
  });

  it("surfaces AI decision outcomes from capture telemetry", async () => {
    resetStore();
    recordAiTelemetry({
      householdId: "household_a",
      phase: "capture_interpretation",
      model: "capture-test",
      provider: "heuristic",
      sourceType: "text",
      status: "success",
      confidence: 0.9,
      totalTokens: 12,
      estimatedCostUsd: 0,
      durationMs: 18,
      metadata: {
        intent: "financial_event",
        confidenceBand: "high",
        decision: "auto_confirmed",
        memoryStatus: "auto_confirmed",
        needsUserInput: false
      }
    });
    recordAiTelemetry({
      householdId: "household_a",
      phase: "capture_interpretation",
      model: "capture-test",
      provider: "heuristic",
      sourceType: "text",
      status: "fallback",
      confidence: 0.4,
      totalTokens: 8,
      estimatedCostUsd: 0,
      durationMs: 12,
      metadata: {
        intent: "context_update",
        confidenceBand: "low",
        decision: "needs_user_input",
        memoryStatus: "needs_user_input",
        needsUserInput: true
      }
    });

    const data = await getFounderConsoleData();

    expect(data.aiDecisionAnalytics.captureDecisionEvents).toBe(2);
    expect(data.aiDecisionAnalytics.autoConfirmPercent).toBe(50);
    expect(data.aiDecisionAnalytics.askUserPercent).toBe(50);
    expect(data.aiDecisionAnalytics.lowConfidencePercent).toBe(50);
    expect(data.aiDecisionAnalytics.intentMix).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "financial_event", count: 1, percent: 50 }),
        expect.objectContaining({ label: "context_update", count: 1, percent: 50 })
      ])
    );
    expect(data.rawTables.telemetry).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          intent: "context_update",
          decision: "needs_user_input",
          confidenceBand: "low",
          needsUserInput: "yes"
        })
      ])
    );
  });

  it("surfaces custom category actor attribution in raw tables", async () => {
    resetStore();
    const actorUserId = "00000000-0000-4000-8000-000000000456";
    addHouseholdCategory({ householdId: "household_lee", name: "BB 學費", color: "#8fb3ff", actorUserId });

    const data = await getFounderConsoleData();

    expect(data.readableViews.schemaDictionary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "household_categories",
          field: expect.stringContaining("createdByUserId")
        })
      ])
    );
    expect(data.rawTables.categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          household: "household_lee",
          name: "BB 學費",
          color: "#8fb3ff",
          createdBy: "user",
          createdByUserId: actorUserId
        })
      ])
    );
  });

  it("surfaces voice transcript cleanup and interpretation chain in founder debug views", async () => {
    resetStore();
    const store = getMemoryRepository().read();

    store.captures.push({
      id: "cap_voice_debug",
      householdId: "household_lee",
      sourceType: "voice",
      transcript: "OK 買野飲 7",
      fileRefs: [],
      metadata: {
        rawTranscript: "我記買野飲 7",
        cleanedTranscript: "OK 買野飲 7"
      },
      createdAt: "2026-07-10T10:00:00.000Z"
    });
    store.memoryObjects.push({
      id: "mem_voice_debug",
      householdId: "household_lee",
      domain: "financial",
      title: "OK便利店 HK$7",
      currentState: "active",
      confidence: 0.86,
      status: "auto_confirmed",
      sourceRefs: [{ type: "capture", id: "cap_voice_debug", strength: "medium" }],
      createdAt: "2026-07-10T10:00:01.000Z",
      updatedAt: "2026-07-10T10:00:01.000Z"
    });
    store.interpretations.push({
      id: "interp_voice_debug",
      memoryObjectId: "mem_voice_debug",
      model: "heuristic-capture-v1",
      promptVersion: "test",
      intent: "financial_event",
      structuredOutput: { merchant: "OK便利店", amount: 7, category: "Groceries" },
      confidence: 0.86,
      confidenceBand: "medium",
      reasoningSummary: "Voice capture was cleaned before merchant inference.",
      sourceRefs: [{ type: "capture", id: "cap_voice_debug", strength: "medium" }],
      createdAt: "2026-07-10T10:00:01.000Z"
    });
    recordAiTelemetry({
      householdId: "household_lee",
      phase: "capture_interpretation",
      model: "heuristic-capture-v1",
      provider: "heuristic",
      sourceType: "voice",
      captureId: "cap_voice_debug",
      memoryObjectId: "mem_voice_debug",
      status: "success",
      confidence: 0.86,
      totalTokens: 12,
      estimatedCostUsd: 0,
      durationMs: 18,
      metadata: {
        intent: "financial_event",
        decision: "auto_confirmed",
        confidenceBand: "medium"
      }
    });

    const data = await getFounderConsoleData();

    expect(data.rawTables.captures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "cap_voice_de",
          source: "voice",
          rawTranscript: "我記買野飲 7",
          cleanedTranscript: "OK 買野飲 7"
        })
      ])
    );
    expect(data.readableViews.captureDebug).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "voice",
          rawTranscript: "我記買野飲 7",
          cleanedTranscript: "OK 買野飲 7",
          intent: "financial_event",
          decision: "auto_confirmed"
        })
      ])
    );
  });

  it("can export readable schema dictionary rows for founder inspection", async () => {
    resetStore();

    const rows = await getFounderViewRows("schemaDictionary");

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "ai_telemetry",
          field: expect.stringContaining("phase / model / tokens / cost / duration")
        })
      ])
    );
  });

  it("can export Supabase migration inventory rows for rollout inspection", async () => {
    resetStore();

    const rows = await getFounderViewRows("migrationInventory");

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          version: "001",
          file: "001_ai_native_memory_engine.sql",
          requiredFor: "private_beta"
        }),
        expect.objectContaining({
          version: "012",
          file: "012_harden_ai_telemetry_constraints.sql",
          requiredFor: "public_launch"
        })
      ])
    );
  });

  it("can export launch blocker rows for founder rollout review", async () => {
    resetStore();

    const rows = await getFounderViewRows("launchBlockers", {
      launchReadiness: {
        configReadyForPrivateBeta: false,
        liveSmokeVerified: false,
        readyForPublicLaunch: false
      },
      launchReadinessChecks: [
        {
          id: "supabase_schema_security",
          label: "Live Supabase schema/security",
          status: "fail",
          detail: "Required migrations: 005_harden_household_role_policies, 007_harden_memory_interpretation_writer_policy"
        },
        {
          id: "ai_budget_discipline",
          label: "AI budget discipline",
          status: "warn",
          detail: "Budget coverage is 50%. Budget overruns: 1."
        }
      ]
    });

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          area: "private_beta_gate",
          level: "critical"
        }),
        expect.objectContaining({
          area: "deploy_smoke",
          level: "warn"
        }),
        expect.objectContaining({
          area: "supabase_schema_security",
          level: "critical",
          detail: expect.stringContaining("005_harden_household_role_policies")
        }),
        expect.objectContaining({
          area: "ai_budget_discipline",
          level: "warn",
          detail: expect.stringContaining("Budget coverage is 50%")
        })
      ])
    );
  });

  it("surfaces schema and budget launch blockers in founder console data", async () => {
    resetStore();

    const data = await getFounderConsoleData({
      launchReadiness: {
        configReadyForPrivateBeta: false,
        liveSmokeVerified: false,
        readyForPublicLaunch: false
      }
    });

    expect(data.readableViews.launchBlockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          area: "private_beta_gate",
          level: "critical"
        }),
        expect.objectContaining({
          area: "deploy_smoke",
          level: "warn"
        })
      ])
    );

    const dataWithChecks = await getFounderConsoleData({
      launchReadiness: {
        configReadyForPrivateBeta: false,
        liveSmokeVerified: false,
        readyForPublicLaunch: false
      },
      launchReadinessChecks: [
        {
          id: "supabase_schema_security",
          label: "Live Supabase schema/security",
          status: "fail",
          detail: "Required migrations: 012_harden_ai_telemetry_constraints"
        },
        {
          id: "ai_budget_discipline",
          label: "AI budget discipline",
          status: "warn",
          detail: "Budget coverage is 80%. Budget overruns: 0."
        }
      ]
    });

    expect(dataWithChecks.readableViews.launchBlockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          area: "supabase_schema_security",
          blocker: "Supabase schema/security proof is incomplete"
        }),
        expect.objectContaining({
          area: "ai_budget_discipline",
          blocker: "AI output-budget discipline is not proven yet"
        })
      ])
    );
  });

  it("surfaces the configured default household binding summary for founder setup", async () => {
    resetStore();

    const data = await getFounderConsoleData({
      defaultHouseholdBinding: async () => ({
        configured: true,
        householdId: "household_lee",
        exists: true,
        memberCount: 2,
        ownerCount: 1,
        issue: ""
      })
    });

    expect(data.defaultHouseholdBinding).toEqual(
      expect.objectContaining({
        householdId: "household_lee",
        exists: true,
        memberCount: 2,
        ownerCount: 1,
        issue: ""
      })
    );
  });

  it("surfaces onboarding invite health for founder setup review", async () => {
    resetStore();

    const data = await getFounderConsoleData({
      onboardingHealth: async () => ({
        configured: true,
        totalInvites: 3,
        pendingInvites: 1,
        acceptedInvites: 1,
        expiredInvites: 1,
        emailLockedInvites: 2,
        recentInvites: [
          {
            householdId: "household_lee",
            email: "wife@example.com",
            role: "member",
            status: "pending",
            expiresAt: "2026-07-20T00:00:00.000Z",
            acceptedAt: ""
          }
        ],
        issue: ""
      }),
      householdRoster: async () => [
        {
          rowType: "binding",
          householdId: "household_lee",
          householdName: "Lee Home",
          userId: "",
          role: "",
          inviteEmail: "",
          inviteStatus: "",
          acceptedAt: "",
          expiresAt: "",
          issue: ""
        },
        {
          rowType: "member",
          householdId: "household_lee",
          householdName: "Lee Home",
          userId: "user_fred",
          role: "owner",
          inviteEmail: "",
          inviteStatus: "",
          acceptedAt: "",
          expiresAt: "",
          issue: ""
        },
        {
          rowType: "invite",
          householdId: "household_lee",
          householdName: "Lee Home",
          userId: "",
          role: "member",
          inviteEmail: "wife@example.com",
          inviteStatus: "pending",
          acceptedAt: "",
          expiresAt: "2026-07-20T00:00:00.000Z",
          issue: ""
        }
      ]
    });

    expect(data.onboardingHealth).toEqual(
      expect.objectContaining({
        totalInvites: 3,
        pendingInvites: 1,
        acceptedInvites: 1,
        expiredInvites: 1,
        emailLockedInvites: 2
      })
    );
    expect(data.onboardingHealth.recentInvites[0]).toEqual(
      expect.objectContaining({
        email: "wife@example.com",
        status: "pending"
      })
    );
    expect(data.readableViews.householdSetup).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          view: "default_household_binding",
          householdId: "",
          configured: "no"
        }),
        expect.objectContaining({
          view: "recent_invite",
          householdId: "household_lee",
          email: "wife@example.com",
          role: "member",
          inviteStatus: "pending"
        })
      ])
    );
    expect(data.readableViews.householdRoster).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowType: "binding",
          householdId: "household_lee",
          householdName: "Lee Home"
        }),
        expect.objectContaining({
          rowType: "member",
          userId: "user_fred",
          role: "owner"
        }),
        expect.objectContaining({
          rowType: "invite",
          inviteEmail: "wife@example.com",
          inviteStatus: "pending"
        })
      ])
    );
  });

  it("can export founder household setup rows for Google-Sheet-style inspection", async () => {
    resetStore();

    const rows = await getFounderViewRows("householdSetup");

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          view: "default_household_binding"
        }),
        expect.objectContaining({
          view: "invite_summary"
        })
      ])
    );
  });

  it("can export founder household roster rows for live roster inspection", async () => {
    resetStore();

    const data = await getFounderConsoleData({
      householdRoster: async () => [
        {
          rowType: "binding",
          householdId: "household_lee",
          householdName: "Lee Home",
          userId: "",
          role: "",
          inviteEmail: "",
          inviteStatus: "",
          acceptedAt: "",
          expiresAt: "",
          issue: ""
        }
      ]
    });

    expect(data.readableViews.householdRoster).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rowType: "binding",
          householdId: "household_lee"
        })
      ])
    );
  });

  it("surfaces schema migration proof rows for founder rollout review", async () => {
    resetStore();

    const data = await getFounderConsoleData({
      launchReadiness: {
        configReadyForPrivateBeta: false,
        liveSmokeVerified: false,
        readyForPublicLaunch: false
      },
      launchReadinessChecks: [
        {
          id: "supabase_schema_security",
          label: "Live Supabase schema/security",
          status: "fail",
          detail: "Apply migration. Required migrations: 005_harden_household_role_policies, 007_harden_memory_interpretation_writer_policy"
        }
      ]
    });

    expect(data.readableViews.schemaMigrationProof).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          view: "live_schema_check",
          requiredMigrations: expect.stringContaining("005_harden_household_role_policies")
        })
      ])
    );
  });

  it("surfaces live proof gaps so founder can separate local readiness from deployed proof", async () => {
    resetStore();

    const data = await getFounderConsoleData({
      defaultHouseholdBinding: async () => ({
        configured: true,
        householdId: "household_lee",
        exists: true,
        memberCount: 1,
        ownerCount: 1,
        issue: ""
      }),
      onboardingHealth: async () => ({
        configured: true,
        totalInvites: 1,
        pendingInvites: 1,
        acceptedInvites: 0,
        expiredInvites: 0,
        emailLockedInvites: 0,
        recentInvites: [],
        issue: ""
      }),
      launchReadiness: {
        configReadyForPrivateBeta: true,
        liveSmokeVerified: false,
        readyForPublicLaunch: false
      },
      launchReadinessChecks: [
        {
          id: "supabase_schema_security",
          label: "Live Supabase schema/security",
          status: "fail",
          detail: "Apply migration 012 on live Supabase."
        },
        {
          id: "ai_budget_discipline",
          label: "AI budget discipline",
          status: "warn",
          detail: "Budget coverage is 50%. Budget overruns: 1."
        }
      ]
    });

    expect(data.readableViews.liveProofGaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          area: "supabase_live_schema",
          status: "pending"
        }),
        expect.objectContaining({
          area: "deployed_smoke",
          status: "pending"
        }),
        expect.objectContaining({
          area: "two_member_household",
          status: "in_progress"
        }),
        expect.objectContaining({
          area: "openai_live_telemetry",
          status: "open"
        })
      ])
    );
  });

  it("uses OpenAI runtime health to sharpen live telemetry proof gaps and blockers", async () => {
    resetStore();
    process.env.OPENAI_API_KEY = "openai-key";

    recordAiTelemetry({
      householdId: "household_lee",
      phase: "capture_interpretation",
      model: "capture-test",
      provider: "openai",
      status: "fallback",
      totalTokens: 20,
      estimatedCostUsd: 0.001,
      durationMs: 25,
      metadata: {
        outputBudgetTokens: 120
      }
    });
    recordAiTelemetry({
      householdId: "household_lee",
      phase: "conversation_answer",
      model: "conversation-test",
      provider: "openai",
      status: "error",
      totalTokens: 14,
      estimatedCostUsd: 0.0005,
      durationMs: 60,
      metadata: {
        outputBudgetTokens: 120
      }
    });

    const data = await getFounderConsoleData({
      defaultHouseholdBinding: async () => ({
        configured: true,
        householdId: "household_lee",
        exists: true,
        memberCount: 2,
        ownerCount: 1,
        issue: ""
      }),
      onboardingHealth: async () => ({
        configured: true,
        totalInvites: 1,
        pendingInvites: 0,
        acceptedInvites: 1,
        expiredInvites: 0,
        emailLockedInvites: 1,
        recentInvites: [],
        issue: ""
      }),
      launchReadiness: {
        configReadyForPrivateBeta: true,
        liveSmokeVerified: true,
        readyForPublicLaunch: false
      },
      launchReadinessChecks: [
        {
          id: "supabase_schema_security",
          label: "Live Supabase schema/security",
          status: "pass",
          detail: "Schema proof ok."
        },
        {
          id: "ai_budget_discipline",
          label: "AI budget discipline",
          status: "pass",
          detail: "Budget proof ok."
        }
      ]
    });

    expect(data.readableViews.liveProofGaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          area: "openai_live_telemetry",
          status: "pending",
          detail: expect.stringContaining("OpenAI events=2"),
          nextAction: expect.stringContaining("positive OpenAI success rate")
        })
      ])
    );
    expect(data.readableViews.launchBlockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          area: "openai_live_telemetry",
          blocker: "OpenAI runtime health is not clean yet"
        })
      ])
    );
  });

  it("can export founder auth setup targets for OAuth configuration handoff", async () => {
    resetStore();
    process.env.NEXT_PUBLIC_APP_URL = "https://sayve.app";

    const rows = await getFounderViewRows("authSetup");

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item: "supabase_site_url",
          target: "https://sayve.app"
        }),
        expect.objectContaining({
          item: "supabase_redirect_url_invite",
          target: "https://sayve.app/invite"
        })
      ])
    );
  });

  it("can export private beta setup gate rows for direct rollout execution", async () => {
    resetStore();
    process.env.NEXT_PUBLIC_APP_URL = "https://sayve.app";
    process.env.SAYVE_TEST_SUPABASE_ACCESS_TOKEN = "owner-token";
    process.env.SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN = "partner-token";
    process.env.SAYVE_TEST_HOUSEHOLD_ID = "household_lee";

    const data = await getFounderConsoleData({
      defaultHouseholdBinding: async () => ({
        configured: true,
        householdId: "household_lee",
        exists: true,
        memberCount: 2,
        ownerCount: 1,
        issue: ""
      }),
      onboardingHealth: async () => ({
        configured: true,
        totalInvites: 1,
        pendingInvites: 0,
        acceptedInvites: 1,
        expiredInvites: 0,
        emailLockedInvites: 1,
        recentInvites: [],
        issue: ""
      }),
      householdRoster: async () => [],
      migrationInspection: mockMigrationInspection(),
      launchReadiness: {
        configReadyForPrivateBeta: true,
        liveSmokeVerified: false,
        readyForPublicLaunch: false
      },
      liveRollout: async () => []
    });

    expect(data.readableViews.privateBetaSetupGate).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          step: 1,
          item: "Supabase project env",
          status: "open"
        }),
        expect.objectContaining({
          step: 5,
          item: "Partner joined household",
          status: "ready"
        }),
        expect.objectContaining({
          step: 8,
          item: "Live deployment smoke",
          status: "open"
        })
      ])
    );
  });

  it("can export integration readiness rows grouped by external system", async () => {
    resetStore();
    process.env.NEXT_PUBLIC_APP_URL = "https://sayve.app";
    process.env.SAYVE_DEPLOY_URL = "https://sayve.app";
    process.env.APP_ACCESS_TOKEN = "app-access-token";
    process.env.ADMIN_CONSOLE_TOKEN = "admin-console-token";

    const data = await getFounderConsoleData({
      defaultHouseholdBinding: async () => ({
        configured: true,
        householdId: "household_lee",
        exists: true,
        memberCount: 1,
        ownerCount: 1,
        issue: ""
      }),
      onboardingHealth: async () => ({
        configured: true,
        totalInvites: 1,
        pendingInvites: 1,
        acceptedInvites: 0,
        expiredInvites: 0,
        emailLockedInvites: 1,
        recentInvites: [],
        issue: ""
      }),
      householdRoster: async () => [],
      migrationInspection: mockMigrationInspection(),
      liveRollout: async () => []
    });

    expect(data.readableViews.integrationReadiness).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          system: "google_oauth",
          stage: "private_beta",
          status: "ready"
        }),
        expect.objectContaining({
          system: "household_onboarding",
          stage: "private_beta",
          status: "pending"
        }),
        expect.objectContaining({
          system: "openai",
          stage: "public_launch",
          status: "open"
        })
      ])
    );
  });

  it("can export integration package rows for copy-paste setup handoff", async () => {
    resetStore();
    process.env.NEXT_PUBLIC_APP_URL = "https://sayve.app";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abc.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";

    const data = await getFounderConsoleData({
      defaultHouseholdBinding: async () => ({
        configured: false,
        householdId: "",
        exists: false,
        memberCount: 0,
        ownerCount: 0,
        issue: ""
      }),
      onboardingHealth: async () => ({
        configured: false,
        totalInvites: 0,
        pendingInvites: 0,
        acceptedInvites: 0,
        expiredInvites: 0,
        emailLockedInvites: 0,
        recentInvites: [],
        issue: ""
      }),
      householdRoster: async () => [],
      migrationInspection: mockMigrationInspection(),
      liveRollout: async () => []
    });
    const rows = data.readableViews.integrationPackage;

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          system: "supabase",
          field: "project_url",
          value: "https://abc.supabase.co"
        }),
        expect.objectContaining({
          system: "google_oauth",
          field: "redirect_invite",
          value: "https://sayve.app/invite"
        }),
        expect.objectContaining({
          system: "openai",
          field: "api_key",
          stage: "public_launch"
        }),
        expect.objectContaining({
          system: "openai",
          field: "capture_output_budget",
          value: "220"
        })
      ])
    );
  });

  it("can export execution checklist rows for rollout status handoff", async () => {
    resetStore();

    const data = await getFounderConsoleData({
      defaultHouseholdBinding: async () => ({
        configured: false,
        householdId: "",
        exists: false,
        memberCount: 0,
        ownerCount: 0,
        issue: ""
      }),
      onboardingHealth: async () => ({
        configured: true,
        totalInvites: 1,
        pendingInvites: 1,
        acceptedInvites: 0,
        expiredInvites: 0,
        emailLockedInvites: 0,
        recentInvites: [],
        issue: ""
      }),
      householdRoster: async () => [],
      migrationInspection: mockMigrationInspection(),
      liveRollout: async () => []
    });

    expect(data.readableViews.executionChecklist).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item: "Supabase project env",
          status: "open"
        }),
        expect.objectContaining({
          item: "Partner joined household",
          status: "pending"
        })
      ])
    );
  });

  it("can export onboarding proof steps for founder and partner live verification", async () => {
    resetStore();
    process.env.NEXT_PUBLIC_APP_URL = "https://sayve.app";

    const data = await getFounderConsoleData({
      defaultHouseholdBinding: async () => ({
        configured: true,
        householdId: "household_lee",
        exists: true,
        memberCount: 1,
        ownerCount: 1,
        issue: ""
      }),
      onboardingHealth: async () => ({
        configured: true,
        totalInvites: 1,
        pendingInvites: 1,
        acceptedInvites: 0,
        expiredInvites: 0,
        emailLockedInvites: 0,
        recentInvites: [],
        issue: ""
      }),
      householdRoster: async () => [],
      migrationInspection: mockMigrationInspection(),
      liveRollout: async () => [],
      launchReadiness: {
        configReadyForPrivateBeta: true,
        liveSmokeVerified: false,
        readyForPublicLaunch: false
      }
    });

    expect(data.readableViews.onboardingProofSteps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          step: 1,
          item: "Login as founder"
        }),
        expect.objectContaining({
          step: 4,
          actor: "partner",
          item: "Accept invite with separate account"
        }),
        expect.objectContaining({
          step: 6,
          item: "Collect bootstrap token"
        })
      ])
    );
  });

  it("can export provider setup rows grouped for founder rollout", async () => {
    resetStore();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abc.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";

    const data = await getFounderConsoleData({
      defaultHouseholdBinding: async () => ({
        configured: false,
        householdId: "",
        exists: false,
        memberCount: 0,
        ownerCount: 0,
        issue: ""
      }),
      onboardingHealth: async () => ({
        configured: false,
        totalInvites: 0,
        pendingInvites: 0,
        acceptedInvites: 0,
        expiredInvites: 0,
        emailLockedInvites: 0,
        recentInvites: [],
        issue: ""
      }),
      householdRoster: async () => [],
      migrationInspection: mockMigrationInspection(),
      liveRollout: async () => []
    });

    expect(data.readableViews.providerSetup).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "supabase",
          field: "project_url"
        }),
        expect.objectContaining({
          provider: "supabase",
          field: "NEXT_PUBLIC_SUPABASE_URL"
        }),
        expect.objectContaining({
          provider: "openai",
          field: "api_key"
        })
      ])
    );
  });

  it("can export founder env setup matrix for deployment handoff", async () => {
    resetStore();
    process.env.MEMORY_REPOSITORY = "local_file";
    process.env.NEXT_PUBLIC_APP_URL = "https://sayve.app";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abc.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";

    const data = await getFounderConsoleData({
      defaultHouseholdBinding: async () => ({
        configured: false,
        householdId: "",
        exists: false,
        memberCount: 0,
        ownerCount: 0,
        issue: ""
      }),
      onboardingHealth: async () => ({
        configured: false,
        totalInvites: 0,
        pendingInvites: 0,
        acceptedInvites: 0,
        expiredInvites: 0,
        emailLockedInvites: 0,
        recentInvites: [],
        issue: ""
      }),
      householdRoster: async () => [],
      migrationInspection: mockMigrationInspection({
        dryRun: { configured: false, valid: true, validation: { valid: true, issues: [], tableCounts: {} }, tables: {}, planSignature: "" }
      }),
      liveRollout: async () => []
    });

    const rows = data.readableViews.envSetup;

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          env: "MEMORY_REPOSITORY",
          value: "local_file"
        }),
        expect.objectContaining({
          env: "NEXT_PUBLIC_APP_URL",
          value: "https://sayve.app"
        }),
        expect.objectContaining({
          env: "SUPABASE_SERVICE_ROLE_KEY",
          value: "configured"
        })
      ])
    );
  });

  it("can export founder copy-paste env template for deployment handoff", async () => {
    resetStore();
    process.env.NEXT_PUBLIC_APP_URL = "https://sayve.app";
    process.env.MEMORY_REPOSITORY = "local_file";

    const data = await getFounderConsoleData({
      householdRoster: async () => [],
      migrationInspection: mockMigrationInspection({
        dryRun: { configured: false, valid: true, validation: { valid: true, issues: [], tableCounts: {} }, tables: {}, planSignature: "" }
      }),
      liveRollout: async () => []
    });

    const rows = data.readableViews.envTemplate;

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          env: "NEXT_PUBLIC_APP_URL",
          value: "https://sayve.app"
        }),
        expect.objectContaining({
          env: "APP_ACCESS_TOKEN"
        }),
        expect.objectContaining({
          env: "SUPABASE_MEDIA_BUCKET",
          value: "<set-before-public-launch>"
        })
      ])
    );
  });

  it("can export founder Google OAuth checklist rows for deployment handoff", async () => {
    resetStore();
    process.env.NEXT_PUBLIC_APP_URL = "https://sayve.app";

    const data = await getFounderConsoleData({
      householdRoster: async () => [],
      migrationInspection: mockMigrationInspection({
        dryRun: { configured: false, valid: true, validation: { valid: true, issues: [], tableCounts: {} }, tables: {}, planSignature: "" }
      }),
      liveRollout: async () => []
    });

    const rows = data.readableViews.oauthChecklist;

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          step: 2,
          item: "Set Supabase Site URL",
          target: "https://sayve.app"
        }),
        expect.objectContaining({
          step: 4,
          item: "Add invite redirect allow-list entry",
          target: "https://sayve.app/invite"
        })
      ])
    );
  });

  it("can build a founder setup bundle for external handoff", async () => {
    resetStore();
    process.env.NEXT_PUBLIC_APP_URL = "https://sayve.app";

    const launchReadinessChecks = [
      {
        id: "deployment_smoke",
        label: "Deployment smoke",
        status: "fail" as const,
        detail: "Smoke proof still missing."
      }
    ];

    const bundle = await getFounderSetupBundle(
      {
        configReadyForPrivateBeta: true,
        liveSmokeVerified: false,
        readyForPublicLaunch: false
      },
      launchReadinessChecks
    );

    expect(bundle.launchReadiness.configReadyForPrivateBeta).toBe(true);
    expect(bundle.launchReadinessChecks).toEqual(launchReadinessChecks);
    expect(bundle.signature).toMatch(/^[a-f0-9]{64}$/);
    expect(Array.isArray(bundle.nextActions)).toBe(true);
    expect(bundle.nextActions[0]).toContain("founder household");
    expect(bundle.commands.privateBeta).toContain("pnpm run verify:deploy:private-beta");
    expect(bundle.commands.strictPrivateBeta).toContain("pnpm run verify:deploy:strict-private-beta");
    expect(bundle.commands.strictPrivateBetaProof).toContain("pnpm run verify:deploy:strict-private-beta:proof");
    expect(bundle.commands.strictPrivateBetaProof).toContain("SAYVE_DEPLOY_PROOF_REPORT_PATH=outputs/setup/deploy-proof-report.json");
    expect(bundle.commands.strictPrivateBeta).toContain("SAYVE_TEST_VIEWER_SUPABASE_ACCESS_TOKEN=");
    expect(bundle.commands.publicLaunch).toContain("pnpm run verify:deploy:public-launch");
    expect(bundle.views.envTemplate).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          env: "NEXT_PUBLIC_APP_URL",
          value: "https://sayve.app"
        })
      ])
    );
    expect(bundle.views.oauthChecklist).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item: "Add invite redirect allow-list entry",
          target: "https://sayve.app/invite"
        })
      ])
    );
    expect(bundle.views.smokeTokenGuide).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "owner"
        })
      ])
    );
    expect(bundle.views.launchCompletionAudit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requirement: "production_storage_boundary"
        })
      ])
    );
    expect(bundle.views.launchBlockers).toEqual(expect.any(Array));
    expect(bundle.views.migrationInventory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          version: "003",
          file: "003_memory_store_snapshots.sql"
        })
      ])
    );
    expect(bundle.views.privateBetaSetupGate).toEqual(expect.any(Array));
    expect(bundle.views.integrationReadiness).toEqual(expect.any(Array));
    expect(bundle.views.integrationPackage).toEqual(expect.any(Array));
    expect(bundle.views.deployEnvTemplate).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          env: "SAYVE_ENV_TARGET",
          value: "public-launch"
        })
      ])
    );
    expect(bundle.views.deploySmokeEnvTemplate).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          env: "SAYVE_REQUIRE_AUTH_SMOKE",
          value: "1"
        })
      ])
    );
    expect(bundle.views.repositorySmokeGuide).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item: "Expected fields",
          target: expect.stringContaining("memberCount")
        })
      ])
    );
    expect(bundle.views.publicLaunchChecks).toEqual(expect.any(Array));
  });

  it("keeps founder setup bundle signature stable across generation timestamps", async () => {
    resetStore();
    process.env.NEXT_PUBLIC_APP_URL = "https://sayve.app";

    const launchReadiness = {
      configReadyForPrivateBeta: true,
      liveSmokeVerified: false,
      readyForPublicLaunch: false
    } as const;

    const first = await getFounderSetupBundle(launchReadiness);
    const second = await getFounderSetupBundle(launchReadiness);

    expect(typeof first.generatedAt).toBe("string");
    expect(typeof second.generatedAt).toBe("string");
    expect(first.signature).toBe(second.signature);
  });

  it("can build a founder integration bundle for external system handoff", async () => {
    resetStore();
    process.env.NEXT_PUBLIC_APP_URL = "https://sayve.app";

    const bundle = await getFounderIntegrationBundle({
      configReadyForPrivateBeta: true,
      liveSmokeVerified: false,
      readyForPublicLaunch: false
    });

    expect(bundle.signature).toMatch(/^[a-f0-9]{64}$/);
    expect(bundle.views.integrationReadiness).toEqual(expect.any(Array));
    expect(bundle.views.integrationPackage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          system: "supabase",
          field: "project_url"
        }),
        expect.objectContaining({
          system: "google_oauth",
          field: "redirect_invite"
        }),
        expect.objectContaining({
          system: "openai",
          field: "api_key"
        }),
        expect.objectContaining({
          system: "openai",
          field: "capture_output_budget"
        }),
        expect.objectContaining({
          system: "openai",
          field: "conversation_output_budget"
        })
      ])
    );
    expect(bundle.views.migrationInventory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: "001_ai_native_memory_engine.sql"
        }),
        expect.objectContaining({
          file: "012_harden_ai_telemetry_constraints.sql"
        })
      ])
    );
    expect(bundle.views.schemaMigrationProof).toEqual(expect.any(Array));
    expect(bundle.views.oauthChecklist).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item: "Add invite redirect allow-list entry",
          target: "https://sayve.app/invite"
        })
      ])
    );
    expect(bundle.commands.privateBeta).toContain("pnpm run verify:deploy:private-beta");
    expect(bundle.commands.strictPrivateBeta).toContain("pnpm run verify:deploy:strict-private-beta");
    expect(bundle.commands.strictPrivateBetaProof).toContain("pnpm run verify:deploy:strict-private-beta:proof");
  });

  it("can build a founder live-proof bundle for rollout evidence handoff", async () => {
    resetStore();
    process.env.NEXT_PUBLIC_APP_URL = "https://sayve.app";

    const launchReadinessChecks = [
      {
        id: "deployment_smoke",
        label: "Smoke proof",
        status: "fail" as const,
        detail: "Smoke proof still missing."
      }
    ];

    const bundle = await getFounderLiveProofBundle(
      {
        configReadyForPrivateBeta: true,
        liveSmokeVerified: false,
        readyForPublicLaunch: false
      },
      launchReadinessChecks
    );

    expect(bundle.signature).toMatch(/^[a-f0-9]{64}$/);
    expect(bundle.defaultHouseholdBinding).toHaveProperty("configured");
    expect(bundle.onboardingHealth).toHaveProperty("pendingInvites");
    expect(bundle.views.liveRollout).toEqual(expect.any(Array));
    expect(bundle.views.liveProofGaps).toEqual(expect.any(Array));
    expect(bundle.views.onboardingProofSteps).toEqual(expect.any(Array));
    expect(bundle.views.launchCompletionAudit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requirement: "supabase_migration_path"
        })
      ])
    );
    expect(bundle.views.publicLaunchChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Smoke proof"
        })
      ])
    );
    expect(bundle.views.schemaMigrationProof).toEqual(expect.any(Array));
    expect(bundle.views.migrationInventory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: "012_harden_ai_telemetry_constraints.sql"
        })
      ])
    );
    expect(bundle.views.deployEnvTemplate).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          env: "SAYVE_ENV_TARGET"
        })
      ])
    );
    expect(bundle.views.deploySmokeEnvTemplate).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          env: "SAYVE_REQUIRE_BOOTSTRAP_SMOKE"
        })
      ])
    );
    expect(bundle.views.smokeTokenGuide).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          env: "SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN"
        })
      ])
    );
    expect(bundle.commands.privateBeta).toContain("pnpm run verify:deploy:private-beta");
    expect(bundle.commands.strictPrivateBeta).toContain("pnpm run verify:deploy:strict-private-beta");
    expect(bundle.commands.strictPrivateBetaProof).toContain("pnpm run verify:deploy:strict-private-beta:proof");
    expect(bundle.commands.publicLaunch).toContain("pnpm run verify:deploy:public-launch");
  });

  it("can export founder smoke token guide rows for deployment handoff", async () => {
    resetStore();
    process.env.NEXT_PUBLIC_APP_URL = "https://sayve.app";

    const rows = await getFounderViewRows("smokeTokenGuide");

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "owner",
          env: "SAYVE_TEST_SUPABASE_ACCESS_TOKEN"
        }),
        expect.objectContaining({
          role: "storage_keys",
          where: "DevTools -> Application -> Local Storage"
        })
      ])
    );
  });

  it("can expose supabase migration inspection rows for founder review", async () => {
    resetStore();

    const data = await getFounderConsoleData({
      migrationInspection: mockMigrationInspection({
        validation: {
          valid: true,
          issues: [],
          tableCounts: {
            households: 1,
            captures: 2
          }
        },
        dryRun: {
          configured: true,
          valid: true,
          validation: {
            valid: true,
            issues: [],
            tableCounts: {
              households: 1,
              captures: 2
            }
          },
          tables: {
            households: {
              rowsInPlan: 1,
              existingRows: 0,
              rowsToInsert: 1,
              sampleExistingExternalIds: [],
              sampleInsertExternalIds: ["household_demo"]
            },
            captures: {
              rowsInPlan: 2,
              existingRows: 1,
              rowsToInsert: 1,
              sampleExistingExternalIds: ["cap_old"],
              sampleInsertExternalIds: ["cap_new"]
            }
          },
          planSignature: "signature"
        },
        applied: {
          configured: true,
          accessible: true,
          ok: false,
          rows: [
            {
              line: 1,
              version: "001",
              file: "001_ai_native_memory_engine.sql",
              requiredFor: "private_beta",
              checksum: "checksum-001",
              shortChecksum: "checksum-001",
              purpose: "Base schema",
              expectedName: "ai_native_memory_engine",
              applied: true,
              remoteName: "ai_native_memory_engine"
            },
            {
              line: 12,
              version: "012",
              file: "012_harden_ai_telemetry_constraints.sql",
              requiredFor: "public_launch",
              checksum: "checksum-012",
              shortChecksum: "checksum-012",
              purpose: "Telemetry constraints",
              expectedName: "harden_ai_telemetry_constraints",
              applied: false,
              remoteName: ""
            }
          ],
          missingVersions: ["012"],
          unexpectedRemoteVersions: []
        }
      })
    });

    expect(data.readableViews.supabaseMigration).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "households",
          rowsInPlan: 1,
          rowsToInsert: 1,
          configured: "yes",
          dryRunValid: "yes",
          appliedMigrationsAccessible: "yes",
          missingMigrationVersions: "012"
        }),
        expect.objectContaining({
          table: "captures",
          existingRows: 1,
          sampleExistingIds: "cap_old",
          sampleInsertIds: "cap_new"
        })
      ])
    );
    expect(data.readableViews.schemaMigrationProof).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          view: "applied_migration",
          status: "missing",
          requiredMigrations: "012_harden_ai_telemetry_constraints.sql"
        })
      ])
    );
  });

  it("can expose live rollout checklist rows for founder review", async () => {
    resetStore();

    const data = await getFounderConsoleData({
      defaultHouseholdBinding: async () => ({
        configured: true,
        householdId: "household_lee",
        exists: true,
        memberCount: 2,
        ownerCount: 1,
        issue: ""
      }),
      onboardingHealth: async () => ({
        configured: true,
        totalInvites: 1,
        pendingInvites: 0,
        acceptedInvites: 1,
        expiredInvites: 0,
        emailLockedInvites: 1,
        recentInvites: [],
        issue: ""
      }),
      liveRollout: () => [
        {
          item: "App base URL",
          status: "READY",
          value: "https://sayve.app",
          detail: "Configured."
        },
        {
          item: "Deploy smoke",
          status: "OPEN",
          value: "",
          detail: "Run live smoke."
        }
      ]
    });

    expect(data.readableViews.liveRollout).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item: "App base URL",
          status: "READY",
          value: "https://sayve.app"
        }),
        expect.objectContaining({
          item: "Deploy smoke",
          status: "OPEN"
        })
      ])
    );
  });

  it("surfaces founder-visible media storage smoke proof in live rollout rows", async () => {
    resetStore();
    process.env.MEMORY_REPOSITORY = "supabase";
    process.env.SUPABASE_MEDIA_BUCKET = "sayve-capture-media";

    const data = await getFounderConsoleData({
      defaultHouseholdBinding: async () => ({
        configured: true,
        householdId: "household_lee",
        exists: true,
        memberCount: 2,
        ownerCount: 1,
        issue: ""
      }),
      onboardingHealth: async () => ({
        configured: true,
        totalInvites: 1,
        pendingInvites: 0,
        acceptedInvites: 1,
        expiredInvites: 0,
        emailLockedInvites: 1,
        recentInvites: [],
        issue: ""
      }),
      householdRoster: async () => [],
      migrationInspection: mockMigrationInspection({
        dryRun: { configured: false, valid: true, validation: { valid: true, issues: [], tableCounts: {} }, tables: {}, planSignature: "" }
      }),
      mediaStorageSmoke: async () => ({
        configured: true,
        ok: false,
        bucket: "sayve-capture-media",
        detail: "Upload failed: permission denied"
      })
    });

    expect(data.readableViews.liveRollout).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item: "Media storage",
          status: "CHECK",
          value: "sayve-capture-media",
          detail: "Upload failed: permission denied"
        })
      ])
    );
  });
});
