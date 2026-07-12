import { afterEach, describe, expect, it } from "vitest";
import { getLaunchReadinessReport as buildLaunchReadinessReport } from "./launch-readiness";
import type { AppliedSupabaseMigrationsResult } from "@/server/memory/supabase-applied-migrations";
import type { SupabaseSchemaCheckResult } from "@/server/memory/supabase-schema-check";

const originalEnv = { ...process.env };
const strongAdminToken = "admin_console_access_32_chars_123";
const strongAppToken = "private_beta_access_32_chars_123456";

afterEach(() => {
  process.env = { ...originalEnv };
});

function schemaResult(ok = true): SupabaseSchemaCheckResult {
  return {
    configured: true,
    ok,
    checkedTables: 18,
    securityChecks: ok
      ? [
          { id: "memory_store_snapshots_service_role_only", ok: true, message: "ok", requiredMigrations: [], recommendedAction: "" },
          { id: "household_role_policies", ok: true, message: "ok", requiredMigrations: [], recommendedAction: "" },
          { id: "invites_service_role_only", ok: true, message: "ok", requiredMigrations: [], recommendedAction: "" },
          { id: "invites_atomic_acceptance", ok: true, message: "ok", requiredMigrations: [], recommendedAction: "" },
          { id: "memory_facts_payload_shape", ok: true, message: "ok", requiredMigrations: [], recommendedAction: "" },
          { id: "ai_telemetry_shape", ok: true, message: "ok", requiredMigrations: [], recommendedAction: "" },
          { id: "media_storage_bucket", ok: true, message: "ok", requiredMigrations: [], recommendedAction: "" }
        ]
      : [{ id: "household_role_policies", ok: false, message: "Apply migrations 005 and 007 before private beta.", requiredMigrations: ["005_harden_household_role_policies", "007_harden_memory_interpretation_writer_policy"], recommendedAction: "Apply migrations 005 and 007 before private beta." }],
    issues: [],
    requiredMigrations: ok ? [] : ["005_harden_household_role_policies", "007_harden_memory_interpretation_writer_policy"],
    recommendedActions: ok ? [] : ["Apply migrations 005 and 007 before private beta."]
  };
}

function appliedMigrationsResult(
  overrides: Partial<AppliedSupabaseMigrationsResult> = {}
): AppliedSupabaseMigrationsResult {
  return {
    configured: true,
    accessible: true,
    ok: true,
    rows: [
      {
        version: "001",
        file: "001_ai_native_memory_engine.sql",
        expectedName: "ai_native_memory_engine",
        applied: true,
        remoteName: "ai_native_memory_engine",
        requiredFor: "private_beta",
        checksum: "checksum-001",
        shortChecksum: "checksum-001",
        purpose: "Base schema"
      },
      {
        version: "012",
        file: "012_harden_ai_telemetry_constraints.sql",
        expectedName: "harden_ai_telemetry_constraints",
        applied: true,
        remoteName: "harden_ai_telemetry_constraints",
        requiredFor: "public_launch",
        checksum: "checksum-012",
        shortChecksum: "checksum-012",
        purpose: "Telemetry constraints"
      }
    ],
    missingVersions: [],
    unexpectedRemoteVersions: [],
    ...overrides
  };
}

function setAllPricingEnv() {
  process.env.OPENAI_CAPTURE_INPUT_USD_PER_1M = "0.15";
  process.env.OPENAI_CAPTURE_OUTPUT_USD_PER_1M = "0.6";
  process.env.OPENAI_RECEIPT_VISION_INPUT_USD_PER_1M = "0.2";
  process.env.OPENAI_RECEIPT_VISION_OUTPUT_USD_PER_1M = "0.8";
  process.env.OPENAI_CONVERSATION_INPUT_USD_PER_1M = "0.15";
  process.env.OPENAI_CONVERSATION_OUTPUT_USD_PER_1M = "0.6";
  process.env.OPENAI_STT_INPUT_USD_PER_1M = "0.1";
  process.env.OPENAI_STT_OUTPUT_USD_PER_1M = "0.4";
}

function setAllModelEnv() {
  process.env.OPENAI_CAPTURE_MODEL = "gpt-test-capture";
  process.env.OPENAI_CONVERSATION_MODEL = "gpt-test-conversation";
  process.env.OPENAI_ESCALATION_MODEL = "gpt-test-escalation";
  process.env.OPENAI_RECEIPT_VISION_MODEL = "gpt-test-vision";
  process.env.OPENAI_SPEECH_TO_TEXT_MODEL = "gpt-test-transcribe";
}

function setAiMediaLimits() {
  process.env.AUDIO_TRANSCRIPTION_MAX_BYTES = "25000000";
  process.env.RECEIPT_VISION_MAX_BYTES = "8000000";
}

function setMediaUploadLimits() {
  process.env.RECEIPT_UPLOAD_MAX_BYTES = "10000000";
  process.env.VOICE_UPLOAD_MAX_BYTES = "25000000";
}

function setSmokeProof(target = "https://sayve.app") {
  process.env.SAYVE_DEPLOYMENT_SMOKE_VERIFIED = "1";
  process.env.SAYVE_DEPLOYMENT_SMOKE_VERIFIED_AT = "2026-07-10T02:00:00.000Z";
  process.env.SAYVE_DEPLOYMENT_SMOKE_TARGET = target;
}

function completeTelemetry(events = 3) {
  return {
    aiRuntimeHealth: {
      totalAiEvents: events,
      telemetryCompletenessPercent: 100,
      budgetCoveragePercent: 100,
      budgetOverrunEvents: 0,
      missingTokenEvents: 0,
      missingCostEvents: 0,
      missingDurationEvents: 0
    },
    onboardingHealth: {
      configured: true,
      totalInvites: 0,
      pendingInvites: 0,
      acceptedInvites: 0,
      expiredInvites: 0,
      emailLockedInvites: 0,
      issue: ""
    }
  };
}

