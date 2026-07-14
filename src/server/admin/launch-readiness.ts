import { founderTokenRequired, getFounderConsoleData } from "@/server/admin/founder-console";
import { runCaptureMediaStorageSmokeTest, type CaptureMediaStorageSmokeResult } from "@/server/media/storage-smoke";
import { readAppliedSupabaseMigrations, type AppliedSupabaseMigrationsResult } from "@/server/memory/supabase-applied-migrations";
import { checkSupabaseSchema, type SupabaseSchemaCheckResult } from "@/server/memory/supabase-schema-check";
import { resolveMemoryRepositoryMode } from "@/server/memory/store";
import { usageLimits, usageLimitsDisabled } from "@/server/memory/usage";
import { createSupabaseServiceClient, supabaseServiceConfigured } from "@/server/supabase/service-client";

export type LaunchReadinessStatus = "pass" | "warn" | "fail";

export type LaunchReadinessCheck = {
  id: string;
  label: string;
  status: LaunchReadinessStatus;
  detail: string;
};

export type LaunchReadinessReport = {
  configReadyForPrivateBeta: boolean;
  liveSmokeVerified: boolean;
  readyForPublicLaunch: boolean;
  status: LaunchReadinessStatus;
  generatedAt: string;
  smokeProof: {
    verifiedAt: string;
    targetUrl: string;
    issues: string[];
  };
  checks: LaunchReadinessCheck[];
};

export type LaunchReadinessOptions = {
  schemaCheck?: () => Promise<SupabaseSchemaCheckResult>;
  appliedMigrations?: () => Promise<AppliedSupabaseMigrationsResult>;
  founderTelemetry?: () => Promise<FounderTelemetryReadiness>;
  defaultHouseholdBinding?: () => Promise<DefaultHouseholdBindingReadiness>;
  mediaStorageSmoke?: () => Promise<CaptureMediaStorageSmokeResult | undefined>;
};

type FounderTelemetryReadiness = {
  aiRuntimeHealth: {
    totalAiEvents: number;
    telemetryCompletenessPercent: number;
    budgetCoveragePercent: number;
    budgetOverrunEvents: number;
    missingTokenEvents: number;
    missingCostEvents: number;
    missingDurationEvents: number;
  };
  onboardingHealth?: {
    configured: boolean;
    totalInvites: number;
    pendingInvites: number;
    acceptedInvites: number;
    expiredInvites: number;
    emailLockedInvites: number;
    issue: string;
  };
};

type DefaultHouseholdBindingReadiness = {
  configured: boolean;
  exists: boolean;
  memberCount?: number;
  ownerCount?: number;
  error?: string;
};

function envPresent(name: string): boolean {
  const value = process.env[name];
  return Boolean(value && value.trim());
}

