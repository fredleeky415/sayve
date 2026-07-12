#!/usr/bin/env node

const target = process.env.SAYVE_ENV_TARGET ?? process.argv[2] ?? "local";
const allowedTargets = new Set(["local", "private-beta", "public-launch"]);

function value(name) {
  return process.env[name]?.trim() ?? "";
}

function present(name) {
  return Boolean(value(name));
}

function isUrl(name) {
  const raw = value(name);
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" || parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function urlHost(name) {
  const raw = value(name);
  if (!raw) return "";
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isPositiveNumber(name) {
  const raw = value(name);
  if (!raw) return false;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0;
}

function isPositiveInteger(name) {
  const raw = value(name);
  if (!raw) return false;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0;
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function warn(message) {
  console.warn(`WARN: ${message}`);
}

function requireEnv(name, reason) {
  if (!present(name)) fail(`${name} is required. ${reason}`);
}

function requireUrl(name, reason) {
  requireEnv(name, reason);
  if (present(name) && !isUrl(name)) fail(`${name} must be a valid URL. ${reason}`);
}

function requireEquals(name, expected, reason) {
  requireEnv(name, reason);
  if (present(name) && value(name) !== expected) fail(`${name} must be ${expected}. ${reason}`);
}

function requireAny(names, reason) {
  if (!names.some(present)) fail(`${names.join(" or ")} is required. ${reason}`);
}

function secretIssues(name) {
  const raw = value(name);
  if (!raw) return [];
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
  const issues = [];
  if (raw.length < 24) issues.push("must be at least 24 characters");
  if (placeholderValues.has(lower) || lower.startsWith("your-") || lower.startsWith("your_") || lower.includes("example") || lower.includes("...")) {
    issues.push("must not be a placeholder value");
  }
  return issues;
}

function requireStrongSecret(name, reason) {
  requireEnv(name, reason);
  const issues = secretIssues(name);
  if (issues.length > 0) fail(`${name} ${issues.join(" and ")}. ${reason}`);
}

function checkTokenSeparation() {
  if (present("APP_ACCESS_TOKEN") && present("ADMIN_CONSOLE_TOKEN") && value("APP_ACCESS_TOKEN") === value("ADMIN_CONSOLE_TOKEN")) {
    fail("APP_ACCESS_TOKEN and ADMIN_CONSOLE_TOKEN must be different values.");
  }
}

function checkSupabaseUrlConsistency() {
  if (!present("NEXT_PUBLIC_SUPABASE_URL") || !present("SUPABASE_URL")) return;
  if (!isUrl("NEXT_PUBLIC_SUPABASE_URL") || !isUrl("SUPABASE_URL")) return;

  const publicHost = urlHost("NEXT_PUBLIC_SUPABASE_URL");
  const serverHost = urlHost("SUPABASE_URL");
  if (publicHost && serverHost && publicHost !== serverHost) {
    fail(
      `NEXT_PUBLIC_SUPABASE_URL and SUPABASE_URL must point to the same Supabase project host. Browser auth uses ${publicHost}, but server storage uses ${serverHost}.`
    );
  }
}

function checkAppBaseUrl(required) {
  if (!present("NEXT_PUBLIC_APP_URL")) {
    if (required) {
      fail(
        "NEXT_PUBLIC_APP_URL is required. Use the real deployed Sayve origin so Google OAuth, magic links, and invite acceptance return to one stable URL."
      );
    } else {
      warn(
        "NEXT_PUBLIC_APP_URL is not configured; browser auth falls back to window.location.origin, which is fine locally but fragile for preview/custom-domain OAuth redirects."
      );
    }
    return;
  }

  if (!isUrl("NEXT_PUBLIC_APP_URL")) {
    fail("NEXT_PUBLIC_APP_URL must be a valid URL. Use the real deployed Sayve origin for browser auth redirects.");
  }
}

function checkDeploymentSmokeProof(publicLaunch) {
  const verified = value("SAYVE_DEPLOYMENT_SMOKE_VERIFIED") === "1";
  const verifiedAt = value("SAYVE_DEPLOYMENT_SMOKE_VERIFIED_AT");
  const targetUrl = value("SAYVE_DEPLOYMENT_SMOKE_TARGET");

  if (publicLaunch) {
    requireEquals("SAYVE_DEPLOYMENT_SMOKE_VERIFIED", "1", "Set only after authenticated live deployment smoke passes.");
  }

  if (!verified) return;

  requireEnv("SAYVE_DEPLOYMENT_SMOKE_VERIFIED_AT", "Record when the last successful live smoke happened.");
  if (present("SAYVE_DEPLOYMENT_SMOKE_VERIFIED_AT") && !Number.isFinite(Date.parse(verifiedAt))) {
    fail("SAYVE_DEPLOYMENT_SMOKE_VERIFIED_AT must be a valid ISO timestamp.");
  }

  requireUrl("SAYVE_DEPLOYMENT_SMOKE_TARGET", "Record which deployed URL passed the last successful live smoke.");

  if (present("NEXT_PUBLIC_APP_URL") && isUrl("NEXT_PUBLIC_APP_URL") && present("SAYVE_DEPLOYMENT_SMOKE_TARGET") && isUrl("SAYVE_DEPLOYMENT_SMOKE_TARGET")) {
    const appHost = urlHost("NEXT_PUBLIC_APP_URL");
    const smokeHost = urlHost("SAYVE_DEPLOYMENT_SMOKE_TARGET");
    if (appHost && smokeHost && appHost !== smokeHost) {
      fail(
        `SAYVE_DEPLOYMENT_SMOKE_TARGET should match NEXT_PUBLIC_APP_URL host. App uses ${appHost}, but the smoke proof points to ${smokeHost}.`
      );
    }
  }
}

function checkSupabaseKeyBoundary() {
  if (!present("SUPABASE_SERVICE_ROLE_KEY")) return;

  const serviceKey = value("SUPABASE_SERVICE_ROLE_KEY");
  const lowerServiceKey = serviceKey.toLowerCase();
  if (lowerServiceKey.startsWith("sb_publishable_")) {
    fail("SUPABASE_SERVICE_ROLE_KEY must be a service-role/secret key, not a Supabase publishable key.");
  }

  if (present("NEXT_PUBLIC_SUPABASE_ANON_KEY") && serviceKey === value("NEXT_PUBLIC_SUPABASE_ANON_KEY")) {
    fail("SUPABASE_SERVICE_ROLE_KEY must be different from NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }
}

function validSupabaseBucketName(name) {
  const raw = value(name);
  return /^[a-zA-Z0-9._-]{3,63}$/.test(raw);
}

function checkMediaStorageEnv(publicLaunch) {
  const mediaStorageRequired = publicLaunch || value("SAYVE_REQUIRE_MEDIA_STORAGE") === "1";
  if (present("SUPABASE_MEDIA_BUCKET") && !validSupabaseBucketName("SUPABASE_MEDIA_BUCKET")) {
    fail("SUPABASE_MEDIA_BUCKET must be 3-63 characters and contain only letters, numbers, dots, underscores, or hyphens.");
  }

  for (const name of ["RECEIPT_UPLOAD_MAX_BYTES", "VOICE_UPLOAD_MAX_BYTES"]) {
    if (present(name) && !isPositiveInteger(name)) {
      fail(`${name} must be a positive integer byte count.`);
    }
  }

  if (mediaStorageRequired) {
    requireEnv("SUPABASE_MEDIA_BUCKET", "Public launch must persist receipt/voice uploads in Supabase Storage, not only file names.");
    requireEnv("RECEIPT_UPLOAD_MAX_BYTES", "Public launch must explicitly cap receipt source-file upload size.");
    requireEnv("VOICE_UPLOAD_MAX_BYTES", "Public launch must explicitly cap voice source-file upload size.");
  } else if (!present("SUPABASE_MEDIA_BUCKET")) {
    warn("SUPABASE_MEDIA_BUCKET is not configured; receipt/voice uploads will keep file names only until media storage is enabled.");
  }
}

function checkPricingEnv(publicLaunch) {
  const names = [
    "OPENAI_CAPTURE_INPUT_USD_PER_1M",
    "OPENAI_CAPTURE_OUTPUT_USD_PER_1M",
    "OPENAI_RECEIPT_VISION_INPUT_USD_PER_1M",
    "OPENAI_RECEIPT_VISION_OUTPUT_USD_PER_1M",
    "OPENAI_CONVERSATION_INPUT_USD_PER_1M",
    "OPENAI_CONVERSATION_OUTPUT_USD_PER_1M",
    "OPENAI_STT_INPUT_USD_PER_1M",
    "OPENAI_STT_OUTPUT_USD_PER_1M"
  ];
  const configured = names.filter(present);
  for (const name of configured) {
    if (!isPositiveNumber(name)) fail(`${name} must be a non-negative number.`);
  }

  if (publicLaunch) {
    for (const name of names) requireEnv(name, "Public launch cost analytics should not silently show zero because pricing env is missing.");
    return;
  }

  if (configured.length === 0) {
    warn("No AI pricing env values are configured; Founder Console cost analytics may show zero.");
  }
}

function modelEnvNames() {
  return [
    "OPENAI_CAPTURE_MODEL",
    "OPENAI_CAPTURE_MAX_OUTPUT_TOKENS",
    "OPENAI_CONVERSATION_MODEL",
    "OPENAI_CONVERSATION_MAX_OUTPUT_TOKENS",
    "OPENAI_ESCALATION_MODEL",
    "OPENAI_RECEIPT_VISION_MODEL",
    "OPENAI_SPEECH_TO_TEXT_MODEL"
  ];
}

function aiMediaLimitEnvNames() {
  return ["AUDIO_TRANSCRIPTION_MAX_BYTES", "RECEIPT_VISION_MAX_BYTES"];
}

function checkAiMediaLimitEnv(publicLaunch) {
  const required = publicLaunch || present("OPENAI_API_KEY");
  const configured = aiMediaLimitEnvNames().filter(present);
  for (const name of configured) {
    if (!isPositiveInteger(name)) fail(`${name} must be a positive integer byte count.`);
  }
  if (!required) return;
  for (const name of aiMediaLimitEnvNames()) {
    requireEnv(name, "Pin AI media byte guardrails whenever OpenAI is enabled so receipt/audio cost and latency stay bounded.");
  }
}

function checkModelEnv(publicLaunch) {
  const required = publicLaunch || present("OPENAI_API_KEY");
  for (const name of ["OPENAI_CAPTURE_MAX_OUTPUT_TOKENS", "OPENAI_CONVERSATION_MAX_OUTPUT_TOKENS"]) {
    if (present(name) && !isPositiveInteger(name)) fail(`${name} must be a positive integer token budget.`);
  }
  if (!required) return;
  for (const name of modelEnvNames()) {
    requireEnv(name, "Pin AI model names and output budgets whenever OpenAI is enabled so telemetry, cost analytics, and smoke tests can audit model usage.");
  }
}

function checkLocal() {
  if (present("NEXT_PUBLIC_APP_URL") && !isUrl("NEXT_PUBLIC_APP_URL")) fail("NEXT_PUBLIC_APP_URL must be a valid URL when set.");
  if (present("NEXT_PUBLIC_SUPABASE_URL") && !isUrl("NEXT_PUBLIC_SUPABASE_URL")) fail("NEXT_PUBLIC_SUPABASE_URL must be a valid URL when set.");
  if (present("SUPABASE_URL") && !isUrl("SUPABASE_URL")) fail("SUPABASE_URL must be a valid URL when set.");
  checkAppBaseUrl(false);
  checkSupabaseUrlConsistency();
  checkSupabaseKeyBoundary();
  checkMediaStorageEnv(false);
  checkModelEnv(false);
  checkAiMediaLimitEnv(false);
  checkPricingEnv(false);
}

function checkPrivateBeta() {
  requireEquals("MEMORY_REPOSITORY", "supabase", "Private beta must not use local prototype storage.");
  checkAppBaseUrl(true);
  requireAny(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"], "Supabase URL is required for production storage.");
  requireUrl("NEXT_PUBLIC_SUPABASE_URL", "Browser and future mobile clients need the public Supabase project URL for Auth.");
  if (present("NEXT_PUBLIC_SUPABASE_URL") && !isUrl("NEXT_PUBLIC_SUPABASE_URL")) fail("NEXT_PUBLIC_SUPABASE_URL must be a valid URL.");
  if (present("SUPABASE_URL") && !isUrl("SUPABASE_URL")) fail("SUPABASE_URL must be a valid URL.");
  checkSupabaseUrlConsistency();
  requireEnv("SUPABASE_SERVICE_ROLE_KEY", "Server-side repository and admin checks need service-role access.");
  requireEnv("SUPABASE_DEFAULT_HOUSEHOLD_ID", "Smoke tests and founder flows need a default household binding.");
  requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "Browser and future mobile clients need Supabase Auth.");
  checkSupabaseKeyBoundary();
  checkMediaStorageEnv(false);
  requireEquals("SUPABASE_AUTH_REQUIRED", "1", "Real household members must be authenticated.");
  requireStrongSecret("APP_ACCESS_TOKEN", "Private beta URLs should not be open to the internet.");
  requireStrongSecret("ADMIN_CONSOLE_TOKEN", "Founder Console and admin APIs must be protected.");
  checkTokenSeparation();
  requireEquals("PROTOTYPE_USAGE_LIMITS_DISABLED", "0", "Private beta should keep usage guardrails enabled.");
  checkModelEnv(false);
  checkAiMediaLimitEnv(false);
  checkPricingEnv(false);
}

function checkPublicLaunch() {
  checkPrivateBeta();
  requireEnv("OPENAI_API_KEY", "Public launch should use the configured AI provider, not heuristic fallback only.");
  checkDeploymentSmokeProof(true);
  checkMediaStorageEnv(true);
  checkModelEnv(true);
  checkAiMediaLimitEnv(true);
  checkPricingEnv(true);
}

if (!allowedTargets.has(target)) {
  fail(`Unknown SAYVE_ENV_TARGET: ${target}. Use local, private-beta, or public-launch.`);
} else if (target === "local") {
  checkLocal();
} else if (target === "private-beta") {
  checkPrivateBeta();
  checkDeploymentSmokeProof(false);
} else {
  checkPublicLaunch();
}

if (process.exitCode) process.exit();
console.log(`Sayve env preflight passed for ${target}.`);