function getLaunchReadinessReport(options: Parameters<typeof buildLaunchReadinessReport>[0] = {}) {
  return buildLaunchReadinessReport({
    founderTelemetry: async () => completeTelemetry(),
    appliedMigrations: async () => appliedMigrationsResult(),
    mediaStorageSmoke: async () => ({
      configured: true,
      ok: true,
      bucket: process.env.SUPABASE_MEDIA_BUCKET?.trim() || "sayve-capture-media",
      detail: `Server write/delete smoke passed for bucket ${process.env.SUPABASE_MEDIA_BUCKET?.trim() || "sayve-capture-media"}.`
    }),
    ...options
  });
}

describe("launch readiness", () => {
  it("blocks public launch when admin protection and Supabase are missing", async () => {
    delete process.env.ADMIN_CONSOLE_TOKEN;
    delete process.env.SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const report = await getLaunchReadinessReport();

    expect(report.readyForPublicLaunch).toBe(false);
    expect(report.configReadyForPrivateBeta).toBe(false);
    expect(report.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "admin_protection")?.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "storage")?.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "supabase_schema_security")?.status).toBe("fail");
  });

  it("fails when live applied migration history is missing for private beta", async () => {
    process.env.ADMIN_CONSOLE_TOKEN = strongAdminToken;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_AUTH_REQUIRED = "1";
    process.env.MEMORY_REPOSITORY = "supabase";
    process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000001";
    process.env.APP_ACCESS_TOKEN = strongAppToken;

    const report = await getLaunchReadinessReport({
      schemaCheck: async () => schemaResult(true),
      appliedMigrations: async () =>
        appliedMigrationsResult({
          ok: false,
          rows: [
            {
              version: "001",
              file: "001_ai_native_memory_engine.sql",
              expectedName: "ai_native_memory_engine",
              applied: false,
              remoteName: "",
              requiredFor: "private_beta",
              checksum: "checksum-001",
              shortChecksum: "checksum-001",
              purpose: "Base schema"
            }
          ],
          missingVersions: ["001"]
        })
    });

    expect(report.configReadyForPrivateBeta).toBe(false);
    expect(report.checks.find((check) => check.id === "supabase_schema_security")?.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "supabase_schema_security")?.detail).toContain("001_ai_native_memory_engine.sql");
  });

  it("fails public launch when public-launch applied migrations are missing even if schema checks pass", async () => {
    process.env.ADMIN_CONSOLE_TOKEN = strongAdminToken;
    process.env.APP_ACCESS_TOKEN = strongAppToken;
    process.env.SAYVE_ENV_TARGET = "public-launch";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_AUTH_REQUIRED = "1";
    process.env.MEMORY_REPOSITORY = "supabase";
    process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000001";
    process.env.OPENAI_API_KEY = "openai-key";
    setSmokeProof();
    setAllModelEnv();
    setAiMediaLimits();
    setAllPricingEnv();
    setMediaUploadLimits();

    const report = await getLaunchReadinessReport({
      schemaCheck: async () => schemaResult(true),
      appliedMigrations: async () =>
        appliedMigrationsResult({
          ok: false,
          rows: [
            {
              version: "001",
              file: "001_ai_native_memory_engine.sql",
              expectedName: "ai_native_memory_engine",
              applied: true,
              remoteName: "ai_native_memory_engine",
              requiredFor: "private_beta",
              checksum: "checksum-001",
              shortChecksum: "checksum-001",
              purpose: "Base schema"
            },
            {
              version: "012",
              file: "012_harden_ai_telemetry_constraints.sql",
              expectedName: "harden_ai_telemetry_constraints",
              applied: false,
              remoteName: "",
              requiredFor: "public_launch",
              checksum: "checksum-012",
              shortChecksum: "checksum-012",
              purpose: "Telemetry constraints"
            }
          ],
          missingVersions: ["012"]
        })
    });

    expect(report.readyForPublicLaunch).toBe(false);
    expect(report.checks.find((check) => check.id === "supabase_schema_security")?.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "supabase_schema_security")?.detail).toContain("012_harden_ai_telemetry_constraints.sql");
  });

  it("passes private beta config checks when admin and Supabase env are configured", async () => {
    process.env.ADMIN_CONSOLE_TOKEN = strongAdminToken;
    process.env.NEXT_PUBLIC_APP_URL = "https://sayve.app";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_AUTH_REQUIRED = "1";
    process.env.MEMORY_REPOSITORY = "supabase";
    process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000001";
    process.env.APP_ACCESS_TOKEN = strongAppToken;
    process.env.OPENAI_API_KEY = "openai-key";
    setAllModelEnv();
    process.env.OPENAI_CAPTURE_INPUT_USD_PER_1M = "0.15";

    const report = await getLaunchReadinessReport({
      schemaCheck: async () => schemaResult(true),
      founderTelemetry: async () => completeTelemetry()
    });

    expect(report.configReadyForPrivateBeta).toBe(true);
    expect(report.liveSmokeVerified).toBe(false);
    expect(report.readyForPublicLaunch).toBe(false);
    expect(report.checks.find((check) => check.id === "admin_protection")?.status).toBe("pass");
    expect(report.checks.find((check) => check.id === "storage")?.status).toBe("pass");
    expect(report.checks.find((check) => check.id === "supabase_auth_required")?.status).toBe("pass");
    expect(report.checks.find((check) => check.id === "supabase_anon_key")?.status).toBe("pass");
    expect(report.checks.find((check) => check.id === "openai_key")?.status).toBe("pass");
    expect(report.checks.find((check) => check.id === "supabase_schema_security")?.status).toBe("pass");
    expect(report.checks.find((check) => check.id === "secret_strength")?.status).toBe("pass");
    expect(report.checks.find((check) => check.id === "onboarding_health")?.status).toBe("pass");
    expect(report.checks.find((check) => check.id === "app_base_url")?.status).toBe("pass");
  });

  it("warns in private beta when founder onboarding health cannot be read", async () => {
    process.env.ADMIN_CONSOLE_TOKEN = strongAdminToken;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_AUTH_REQUIRED = "1";
    process.env.MEMORY_REPOSITORY = "supabase";
    process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000001";
    process.env.APP_ACCESS_TOKEN = strongAppToken;

    const report = await buildLaunchReadinessReport({
      schemaCheck: async () => schemaResult(true),
      appliedMigrations: async () => appliedMigrationsResult(),
      founderTelemetry: async () => {
        throw new Error("founder read failed");
      }
    });

    expect(report.checks.find((check) => check.id === "onboarding_health")?.status).toBe("warn");
    expect(report.checks.find((check) => check.id === "onboarding_health")?.detail).toContain("founder read failed");
  });

  it("fails public launch readiness when founder onboarding health is missing", async () => {
    process.env.ADMIN_CONSOLE_TOKEN = strongAdminToken;
    process.env.APP_ACCESS_TOKEN = strongAppToken;
    process.env.SAYVE_ENV_TARGET = "public-launch";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_AUTH_REQUIRED = "1";
    process.env.MEMORY_REPOSITORY = "supabase";
    process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000001";
    process.env.OPENAI_API_KEY = "openai-key";
    setSmokeProof();
    setAllModelEnv();
    setAiMediaLimits();
    setAllPricingEnv();
    setMediaUploadLimits();

    const report = await buildLaunchReadinessReport({
      schemaCheck: async () => schemaResult(true),
      appliedMigrations: async () => appliedMigrationsResult(),
      founderTelemetry: async () => ({
        aiRuntimeHealth: {
          totalAiEvents: 4,
          telemetryCompletenessPercent: 100,
          budgetCoveragePercent: 100,
          budgetOverrunEvents: 0,
          missingTokenEvents: 0,
          missingCostEvents: 0,
          missingDurationEvents: 0
        }
      })
    });

    expect(report.readyForPublicLaunch).toBe(false);
    expect(report.checks.find((check) => check.id === "onboarding_health")?.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "onboarding_health")?.detail).toContain("missing");
  });

  it("blocks private beta readiness when OpenAI is enabled without pinned model env", async () => {
    process.env.ADMIN_CONSOLE_TOKEN = strongAdminToken;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_AUTH_REQUIRED = "1";
    process.env.MEMORY_REPOSITORY = "supabase";
    process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000001";
    process.env.APP_ACCESS_TOKEN = strongAppToken;
    process.env.OPENAI_API_KEY = "openai-key";

    const report = await getLaunchReadinessReport({ schemaCheck: async () => schemaResult(true) });

    expect(report.configReadyForPrivateBeta).toBe(false);
    expect(report.readyForPublicLaunch).toBe(false);
    expect(report.checks.find((check) => check.id === "ai_model_config")?.status).toBe("warn");
    expect(report.checks.find((check) => check.id === "ai_model_config")?.detail).toContain("OPENAI_CAPTURE_MODEL");
  });

  it("blocks private beta readiness when OpenAI is enabled without AI media guardrails", async () => {
    process.env.ADMIN_CONSOLE_TOKEN = strongAdminToken;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_AUTH_REQUIRED = "1";
    process.env.MEMORY_REPOSITORY = "supabase";
    process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000001";
    process.env.APP_ACCESS_TOKEN = strongAppToken;
    process.env.OPENAI_API_KEY = "openai-key";
    setAllModelEnv();

    const report = await getLaunchReadinessReport({ schemaCheck: async () => schemaResult(true) });

    expect(report.configReadyForPrivateBeta).toBe(false);
    expect(report.checks.find((check) => check.id === "ai_media_limits")?.status).toBe("warn");
    expect(report.checks.find((check) => check.id === "ai_media_limits")?.detail).toContain("AUDIO_TRANSCRIPTION_MAX_BYTES");
  });

  it("blocks private beta readiness when browser Supabase URL is missing", async () => {
    process.env.ADMIN_CONSOLE_TOKEN = strongAdminToken;
    process.env.APP_ACCESS_TOKEN = strongAppToken;
    process.env.NEXT_PUBLIC_APP_URL = "https://sayve.app";
    process.env.SUPABASE_URL = "https://server-only.supabase.co";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_AUTH_REQUIRED = "1";
    process.env.MEMORY_REPOSITORY = "supabase";
    process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000001";

    const report = await getLaunchReadinessReport({ schemaCheck: async () => schemaResult(true) });

    expect(report.configReadyForPrivateBeta).toBe(false);
    expect(report.readyForPublicLaunch).toBe(false);
    expect(report.checks.find((check) => check.id === "supabase_anon_key")?.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "supabase_anon_key")?.detail).toContain("NEXT_PUBLIC_SUPABASE_URL");
  });

  it("warns in private beta when app base url is missing", async () => {
    process.env.ADMIN_CONSOLE_TOKEN = strongAdminToken;
    process.env.APP_ACCESS_TOKEN = strongAppToken;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_AUTH_REQUIRED = "1";
    process.env.MEMORY_REPOSITORY = "supabase";
    process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000001";

    const report = await getLaunchReadinessReport({ schemaCheck: async () => schemaResult(true) });

    expect(report.configReadyForPrivateBeta).toBe(false);
    expect(report.checks.find((check) => check.id === "app_base_url")?.status).toBe("warn");
    expect(report.checks.find((check) => check.id === "app_base_url")?.detail).toContain("window.location.origin");
  });

  it("fails public launch readiness when app base url is missing", async () => {
    process.env.ADMIN_CONSOLE_TOKEN = strongAdminToken;
    process.env.APP_ACCESS_TOKEN = strongAppToken;
    process.env.SAYVE_ENV_TARGET = "public-launch";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_AUTH_REQUIRED = "1";
    process.env.MEMORY_REPOSITORY = "supabase";
    process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000001";
    process.env.SUPABASE_MEDIA_BUCKET = "sayve-capture-media";
    process.env.OPENAI_API_KEY = "openai-key";
    setSmokeProof();
    setAllModelEnv();
    setAllPricingEnv();
    setMediaUploadLimits();

    const report = await getLaunchReadinessReport({ schemaCheck: async () => schemaResult(true) });

    expect(report.readyForPublicLaunch).toBe(false);
    expect(report.checks.find((check) => check.id === "app_base_url")?.status).toBe("fail");
  });

  it("blocks readiness when browser auth and server storage use different Supabase projects", async () => {
    process.env.ADMIN_CONSOLE_TOKEN = strongAdminToken;
    process.env.APP_ACCESS_TOKEN = strongAppToken;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://browser-project.supabase.co";
    process.env.SUPABASE_URL = "https://server-project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_AUTH_REQUIRED = "1";
    process.env.MEMORY_REPOSITORY = "supabase";
    process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000001";

    const report = await getLaunchReadinessReport({ schemaCheck: async () => schemaResult(true) });
    const check = report.checks.find((item) => item.id === "supabase_url_consistency");

    expect(report.configReadyForPrivateBeta).toBe(false);
    expect(report.readyForPublicLaunch).toBe(false);
    expect(report.status).toBe("fail");
    expect(check?.status).toBe("fail");
    expect(check?.detail).toContain("browser-project.supabase.co");
    expect(check?.detail).toContain("server-project.supabase.co");
  });

  it("blocks readiness when Supabase service role and browser anon keys are reused", async () => {
    process.env.ADMIN_CONSOLE_TOKEN = strongAdminToken;
    process.env.APP_ACCESS_TOKEN = strongAppToken;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "same-supabase-key";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "same-supabase-key";
    process.env.SUPABASE_AUTH_REQUIRED = "1";
    process.env.MEMORY_REPOSITORY = "supabase";
    process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000001";

    const report = await getLaunchReadinessReport({ schemaCheck: async () => schemaResult(true) });
    const check = report.checks.find((item) => item.id === "supabase_key_boundary");

    expect(report.configReadyForPrivateBeta).toBe(false);
    expect(report.readyForPublicLaunch).toBe(false);
    expect(report.status).toBe("fail");
    expect(check?.status).toBe("fail");
    expect(check?.detail).toContain("must be different");
  });

  it("blocks readiness when the server Supabase key is publishable", async () => {
    process.env.ADMIN_CONSOLE_TOKEN = strongAdminToken;
    process.env.APP_ACCESS_TOKEN = strongAppToken;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_publishable_wrong_server_key";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_AUTH_REQUIRED = "1";
    process.env.MEMORY_REPOSITORY = "supabase";
    process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000001";

    const report = await getLaunchReadinessReport({ schemaCheck: async () => schemaResult(true) });
    const check = report.checks.find((item) => item.id === "supabase_key_boundary");

    expect(report.configReadyForPrivateBeta).toBe(false);
    expect(report.readyForPublicLaunch).toBe(false);
    expect(report.status).toBe("fail");
    expect(check?.status).toBe("fail");
    expect(check?.detail).toContain("publishable key");
  });

  it("keeps private beta readiness blocked when production storage is still local", async () => {
    process.env.ADMIN_CONSOLE_TOKEN = strongAdminToken;
    process.env.APP_ACCESS_TOKEN = strongAppToken;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_AUTH_REQUIRED = "1";
    process.env.MEMORY_REPOSITORY = "local_file";
    process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000001";

    const report = await getLaunchReadinessReport({ schemaCheck: async () => schemaResult(true) });

    expect(report.configReadyForPrivateBeta).toBe(false);
    expect(report.readyForPublicLaunch).toBe(false);
    expect(report.status).toBe("warn");
    expect(report.checks.find((check) => check.id === "repository_mode")?.status).toBe("warn");
  });

  it("keeps private beta readiness blocked without the private beta access token", async () => {
    process.env.ADMIN_CONSOLE_TOKEN = strongAdminToken;
    delete process.env.APP_ACCESS_TOKEN;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_AUTH_REQUIRED = "1";
    process.env.MEMORY_REPOSITORY = "supabase";
    process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000001";

    const report = await getLaunchReadinessReport({ schemaCheck: async () => schemaResult(true) });

    expect(report.configReadyForPrivateBeta).toBe(false);
    expect(report.readyForPublicLaunch).toBe(false);
    expect(report.status).toBe("warn");
    expect(report.checks.find((check) => check.id === "private_beta_access")?.status).toBe("warn");
    expect(report.checks.find((check) => check.id === "secret_strength")?.status).toBe("warn");
  });

  it("requires an explicit live smoke marker before public launch readiness", async () => {
    process.env.ADMIN_CONSOLE_TOKEN = strongAdminToken;
    process.env.APP_ACCESS_TOKEN = strongAppToken;
    process.env.NEXT_PUBLIC_APP_URL = "https://sayve.app";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_AUTH_REQUIRED = "1";
    process.env.MEMORY_REPOSITORY = "supabase";
    process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000001";
    process.env.SUPABASE_MEDIA_BUCKET = "sayve-capture-media";
    process.env.OPENAI_API_KEY = "openai-key";
    setAllModelEnv();
    setAiMediaLimits();
    setAllPricingEnv();
    setMediaUploadLimits();
    setSmokeProof();

    const report = await getLaunchReadinessReport({ schemaCheck: async () => schemaResult(true) });

    expect(report.liveSmokeVerified).toBe(true);
    expect(report.readyForPublicLaunch).toBe(true);
    expect(report.checks.find((check) => check.id === "deployment_smoke")?.status).toBe("pass");
    expect(report.checks.find((check) => check.id === "ai_model_config")?.status).toBe("pass");
    expect(report.checks.find((check) => check.id === "cost_pricing")?.status).toBe("pass");
    expect(report.checks.find((check) => check.id === "ai_telemetry_completeness")?.status).toBe("pass");
    expect(report.checks.find((check) => check.id === "media_storage")?.status).toBe("pass");
    expect(report.checks.find((check) => check.id === "media_upload_limits")?.status).toBe("pass");
  });

  it("warns when the media bucket exists but no server smoke proof was collected yet", async () => {
    process.env.ADMIN_CONSOLE_TOKEN = strongAdminToken;
    process.env.APP_ACCESS_TOKEN = strongAppToken;
    process.env.NEXT_PUBLIC_APP_URL = "https://sayve.app";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_AUTH_REQUIRED = "1";
    process.env.MEMORY_REPOSITORY = "supabase";
    process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000001";
    process.env.SUPABASE_MEDIA_BUCKET = "sayve-capture-media";
    process.env.SAYVE_ENV_TARGET = "public-launch";
    process.env.OPENAI_API_KEY = "openai-key";
    setAllModelEnv();
    setAiMediaLimits();
    setAllPricingEnv();
    setMediaUploadLimits();
    setSmokeProof();

    const report = await getLaunchReadinessReport({
      schemaCheck: async () => schemaResult(true),
      mediaStorageSmoke: async () => undefined as never
    });

    expect(report.readyForPublicLaunch).toBe(false);
    expect(report.checks.find((check) => check.id === "media_storage")?.status).toBe("warn");
    expect(report.checks.find((check) => check.id === "media_storage")?.detail).toContain("no live server write/delete smoke proof");
  });

  it("fails public launch when the configured media bucket cannot pass server smoke", async () => {
    process.env.ADMIN_CONSOLE_TOKEN = strongAdminToken;
    process.env.APP_ACCESS_TOKEN = strongAppToken;
    process.env.NEXT_PUBLIC_APP_URL = "https://sayve.app";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_AUTH_REQUIRED = "1";
    process.env.MEMORY_REPOSITORY = "supabase";
    process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000001";
    process.env.SUPABASE_MEDIA_BUCKET = "sayve-capture-media";
    process.env.SAYVE_ENV_TARGET = "public-launch";
    process.env.OPENAI_API_KEY = "openai-key";
    setAllModelEnv();
    setAiMediaLimits();
    setAllPricingEnv();
    setMediaUploadLimits();
    setSmokeProof();

    const report = await getLaunchReadinessReport({
      schemaCheck: async () => schemaResult(true),
      mediaStorageSmoke: async () => ({
        configured: true,
        ok: false,
        bucket: "sayve-capture-media",
        detail: "Upload failed: permission denied"
      })
    });

    expect(report.readyForPublicLaunch).toBe(false);
    expect(report.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "media_storage")?.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "media_storage")?.detail).toContain("permission denied");
  });

  it("blocks public launch when smoke proof metadata is missing or mismatched", async () => {
    process.env.ADMIN_CONSOLE_TOKEN = strongAdminToken;
    process.env.APP_ACCESS_TOKEN = strongAppToken;
    process.env.NEXT_PUBLIC_APP_URL = "https://sayve.app";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_AUTH_REQUIRED = "1";
    process.env.MEMORY_REPOSITORY = "supabase";
    process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000001";
    process.env.SUPABASE_MEDIA_BUCKET = "sayve-capture-media";
    process.env.OPENAI_API_KEY = "openai-key";
    process.env.SAYVE_ENV_TARGET = "public-launch";
    setAllModelEnv();
    setAllPricingEnv();
    setMediaUploadLimits();
    process.env.SAYVE_DEPLOYMENT_SMOKE_VERIFIED = "1";
    delete process.env.SAYVE_DEPLOYMENT_SMOKE_VERIFIED_AT;
    delete process.env.SAYVE_DEPLOYMENT_SMOKE_TARGET;

    const missing = await getLaunchReadinessReport({ schemaCheck: async () => schemaResult(true) });
    expect(missing.readyForPublicLaunch).toBe(false);
    expect(missing.checks.find((check) => check.id === "deployment_smoke")?.status).toBe("fail");
    expect(missing.checks.find((check) => check.id === "deployment_smoke")?.detail).toContain("SAYVE_DEPLOYMENT_SMOKE_VERIFIED_AT");

    setSmokeProof("https://preview.sayve.app");
    const mismatched = await getLaunchReadinessReport({ schemaCheck: async () => schemaResult(true) });
    expect(mismatched.readyForPublicLaunch).toBe(false);
    expect(mismatched.checks.find((check) => check.id === "deployment_smoke")?.detail).toContain("NEXT_PUBLIC_APP_URL host");
    expect(mismatched.smokeProof.targetUrl).toBe("https://preview.sayve.app");
  });

  it("keeps public launch readiness blocked when AI telemetry has not been proven by smoke", async () => {
    process.env.ADMIN_CONSOLE_TOKEN = strongAdminToken;
    process.env.APP_ACCESS_TOKEN = strongAppToken;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_AUTH_REQUIRED = "1";
    process.env.MEMORY_REPOSITORY = "supabase";
    process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000001";
    process.env.SUPABASE_MEDIA_BUCKET = "sayve-capture-media";
    process.env.OPENAI_API_KEY = "openai-key";
    process.env.SAYVE_ENV_TARGET = "public-launch";
    setAllModelEnv();
    setAllPricingEnv();
    setMediaUploadLimits();
    setSmokeProof();

    const report = await getLaunchReadinessReport({
      schemaCheck: async () => schemaResult(true),
      founderTelemetry: async () => ({
        aiRuntimeHealth: {
          totalAiEvents: 0,
          telemetryCompletenessPercent: 0,
          budgetCoveragePercent: 0,
          budgetOverrunEvents: 0,
          missingTokenEvents: 0,
          missingCostEvents: 0,
          missingDurationEvents: 0
        }
      })
    });

    expect(report.readyForPublicLaunch).toBe(false);
    expect(report.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "ai_telemetry_completeness")?.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "ai_telemetry_completeness")?.detail).toContain("No AI telemetry events");
  });

  it("keeps public launch readiness blocked when telemetry is missing cost token or latency fields", async () => {
    process.env.ADMIN_CONSOLE_TOKEN = strongAdminToken;
    process.env.APP_ACCESS_TOKEN = strongAppToken;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_AUTH_REQUIRED = "1";
    process.env.MEMORY_REPOSITORY = "supabase";
    process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000001";
    process.env.SUPABASE_MEDIA_BUCKET = "sayve-capture-media";
    process.env.OPENAI_API_KEY = "openai-key";
    process.env.SAYVE_ENV_TARGET = "public-launch";
    setAllModelEnv();
    setAllPricingEnv();
    setMediaUploadLimits();
    setSmokeProof();

    const report = await getLaunchReadinessReport({
      schemaCheck: async () => schemaResult(true),
      founderTelemetry: async () => ({
        aiRuntimeHealth: {
          totalAiEvents: 4,
          telemetryCompletenessPercent: 75,
          budgetCoveragePercent: 100,
          budgetOverrunEvents: 0,
          missingTokenEvents: 1,
          missingCostEvents: 1,
          missingDurationEvents: 1
        }
      })
    });

    expect(report.readyForPublicLaunch).toBe(false);
    expect(report.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "ai_telemetry_completeness")?.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "ai_telemetry_completeness")?.detail).toContain("75%");
  });

  it("keeps public launch readiness blocked until receipt and voice media storage is configured", async () => {
    process.env.ADMIN_CONSOLE_TOKEN = strongAdminToken;
    process.env.APP_ACCESS_TOKEN = strongAppToken;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_AUTH_REQUIRED = "1";
    process.env.MEMORY_REPOSITORY = "supabase";
    process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000001";
    process.env.SAYVE_ENV_TARGET = "public-launch";
    process.env.OPENAI_API_KEY = "openai-key";
    setAllModelEnv();
    setAllPricingEnv();
    setSmokeProof();

    const report = await getLaunchReadinessReport({ schemaCheck: async () => schemaResult(true) });

    expect(report.readyForPublicLaunch).toBe(false);
    expect(report.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "media_storage")?.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "media_storage")?.detail).toContain("SAYVE_ENV_TARGET=public-launch");
  });

  it("fails media storage readiness when required media storage is enabled outside public launch", async () => {
    process.env.ADMIN_CONSOLE_TOKEN = strongAdminToken;
    process.env.APP_ACCESS_TOKEN = strongAppToken;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_AUTH_REQUIRED = "1";
    process.env.MEMORY_REPOSITORY = "supabase";
    process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000001";
    process.env.SAYVE_REQUIRE_MEDIA_STORAGE = "1";
    setAllModelEnv();
    setAllPricingEnv();

    const report = await getLaunchReadinessReport({ schemaCheck: async () => schemaResult(true) });

    expect(report.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "media_storage")?.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "media_storage")?.detail).toContain("SAYVE_REQUIRE_MEDIA_STORAGE=1");
  });

  it("blocks readiness when receipt or voice upload limits are invalid", async () => {
    process.env.ADMIN_CONSOLE_TOKEN = strongAdminToken;
    process.env.APP_ACCESS_TOKEN = strongAppToken;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_AUTH_REQUIRED = "1";
    process.env.MEMORY_REPOSITORY = "supabase";
    process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000001";
    process.env.SUPABASE_MEDIA_BUCKET = "sayve-capture-media";
    process.env.OPENAI_API_KEY = "openai-key";
    process.env.RECEIPT_UPLOAD_MAX_BYTES = "0";
    process.env.VOICE_UPLOAD_MAX_BYTES = "not-a-number";
    setAllModelEnv();
    setAllPricingEnv();
    setSmokeProof();

    const report = await getLaunchReadinessReport({ schemaCheck: async () => schemaResult(true) });

    expect(report.readyForPublicLaunch).toBe(false);
    expect(report.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "media_upload_limits")?.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "media_upload_limits")?.detail).toContain("RECEIPT_UPLOAD_MAX_BYTES");
    expect(report.checks.find((check) => check.id === "media_upload_limits")?.detail).toContain("VOICE_UPLOAD_MAX_BYTES");
  });

  it("keeps public launch readiness blocked until receipt and voice upload limits are explicitly configured", async () => {
    process.env.ADMIN_CONSOLE_TOKEN = strongAdminToken;
    process.env.APP_ACCESS_TOKEN = strongAppToken;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_AUTH_REQUIRED = "1";
    process.env.MEMORY_REPOSITORY = "supabase";
    process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000001";
    process.env.SUPABASE_MEDIA_BUCKET = "sayve-capture-media";
    process.env.OPENAI_API_KEY = "openai-key";
    process.env.SAYVE_ENV_TARGET = "public-launch";
    setAllModelEnv();
    setAllPricingEnv();
    setSmokeProof();

    const report = await getLaunchReadinessReport({ schemaCheck: async () => schemaResult(true) });

    expect(report.readyForPublicLaunch).toBe(false);
    expect(report.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "media_upload_limits")?.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "media_upload_limits")?.detail).toContain("RECEIPT_UPLOAD_MAX_BYTES");
    expect(report.checks.find((check) => check.id === "media_upload_limits")?.detail).toContain("VOICE_UPLOAD_MAX_BYTES");
  });

  it("keeps public launch readiness blocked until model env values are pinned", async () => {
    process.env.ADMIN_CONSOLE_TOKEN = strongAdminToken;
    process.env.APP_ACCESS_TOKEN = strongAppToken;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_AUTH_REQUIRED = "1";
    process.env.MEMORY_REPOSITORY = "supabase";
    process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000001";
    process.env.OPENAI_API_KEY = "openai-key";
    process.env.SUPABASE_MEDIA_BUCKET = "sayve-capture-media";
    process.env.SAYVE_ENV_TARGET = "public-launch";
    setAllPricingEnv();
    setMediaUploadLimits();
    setSmokeProof();

    const report = await getLaunchReadinessReport({ schemaCheck: async () => schemaResult(true) });

    expect(report.readyForPublicLaunch).toBe(false);
    expect(report.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "ai_model_config")?.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "ai_model_config")?.detail).toContain("OPENAI_CONVERSATION_MODEL");
    expect(report.checks.find((check) => check.id === "ai_model_config")?.detail).toContain("OPENAI_ESCALATION_MODEL");
  });

  it("fails public launch readiness when OpenAI key is missing", async () => {
    process.env.ADMIN_CONSOLE_TOKEN = strongAdminToken;
    process.env.APP_ACCESS_TOKEN = strongAppToken;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_AUTH_REQUIRED = "1";
    process.env.MEMORY_REPOSITORY = "supabase";
    process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000001";
    process.env.SUPABASE_MEDIA_BUCKET = "sayve-capture-media";
    process.env.SAYVE_ENV_TARGET = "public-launch";
    setAllModelEnv();
    setAllPricingEnv();
    setMediaUploadLimits();
    setSmokeProof();

    const report = await getLaunchReadinessReport({ schemaCheck: async () => schemaResult(true) });

    expect(report.readyForPublicLaunch).toBe(false);
    expect(report.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "openai_key")?.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "openai_key")?.detail).toContain("SAYVE_ENV_TARGET=public-launch");
  });

  it("keeps public launch readiness blocked until all pricing env values are configured", async () => {
    process.env.ADMIN_CONSOLE_TOKEN = strongAdminToken;
    process.env.APP_ACCESS_TOKEN = strongAppToken;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_AUTH_REQUIRED = "1";
    process.env.MEMORY_REPOSITORY = "supabase";
    process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000001";
    process.env.OPENAI_API_KEY = "openai-key";
    process.env.SUPABASE_MEDIA_BUCKET = "sayve-capture-media";
    process.env.SAYVE_ENV_TARGET = "public-launch";
    setAllModelEnv();
    setMediaUploadLimits();
    process.env.OPENAI_CAPTURE_INPUT_USD_PER_1M = "0.15";
    setSmokeProof();

    const report = await getLaunchReadinessReport({ schemaCheck: async () => schemaResult(true) });

    expect(report.configReadyForPrivateBeta).toBe(false);
    expect(report.readyForPublicLaunch).toBe(false);
    expect(report.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "cost_pricing")?.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "cost_pricing")?.detail).toContain("OPENAI_STT_OUTPUT_USD_PER_1M");
  });

  it("keeps public launch readiness blocked when pricing env values are not numeric", async () => {
    process.env.ADMIN_CONSOLE_TOKEN = strongAdminToken;
    process.env.APP_ACCESS_TOKEN = strongAppToken;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_AUTH_REQUIRED = "1";
    process.env.MEMORY_REPOSITORY = "supabase";
    process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000001";
    process.env.OPENAI_API_KEY = "openai-key";
    process.env.SUPABASE_MEDIA_BUCKET = "sayve-capture-media";
    process.env.SAYVE_ENV_TARGET = "public-launch";
    setAllModelEnv();
    setAllPricingEnv();
    setMediaUploadLimits();
    process.env.OPENAI_CONVERSATION_OUTPUT_USD_PER_1M = "not-a-number";
    setSmokeProof();

    const report = await getLaunchReadinessReport({ schemaCheck: async () => schemaResult(true) });

    expect(report.readyForPublicLaunch).toBe(false);
    expect(report.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "cost_pricing")?.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "cost_pricing")?.detail).toContain("OPENAI_CONVERSATION_OUTPUT_USD_PER_1M");
  });

  it("requires a Supabase household id when Supabase repository mode is enabled", async () => {
    process.env.MEMORY_REPOSITORY = "supabase";
    delete process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID;

    const missing = await getLaunchReadinessReport({ schemaCheck: async () => schemaResult(true) });
    expect(missing.checks.find((check) => check.id === "repository_mode")?.status).toBe("pass");
    expect(missing.checks.find((check) => check.id === "supabase_household")?.status).toBe("fail");

    process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000001";
    const configured = await getLaunchReadinessReport({
      schemaCheck: async () => schemaResult(true),
      defaultHouseholdBinding: async () => ({ configured: true, exists: true, memberCount: 2, ownerCount: 1 })
    });
    expect(configured.checks.find((check) => check.id === "supabase_household")?.status).toBe("pass");
    expect(configured.checks.find((check) => check.id === "supabase_household")?.detail).toContain("2 household member");
    expect(configured.checks.find((check) => check.id === "supabase_household")?.detail).toContain("1 owner");
  });

  it("fails readiness when the configured Supabase default household does not exist", async () => {
    process.env.MEMORY_REPOSITORY = "supabase";
    process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000001";

    const report = await getLaunchReadinessReport({
      schemaCheck: async () => schemaResult(true),
      defaultHouseholdBinding: async () => ({ configured: true, exists: false })
    });

    expect(report.checks.find((check) => check.id === "supabase_household")?.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "supabase_household")?.detail).toContain("no matching household row exists");
  });

  it("warns in private beta when live default household verification errors, but fails for public launch", async () => {
    process.env.MEMORY_REPOSITORY = "supabase";
    process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000001";

    const privateBeta = await getLaunchReadinessReport({
      schemaCheck: async () => schemaResult(true),
      defaultHouseholdBinding: async () => ({ configured: true, exists: false, error: "network timeout" })
    });
    expect(privateBeta.checks.find((check) => check.id === "supabase_household")?.status).toBe("warn");

    process.env.SAYVE_ENV_TARGET = "public-launch";
    const publicLaunch = await getLaunchReadinessReport({
      schemaCheck: async () => schemaResult(true),
      defaultHouseholdBinding: async () => ({ configured: true, exists: false, error: "network timeout" })
    });
    expect(publicLaunch.checks.find((check) => check.id === "supabase_household")?.status).toBe("fail");
  });

  it("warns in private beta when AI budget telemetry is incomplete or over budget, but fails for public launch", async () => {
    const telemetry = {
      aiRuntimeHealth: {
        totalAiEvents: 2,
        telemetryCompletenessPercent: 100,
        budgetCoveragePercent: 50,
        budgetOverrunEvents: 1,
        missingTokenEvents: 0,
        missingCostEvents: 0,
        missingDurationEvents: 0
      },
      onboardingHealth: completeTelemetry().onboardingHealth
    };

    const privateBeta = await getLaunchReadinessReport({
      schemaCheck: async () => schemaResult(true),
      founderTelemetry: async () => telemetry
    });
    expect(privateBeta.checks.find((check) => check.id === "ai_budget_discipline")?.status).toBe("warn");
    expect(privateBeta.checks.find((check) => check.id === "ai_budget_discipline")?.detail).toContain("Budget coverage is 50%");
    expect(privateBeta.checks.find((check) => check.id === "ai_budget_discipline")?.detail).toContain("Budget overruns: 1");

    process.env.SAYVE_ENV_TARGET = "public-launch";
    const publicLaunch = await getLaunchReadinessReport({
      schemaCheck: async () => schemaResult(true),
      founderTelemetry: async () => telemetry
    });
    expect(publicLaunch.checks.find((check) => check.id === "ai_budget_discipline")?.status).toBe("fail");
  });

  it("passes AI budget discipline when telemetry coverage is complete and no overruns exist", async () => {
    const report = await getLaunchReadinessReport({
      schemaCheck: async () => schemaResult(true),
      founderTelemetry: async () => completeTelemetry()
    });

    expect(report.checks.find((check) => check.id === "ai_budget_discipline")?.status).toBe("pass");
    expect(report.checks.find((check) => check.id === "ai_budget_discipline")?.detail).toContain("no budget overruns");
  });

  it("fails readiness when the configured default household has no members yet", async () => {
    process.env.MEMORY_REPOSITORY = "supabase";
    process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000001";

    const report = await getLaunchReadinessReport({
      schemaCheck: async () => schemaResult(true),
      defaultHouseholdBinding: async () => ({ configured: true, exists: true, memberCount: 0, ownerCount: 0 })
    });

    expect(report.checks.find((check) => check.id === "supabase_household")?.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "supabase_household")?.detail).toContain("has no household members yet");
  });

  it("fails readiness when the configured default household has no owner member", async () => {
    process.env.MEMORY_REPOSITORY = "supabase";
    process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000001";

    const report = await getLaunchReadinessReport({
      schemaCheck: async () => schemaResult(true),
      defaultHouseholdBinding: async () => ({ configured: true, exists: true, memberCount: 2, ownerCount: 0 })
    });

    expect(report.checks.find((check) => check.id === "supabase_household")?.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "supabase_household")?.detail).toContain("has no owner role member yet");
  });

  it("blocks public launch when live Supabase schema/security checks fail", async () => {
    process.env.ADMIN_CONSOLE_TOKEN = strongAdminToken;
    process.env.APP_ACCESS_TOKEN = strongAppToken;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_AUTH_REQUIRED = "1";
    process.env.MEMORY_REPOSITORY = "supabase";
    process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000001";
    process.env.OPENAI_API_KEY = "openai-key";
    setAllModelEnv();
    process.env.OPENAI_CAPTURE_INPUT_USD_PER_1M = "0.15";
    setSmokeProof();

    const report = await getLaunchReadinessReport({ schemaCheck: async () => schemaResult(false) });

    expect(report.readyForPublicLaunch).toBe(false);
    expect(report.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "supabase_schema_security")?.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "supabase_schema_security")?.detail).toContain("005");
    expect(report.checks.find((check) => check.id === "supabase_schema_security")?.detail).toContain("Required migrations: 005_harden_household_role_policies, 007_harden_memory_interpretation_writer_policy");
  });

  it("blocks public launch when live Supabase schema/security response is missing required check ids", async () => {
    process.env.ADMIN_CONSOLE_TOKEN = strongAdminToken;
    process.env.APP_ACCESS_TOKEN = strongAppToken;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_AUTH_REQUIRED = "1";
    process.env.MEMORY_REPOSITORY = "supabase";
    process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000001";
    process.env.OPENAI_API_KEY = "openai-key";
    setAllModelEnv();
    setAllPricingEnv();
    setSmokeProof();

    const legacySchema = schemaResult(true);
    legacySchema.securityChecks = legacySchema.securityChecks.filter((check) => check.id !== "memory_facts_payload_shape");

    const report = await getLaunchReadinessReport({ schemaCheck: async () => legacySchema });

    expect(report.readyForPublicLaunch).toBe(false);
    expect(report.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "supabase_schema_security")?.status).toBe("fail");
    expect(report.checks.find((check) => check.id === "supabase_schema_security")?.detail).toContain("memory_facts_payload_shape");

    legacySchema.securityChecks = schemaResult(true).securityChecks.filter((check) => check.id !== "ai_telemetry_shape");
    const missingTelemetry = await getLaunchReadinessReport({ schemaCheck: async () => legacySchema });
    expect(missingTelemetry.readyForPublicLaunch).toBe(false);
    expect(missingTelemetry.checks.find((check) => check.id === "supabase_schema_security")?.detail).toContain("ai_telemetry_shape");
  });

  it("blocks public launch when private beta or admin tokens are weak or reused", async () => {
    process.env.ADMIN_CONSOLE_TOKEN = "secret";
    process.env.APP_ACCESS_TOKEN = "private-beta-token";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    process.env.SUPABASE_AUTH_REQUIRED = "1";
    process.env.MEMORY_REPOSITORY = "supabase";
    process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000001";
    process.env.OPENAI_API_KEY = "openai-key";
    setAllModelEnv();
    setAllPricingEnv();
    setSmokeProof();

    const weak = await getLaunchReadinessReport({ schemaCheck: async () => schemaResult(true) });
    expect(weak.readyForPublicLaunch).toBe(false);
    expect(weak.status).toBe("fail");
    expect(weak.checks.find((check) => check.id === "secret_strength")?.status).toBe("fail");
    expect(weak.checks.find((check) => check.id === "secret_strength")?.detail).toContain("placeholder-like");

    process.env.ADMIN_CONSOLE_TOKEN = "same_strong_access_value_123456";
    process.env.APP_ACCESS_TOKEN = "same_strong_access_value_123456";
    const reused = await getLaunchReadinessReport({ schemaCheck: async () => schemaResult(true) });
    expect(reused.readyForPublicLaunch).toBe(false);
    expect(reused.checks.find((check) => check.id === "secret_strength")?.detail).toContain("must be different");
  });
});