function envValue(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function publicLaunchTarget(): boolean {
  return process.env.SAYVE_ENV_TARGET === "public-launch";
}

function validUrlEnv(name: string): boolean {
  const raw = envValue(name);
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" || parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function urlHostEnv(name: string): string {
  const raw = envValue(name);
  if (!raw) return "";
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function validAppBaseUrl(raw: string): boolean {
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" || parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function validIsoTimestamp(raw: string): boolean {
  if (!raw) return false;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed);
}

function deploymentSmokeProof() {
  const verified = process.env.SAYVE_DEPLOYMENT_SMOKE_VERIFIED === "1";
  const verifiedAt = envValue("SAYVE_DEPLOYMENT_SMOKE_VERIFIED_AT");
  const targetUrl = envValue("SAYVE_DEPLOYMENT_SMOKE_TARGET");
  const issues: string[] = [];

  if (verified) {
    if (!verifiedAt) {
      issues.push("SAYVE_DEPLOYMENT_SMOKE_VERIFIED_AT is missing.");
    } else if (!validIsoTimestamp(verifiedAt)) {
      issues.push("SAYVE_DEPLOYMENT_SMOKE_VERIFIED_AT must be a valid ISO timestamp.");
    }

    if (!targetUrl) {
      issues.push("SAYVE_DEPLOYMENT_SMOKE_TARGET is missing.");
    } else if (!validAppBaseUrl(targetUrl)) {
      issues.push("SAYVE_DEPLOYMENT_SMOKE_TARGET must be a valid deployment URL.");
    }

    const appBaseUrl = envValue("NEXT_PUBLIC_APP_URL");
    if (appBaseUrl && validAppBaseUrl(appBaseUrl) && targetUrl && validAppBaseUrl(targetUrl)) {
      if (urlHostEnv("NEXT_PUBLIC_APP_URL") !== (() => {
        try {
          return new URL(targetUrl).hostname.toLowerCase();
        } catch {
          return "";
        }
      })()) {
        issues.push("SAYVE_DEPLOYMENT_SMOKE_TARGET should match the deployed NEXT_PUBLIC_APP_URL host.");
      }
    }
  }

  return {
    verified,
    verifiedAt,
    targetUrl,
    issues
  };
}

function appBaseUrlReadinessCheck(): LaunchReadinessCheck {
  const raw = envValue("NEXT_PUBLIC_APP_URL");
  if (!raw) {
    return {
      id: "app_base_url",
      label: "App base URL",
      status: publicLaunchTarget() ? "fail" : "warn",
      detail:
        "NEXT_PUBLIC_APP_URL is not configured. Browser auth currently falls back to window.location.origin, which is acceptable locally but fragile for OAuth redirects across preview/custom domains."
    };
  }

  if (!validAppBaseUrl(raw)) {
    return {
      id: "app_base_url",
      label: "App base URL",
      status: "fail",
      detail: "NEXT_PUBLIC_APP_URL must be a valid https URL (or localhost/127.0.0.1 for local testing)."
    };
  }

  return {
    id: "app_base_url",
    label: "App base URL",
    status: "pass",
    detail: "Browser auth and invite redirects use NEXT_PUBLIC_APP_URL as the stable origin."
  };
}

function secretIssues(name: string): string[] {
  const raw = envValue(name);
  if (!raw) return ["missing"];
  const lower = raw.toLowerCase();
  const placeholderValues = new Set([
    "secret",
    "admin",
    "password",
    "token",
    "changeme",
    "change-me",
    "private-beta",
    "private-beta-token",
    "admin-token",
    "app-token",
    "test",
    "demo"
  ]);
  const issues: string[] = [];
  if (raw.length < 24) issues.push("too short");
  if (placeholderValues.has(lower) || lower.startsWith("your-") || lower.startsWith("your_") || lower.includes("example") || lower.includes("...")) {
    issues.push("placeholder-like");
  }
  return issues;
}

function secretStrengthReadinessCheck(): LaunchReadinessCheck {
  const appIssues = secretIssues("APP_ACCESS_TOKEN");
  const adminIssues = secretIssues("ADMIN_CONSOLE_TOKEN");
  const sameSecret = envPresent("APP_ACCESS_TOKEN") && envPresent("ADMIN_CONSOLE_TOKEN") && envValue("APP_ACCESS_TOKEN") === envValue("ADMIN_CONSOLE_TOKEN");
  const configured = appIssues.length === 0 && adminIssues.length === 0 && !sameSecret;
  if (configured) {
    return {
      id: "secret_strength",
      label: "Admin/private beta token strength",
      status: "pass",
      detail: "APP_ACCESS_TOKEN and ADMIN_CONSOLE_TOKEN are strong enough and use separate values."
    };
  }

  const missingOnly =
    !sameSecret &&
    [...appIssues, ...adminIssues].every((issue) => issue === "missing") &&
    (appIssues.includes("missing") || adminIssues.includes("missing"));
  if (missingOnly) {
    return {
      id: "secret_strength",
      label: "Admin/private beta token strength",
      status: "warn",
      detail: "Token strength cannot be checked until APP_ACCESS_TOKEN and ADMIN_CONSOLE_TOKEN are configured."
    };
  }

  const details = [
    appIssues.length > 0 ? `APP_ACCESS_TOKEN: ${appIssues.join(", ")}` : "",
    adminIssues.length > 0 ? `ADMIN_CONSOLE_TOKEN: ${adminIssues.join(", ")}` : "",
    sameSecret ? "APP_ACCESS_TOKEN and ADMIN_CONSOLE_TOKEN must be different" : ""
  ].filter(Boolean);
  return {
    id: "secret_strength",
    label: "Admin/private beta token strength",
    status: "fail",
    detail: details.join(" | ")
  };
}

function hasAnyPricingEnv(): boolean {
  return pricingEnvNames().some(envPresent);
}

function pricingEnvNames(): string[] {
  return [
    "OPENAI_CAPTURE_INPUT_USD_PER_1M",
    "OPENAI_CAPTURE_OUTPUT_USD_PER_1M",
    "OPENAI_RECEIPT_VISION_INPUT_USD_PER_1M",
    "OPENAI_RECEIPT_VISION_OUTPUT_USD_PER_1M",
    "OPENAI_CONVERSATION_INPUT_USD_PER_1M",
    "OPENAI_CONVERSATION_OUTPUT_USD_PER_1M",
    "OPENAI_STT_INPUT_USD_PER_1M",
    "OPENAI_STT_OUTPUT_USD_PER_1M"
  ];
}

function missingPricingEnv(): string[] {
  return pricingEnvNames().filter((name) => !envPresent(name));
}

function modelEnvNames(): string[] {
  return [
    "OPENAI_CAPTURE_MODEL",
    "OPENAI_CONVERSATION_MODEL",
    "OPENAI_ESCALATION_MODEL",
    "OPENAI_RECEIPT_VISION_MODEL",
    "OPENAI_SPEECH_TO_TEXT_MODEL"
  ];
}

function aiMediaLimitEnvNames(): string[] {
  return ["AUDIO_TRANSCRIPTION_MAX_BYTES", "RECEIPT_VISION_MAX_BYTES"];
}

function missingModelEnv(): string[] {
  return modelEnvNames().filter((name) => !envPresent(name));
}

function missingAiMediaLimitEnv(): string[] {
  return aiMediaLimitEnvNames().filter((name) => !envPresent(name));
}

function pricingValueIsValid(name: string): boolean {
  const raw = process.env[name]?.trim();
  if (!raw) return false;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0;
}

function invalidPricingEnv(): string[] {
  return pricingEnvNames().filter((name) => envPresent(name) && !pricingValueIsValid(name));
}

function pricingReadinessCheck(): LaunchReadinessCheck {
  const missing = missingPricingEnv();
  const invalid = invalidPricingEnv();
  const publicLaunch = publicLaunchTarget();
  if (missing.length === 0) {
    if (invalid.length > 0) {
      return {
        id: "cost_pricing",
        label: "AI cost pricing env",
        status: publicLaunch ? "fail" : "warn",
        detail: `Some pricing env values are not valid non-negative numbers: ${invalid.join(", ")}.`
      };
    }

    return {
      id: "cost_pricing",
      label: "AI cost pricing env",
      status: "pass",
      detail: "All pricing env values are configured as valid non-negative numbers for founder cost analytics."
    };
  }

  if (hasAnyPricingEnv()) {
    const invalidDetail = invalid.length > 0 ? ` Invalid values: ${invalid.join(", ")}.` : "";
    return {
      id: "cost_pricing",
      label: "AI cost pricing env",
      status: publicLaunch ? "fail" : "warn",
      detail: `Some pricing env values are missing, so public-launch cost analytics is incomplete: ${missing.join(", ")}.${invalidDetail}`
    };
  }

  return {
    id: "cost_pricing",
    label: "AI cost pricing env",
    status: publicLaunch ? "fail" : "warn",
    detail: "Pricing env values are empty, so founder cost analytics may show zero until configured."
  };
}

function modelReadinessCheck(): LaunchReadinessCheck {
  const missing = missingModelEnv();
  if (missing.length === 0) {
    return {
      id: "ai_model_config",
      label: "AI model config",
      status: "pass",
      detail: "Capture, conversation, escalation, receipt vision, and speech model env vars are pinned for telemetry and cost analytics. Output-token budgets can now also be tuned separately for capture and conversation."
    };
  }

  if (!envPresent("OPENAI_API_KEY")) {
    return {
      id: "ai_model_config",
      label: "AI model config",
      status: "warn",
      detail: `Model env vars are not fully configured, but OpenAI is not enabled yet. Missing: ${missing.join(", ")}.`
    };
  }

  return {
    id: "ai_model_config",
    label: "AI model config",
    status: publicLaunchTarget() ? "fail" : "warn",
    detail: `OpenAI is enabled, but model telemetry is not fully pinned. Missing: ${missing.join(", ")}.`
  };
}

function validPositiveIntegerEnv(name: string): boolean {
  const raw = envValue(name);
  if (!raw) return true;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0;
}

function aiMediaLimitsReadinessCheck(): LaunchReadinessCheck {
  const invalid = aiMediaLimitEnvNames().filter((name) => !validPositiveIntegerEnv(name));
  if (invalid.length > 0) {
    return {
      id: "ai_media_limits",
      label: "AI media byte guardrails",
      status: publicLaunchTarget() ? "fail" : "warn",
      detail: `AI media guardrails must be positive integer byte counts: ${invalid.join(", ")}.`
    };
  }

  const missing = missingAiMediaLimitEnv();
  if (missing.length === 0) {
    return {
      id: "ai_media_limits",
      label: "AI media byte guardrails",
      status: "pass",
      detail: "Speech-to-text and receipt vision byte guardrails are explicitly configured."
    };
  }

  if (!envPresent("OPENAI_API_KEY")) {
    return {
      id: "ai_media_limits",
      label: "AI media byte guardrails",
      status: "warn",
      detail: `AI media guardrails are not fully configured yet, but OpenAI is not enabled. Missing: ${missing.join(", ")}.`
    };
  }

  return {
    id: "ai_media_limits",
    label: "AI media byte guardrails",
    status: publicLaunchTarget() ? "fail" : "warn",
    detail: `OpenAI is enabled, but AI media byte guardrails are missing: ${missing.join(", ")}.`
  };
}

function supabaseUrlConsistencyCheck(): LaunchReadinessCheck {
  const publicUrlConfigured = envPresent("NEXT_PUBLIC_SUPABASE_URL");
  const serverUrlConfigured = envPresent("SUPABASE_URL");

  if (!publicUrlConfigured) {
    return {
      id: "supabase_url_consistency",
      label: "Supabase URL consistency",
      status: "fail",
      detail: "NEXT_PUBLIC_SUPABASE_URL is required so browser auth and future mobile clients use the same Supabase project as storage."
    };
  }

  if (!validUrlEnv("NEXT_PUBLIC_SUPABASE_URL")) {
    return {
      id: "supabase_url_consistency",
      label: "Supabase URL consistency",
      status: "fail",
      detail: "NEXT_PUBLIC_SUPABASE_URL is not a valid Supabase URL."
    };
  }

  if (!serverUrlConfigured) {
    return {
      id: "supabase_url_consistency",
      label: "Supabase URL consistency",
      status: "pass",
      detail: "SUPABASE_URL is not set, so server storage uses NEXT_PUBLIC_SUPABASE_URL as the single Supabase project URL."
    };
  }

  if (!validUrlEnv("SUPABASE_URL")) {
    return {
      id: "supabase_url_consistency",
      label: "Supabase URL consistency",
      status: "fail",
      detail: "SUPABASE_URL is configured but is not a valid URL."
    };
  }

  const publicHost = urlHostEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serverHost = urlHostEnv("SUPABASE_URL");
  if (publicHost !== serverHost) {
    return {
      id: "supabase_url_consistency",
      label: "Supabase URL consistency",
      status: "fail",
      detail: `Browser auth points to ${publicHost}, but server storage points to ${serverHost}. They must be the same Supabase project host.`
    };
  }

  return {
    id: "supabase_url_consistency",
    label: "Supabase URL consistency",
    status: "pass",
    detail: "Browser auth and server storage point to the same Supabase project host."
  };
}

function supabaseKeyBoundaryCheck(): LaunchReadinessCheck {
  const serviceKey = envValue("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = envValue("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  if (!serviceKey || !anonKey) {
    return {
      id: "supabase_key_boundary",
      label: "Supabase key boundary",
      status: "fail",
      detail: "SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_ANON_KEY are both required before key separation can be verified."
    };
  }

  if (serviceKey === anonKey) {
    return {
      id: "supabase_key_boundary",
      label: "Supabase key boundary",
      status: "fail",
      detail: "SUPABASE_SERVICE_ROLE_KEY must be different from NEXT_PUBLIC_SUPABASE_ANON_KEY."
    };
  }

  if (serviceKey.toLowerCase().startsWith("sb_publishable_")) {
    return {
      id: "supabase_key_boundary",
      label: "Supabase key boundary",
      status: "fail",
      detail: "SUPABASE_SERVICE_ROLE_KEY looks like a Supabase publishable key; use a service-role/secret key for server-only memory writes."
    };
  }

  return {
    id: "supabase_key_boundary",
    label: "Supabase key boundary",
    status: "pass",
    detail: "Browser anon key and server service-role key are separated."
  };
}

function validBucketName(name: string): boolean {
  return /^[a-zA-Z0-9._-]{3,63}$/.test(envValue(name));
}

function mediaUploadLimitEnvNames(): string[] {
  return ["RECEIPT_UPLOAD_MAX_BYTES", "VOICE_UPLOAD_MAX_BYTES"];
}

function mediaStorageRequired(): boolean {
  return process.env.SAYVE_REQUIRE_MEDIA_STORAGE === "1" || process.env.SAYVE_ENV_TARGET === "public-launch";
}

function mediaStorageReadinessCheck(smoke?: CaptureMediaStorageSmokeResult): LaunchReadinessCheck {
  if (!envPresent("SUPABASE_MEDIA_BUCKET")) {
    const required = mediaStorageRequired();
    return {
      id: "media_storage",
      label: "Receipt/voice media storage",
      status: required ? "fail" : "warn",
      detail: required
        ? "SUPABASE_MEDIA_BUCKET is required when SAYVE_ENV_TARGET=public-launch or SAYVE_REQUIRE_MEDIA_STORAGE=1."
        : "SUPABASE_MEDIA_BUCKET is not configured; receipt/voice uploads will keep file names only until Supabase Storage is enabled."
    };
  }

  if (!validBucketName("SUPABASE_MEDIA_BUCKET")) {
    return {
      id: "media_storage",
      label: "Receipt/voice media storage",
      status: "fail",
      detail: "SUPABASE_MEDIA_BUCKET must be 3-63 characters and contain only letters, numbers, dots, underscores, or hyphens."
    };
  }

  if (smoke) {
    return {
      id: "media_storage",
      label: "Receipt/voice media storage",
      status: smoke.ok ? "pass" : mediaStorageRequired() ? "fail" : "warn",
      detail: smoke.detail
    };
  }

  return {
    id: "media_storage",
    label: "Receipt/voice media storage",
    status: mediaStorageRequired() ? "warn" : "pass",
    detail: mediaStorageRequired()
      ? "SUPABASE_MEDIA_BUCKET is configured, but no live server write/delete smoke proof has been collected yet."
      : "Receipt and voice upload routes can persist original files to the configured Supabase Storage bucket."
  };
}

function mediaUploadLimitsReadinessCheck(): LaunchReadinessCheck {
  const invalid = mediaUploadLimitEnvNames().filter((name) => !validPositiveIntegerEnv(name));
  if (invalid.length > 0) {
    return {
      id: "media_upload_limits",
      label: "Receipt/voice upload limits",
      status: "fail",
      detail: `Media upload limits must be positive integer byte counts: ${invalid.join(", ")}.`
    };
  }

  const missing = mediaUploadLimitEnvNames().filter((name) => !envPresent(name));
  if (mediaStorageRequired() && missing.length > 0) {
    return {
      id: "media_upload_limits",
      label: "Receipt/voice upload limits",
      status: "fail",
      detail: `Explicit receipt and voice upload byte limits are required when SAYVE_ENV_TARGET=public-launch or SAYVE_REQUIRE_MEDIA_STORAGE=1. Missing: ${missing.join(", ")}.`
    };
  }

  const configured = mediaUploadLimitEnvNames().filter(envPresent);
  return {
    id: "media_upload_limits",
    label: "Receipt/voice upload limits",
    status: "pass",
    detail:
      configured.length === mediaUploadLimitEnvNames().length
        ? "Receipt and voice upload byte limits are explicitly configured."
        : "Receipt and voice upload byte limits use safe defaults unless explicitly overridden."
  };
}

function telemetryCompletenessReadinessCheck(result: FounderTelemetryReadiness | undefined, error?: unknown): LaunchReadinessCheck {
  const publicLaunch = publicLaunchTarget();

  if (error) {
    return {
      id: "ai_telemetry_completeness",
      label: "AI telemetry completeness",
      status: publicLaunch ? "fail" : "warn",
      detail: `Founder telemetry could not be read for launch readiness: ${error instanceof Error ? error.message : String(error)}.`
    };
  }

  const health = result?.aiRuntimeHealth;
  if (!health || health.totalAiEvents === 0) {
    return {
      id: "ai_telemetry_completeness",
      label: "AI telemetry completeness",
      status: publicLaunch ? "fail" : "warn",
      detail: publicLaunch
        ? "No AI telemetry events are available. Run live capture/conversation smoke before public launch so cost, latency, and quality analytics are proven."
        : "No AI telemetry events yet; Founder Console health will become meaningful after capture/conversation smoke runs."
    };
  }

  const missing = health.missingTokenEvents + health.missingCostEvents + health.missingDurationEvents;
  if (missing > 0 || health.telemetryCompletenessPercent < 100) {
    return {
      id: "ai_telemetry_completeness",
      label: "AI telemetry completeness",
      status: publicLaunch ? "fail" : "warn",
      detail: `AI telemetry completeness is ${health.telemetryCompletenessPercent}%. Missing token events: ${health.missingTokenEvents}; missing cost events: ${health.missingCostEvents}; missing duration events: ${health.missingDurationEvents}.`
    };
  }

  return {
    id: "ai_telemetry_completeness",
    label: "AI telemetry completeness",
    status: "pass",
    detail: `AI telemetry has cost, token, and latency fields for ${health.totalAiEvents} monthly event(s).`
  };
}

function telemetryBudgetReadinessCheck(result: FounderTelemetryReadiness | undefined, error?: unknown): LaunchReadinessCheck {
  const publicLaunch = publicLaunchTarget();

  if (error) {
    return {
      id: "ai_budget_discipline",
      label: "AI budget discipline",
      status: publicLaunch ? "fail" : "warn",
      detail: `Founder budget telemetry could not be read for launch readiness: ${error instanceof Error ? error.message : String(error)}.`
    };
  }

  const health = result?.aiRuntimeHealth;
  if (!health || health.totalAiEvents === 0) {
    return {
      id: "ai_budget_discipline",
      label: "AI budget discipline",
      status: publicLaunch ? "fail" : "warn",
      detail: publicLaunch
        ? "No AI telemetry events are available. Run live capture/conversation smoke before public launch so output-budget discipline is proven."
        : "No AI telemetry events yet; budget discipline will become visible after capture/conversation smoke runs."
    };
  }

  if (health.budgetCoveragePercent < 100 || health.budgetOverrunEvents > 0) {
    return {
      id: "ai_budget_discipline",
      label: "AI budget discipline",
      status: publicLaunch ? "fail" : "warn",
      detail: `Budget coverage is ${health.budgetCoveragePercent}%. Budget overruns: ${health.budgetOverrunEvents}. Founder Console should show capture/conversation telemetry staying within tracked output budgets before public launch.`
    };
  }

  return {
    id: "ai_budget_discipline",
    label: "AI budget discipline",
    status: "pass",
    detail: "Capture and conversation telemetry both carry output-budget metadata, and no budget overruns were detected."
  };
}

function onboardingHealthReadinessCheck(result: FounderTelemetryReadiness | undefined, error?: unknown): LaunchReadinessCheck {
  const publicLaunch = publicLaunchTarget();

  if (error) {
    return {
      id: "onboarding_health",
      label: "Founder onboarding health",
      status: publicLaunch ? "fail" : "warn",
      detail: `Founder onboarding health could not be read for launch readiness: ${error instanceof Error ? error.message : String(error)}.`
    };
  }

  const health = result?.onboardingHealth;
  if (!health) {
    return {
      id: "onboarding_health",
      label: "Founder onboarding health",
      status: publicLaunch ? "fail" : "warn",
      detail: "Founder onboarding health is missing, so partner invite monitoring is not yet proven."
    };
  }

  if (!health.configured) {
    return {
      id: "onboarding_health",
      label: "Founder onboarding health",
      status: publicLaunch ? "fail" : "warn",
      detail: health.issue || "Founder onboarding health is not configured."
    };
  }

  if (health.issue) {
    return {
      id: "onboarding_health",
      label: "Founder onboarding health",
      status: publicLaunch ? "fail" : "warn",
      detail: health.issue
    };
  }

  return {
    id: "onboarding_health",
    label: "Founder onboarding health",
    status: "pass",
    detail: `Invite monitoring is readable. pending=${health.pendingInvites}, accepted=${health.acceptedInvites}, expired=${health.expiredInvites}, emailLocked=${health.emailLockedInvites}.`
  };
}

async function readDefaultHouseholdBinding(): Promise<DefaultHouseholdBindingReadiness> {
  const householdId = envValue("SUPABASE_DEFAULT_HOUSEHOLD_ID");
  const supabase = createSupabaseServiceClient();
  if (!householdId || !supabase) {
    return {
      configured: Boolean(supabase),
      exists: false
    };
  }

  const householdResponse = await supabase.from("households").select("id").eq("id", householdId).maybeSingle();
  if (householdResponse.error) {
    return {
      configured: true,
      exists: false,
      error: householdResponse.error.message
    };
  }

  if (!householdResponse.data?.id) {
    return {
      configured: true,
      exists: false
    };
  }

  const membersResponse = await supabase.from("household_members").select("role").eq("household_id", householdId);
  if (membersResponse.error) {
    return {
      configured: true,
      exists: true,
      error: membersResponse.error.message
    };
  }

  return {
    configured: true,
    exists: true,
    memberCount: (membersResponse.data ?? []).length,
    ownerCount: (membersResponse.data ?? []).filter((row) => row.role === "owner").length
  };
}

function supabaseHouseholdReadinessCheck(
  repositoryMode: "supabase" | "local_file",
  binding?: DefaultHouseholdBindingReadiness
): LaunchReadinessCheck {
  if (repositoryMode !== "supabase") {
    return {
      id: "supabase_household",
      label: "Supabase household binding",
      status: "warn",
      detail: "Not required until MEMORY_REPOSITORY=supabase."
    };
  }

  if (!envPresent("SUPABASE_DEFAULT_HOUSEHOLD_ID")) {
    return {
      id: "supabase_household",
      label: "Supabase household binding",
      status: "fail",
      detail: "Set SUPABASE_DEFAULT_HOUSEHOLD_ID for founder setup, repository smoke, and server-side fallback reads."
    };
  }

  if (binding?.error) {
    return {
      id: "supabase_household",
      label: "Supabase household binding",
      status: publicLaunchTarget() ? "fail" : "warn",
      detail: `Could not verify SUPABASE_DEFAULT_HOUSEHOLD_ID against live Supabase. ${binding.error}`
    };
  }

  if (binding?.configured && !binding.exists) {
    return {
      id: "supabase_household",
      label: "Supabase household binding",
      status: "fail",
      detail: `SUPABASE_DEFAULT_HOUSEHOLD_ID is configured but no matching household row exists in Supabase: ${envValue("SUPABASE_DEFAULT_HOUSEHOLD_ID")}.`
    };
  }

  if (binding?.configured && binding.exists) {
    if ((binding.memberCount ?? 0) === 0) {
      return {
        id: "supabase_household",
        label: "Supabase household binding",
        status: "fail",
        detail: `SUPABASE_DEFAULT_HOUSEHOLD_ID exists in Supabase but has no household members yet: ${envValue("SUPABASE_DEFAULT_HOUSEHOLD_ID")}.`
      };
    }

    if ((binding.ownerCount ?? 0) === 0) {
      return {
        id: "supabase_household",
        label: "Supabase household binding",
        status: "fail",
        detail: `SUPABASE_DEFAULT_HOUSEHOLD_ID exists in Supabase but has no owner role member yet: ${envValue("SUPABASE_DEFAULT_HOUSEHOLD_ID")}.`
      };
    }

    return {
      id: "supabase_household",
      label: "Supabase household binding",
      status: "pass",
      detail:
        typeof binding.memberCount === "number"
          ? `SUPABASE_DEFAULT_HOUSEHOLD_ID exists in Supabase with ${binding.memberCount} household member(s) and ${binding.ownerCount ?? 0} owner(s).`
          : "SUPABASE_DEFAULT_HOUSEHOLD_ID exists in Supabase."
    };
  }

  return {
    id: "supabase_household",
    label: "Supabase household binding",
    status: "pass",
    detail: "SUPABASE_DEFAULT_HOUSEHOLD_ID is configured."
  };
}

function overallStatus(checks: LaunchReadinessCheck[]): LaunchReadinessStatus {
  if (checks.some((check) => check.status === "fail")) return "fail";
  if (checks.some((check) => check.status === "warn")) return "warn";
  return "pass";
}

const privateBetaBlockingWarnings = new Set(["private_beta_access", "secret_strength", "repository_mode", "usage_limits", "ai_model_config", "app_base_url"]);
const requiredSupabaseSecurityChecks = [
  "memory_store_snapshots_service_role_only",
  "household_role_policies",
  "invites_service_role_only",
  "invites_atomic_acceptance",
  "memory_facts_payload_shape",
  "ai_telemetry_shape",
  "media_storage_bucket"
];
const requiredAppliedMigrationStages = ["private_beta", "public_launch"] as const;

function privateBetaConfigReady(checks: LaunchReadinessCheck[]): boolean {
  return !checks.some((check) => check.status === "fail" || (check.status === "warn" && privateBetaBlockingWarnings.has(check.id)));
}

function schemaReadinessCheck(
  result: SupabaseSchemaCheckResult | undefined,
  appliedMigrations: AppliedSupabaseMigrationsResult | undefined
): LaunchReadinessCheck {
  if (!result) {
    return {
      id: "supabase_schema_security",
      label: "Live Supabase schema/security",
      status: "fail",
      detail: "Supabase service credentials are missing, so live schema/security could not be checked."
    };
  }

  if (!result.configured) {
    return {
      id: "supabase_schema_security",
      label: "Live Supabase schema/security",
      status: "fail",
      detail: "Supabase schema/security check is not configured."
    };
  }

  if (!result.ok) {
    const issueDetails = result.issues.map((issue) => `${issue.table}: ${issue.message}`);
    const securityDetails = result.securityChecks.filter((check) => !check.ok).map((check) => `${check.id}: ${check.message}`);
    const migrationDetail = result.requiredMigrations.length > 0 ? ` Required migrations: ${result.requiredMigrations.join(", ")}` : "";
    return {
      id: "supabase_schema_security",
      label: "Live Supabase schema/security",
      status: "fail",
      detail: ([...issueDetails, ...securityDetails].join(" | ") || "Live Supabase schema/security check failed.") + migrationDetail
    };
  }

  if (!appliedMigrations) {
    return {
      id: "supabase_schema_security",
      label: "Live Supabase schema/security",
      status: "fail",
      detail: "Live applied migration history could not be checked."
    };
  }

  if (!appliedMigrations.configured) {
    return {
      id: "supabase_schema_security",
      label: "Live Supabase schema/security",
      status: "fail",
      detail: "Supabase service credentials are missing, so live applied migration history could not be checked."
    };
  }

  if (!appliedMigrations.accessible) {
    return {
      id: "supabase_schema_security",
      label: "Live Supabase schema/security",
      status: "fail",
      detail: `Live applied migration history is not accessible. ${appliedMigrations.issue ?? ""}`.trim()
    };
  }

  const requiredStages = publicLaunchTarget() ? requiredAppliedMigrationStages : ["private_beta"];
  const missingApplied = appliedMigrations.rows.filter(
    (row) => requiredStages.includes(row.requiredFor) && !row.applied
  );
  if (missingApplied.length > 0) {
    return {
      id: "supabase_schema_security",
      label: "Live Supabase schema/security",
      status: "fail",
      detail: `Live Supabase migration history is missing required applied migration(s): ${missingApplied.map((row) => row.file).join(", ")}.`
    };
  }

  const securityCheckIds = new Set(result.securityChecks.map((check) => check.id));
  const missingSecurityChecks = requiredSupabaseSecurityChecks.filter((id) => !securityCheckIds.has(id));
  if (missingSecurityChecks.length > 0) {
    return {
      id: "supabase_schema_security",
      label: "Live Supabase schema/security",
      status: "fail",
      detail: `Live Supabase schema/security check is missing required check(s): ${missingSecurityChecks.join(", ")}. Redeploy the latest schema-check route and apply all migrations before launch.`
    };
  }

  return {
    id: "supabase_schema_security",
    label: "Live Supabase schema/security",
    status: "pass",
    detail: `Live Supabase schema ok: ${result.checkedTables} tables, ${result.securityChecks.length} security checks, ${requiredStages.length === 2 ? "private-beta/public-launch" : "private-beta"} applied migrations verified.`
  };
}

export async function getLaunchReadinessReport(options: LaunchReadinessOptions = {}): Promise<LaunchReadinessReport> {
  const limits = usageLimits();
  const repositoryMode = resolveMemoryRepositoryMode();
  const smokeProof = deploymentSmokeProof();
  const liveSmokeVerified = smokeProof.verified;
  const liveSchemaResult = options.schemaCheck ? await options.schemaCheck() : supabaseServiceConfigured() ? await checkSupabaseSchema() : undefined;
  const liveAppliedMigrations = options.appliedMigrations
    ? await options.appliedMigrations()
    : supabaseServiceConfigured()
      ? await readAppliedSupabaseMigrations()
      : undefined;
  const browserSupabaseConfigured = validUrlEnv("NEXT_PUBLIC_SUPABASE_URL") && envPresent("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  let founderTelemetry: FounderTelemetryReadiness | undefined;
  let founderTelemetryError: unknown;
  let defaultHouseholdBinding: DefaultHouseholdBindingReadiness | undefined;
  let mediaStorageSmoke: CaptureMediaStorageSmokeResult | undefined;
  try {
    founderTelemetry = options.founderTelemetry ? await options.founderTelemetry() : await getFounderConsoleData();
  } catch (error) {
    founderTelemetryError = error;
  }
  try {
    defaultHouseholdBinding = options.defaultHouseholdBinding
      ? await options.defaultHouseholdBinding()
      : !options.schemaCheck && repositoryMode === "supabase" && envPresent("SUPABASE_DEFAULT_HOUSEHOLD_ID") && supabaseServiceConfigured()
        ? await readDefaultHouseholdBinding()
        : undefined;
  } catch (error) {
    defaultHouseholdBinding = {
      configured: true,
      exists: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
  try {
    mediaStorageSmoke = options.mediaStorageSmoke
      ? await options.mediaStorageSmoke()
      : repositoryMode === "supabase" && envPresent("SUPABASE_MEDIA_BUCKET") && supabaseServiceConfigured()
        ? await runCaptureMediaStorageSmokeTest()
        : undefined;
  } catch (error) {
    mediaStorageSmoke = {
      configured: true,
      ok: false,
      bucket: process.env.SUPABASE_MEDIA_BUCKET?.trim() || "",
      detail: error instanceof Error ? error.message : String(error)
    };
  }
  const checks: LaunchReadinessCheck[] = [
    {
      id: "admin_protection",
      label: "Founder Console protection",
      status: founderTokenRequired() ? "pass" : "fail",
      detail: founderTokenRequired()
        ? "ADMIN_CONSOLE_TOKEN is configured."
        : "Set ADMIN_CONSOLE_TOKEN before public deployment."
    },
    {
      id: "private_beta_access",
      label: "Private beta access gate",
      status: envPresent("APP_ACCESS_TOKEN") ? "pass" : "warn",
      detail: envPresent("APP_ACCESS_TOKEN")
        ? "APP_ACCESS_TOKEN is configured for private beta access."
        : "No APP_ACCESS_TOKEN set; acceptable locally, risky for a public prototype URL."
    },
    secretStrengthReadinessCheck(),
    {
      id: "openai_key",
      label: "OpenAI API key",
      status: envPresent("OPENAI_API_KEY") ? "pass" : publicLaunchTarget() ? "fail" : "warn",
      detail: envPresent("OPENAI_API_KEY")
        ? "AI calls can use the configured provider."
        : publicLaunchTarget()
          ? "OPENAI_API_KEY is required when SAYVE_ENV_TARGET=public-launch."
          : "No OPENAI_API_KEY found; app will use heuristic fallback only."
    },
    {
      id: "storage",
      label: "Production storage",
      status: supabaseServiceConfigured() ? "pass" : "fail",
      detail: supabaseServiceConfigured()
        ? "Supabase service credentials are configured."
        : "Configure NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL plus SUPABASE_SERVICE_ROLE_KEY before public launch."
    },
    {
      id: "supabase_auth_required",
      label: "Supabase Auth required",
      status: process.env.SUPABASE_AUTH_REQUIRED === "1" ? "pass" : "fail",
      detail:
        process.env.SUPABASE_AUTH_REQUIRED === "1"
          ? "API writes require a logged-in household member."
          : "Set SUPABASE_AUTH_REQUIRED=1 before real household members use the app."
    },
    {
      id: "supabase_anon_key",
      label: "Supabase browser auth",
      status: browserSupabaseConfigured ? "pass" : "fail",
      detail: browserSupabaseConfigured
        ? "Browser can start Supabase Auth sessions with NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
        : "Set a valid NEXT_PUBLIC_SUPABASE_URL plus NEXT_PUBLIC_SUPABASE_ANON_KEY so web and mobile clients can log in."
    },
    appBaseUrlReadinessCheck(),
    supabaseUrlConsistencyCheck(),
    supabaseKeyBoundaryCheck(),
    mediaStorageReadinessCheck(mediaStorageSmoke),
    mediaUploadLimitsReadinessCheck(),
    {
      id: "repository_mode",
      label: "Repository mode",
      status: repositoryMode === "supabase" ? "pass" : "warn",
      detail:
        repositoryMode === "supabase"
          ? "Memory repository is running on Supabase."
          : `Memory repository is currently ${repositoryMode}; acceptable for prototype, not final multi-user launch.`
    },
    supabaseHouseholdReadinessCheck(repositoryMode === "memory_only" ? "local_file" : repositoryMode, defaultHouseholdBinding),
    schemaReadinessCheck(liveSchemaResult, liveAppliedMigrations),
    {
      id: "usage_limits",
      label: "Prototype usage limits",
      status: usageLimitsDisabled() ? "warn" : "pass",
      detail: usageLimitsDisabled()
        ? "Usage limits are disabled; AI spend can grow without guardrails."
        : `Monthly limits active: ${limits.captures} captures, ${limits.receiptCaptures} receipts, ${limits.voiceCaptures} voice, ${limits.conversationTurns} chat turns.`
    },
    modelReadinessCheck(),
    aiMediaLimitsReadinessCheck(),
    pricingReadinessCheck(),
    telemetryCompletenessReadinessCheck(founderTelemetry, founderTelemetryError),
    telemetryBudgetReadinessCheck(founderTelemetry, founderTelemetryError),
    onboardingHealthReadinessCheck(founderTelemetry, founderTelemetryError),
    {
      id: "receipt_vision",
      label: "Receipt vision",
      status: process.env.OPENAI_RECEIPT_VISION_DISABLED === "1" ? "warn" : "pass",
      detail:
        process.env.OPENAI_RECEIPT_VISION_DISABLED === "1"
          ? "Receipt vision is disabled."
          : "Receipt vision is enabled when OpenAI API key is present."
    },
    {
      id: "deployment_smoke",
      label: "Live deployment smoke test",
      status: !liveSmokeVerified ? "warn" : smokeProof.issues.length === 0 ? "pass" : publicLaunchTarget() ? "fail" : "warn",
      detail: !liveSmokeVerified
        ? "Run pnpm run verify:deploy against the deployed URL, then set SAYVE_DEPLOYMENT_SMOKE_VERIFIED=1 before public launch."
        : smokeProof.issues.length === 0
          ? `Smoke proof recorded at ${smokeProof.verifiedAt} for ${smokeProof.targetUrl}.`
          : `Smoke proof metadata is incomplete: ${smokeProof.issues.join(" ")}`
    }
  ];
  const status = overallStatus(checks);
  const configReadyForPrivateBeta = privateBetaConfigReady(checks);

  return {
    configReadyForPrivateBeta,
    liveSmokeVerified,
    readyForPublicLaunch: status === "pass",
    status,
    generatedAt: new Date().toISOString(),
    smokeProof: {
      verifiedAt: smokeProof.verifiedAt,
      targetUrl: smokeProof.targetUrl,
      issues: smokeProof.issues
    },
    checks
  };
}
