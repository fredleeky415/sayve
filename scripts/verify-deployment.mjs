#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const baseUrl = (process.env.SAYVE_DEPLOY_URL ?? process.argv[2] ?? "").replace(/\/$/, "");
const proofReportPath = process.env.SAYVE_DEPLOY_PROOF_REPORT_PATH?.trim() || "";
const proofSummaryPath = process.env.SAYVE_DEPLOY_PROOF_SUMMARY_PATH?.trim() || "";
const defaultProofReportPath = "outputs/setup/deploy-proof-report.json";
const defaultProofSummaryPath = "outputs/setup/deploy-proof-summary.md";
const adminToken = process.env.ADMIN_CONSOLE_TOKEN;
const appAccessToken = process.env.APP_ACCESS_TOKEN;
const requirePublicReady = process.env.SAYVE_REQUIRE_PUBLIC_READY !== "0";
const testSupabaseAccessToken = process.env.SAYVE_TEST_SUPABASE_ACCESS_TOKEN;
const testSecondSupabaseAccessToken = process.env.SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN;
const testViewerSupabaseAccessToken = process.env.SAYVE_TEST_VIEWER_SUPABASE_ACCESS_TOKEN;
const testInviteAcceptSupabaseAccessToken = process.env.SAYVE_TEST_INVITE_ACCEPT_SUPABASE_ACCESS_TOKEN;
const testBootstrapSupabaseAccessToken = process.env.SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN;
const testHouseholdId = process.env.SAYVE_TEST_HOUSEHOLD_ID;
const requireAuthSmoke = process.env.SAYVE_REQUIRE_AUTH_SMOKE === "1";
const requireTwoMemberSmoke = process.env.SAYVE_REQUIRE_TWO_MEMBER_SMOKE === "1" || requirePublicReady;
const requireViewerSmoke = process.env.SAYVE_REQUIRE_VIEWER_SMOKE === "1" || requirePublicReady;
const requireInviteSmoke = process.env.SAYVE_REQUIRE_INVITE_SMOKE === "1";
const requireInviteAcceptanceSmoke = process.env.SAYVE_REQUIRE_INVITE_ACCEPT_SMOKE === "1";
const requireBootstrapSmoke = process.env.SAYVE_REQUIRE_BOOTSTRAP_SMOKE === "1" || requirePublicReady;
const requireOpenAiSmoke = process.env.SAYVE_REQUIRE_OPENAI_SMOKE === "1" || requirePublicReady;
const requirePrivacySmoke = process.env.SAYVE_REQUIRE_PRIVACY_SMOKE === "1" || requirePublicReady;
const verificationStartedAt = new Date().toISOString();
const proofFailures = [];
const proofWarnings = [];
let latestLaunchReadiness = null;
const requiredLaunchReadinessCheckIds = [
  "admin_protection",
  "private_beta_access",
  "secret_strength",
  "storage",
  "supabase_auth_required",
  "supabase_anon_key",
  "app_base_url",
  "supabase_url_consistency",
  "supabase_key_boundary",
  "media_storage",
  "media_upload_limits",
  "repository_mode",
  "supabase_household",
  "supabase_schema_security",
  "usage_limits",
  "ai_model_config",
  "ai_media_limits",
  "cost_pricing",
  "ai_telemetry_completeness",
  "ai_budget_discipline",
  "deployment_smoke"
];

function fail(message) {
  proofFailures.push(message);
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function warn(message) {
  proofWarnings.push(message);
  console.warn(`WARN: ${message}`);
}

function writeProofReport() {
  if (!proofReportPath) return;

  const report = {
    generatedAt: new Date().toISOString(),
    startedAt: verificationStartedAt,
    status: process.exitCode ? "failed" : "passed",
    deployUrl: baseUrl,
    requirePublicReady,
    env: {
      hasAdminConsoleToken: Boolean(adminToken),
      hasAppAccessToken: Boolean(appAccessToken),
      hasOwnerToken: Boolean(testSupabaseAccessToken),
      hasSecondMemberToken: Boolean(testSecondSupabaseAccessToken),
      hasViewerToken: Boolean(testViewerSupabaseAccessToken),
      hasInviteAcceptanceToken: Boolean(testInviteAcceptSupabaseAccessToken),
      hasBootstrapToken: Boolean(testBootstrapSupabaseAccessToken),
      hasHouseholdId: Boolean(testHouseholdId)
    },
    warnings: proofWarnings,
    failures: proofFailures,
    launchReadiness: latestLaunchReadiness
      ? {
          status: latestLaunchReadiness.status,
          configReadyForPrivateBeta: latestLaunchReadiness.configReadyForPrivateBeta,
          liveSmokeVerified: latestLaunchReadiness.liveSmokeVerified,
          readyForPublicLaunch: latestLaunchReadiness.readyForPublicLaunch,
          smokeProof: latestLaunchReadiness.smokeProof,
          checks: Array.isArray(latestLaunchReadiness.checks)
            ? latestLaunchReadiness.checks.map((check) => ({
                id: check.id,
                label: check.label,
                status: check.status,
                detail: check.detail
              }))
            : []
        }
      : null
  };

  mkdirSync(dirname(proofReportPath), { recursive: true });
  writeFileSync(proofReportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function deriveProofSummaryPath() {
  if (proofSummaryPath) return proofSummaryPath;
  if (!proofReportPath) return "";
  if (proofReportPath === defaultProofReportPath) return defaultProofSummaryPath;
  if (proofReportPath.endsWith(".json")) {
    return proofReportPath.slice(0, -".json".length).replace(/report$/u, "summary") + ".md";
  }
  return `${proofReportPath}-summary.md`;
}

function writeProofSummary() {
  if (!proofReportPath) return;

  const summaryPath = deriveProofSummaryPath();
  if (!summaryPath) return;
  try {
    execFileSync(process.execPath, [join(process.cwd(), "scripts", "report-deploy-proof.mjs"), proofReportPath, summaryPath], {
      cwd: process.cwd(),
      stdio: "ignore"
    });
  } catch (error) {
    fail(
      `Could not generate deploy proof summary at ${summaryPath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function writeProofArtifacts() {
  writeProofReport();
  writeProofSummary();
}

function secretIssues(name, raw) {
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
  if (issues.length > 0) fail(`${name} ${issues.join(" and ")}.`);
}

function verifySecretInputs() {
  secretIssues("ADMIN_CONSOLE_TOKEN", adminToken);
  secretIssues("APP_ACCESS_TOKEN", appAccessToken);
  if (adminToken && appAccessToken && adminToken === appAccessToken) {
    fail("APP_ACCESS_TOKEN and ADMIN_CONSOLE_TOKEN must be different values.");
  }
}

function isLocalDeployHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function verifyDeploymentTarget() {
  if (!baseUrl) {
    fail("Missing SAYVE_DEPLOY_URL. Example: SAYVE_DEPLOY_URL=https://sayve.vercel.app pnpm run verify:deploy");
    return false;
  }

  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    fail(`SAYVE_DEPLOY_URL must be a valid URL. Got: ${baseUrl}`);
    return false;
  }

  const isLocal = isLocalDeployHost(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocal)) {
    fail("SAYVE_DEPLOY_URL must use https, except http://localhost or http://127.0.0.1 for private local smoke tests.");
    return false;
  }

  if (requirePublicReady && (parsed.protocol !== "https:" || isLocal)) {
    fail("Public-ready deployment smoke must target an HTTPS non-local deployment URL. Use SAYVE_REQUIRE_PUBLIC_READY=0 for local/private smoke tests.");
    return false;
  }

  return true;
}

function endpoint(path) {
  if (!baseUrl) throw new Error("Set SAYVE_DEPLOY_URL or pass the deployment URL as the first argument.");
  return `${baseUrl}${path}`;
}

async function requestJson(path, init = {}) {
  const headers = new Headers(init.headers ?? {});
  if (appAccessToken) headers.set("x-app-access-token", appAccessToken);
  if (adminToken) headers.set("x-admin-token", adminToken);

  const response = await fetch(endpoint(path), {
    ...init,
    headers
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  return { response, json };
}

async function requestJsonWithoutPrivateAccess(path, init = {}) {
  const headers = new Headers(init.headers ?? {});
  const response = await fetch(endpoint(path), {
    ...init,
    headers
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  return { response, json };
}

async function requestTextWithoutPrivateAccess(path, init = {}) {
  const headers = new Headers(init.headers ?? {});
  const response = await fetch(endpoint(path), {
    ...init,
    headers
  });
  return { response, text: await response.text() };
}

async function requestText(path, init = {}) {
  const headers = new Headers(init.headers ?? {});
  if (appAccessToken) headers.set("x-app-access-token", appAccessToken);
  const response = await fetch(endpoint(path), {
    ...init,
    headers
  });
  return { response, text: await response.text() };
}

async function requestJsonWithAuth(path, init = {}, accessToken = testSupabaseAccessToken) {
  const headers = new Headers(init.headers ?? {});
  if (accessToken) headers.set("authorization", `Bearer ${accessToken}`);
  if (testHouseholdId) headers.set("x-household-id", testHouseholdId);
  return requestJson(path, { ...init, headers });
}

function verifyNoStoreHeaders(response, label) {
  const cacheControl = response.headers.get("cache-control") ?? "";
  const robots = response.headers.get("x-robots-tag") ?? "";
  if (!cacheControl.includes("no-store") || robots !== "noindex") {
    fail(`${label} must return no-store/noindex headers. Got cache-control=${cacheControl}, x-robots-tag=${robots}`);
    return false;
  }
  return true;
}

function verifyTelemetryEventCompleteness(event, label) {
  const missing = [];
  if (typeof event?.totalTokens !== "number") missing.push("totalTokens");
  if (typeof event?.estimatedCostUsd !== "number") missing.push("estimatedCostUsd");
  if (typeof event?.durationMs !== "number") missing.push("durationMs");
  if (missing.length > 0) {
    fail(`${label} telemetry is incomplete; missing ${missing.join(", ")}: ${JSON.stringify(event)}`);
    return false;
  }
  return true;
}

function verifyOpenAiTelemetryEvent(event, label) {
  if (!requireOpenAiSmoke) return true;
  if (event?.provider !== "openai" || event?.status !== "success") {
    fail(
      `${label} must use OpenAI successfully when SAYVE_REQUIRE_OPENAI_SMOKE=1 or public-ready smoke is required. Got provider=${event?.provider}, status=${event?.status}, model=${event?.model}`
    );
    return false;
  }
  return true;
}

function verifyOpenAiRuntimeHealth(runtimeHealth, label) {
  if (!requireOpenAiSmoke) return true;
  if (typeof runtimeHealth?.openAiEvents !== "number") {
    fail(`${label} Founder Console is missing aiRuntimeHealth.openAiEvents: ${JSON.stringify(runtimeHealth)}`);
    return false;
  }
  if (runtimeHealth.openAiEvents <= 0) {
    fail(`${label} Founder Console should report OpenAI events after OpenAI smoke. Got ${JSON.stringify(runtimeHealth)}`);
    return false;
  }
  if (typeof runtimeHealth?.openAiSuccessRate !== "number" || typeof runtimeHealth?.openAiFallbackRate !== "number" || typeof runtimeHealth?.openAiErrorEvents !== "number") {
    fail(`${label} Founder Console is missing OpenAI runtime metrics: ${JSON.stringify(runtimeHealth)}`);
    return false;
  }
  if (runtimeHealth.openAiSuccessRate <= 0) {
    fail(`${label} Founder Console should report a positive OpenAI success rate after OpenAI smoke. Got ${JSON.stringify(runtimeHealth)}`);
    return false;
  }
  return true;
}

function verifyCaptureDecisionTelemetryEvent(event, label) {
  if (event?.phase !== "capture_interpretation") {
    fail(`${label} capture telemetry should be phase=capture_interpretation. Got ${event?.phase}: ${JSON.stringify(event)}`);
    return false;
  }
  const metadata = event.metadata ?? {};
  if (typeof metadata.intent !== "string" || metadata.intent.length === 0) {
    fail(`${label} capture telemetry is missing intent metadata: ${JSON.stringify(event)}`);
    return false;
  }
  const decision = typeof metadata.decision === "string" ? metadata.decision : metadata.memoryStatus;
  if (typeof decision !== "string" || decision.length === 0) {
    fail(`${label} capture telemetry is missing decision metadata: ${JSON.stringify(event)}`);
    return false;
  }
  if (typeof metadata.confidenceBand !== "string" || typeof metadata.needsUserInput !== "boolean") {
    fail(`${label} capture telemetry is missing decision-quality metadata: ${JSON.stringify(event)}`);
    return false;
  }
  return true;
}

function verifyLaunchReadinessShape(readinessJson) {
  const missingBooleanFields = ["configReadyForPrivateBeta", "liveSmokeVerified", "readyForPublicLaunch"].filter(
    (field) => typeof readinessJson?.[field] !== "boolean"
  );
  if (missingBooleanFields.length > 0) {
    fail(
      `Launch readiness response is missing required boolean fields: ${missingBooleanFields.join(
        ", "
      )}. Redeploy the latest Sayve build before trusting launch readiness.`
    );
    return false;
  }

  if (!["pass", "warn", "fail"].includes(readinessJson?.status)) {
    fail(
      `Launch readiness response has invalid status=${JSON.stringify(
        readinessJson?.status
      )}. Redeploy the latest Sayve build before trusting launch readiness.`
    );
    return false;
  }

  const checks = Array.isArray(readinessJson?.checks) ? readinessJson.checks : [];
  const checkIds = new Set(checks.map((check) => check?.id).filter(Boolean));
  const missing = requiredLaunchReadinessCheckIds.filter((id) => !checkIds.has(id));
  if (missing.length > 0) {
    fail(`Launch readiness response is missing required check ids: ${missing.join(", ")}. Redeploy the latest Sayve build before trusting launch readiness.`);
    return false;
  }

  if (!readinessJson?.smokeProof || typeof readinessJson.smokeProof !== "object") {
    fail("Launch readiness response is missing smokeProof metadata. Redeploy the latest Sayve build before trusting launch readiness.");
    return false;
  }

  const smokeProof = readinessJson.smokeProof;
  const missingSmokeFields = ["verifiedAt", "targetUrl", "issues"].filter((field) => !(field in smokeProof));
  if (missingSmokeFields.length > 0) {
    fail(`Launch readiness smokeProof is missing required fields: ${missingSmokeFields.join(", ")}.`);
    return false;
  }
  return true;
}

function summarizeLaunchReadinessChecks(readinessJson, statuses = ["fail"]) {
  const checks = Array.isArray(readinessJson?.checks) ? readinessJson.checks : [];
  return checks
    .filter((check) => statuses.includes(check?.status))
    .map((check) => {
      const parts = [`[${check.id}] ${check.label}`];
      if (typeof check.detail === "string" && check.detail.length > 0) {
        parts.push(check.detail);
      }
      if (Array.isArray(check.requiredMigrations) && check.requiredMigrations.length > 0) {
        parts.push(`Required migrations: ${check.requiredMigrations.join(", ")}`);
      }
      if (Array.isArray(check.recommendedActions) && check.recommendedActions.length > 0) {
        parts.push(`Next: ${check.recommendedActions.join(" | ")}`);
      }
      return parts.join(" :: ");
    });
}

function verifyAppliedMigrationProofRows(rows, label) {
  const appliedRows = Array.isArray(rows) ? rows.filter((row) => row?.view === "applied_migration") : [];
  if (appliedRows.length === 0) {
    fail(`${label} is missing applied_migration proof rows: ${JSON.stringify(rows)}`);
    return false;
  }

  const requiredStage = requirePublicReady ? "public_launch" : "private_beta";
  const requiredRows = appliedRows.filter((row) => row?.requiredFor === "private_beta" || (requirePublicReady && row?.requiredFor === "public_launch"));
  if (requiredRows.length === 0) {
    fail(`${label} is missing required staged applied_migration rows for ${requiredStage}: ${JSON.stringify(appliedRows)}`);
    return false;
  }

  const missingRequired = requiredRows.filter((row) => row?.status !== "ok");
  if (missingRequired.length > 0) {
    fail(
      `${label} has missing applied migrations for ${requiredStage}: ${missingRequired.map((row) => row?.file || row?.version || JSON.stringify(row)).join(", ")}`
    );
    return false;
  }

  return true;
}

function verifySmokeProof(readinessJson) {
  if (!readinessJson?.liveSmokeVerified) return true;

  const smokeProof = readinessJson.smokeProof ?? {};
  if (typeof smokeProof.verifiedAt !== "string" || !Number.isFinite(Date.parse(smokeProof.verifiedAt))) {
    fail(`Launch readiness smokeProof.verifiedAt must be a valid ISO timestamp. Got ${JSON.stringify(smokeProof.verifiedAt)}.`);
    return false;
  }
  if (typeof smokeProof.targetUrl !== "string" || smokeProof.targetUrl.length === 0) {
    fail("Launch readiness smokeProof.targetUrl must be present once live smoke is verified.");
    return false;
  }
  if (!Array.isArray(smokeProof.issues)) {
    fail("Launch readiness smokeProof.issues must be an array.");
    return false;
  }
  if (smokeProof.issues.length > 0) {
    fail(`Launch readiness smokeProof still reports issues: ${smokeProof.issues.join(" ")}`);
    return false;
  }
  if (smokeProof.targetUrl.replace(/\/$/, "") !== baseUrl) {
    fail(`Launch readiness smokeProof.targetUrl should match SAYVE_DEPLOY_URL. Got ${smokeProof.targetUrl}, expected ${baseUrl}.`);
    return false;
  }
  return true;
}

async function verifyFounderSetupBundleSmoke(readinessJson) {
  const bundle = await requestJson("/api/admin/founder/setup-bundle");
  if (!bundle.response.ok) {
    fail(`/api/admin/founder/setup-bundle failed with ${bundle.response.status}: ${JSON.stringify(bundle.json)}`);
    return false;
  }
  if (!verifyNoStoreHeaders(bundle.response, "/api/admin/founder/setup-bundle")) return false;

  const requiredTopLevel = ["generatedAt", "signature", "launchReadiness", "launchReadinessChecks", "defaultHouseholdBinding", "onboardingHealth", "nextActions", "commands", "views"];
  if (!Array.isArray(readinessJson?.requiredMigrations) || !Array.isArray(readinessJson?.recommendedActions)) {
    fail(`Launch readiness response is missing requiredMigrations/recommendedActions arrays: ${JSON.stringify(readinessJson)}`);
    return false;
  }
  const missingTopLevel = requiredTopLevel.filter((field) => !(field in (bundle.json ?? {})));
  if (missingTopLevel.length > 0) {
    fail(`/api/admin/founder/setup-bundle is missing fields: ${missingTopLevel.join(", ")}.`);
    return false;
  }

  const launch = bundle.json.launchReadiness ?? {};
  const expectedLaunch = {
    configReadyForPrivateBeta: readinessJson.configReadyForPrivateBeta,
    liveSmokeVerified: readinessJson.liveSmokeVerified,
    readyForPublicLaunch: readinessJson.readyForPublicLaunch
  };
  for (const [key, value] of Object.entries(expectedLaunch)) {
    if (launch[key] !== value) {
      fail(`/api/admin/founder/setup-bundle launchReadiness.${key} drifted from /api/admin/launch-readiness. Got ${launch[key]}, expected ${value}.`);
      return false;
    }
  }

  const views = bundle.json.views ?? {};
  const nextActions = bundle.json.nextActions;
  const launchReadinessChecks = bundle.json.launchReadinessChecks;
  const commands = bundle.json.commands ?? {};
  if (!Array.isArray(launchReadinessChecks) || launchReadinessChecks.length === 0) {
    fail(`/api/admin/founder/setup-bundle launchReadinessChecks are missing or invalid: ${JSON.stringify(launchReadinessChecks)}`);
    return false;
  }
  const missingBundledChecks = (Array.isArray(readinessJson?.checks) ? readinessJson.checks : [])
    .filter((check) => !launchReadinessChecks.some((item) => item?.id === check?.id && item?.status === check?.status));
  if (missingBundledChecks.length > 0) {
    fail(`/api/admin/founder/setup-bundle launchReadinessChecks drifted from /api/admin/launch-readiness: ${JSON.stringify(missingBundledChecks)}`);
    return false;
  }
  if (!Array.isArray(nextActions) || nextActions.length === 0 || nextActions.some((item) => typeof item !== "string" || item.length === 0)) {
    fail(`/api/admin/founder/setup-bundle nextActions are missing or invalid: ${JSON.stringify(nextActions)}`);
    return false;
  }
  const requiredViews = [
    "liveRollout",
    "launchCompletionAudit",
    "launchBlockers",
    "publicLaunchChecks",
    "migrationInventory",
    "schemaMigrationProof",
    "privateBetaSetupGate",
    "integrationReadiness",
    "integrationPackage",
    "authSetup",
    "envSetup",
    "envTemplate",
    "deployEnvTemplate",
    "deploySmokeEnvTemplate",
    "repositorySmokeGuide",
    "oauthChecklist",
    "smokeTokenGuide"
  ];
  const missingViews = requiredViews.filter((name) => !Array.isArray(views[name]));
  if (missingViews.length > 0) {
    fail(`/api/admin/founder/setup-bundle views are missing arrays for: ${missingViews.join(", ")}.`);
    return false;
  }
  if (
    typeof commands.privateBeta !== "string" ||
    !commands.privateBeta.includes("pnpm run verify:deploy:private-beta") ||
    typeof commands.strictPrivateBeta !== "string" ||
    !commands.strictPrivateBeta.includes("pnpm run verify:deploy:strict-private-beta") ||
    !commands.strictPrivateBeta.includes("SAYVE_TEST_VIEWER_SUPABASE_ACCESS_TOKEN=") ||
    typeof commands.strictPrivateBetaProof !== "string" ||
    !commands.strictPrivateBetaProof.includes("pnpm run verify:deploy:strict-private-beta:proof") ||
    !commands.strictPrivateBetaProof.includes("SAYVE_DEPLOY_PROOF_REPORT_PATH=outputs/setup/deploy-proof-report.json") ||
    typeof commands.publicLaunch !== "string" ||
    !commands.publicLaunch.includes("pnpm run verify:deploy:public-launch") ||
    !commands.publicLaunch.includes("SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN=")
  ) {
    fail(`/api/admin/founder/setup-bundle commands are incomplete: ${JSON.stringify(commands)}`);
    return false;
  }

  const launchCompletionRow = views.launchCompletionAudit.find((row) => row?.requirement === "production_storage_boundary");
  if (!launchCompletionRow || typeof launchCompletionRow.liveProof !== "string" || typeof launchCompletionRow.nextAction !== "string") {
    fail(`/api/admin/founder/setup-bundle launchCompletionAudit is incomplete: ${JSON.stringify(views.launchCompletionAudit)}`);
    return false;
  }

  const inviteRedirectRow = views.authSetup.find((row) => row?.item === "supabase_redirect_url_invite");
  if (!inviteRedirectRow || typeof inviteRedirectRow.target !== "string") {
    fail(`/api/admin/founder/setup-bundle authSetup is missing supabase_redirect_url_invite: ${JSON.stringify(views.authSetup)}`);
    return false;
  }

  const envTemplateAppUrl = views.envTemplate.find((row) => row?.env === "NEXT_PUBLIC_APP_URL");
  if (!envTemplateAppUrl || typeof envTemplateAppUrl.value !== "string") {
    fail(`/api/admin/founder/setup-bundle envTemplate is missing NEXT_PUBLIC_APP_URL: ${JSON.stringify(views.envTemplate)}`);
    return false;
  }

  const deployEnvTarget = views.deployEnvTemplate.find((row) => row?.env === "SAYVE_ENV_TARGET");
  if (!deployEnvTarget || deployEnvTarget.value !== "public-launch") {
    fail(`/api/admin/founder/setup-bundle deployEnvTemplate is missing SAYVE_ENV_TARGET=public-launch: ${JSON.stringify(views.deployEnvTemplate)}`);
    return false;
  }
  const deploySmokeAuthRow = views.deploySmokeEnvTemplate.find((row) => row?.env === "SAYVE_REQUIRE_AUTH_SMOKE");
  if (!deploySmokeAuthRow || String(deploySmokeAuthRow.value) !== "1") {
    fail(
      `/api/admin/founder/setup-bundle deploySmokeEnvTemplate is missing SAYVE_REQUIRE_AUTH_SMOKE=1: ${JSON.stringify(
        views.deploySmokeEnvTemplate
      )}`
    );
    return false;
  }
  const deploySmokeBootstrapFlagRow = views.deploySmokeEnvTemplate.find((row) => row?.env === "SAYVE_REQUIRE_BOOTSTRAP_SMOKE");
  if (!deploySmokeBootstrapFlagRow || String(deploySmokeBootstrapFlagRow.value) !== "1") {
    fail(
      `/api/admin/founder/setup-bundle deploySmokeEnvTemplate is missing SAYVE_REQUIRE_BOOTSTRAP_SMOKE=1: ${JSON.stringify(
        views.deploySmokeEnvTemplate
      )}`
    );
    return false;
  }
  const deploySmokeBootstrapTokenRow = views.deploySmokeEnvTemplate.find((row) => row?.env === "SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN");
  if (!deploySmokeBootstrapTokenRow) {
    fail(`/api/admin/founder/setup-bundle deploySmokeEnvTemplate is missing SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN: ${JSON.stringify(views.deploySmokeEnvTemplate)}`);
    return false;
  }

  const oauthInviteStep = views.oauthChecklist.find((row) => row?.item === "Add invite redirect allow-list entry");
  if (!oauthInviteStep || typeof oauthInviteStep.target !== "string") {
    fail(`/api/admin/founder/setup-bundle oauthChecklist is missing invite redirect step: ${JSON.stringify(views.oauthChecklist)}`);
    return false;
  }

  const smokeOwnerRow = views.smokeTokenGuide.find((row) => row?.role === "owner");
  if (!smokeOwnerRow || smokeOwnerRow.env !== "SAYVE_TEST_SUPABASE_ACCESS_TOKEN") {
    fail(`/api/admin/founder/setup-bundle smokeTokenGuide is missing owner token instructions: ${JSON.stringify(views.smokeTokenGuide)}`);
    return false;
  }
  const smokeBootstrapRow = views.smokeTokenGuide.find((row) => row?.role === "fresh_no_household");
  if (!smokeBootstrapRow || smokeBootstrapRow.env !== "SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN") {
    fail(`/api/admin/founder/setup-bundle smokeTokenGuide is missing bootstrap token instructions: ${JSON.stringify(views.smokeTokenGuide)}`);
    return false;
  }
  const repositoryGuideRow = views.repositorySmokeGuide.find((row) => row?.item === "Expected fields");
  if (
    !repositoryGuideRow ||
    typeof repositoryGuideRow.target !== "string" ||
    !repositoryGuideRow.target.includes("memberCount") ||
    !repositoryGuideRow.target.includes("viewerCount") ||
    !repositoryGuideRow.target.includes("onboarding.pendingInvites")
  ) {
    fail(`/api/admin/founder/setup-bundle repositorySmokeGuide is missing expected repository smoke fields: ${JSON.stringify(views.repositorySmokeGuide)}`);
    return false;
  }
  if (!Array.isArray(views.publicLaunchChecks)) {
    fail(`/api/admin/founder/setup-bundle publicLaunchChecks is missing: ${JSON.stringify(views.publicLaunchChecks)}`);
    return false;
  }
  const migration001 = views.migrationInventory.find((row) => row?.file === "001_ai_native_memory_engine.sql");
  const migration012 = views.migrationInventory.find((row) => row?.file === "012_harden_ai_telemetry_constraints.sql");
  if (!migration001 || !migration012) {
    fail(`/api/admin/founder/setup-bundle migrationInventory is incomplete: ${JSON.stringify(views.migrationInventory)}`);
    return false;
  }
  const schemaMigrationProofRow = views.schemaMigrationProof.find((row) => row?.view === "live_schema_check");
  if (!schemaMigrationProofRow || typeof schemaMigrationProofRow.recommendedAction !== "string") {
    fail(`/api/admin/founder/setup-bundle schemaMigrationProof is missing live schema proof rows: ${JSON.stringify(views.schemaMigrationProof)}`);
    return false;
  }
  if (!verifyAppliedMigrationProofRows(views.schemaMigrationProof, "/api/admin/founder/setup-bundle schemaMigrationProof")) return false;
  const setupGateSmoke = views.privateBetaSetupGate.find((row) => row?.item === "Live deployment smoke");
  const setupGatePartner = views.privateBetaSetupGate.find((row) => row?.item === "Partner joined household");
  if (!setupGateSmoke || !setupGatePartner) {
    fail(`/api/admin/founder/setup-bundle privateBetaSetupGate is incomplete: ${JSON.stringify(views.privateBetaSetupGate)}`);
    return false;
  }
  const integrationSupabase = views.integrationReadiness.find((row) => row?.system === "supabase");
  const integrationOAuth = views.integrationReadiness.find((row) => row?.system === "google_oauth");
  const integrationVercel = views.integrationReadiness.find((row) => row?.system === "vercel");
  if (!integrationSupabase || !integrationOAuth || !integrationVercel) {
    fail(`/api/admin/founder/setup-bundle integrationReadiness is incomplete: ${JSON.stringify(views.integrationReadiness)}`);
    return false;
  }
  const integrationPkgSupabase = views.integrationPackage.find((row) => row?.system === "supabase" && row?.field === "project_url");
  const integrationPkgOAuth = views.integrationPackage.find((row) => row?.system === "google_oauth" && row?.field === "redirect_invite");
  const integrationPkgOpenAi = views.integrationPackage.find((row) => row?.system === "openai" && row?.field === "api_key");
  if (!integrationPkgSupabase || !integrationPkgOAuth || !integrationPkgOpenAi) {
    fail(`/api/admin/founder/setup-bundle integrationPackage is incomplete: ${JSON.stringify(views.integrationPackage)}`);
    return false;
  }

  console.log("PASS: founder setup bundle ok");
  const exportedBundle = await requestJson("/api/admin/export?scope=bundle&name=setup&format=json");
  if (!exportedBundle.response.ok) {
    fail(`/api/admin/export?scope=bundle&name=setup&format=json failed with ${exportedBundle.response.status}: ${JSON.stringify(exportedBundle.json)}`);
    return false;
  }
  if (!verifyNoStoreHeaders(exportedBundle.response, "/api/admin/export setup bundle")) return false;
  if (exportedBundle.json?.scope !== "bundle" || exportedBundle.json?.name !== "setup" || !exportedBundle.json?.bundle) {
    fail(`/api/admin/export setup bundle payload is malformed: ${JSON.stringify(exportedBundle.json)}`);
    return false;
  }
  if (!Array.isArray(exportedBundle.json.bundle.nextActions) || typeof exportedBundle.json.bundle.commands?.privateBeta !== "string") {
    fail(`/api/admin/export setup bundle is missing nextActions or commands: ${JSON.stringify(exportedBundle.json.bundle)}`);
    return false;
  }
  if (typeof bundle.json.signature !== "string" || bundle.json.signature.length !== 64) {
    fail(`/api/admin/founder/setup-bundle signature is missing or invalid: ${JSON.stringify(bundle.json.signature)}`);
    return false;
  }
  if (exportedBundle.json.bundle.signature !== bundle.json.signature) {
    fail(
      `/api/admin/export setup bundle signature drifted from /api/admin/founder/setup-bundle. Got ${exportedBundle.json.bundle.signature}, expected ${bundle.json.signature}.`
    );
    return false;
  }
  console.log("PASS: founder setup bundle export ok");

  const integrationBundle = await requestJson("/api/admin/export?scope=bundle&name=integration&format=json");
  if (!integrationBundle.response.ok) {
    fail(`/api/admin/export?scope=bundle&name=integration&format=json failed with ${integrationBundle.response.status}: ${JSON.stringify(integrationBundle.json)}`);
    return false;
  }
  if (!verifyNoStoreHeaders(integrationBundle.response, "/api/admin/export integration bundle")) return false;
  if (integrationBundle.json?.scope !== "bundle" || integrationBundle.json?.name !== "integration" || !integrationBundle.json?.bundle) {
    fail(`/api/admin/export integration bundle payload is malformed: ${JSON.stringify(integrationBundle.json)}`);
    return false;
  }
  if (
    !Array.isArray(integrationBundle.json.bundle.views?.launchCompletionAudit) ||
    !Array.isArray(integrationBundle.json.bundle.views?.integrationReadiness) ||
    !Array.isArray(integrationBundle.json.bundle.views?.integrationPackage) ||
    !Array.isArray(integrationBundle.json.bundle.views?.schemaMigrationProof) ||
    !Array.isArray(integrationBundle.json.bundle.views?.migrationInventory) ||
    !Array.isArray(integrationBundle.json.bundle.views?.deploySmokeEnvTemplate) ||
    !Array.isArray(integrationBundle.json.bundle.views?.smokeTokenGuide)
  ) {
    fail(`/api/admin/export integration bundle is missing integration views: ${JSON.stringify(integrationBundle.json.bundle)}`);
    return false;
  }
  const integrationViews = integrationBundle.json.bundle.views;
  const integrationMigration001 = integrationViews.migrationInventory.find((row) => row?.file === "001_ai_native_memory_engine.sql");
  const integrationMigration012 = integrationViews.migrationInventory.find((row) => row?.file === "012_harden_ai_telemetry_constraints.sql");
  const integrationSchemaProofRow = integrationViews.schemaMigrationProof.find((row) => row?.view === "live_schema_check");
  if (!integrationMigration001 || !integrationMigration012 || !integrationSchemaProofRow || typeof integrationSchemaProofRow.recommendedAction !== "string") {
    fail(`/api/admin/export integration bundle is missing schema migration proof rows: ${JSON.stringify({ migrationInventory: integrationViews.migrationInventory, schemaMigrationProof: integrationViews.schemaMigrationProof })}`);
    return false;
  }
  if (!verifyAppliedMigrationProofRows(integrationViews.schemaMigrationProof, "/api/admin/export integration bundle schemaMigrationProof")) return false;
  const integrationExportSupabase = integrationViews.integrationPackage.find((row) => row?.system === "supabase" && row?.field === "project_url");
  const integrationExportOAuth = integrationViews.integrationPackage.find((row) => row?.system === "google_oauth" && row?.field === "redirect_invite");
  const integrationExportOpenAi = integrationViews.integrationPackage.find((row) => row?.system === "openai" && row?.field === "api_key");
  const integrationCaptureBudget = integrationViews.integrationPackage.find((row) => row?.system === "openai" && row?.field === "capture_output_budget");
  const integrationConversationBudget = integrationViews.integrationPackage.find((row) => row?.system === "openai" && row?.field === "conversation_output_budget");
  if (!integrationExportSupabase || !integrationExportOAuth || !integrationExportOpenAi || !integrationCaptureBudget || !integrationConversationBudget) {
    fail(`/api/admin/export integration bundle is incomplete: ${JSON.stringify(integrationViews.integrationPackage)}`);
    return false;
  }
  const integrationBootstrapTokenRow = integrationViews.smokeTokenGuide.find((row) => row?.env === "SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN");
  if (!integrationBootstrapTokenRow) {
    fail(`/api/admin/export integration bundle is missing bootstrap token guide row: ${JSON.stringify(integrationViews.smokeTokenGuide)}`);
    return false;
  }
  const integrationBootstrapFlagRow = integrationViews.deploySmokeEnvTemplate.find((row) => row?.env === "SAYVE_REQUIRE_BOOTSTRAP_SMOKE");
  const integrationBootstrapEnvRow = integrationViews.deploySmokeEnvTemplate.find((row) => row?.env === "SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN");
  if (!integrationBootstrapFlagRow || String(integrationBootstrapFlagRow.value) !== "1" || !integrationBootstrapEnvRow) {
    fail(`/api/admin/export integration bundle is missing bootstrap deploy smoke rows: ${JSON.stringify(integrationViews.deploySmokeEnvTemplate)}`);
    return false;
  }
  if (
    typeof integrationBundle.json.bundle.commands?.publicLaunch !== "string" ||
    !integrationBundle.json.bundle.commands.publicLaunch.includes("SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN=")
  ) {
    fail(`/api/admin/export integration bundle publicLaunch command is missing bootstrap token env: ${JSON.stringify(integrationBundle.json.bundle.commands)}`);
    return false;
  }
  if (typeof integrationBundle.json.bundle.signature !== "string" || integrationBundle.json.bundle.signature.length !== 64) {
    fail(`/api/admin/export integration bundle signature is missing or invalid: ${JSON.stringify(integrationBundle.json.bundle.signature)}`);
    return false;
  }
  console.log("PASS: founder integration bundle export ok");

  const liveProofBundle = await requestJson("/api/admin/export?scope=bundle&name=live-proof&format=json");
  if (!liveProofBundle.response.ok) {
    fail(`/api/admin/export?scope=bundle&name=live-proof&format=json failed with ${liveProofBundle.response.status}: ${JSON.stringify(liveProofBundle.json)}`);
    return false;
  }
  if (!verifyNoStoreHeaders(liveProofBundle.response, "/api/admin/export live-proof bundle")) return false;
  if (liveProofBundle.json?.scope !== "bundle" || liveProofBundle.json?.name !== "live-proof" || !liveProofBundle.json?.bundle) {
    fail(`/api/admin/export live-proof bundle payload is malformed: ${JSON.stringify(liveProofBundle.json)}`);
    return false;
  }
  const liveProofViews = liveProofBundle.json.bundle.views ?? {};
  if (
    !Array.isArray(liveProofViews.liveProofGaps) ||
    !Array.isArray(liveProofViews.onboardingProofSteps) ||
    !Array.isArray(liveProofViews.publicLaunchChecks) ||
    !Array.isArray(liveProofViews.schemaMigrationProof) ||
    !Array.isArray(liveProofViews.migrationInventory) ||
    !Array.isArray(liveProofViews.deployEnvTemplate) ||
    !Array.isArray(liveProofViews.deploySmokeEnvTemplate) ||
    !Array.isArray(liveProofViews.smokeTokenGuide)
  ) {
    fail(`/api/admin/export live-proof bundle is missing required proof views: ${JSON.stringify(liveProofBundle.json.bundle)}`);
    return false;
  }
  if (!verifyAppliedMigrationProofRows(liveProofViews.schemaMigrationProof, "/api/admin/export live-proof bundle schemaMigrationProof")) return false;
  const liveProofGapRow = liveProofViews.liveProofGaps.find((row) => row?.proofType === "external_live_proof");
  const onboardingProofRow = liveProofViews.onboardingProofSteps.find((row) => row?.item === "Shared-household proof");
  const smokeProofCheck = liveProofViews.publicLaunchChecks.find((row) => row?.item === "Smoke proof");
  const liveProofBootstrapToken = liveProofViews.smokeTokenGuide.find((row) => row?.env === "SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN");
  if (!liveProofGapRow || !onboardingProofRow || !smokeProofCheck || !liveProofBootstrapToken) {
    fail(`/api/admin/export live-proof bundle is incomplete: ${JSON.stringify(liveProofViews)}`);
    return false;
  }
  if (
    typeof liveProofBundle.json.bundle.commands?.strictPrivateBeta !== "string" ||
    !liveProofBundle.json.bundle.commands.strictPrivateBeta.includes("pnpm run verify:deploy:strict-private-beta") ||
    typeof liveProofBundle.json.bundle.commands?.strictPrivateBetaProof !== "string" ||
    !liveProofBundle.json.bundle.commands.strictPrivateBetaProof.includes("pnpm run verify:deploy:strict-private-beta:proof")
  ) {
    fail(`/api/admin/export live-proof bundle strict private beta proof commands are missing: ${JSON.stringify(liveProofBundle.json.bundle.commands)}`);
    return false;
  }
  if (typeof liveProofBundle.json.bundle.signature !== "string" || liveProofBundle.json.bundle.signature.length !== 64) {
    fail(`/api/admin/export live-proof bundle signature is missing or invalid: ${JSON.stringify(liveProofBundle.json.bundle.signature)}`);
    return false;
  }
  console.log("PASS: founder live-proof bundle export ok");
  return true;
}

function verifyCaptureMediaStored(capture, label) {
  if (!requirePublicReady) return true;
  const fileRefs = capture?.fileRefs ?? [];
  const metadata = capture?.metadata ?? {};
  if (!Array.isArray(fileRefs) || !fileRefs.some((ref) => typeof ref === "string" && ref.startsWith("supabase://")) || metadata.mediaStored !== true) {
    fail(`${label} must persist uploaded media to Supabase Storage during public-ready smoke. Got fileRefs=${JSON.stringify(fileRefs)}, metadata=${JSON.stringify(metadata)}`);
    return false;
  }
  return true;
}

async function verifyFounderTelemetryForCapture(captureId, label) {
  const founder = await requestJson("/api/admin/founder");
  if (!founder.response.ok) {
    fail(`/api/admin/founder telemetry smoke failed with ${founder.response.status}: ${JSON.stringify(founder.json)}`);
    return false;
  }
  if (!verifyNoStoreHeaders(founder.response, `/api/admin/founder ${label}`)) return false;
  const event = (founder.json.recentTelemetry ?? []).find(
    (telemetry) => telemetry.captureId === captureId && telemetry.phase === "capture_interpretation"
  );
  if (!event) {
    fail(`${label} capture_interpretation telemetry was not found in Founder Console recentTelemetry for capture ${captureId}.`);
    return false;
  }
  if (!verifyTelemetryEventCompleteness(event, `${label} capture`)) return false;
  if (!verifyCaptureDecisionTelemetryEvent(event, label)) return false;
  if (!verifyOpenAiTelemetryEvent(event, `${label} capture`)) return false;
  const aiDecisions = founder.json.aiDecisionAnalytics ?? {};
  if (typeof aiDecisions.captureDecisionEvents !== "number" || typeof aiDecisions.autoConfirmPercent !== "number") {
    fail(`${label} Founder Console AI Decisions are missing capture decision analytics: ${JSON.stringify(aiDecisions)}`);
    return false;
  }
  const runtimeHealth = founder.json.aiRuntimeHealth ?? {};
  if (typeof runtimeHealth.telemetryCompletenessPercent !== "number") {
    fail(`${label} Founder Console is missing telemetry completeness metrics: ${JSON.stringify(runtimeHealth)}`);
    return false;
  }
  if (!verifyOpenAiRuntimeHealth(runtimeHealth, `${label} capture`)) return false;
  console.log(`PASS: ${label} telemetry ok`);
  return true;
}

async function verifyFounderTelemetryForConversation(messageId, label) {
  const founder = await requestJson("/api/admin/founder");
  if (!founder.response.ok) {
    fail(`/api/admin/founder conversation telemetry smoke failed with ${founder.response.status}: ${JSON.stringify(founder.json)}`);
    return false;
  }
  if (!verifyNoStoreHeaders(founder.response, `/api/admin/founder ${label}`)) return false;
  const event = (founder.json.recentTelemetry ?? []).find((telemetry) => telemetry.conversationMessageId === messageId);
  if (!event) {
    fail(`${label} conversation telemetry was not found in Founder Console recentTelemetry for message ${messageId}.`);
    return false;
  }
  if (!verifyTelemetryEventCompleteness(event, `${label} conversation`)) return false;
  if (!verifyOpenAiTelemetryEvent(event, `${label} conversation`)) return false;
  if (event.phase !== "conversation_answer") {
    fail(`${label} conversation telemetry should be phase=conversation_answer. Got ${event.phase}: ${JSON.stringify(event)}`);
    return false;
  }
  const runtimeHealth = founder.json.aiRuntimeHealth ?? {};
  if (!verifyOpenAiRuntimeHealth(runtimeHealth, `${label} conversation`)) return false;
  console.log(`PASS: ${label} conversation telemetry ok`);
  return true;
}

function verifyDashboardPayloadShape(data, label) {
  if (!data || typeof data !== "object") {
    fail(`${label} dashboard payload is missing.`);
    return false;
  }

  const requiredNumberFields = ["income", "expenses", "net", "factCount", "memoryCount", "contextCount"];
  for (const field of requiredNumberFields) {
    if (typeof data[field] !== "number") {
      fail(`${label} dashboard payload is missing numeric field ${field}: ${JSON.stringify(data)}`);
      return false;
    }
  }

  if (typeof data.month !== "string" || data.month.length !== 7) {
    fail(`${label} dashboard payload has invalid month: ${JSON.stringify(data.month)}`);
    return false;
  }
  if (data.currency !== "HKD") {
    fail(`${label} dashboard payload should stay pinned to HKD for the smoke household. Got ${JSON.stringify(data.currency)}`);
    return false;
  }

  const requiredArrayFields = ["availableMonths", "byCategory", "daily", "reviewQueue", "monthlyTrend", "categoryTrends", "recentFacts", "monthlyFacts", "categoryOptions"];
  for (const field of requiredArrayFields) {
    if (!Array.isArray(data[field])) {
      fail(`${label} dashboard payload is missing array field ${field}: ${JSON.stringify(data)}`);
      return false;
    }
  }

  if (!Array.isArray(data.recurring)) {
    fail(`${label} dashboard payload is missing recurring array: ${JSON.stringify(data)}`);
    return false;
  }

  if (!data.availableMonths.includes(data.month)) {
    fail(`${label} dashboard payload should list the selected month in availableMonths: ${JSON.stringify(data.availableMonths)}`);
    return false;
  }

  const selectedTrendRows = data.monthlyTrend.filter((row) => row?.selected === true);
  if (selectedTrendRows.length !== 1 || selectedTrendRows[0]?.month !== data.month) {
    fail(`${label} dashboard monthlyTrend should contain exactly one selected row for ${data.month}: ${JSON.stringify(data.monthlyTrend)}`);
    return false;
  }

  const invalidCategoryTrend = data.categoryTrends.find(
    (trend) => typeof trend?.category !== "string" || !Array.isArray(trend?.rows)
  );
  if (invalidCategoryTrend) {
    fail(`${label} dashboard categoryTrends row is malformed: ${JSON.stringify(invalidCategoryTrend)}`);
    return false;
  }

  return true;
}

async function verifyMemoryDetailSmoke({ accessToken, memoryObjectId, factId, label }) {
  const memory = await requestJsonWithAuth(`/api/memory/${encodeURIComponent(memoryObjectId)}`, {}, accessToken);
  if (!memory.response.ok || memory.json.memory_object_id !== memoryObjectId || !memory.json.data?.memory) {
    fail(`/api/memory/:id ${label} smoke failed with ${memory.response.status}: ${JSON.stringify(memory.json)}`);
    return false;
  }
  if (!verifyNoStoreHeaders(memory.response, `/api/memory/:id ${label}`)) return false;

  const facts = memory.json.data?.facts ?? [];
  if (!Array.isArray(facts) || !facts.some((fact) => fact?.id === factId)) {
    fail(`${label} memory detail did not include expected fact ${factId}: ${JSON.stringify(memory.json.data)}`);
    return false;
  }

  const captures = memory.json.data?.captures ?? [];
  if (!Array.isArray(captures) || captures.length === 0) {
    fail(`${label} memory detail did not include source captures: ${JSON.stringify(memory.json.data)}`);
    return false;
  }

  console.log(`PASS: ${label} memory detail ok`);
  return true;
}

async function verifyInsightInboxSmoke(accessToken) {
  const insights = await requestJsonWithAuth("/api/insights", {}, accessToken);
  if (!insights.response.ok || insights.json.current_state !== "insight_inbox" || !Array.isArray(insights.json.data)) {
    fail(`/api/insights smoke failed with ${insights.response.status}: ${JSON.stringify(insights.json)}`);
    return false;
  }
  if (!verifyNoStoreHeaders(insights.response, "/api/insights smoke")) return false;

  const malformedInsight = insights.json.data.find(
    (item) => typeof item?.id !== "string" || typeof item?.title !== "string" || typeof item?.explanation !== "string"
  );
  if (malformedInsight) {
    fail(`/api/insights returned malformed insight row: ${JSON.stringify(malformedInsight)}`);
    return false;
  }

  const dismissibleInsight = insights.json.data.find((item) => item && item.dismissed !== true);
  if (!dismissibleInsight) {
    warn("Skipping insight dismiss smoke because the inbox is empty.");
    console.log("PASS: insight inbox smoke ok");
    return true;
  }

  const dismiss = await requestJsonWithAuth(
    `/api/insights/${encodeURIComponent(dismissibleInsight.id)}/dismiss`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    },
    accessToken
  );
  if (!dismiss.response.ok || dismiss.json.current_state !== "insight_dismissed" || dismiss.json.data?.id !== dismissibleInsight.id) {
    fail(`/api/insights/:id/dismiss smoke failed with ${dismiss.response.status}: ${JSON.stringify(dismiss.json)}`);
    return false;
  }
  if (!verifyNoStoreHeaders(dismiss.response, "/api/insights/:id/dismiss smoke")) return false;

  const refreshed = await requestJsonWithAuth("/api/insights", {}, accessToken);
  if (!refreshed.response.ok || !Array.isArray(refreshed.json.data)) {
    fail(`/api/insights refresh after dismiss failed with ${refreshed.response.status}: ${JSON.stringify(refreshed.json)}`);
    return false;
  }
  if (!verifyNoStoreHeaders(refreshed.response, "/api/insights refresh smoke")) return false;
  if (refreshed.json.data.some((item) => item?.id === dismissibleInsight.id)) {
    fail(`/api/insights dismiss smoke left the dismissed insight visible in inbox: ${JSON.stringify(refreshed.json.data)}`);
    return false;
  }

  console.log("PASS: insight inbox smoke ok");
  return true;
}

async function verifyConversationSourcesSmoke({ accessToken, messageId, label }) {
  const sources = await requestJsonWithAuth(`/api/conversation/${encodeURIComponent(messageId)}/sources`, {}, accessToken);
  if (!sources.response.ok || sources.json.current_state !== "conversation_sources" || !sources.json.data?.message) {
    fail(`/api/conversation/:id/sources ${label} smoke failed with ${sources.response.status}: ${JSON.stringify(sources.json)}`);
    return false;
  }
  if (!verifyNoStoreHeaders(sources.response, `/api/conversation/:id/sources ${label}`)) return false;

  const sourceRefs = sources.json.data?.sourceRefs ?? sources.json.source_refs ?? [];
  if (!Array.isArray(sourceRefs) || sourceRefs.length === 0) {
    fail(`${label} conversation sources should expose non-empty sourceRefs: ${JSON.stringify(sources.json)}`);
    return false;
  }

  const sourcePayloads = [sources.json.data?.facts, sources.json.data?.contexts, sources.json.data?.memories, sources.json.data?.captures];
  if (!sourcePayloads.some((rows) => Array.isArray(rows) && rows.length > 0)) {
    fail(`${label} conversation sources should resolve at least one concrete source payload: ${JSON.stringify(sources.json.data)}`);
    return false;
  }

  console.log(`PASS: ${label} conversation sources ok`);
  return true;
}

async function verifyConversationSmoke(accessToken) {
  const ask = await requestJsonWithAuth(
    "/api/conversation/ask",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: `[smoke] 今個月交通用了幾多？ ${new Date().toISOString()}` })
    },
    accessToken
  );

  if (!ask.response.ok || ask.json.current_state !== "conversation_answer" || !ask.json.data?.message?.id) {
    fail(`/api/conversation/ask smoke failed with ${ask.response.status}: ${JSON.stringify(ask.json)}`);
    return false;
  }
  if (!verifyNoStoreHeaders(ask.response, "/api/conversation/ask smoke")) return false;
  if (typeof ask.json.data?.message?.content !== "string" || ask.json.data.message.content.length === 0) {
    fail(`/api/conversation/ask smoke returned an empty message: ${JSON.stringify(ask.json)}`);
    return false;
  }
  if (!Array.isArray(ask.json.source_refs)) {
    fail(`/api/conversation/ask smoke should return source_refs array: ${JSON.stringify(ask.json)}`);
    return false;
  }

  const messageId = ask.json.data.message.id;
  const telemetryOk = await verifyFounderTelemetryForConversation(messageId, "primary member");
  if (!telemetryOk) return false;
  const sourcesOk = await verifyConversationSourcesSmoke({ accessToken, messageId, label: "primary member" });
  if (!sourcesOk) return false;

  console.log("PASS: conversation smoke ok");
  return true;
}

async function verifyAuthenticatedMember({ label, accessToken, smokeText, expectedVisibleFactIds = [], expectedVisibleFacts = [] }) {
  const households = await requestJsonWithAuth("/api/households", {}, accessToken);
  if (!households.response.ok || households.json.ok !== true) {
    fail(`/api/households ${label} smoke failed with ${households.response.status}: ${JSON.stringify(households.json)}`);
    return false;
  }
  if (!verifyNoStoreHeaders(households.response, `/api/households ${label}`)) return false;
  const householdIds = (households.json.households ?? []).map((household) => household.id);
  if (!householdIds.includes(testHouseholdId)) {
    fail(`${label} authenticated user is not a member of SAYVE_TEST_HOUSEHOLD_ID. Households returned: ${householdIds.join(", ")}`);
    return false;
  }
  console.log(`PASS: ${label} household list ok`);

  const datedSmokeText = `[smoke] Sayve ${label} ${smokeText} ${new Date().toISOString()}`;
  const capture = await requestJsonWithAuth(
    "/api/captures/text",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: datedSmokeText })
    },
    accessToken
  );
  if (!capture.response.ok || capture.json.needs_user_input !== false || !capture.json.data?.capture?.id || !capture.json.data?.fact?.id) {
    fail(`/api/captures/text ${label} smoke failed with ${capture.response.status}: ${JSON.stringify(capture.json)}`);
    return false;
  }
  if (!verifyNoStoreHeaders(capture.response, `/api/captures/text ${label}`)) return false;
  const captureId = capture.json.data.capture.id;
  const factId = capture.json.data.fact.id;
  const memoryObjectId = capture.json.memory_object_id;
  const createdBy = capture.json.data.capture.createdBy;
  const ownershipScope = capture.json.data.fact?.payload?.ownershipScope;
  if (ownershipScope !== "shared") {
    fail(`${label} unspecified ownership smoke should default to shared household spending. Got ownershipScope=${ownershipScope}: ${JSON.stringify(capture.json.data.fact)}`);
    return false;
  }
  console.log(`PASS: ${label} capture ok (${captureId}, fact ${factId})`);
  const telemetryOk = await verifyFounderTelemetryForCapture(captureId, label);
  if (!telemetryOk) return false;

  const dashboard = await requestJsonWithAuth("/api/views/dashboard", {}, accessToken);
  if (!dashboard.response.ok || dashboard.json.current_state !== "dashboard_view") {
    fail(`/api/views/dashboard ${label} smoke failed with ${dashboard.response.status}: ${JSON.stringify(dashboard.json)}`);
    return false;
  }
  if (!verifyNoStoreHeaders(dashboard.response, `/api/views/dashboard ${label}`)) return false;
  const factsThatMustBeVisible = [
    ...expectedVisibleFactIds.filter(Boolean).map((id) => ({ id })),
    ...expectedVisibleFacts.filter((fact) => fact?.id),
    { id: factId, createdBy, ownershipScope: "shared" }
  ];
  const factIdsThatMustBeVisible = factsThatMustBeVisible.map((fact) => fact.id);
  if (factIdsThatMustBeVisible.length > 0) {
    const monthlyFacts = dashboard.json.data?.monthlyFacts ?? [];
    const visibleFactIds = new Set(monthlyFacts.map((fact) => fact.id));
    const missingFactIds = factIdsThatMustBeVisible.filter((id) => !visibleFactIds.has(id));
    if (missingFactIds.length > 0) {
      fail(
        `${label} dashboard did not show expected shared household fact ids (${missingFactIds.join(", ")}): ${JSON.stringify(
          monthlyFacts
        )}`
      );
      return false;
    }

    const attributionMismatches = factsThatMustBeVisible
      .filter((expected) => expected.createdBy)
      .map((expected) => {
        const visible = monthlyFacts.find((fact) => fact.id === expected.id);
        return visible?.createdBy === expected.createdBy ? undefined : { id: expected.id, expected: expected.createdBy, actual: visible?.createdBy };
      })
      .filter(Boolean);
    if (attributionMismatches.length > 0) {
      fail(`${label} dashboard lost member attribution for shared household facts: ${JSON.stringify(attributionMismatches)}`);
      return false;
    }

    const ownershipMismatches = factsThatMustBeVisible
      .filter((expected) => expected.ownershipScope)
      .map((expected) => {
        const visible = monthlyFacts.find((fact) => fact.id === expected.id);
        return visible?.ownershipScope === expected.ownershipScope
          ? undefined
          : { id: expected.id, expected: expected.ownershipScope, actual: visible?.ownershipScope };
      })
      .filter(Boolean);
    if (ownershipMismatches.length > 0) {
      fail(`${label} dashboard lost shared spending ownership for household facts: ${JSON.stringify(ownershipMismatches)}`);
      return false;
    }
  }
  if (expectedVisibleFactIds.length > 0 && (dashboard.json.data?.factCount ?? 0) < factIdsThatMustBeVisible.length) {
    fail(`${label} dashboard fact count is lower than expected shared captures: ${JSON.stringify(dashboard.json.data)}`);
    return false;
  }
  if (!verifyDashboardPayloadShape(dashboard.json.data, label)) return false;
  console.log(`PASS: ${label} dashboard ok`);

  const memoryDetailOk = await verifyMemoryDetailSmoke({ accessToken, memoryObjectId, factId, label });
  if (!memoryDetailOk) return false;

  const timeline = await requestJsonWithAuth("/api/views/timeline", {}, accessToken);
  if (!timeline.response.ok || timeline.json.current_state !== "timeline_view") {
    fail(`/api/views/timeline ${label} smoke failed with ${timeline.response.status}: ${JSON.stringify(timeline.json)}`);
    return false;
  }
  if (!verifyNoStoreHeaders(timeline.response, `/api/views/timeline ${label}`)) return false;
  const timelineRows = timeline.json.data ?? [];
  const timelineMemoryIds = new Set(timelineRows.map((row) => row.memory?.id).filter(Boolean));
  const timelineFactIds = new Set(timelineRows.flatMap((row) => (row.facts ?? []).map((fact) => fact.id)).filter(Boolean));
  if (memoryObjectId && !timelineMemoryIds.has(memoryObjectId)) {
    fail(`${label} timeline did not show the new memory object ${memoryObjectId}: ${JSON.stringify(timelineRows)}`);
    return false;
  }
  const missingTimelineFactIds = factIdsThatMustBeVisible.filter((id) => !timelineFactIds.has(id));
  if (missingTimelineFactIds.length > 0) {
    fail(`${label} timeline did not show expected shared household fact ids (${missingTimelineFactIds.join(", ")}): ${JSON.stringify(timelineRows)}`);
    return false;
  }
  console.log(`PASS: ${label} timeline ok`);
  return { captureId, factId, createdBy, ownershipScope: "shared" };
}

async function verifyAuthenticatedMediaCaptureSmoke(accessToken) {
  const receiptForm = new FormData();
  receiptForm.set("note", `[smoke] receipt upload coffee HK$12 ${new Date().toISOString()}`);
  receiptForm.set("file", new Blob(["sayve receipt smoke"], { type: "image/png" }), "sayve-receipt-smoke.png");
  const receipt = await requestJsonWithAuth(
    "/api/captures/receipt",
    {
      method: "POST",
      body: receiptForm
    },
    accessToken
  );
  if (!receipt.response.ok || receipt.json.needs_user_input !== false || !receipt.json.data?.capture?.id || receipt.json.data.capture.sourceType !== "receipt") {
    fail(`/api/captures/receipt authenticated multipart smoke failed with ${receipt.response.status}: ${JSON.stringify(receipt.json)}`);
    return false;
  }
  if (!verifyCaptureMediaStored(receipt.json.data.capture, "receipt multipart capture")) return false;
  if (!verifyNoStoreHeaders(receipt.response, "/api/captures/receipt authenticated multipart smoke")) return false;
  const receiptTelemetryOk = await verifyFounderTelemetryForCapture(receipt.json.data.capture.id, "receipt multipart");
  if (!receiptTelemetryOk) return false;

  const voiceForm = new FormData();
  voiceForm.set("transcript", `[smoke] voice capture transport HK$8 ${new Date().toISOString()}`);
  voiceForm.set("file", new Blob(["sayve voice smoke"], { type: "audio/webm" }), "sayve-voice-smoke.webm");
  const voice = await requestJsonWithAuth(
    "/api/captures/voice",
    {
      method: "POST",
      body: voiceForm
    },
    accessToken
  );
  if (!voice.response.ok || voice.json.needs_user_input !== false || !voice.json.data?.capture?.id || voice.json.data.capture.sourceType !== "voice") {
    fail(`/api/captures/voice authenticated multipart smoke failed with ${voice.response.status}: ${JSON.stringify(voice.json)}`);
    return false;
  }
  if (!verifyCaptureMediaStored(voice.json.data.capture, "voice multipart capture")) return false;
  if (!verifyNoStoreHeaders(voice.response, "/api/captures/voice authenticated multipart smoke")) return false;
  const voiceTelemetryOk = await verifyFounderTelemetryForCapture(voice.json.data.capture.id, "voice multipart");
  if (!voiceTelemetryOk) return false;

  console.log("PASS: authenticated receipt/voice multipart capture smoke ok");
  return true;
}

async function verifyCategoryLearningSmoke(accessToken) {
  const categoryName = `[smoke] Sayve Category ${Date.now()}`;
  const category = await requestJsonWithAuth(
    "/api/categories",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: categoryName, color: "#8fb3ff" })
    },
    accessToken
  );

  if (!category.response.ok || category.json.current_state !== "category_created" || category.json.data?.category?.name !== categoryName) {
    fail(`/api/categories category learning smoke failed with ${category.response.status}: ${JSON.stringify(category.json)}`);
    return false;
  }
  if (!verifyNoStoreHeaders(category.response, "/api/categories category learning")) return false;

  const createdByUserId = category.json.data?.category?.createdByUserId;
  if (typeof createdByUserId !== "string" || createdByUserId.length === 0) {
    fail(`category learning smoke did not preserve createdByUserId: ${JSON.stringify(category.json.data?.category)}`);
    return false;
  }

  const dashboard = await requestJsonWithAuth("/api/views/dashboard", {}, accessToken);
  if (!dashboard.response.ok || dashboard.json.current_state !== "dashboard_view") {
    fail(`/api/views/dashboard category learning smoke failed with ${dashboard.response.status}: ${JSON.stringify(dashboard.json)}`);
    return false;
  }
  if (!verifyNoStoreHeaders(dashboard.response, "/api/views/dashboard category learning")) return false;
  const categoryOptions = dashboard.json.data?.categoryOptions ?? [];
  if (!categoryOptions.includes(categoryName)) {
    fail(`dashboard categoryOptions did not include the smoke category ${categoryName}: ${JSON.stringify(categoryOptions)}`);
    return false;
  }

  const founder = await requestJson("/api/admin/founder");
  if (!founder.response.ok) {
    fail(`/api/admin/founder category learning smoke failed with ${founder.response.status}: ${JSON.stringify(founder.json)}`);
    return false;
  }
  if (!verifyNoStoreHeaders(founder.response, "/api/admin/founder category learning")) return false;
  const rawCategory = (founder.json.rawTables?.categories ?? []).find((row) => row.name === categoryName);
  if (!rawCategory || rawCategory.createdByUserId !== createdByUserId) {
    fail(
      `Founder Console raw categories did not preserve category actor attribution for ${categoryName}: ${JSON.stringify(
        founder.json.rawTables?.categories ?? []
      )}`
    );
    return false;
  }

  console.log("PASS: custom category learning smoke ok");
  return true;
}

async function verifyPrivacyRedactionSmoke(accessToken) {
  if (!requirePrivacySmoke) {
    warn("Skipping privacy redaction smoke. Set SAYVE_REQUIRE_PRIVACY_SMOKE=1 to prove live privacy redaction.");
    return true;
  }

  const sensitiveToken = `SAYVEPRIVACYSMOKE${Date.now()}`;
  const capture = await requestJsonWithAuth(
    "/api/captures/text",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: `[smoke] privacy redaction at ${sensitiveToken} HK$9099` })
    },
    accessToken
  );
  if (!capture.response.ok || !capture.json.data?.capture?.id || !capture.json.memory_object_id) {
    fail(`/api/captures/text privacy smoke setup failed with ${capture.response.status}: ${JSON.stringify(capture.json)}`);
    return false;
  }
  if (!verifyNoStoreHeaders(capture.response, "/api/captures/text privacy smoke")) return false;
  const memoryId = capture.json.memory_object_id;
  const captureId = capture.json.data.capture.id;
  const telemetryOk = await verifyFounderTelemetryForCapture(captureId, "privacy redaction setup");
  if (!telemetryOk) return false;

  const conversation = await requestJsonWithAuth(
    "/api/conversation/ask",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: `今個月 ${sensitiveToken} 用咗幾多？` })
    },
    accessToken
  );
  if (!conversation.response.ok || conversation.json.current_state !== "conversation_answer") {
    fail(`/api/conversation/ask privacy smoke setup failed with ${conversation.response.status}: ${JSON.stringify(conversation.json)}`);
    return false;
  }
  if (!verifyNoStoreHeaders(conversation.response, "/api/conversation/ask privacy smoke")) return false;
  const answerRefs = conversation.json.source_refs ?? conversation.json.data?.message?.sourceRefs ?? [];
  if (!Array.isArray(answerRefs) || !answerRefs.some((ref) => ref?.id === capture.json.data?.fact?.id || ref?.id === memoryId)) {
    fail(`privacy redaction smoke conversation did not cite the sensitive memory/fact before redaction: ${JSON.stringify(conversation.json)}`);
    return false;
  }

  const redaction = await requestJsonWithAuth(
    "/api/memory/redact",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        memoryObjectId: memoryId,
        reason: "deployment privacy smoke"
      })
    },
    accessToken
  );
  if (!redaction.response.ok || redaction.json.current_state !== "privacy_redacted") {
    fail(`/api/memory/redact privacy smoke failed with ${redaction.response.status}: ${JSON.stringify(redaction.json)}`);
    return false;
  }
  if (!verifyNoStoreHeaders(redaction.response, "/api/memory/redact privacy smoke")) return false;
  if (redaction.json.data?.revision?.revisionType !== "privacy_redaction") {
    fail(`privacy redaction smoke did not create a privacy_redaction revision: ${JSON.stringify(redaction.json)}`);
    return false;
  }

  const memory = await requestJsonWithAuth(`/api/memory/${encodeURIComponent(memoryId)}`, {}, accessToken);
  if (!memory.response.ok || memory.json.data?.memory?.currentState !== "archived") {
    fail(`/api/memory/:id privacy smoke detail failed with ${memory.response.status}: ${JSON.stringify(memory.json)}`);
    return false;
  }
  if (!verifyNoStoreHeaders(memory.response, "/api/memory/:id privacy smoke")) return false;
  const memoryText = JSON.stringify(memory.json);
  if (memoryText.includes(sensitiveToken) || memoryText.includes("9099")) {
    fail(`privacy redaction smoke left sensitive content in memory detail: ${memoryText}`);
    return false;
  }

  const founder = await requestJson("/api/admin/founder");
  if (!founder.response.ok) {
    fail(`/api/admin/founder privacy smoke failed with ${founder.response.status}: ${JSON.stringify(founder.json)}`);
    return false;
  }
  if (!verifyNoStoreHeaders(founder.response, "/api/admin/founder privacy smoke")) return false;
  const founderText = JSON.stringify(founder.json);
  if (founderText.includes(sensitiveToken) || founderText.includes("9099")) {
    fail(`privacy redaction smoke left sensitive content in Founder Console: ${founderText}`);
    return false;
  }
  const redactedEvent = (founder.json.recentTelemetry ?? []).find((event) => event.captureId === captureId);
  if (!redactedEvent || redactedEvent.metadata?.redacted !== true) {
    fail(`privacy redaction smoke did not redact linked telemetry metadata: ${JSON.stringify(redactedEvent)}`);
    return false;
  }
  const redactedConversationRows = (founder.json.rawTables?.conversations ?? []).filter((row) => row.content === "Redacted for privacy.");
  if (redactedConversationRows.length < 2) {
    fail(`privacy redaction smoke did not redact the sourced user question/assistant answer pair: ${JSON.stringify(founder.json.rawTables?.conversations ?? [])}`);
    return false;
  }

  console.log("PASS: privacy redaction smoke ok");
  return true;
}

async function verifyViewerReadOnlySmoke(accessToken) {
  const households = await requestJsonWithAuth("/api/households", {}, accessToken);
  if (!households.response.ok || households.json.ok !== true) {
    fail(`/api/households viewer smoke failed with ${households.response.status}: ${JSON.stringify(households.json)}`);
    return false;
  }
  if (!verifyNoStoreHeaders(households.response, "/api/households viewer")) return false;
  const householdIds = (households.json.households ?? []).map((household) => household.id);
  if (!householdIds.includes(testHouseholdId)) {
    fail(`viewer authenticated user is not a member of SAYVE_TEST_HOUSEHOLD_ID. Households returned: ${householdIds.join(", ")}`);
    return false;
  }
  console.log("PASS: viewer household list ok");

  const dashboard = await requestJsonWithAuth("/api/views/dashboard", {}, accessToken);
  if (!dashboard.response.ok || dashboard.json.current_state !== "dashboard_view") {
    fail(`/api/views/dashboard viewer smoke failed with ${dashboard.response.status}: ${JSON.stringify(dashboard.json)}`);
    return false;
  }
  if (!verifyNoStoreHeaders(dashboard.response, "/api/views/dashboard viewer")) return false;
  console.log("PASS: viewer dashboard read ok");

  const write = await requestJsonWithAuth(
    "/api/captures/text",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: `[smoke] Sayve viewer should not write ${new Date().toISOString()}` })
    },
    accessToken
  );
  if (write.response.status !== 403 || write.json.current_state !== "household_write_denied") {
    fail(`/api/captures/text viewer write should be denied. Got ${write.response.status}: ${JSON.stringify(write.json)}`);
    return false;
  }
  if (!verifyNoStoreHeaders(write.response, "/api/captures/text viewer denied")) return false;

  const categoryWrite = await requestJsonWithAuth(
    "/api/categories",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: `[smoke] viewer category should fail ${Date.now()}` })
    },
    accessToken
  );
  if (categoryWrite.response.status !== 403 || categoryWrite.json.current_state !== "household_write_denied") {
    fail(`/api/categories viewer write should be denied. Got ${categoryWrite.response.status}: ${JSON.stringify(categoryWrite.json)}`);
    return false;
  }
  if (!verifyNoStoreHeaders(categoryWrite.response, "/api/categories viewer denied")) return false;
  console.log("PASS: viewer capture write denied");
  console.log("PASS: viewer category write denied");
  return true;
}

async function verifyInviteCreationSmoke() {
  if (!testHouseholdId) {
    const message = "Skipping invite creation smoke. Set SAYVE_TEST_HOUSEHOLD_ID to verify partner invite link generation.";
    if (requireInviteSmoke || requirePublicReady) {
      fail(message);
      return false;
    }
    warn(message);
    return true;
  }

  const invite = await requestJson("/api/households/invite", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      householdId: testHouseholdId,
      email: `sayve-smoke-${Date.now()}@example.invalid`,
      role: "viewer",
      expiresInDays: 1
    })
  });

  if (!invite.response.ok || invite.json.ok !== true || !invite.json.data?.token || !invite.json.data?.inviteUrl || !invite.json.data?.invitePath) {
    fail(`/api/households/invite smoke failed with ${invite.response.status}: ${JSON.stringify(invite.json)}`);
    return false;
  }

  const cacheControl = invite.response.headers.get("cache-control") ?? "";
  const robots = invite.response.headers.get("x-robots-tag") ?? "";
  if (!cacheControl.includes("no-store") || robots !== "noindex") {
    fail(`/api/households/invite must return no-store/noindex headers. Got cache-control=${cacheControl}, x-robots-tag=${robots}`);
    return false;
  }

  const inviteUrl = new URL(invite.json.data.inviteUrl);
  if (inviteUrl.origin !== baseUrl || inviteUrl.pathname !== "/invite" || inviteUrl.searchParams.get("token") !== invite.json.data.token) {
    fail(`Invite URL is not bound to the deployment origin/token: ${JSON.stringify(invite.json.data)}`);
    return false;
  }

  if (appAccessToken) {
    if (!invite.json.data.privateBetaInviteUrl) {
      fail("Invite smoke expected privateBetaInviteUrl because APP_ACCESS_TOKEN is configured.");
      return false;
    }
    const privateBetaInviteUrl = new URL(invite.json.data.privateBetaInviteUrl);
    if (
      privateBetaInviteUrl.origin !== baseUrl ||
      privateBetaInviteUrl.pathname !== "/invite" ||
      privateBetaInviteUrl.searchParams.get("token") !== invite.json.data.token ||
      privateBetaInviteUrl.searchParams.get("access_token") !== appAccessToken
    ) {
      fail(`Private beta invite URL is not bound to deployment origin/token/access token: ${JSON.stringify(invite.json.data)}`);
      return false;
    }
  }

  const invitePage = await requestText(invite.json.data.invitePath);
  const invitePageCacheControl = invitePage.response.headers.get("cache-control") ?? "";
  const invitePageRobots = invitePage.response.headers.get("x-robots-tag") ?? "";
  if (!invitePage.response.ok || !invitePageCacheControl.includes("no-store") || invitePageRobots !== "noindex") {
    fail(
      `/invite page must return no-store/noindex headers. Got ${invitePage.response.status}, cache-control=${invitePageCacheControl}, x-robots-tag=${invitePageRobots}`
    );
    return false;
  }

  const founder = await requestJson("/api/admin/founder");
  if (!founder.response.ok) {
    fail(`/api/admin/founder onboarding smoke failed with ${founder.response.status}: ${JSON.stringify(founder.json)}`);
    return false;
  }
  if (!verifyNoStoreHeaders(founder.response, "/api/admin/founder onboarding")) return false;
  const onboardingHealth = founder.json.onboardingHealth;
  if (
    !onboardingHealth ||
    typeof onboardingHealth.pendingInvites !== "number" ||
    typeof onboardingHealth.emailLockedInvites !== "number" ||
    !Array.isArray(onboardingHealth.recentInvites)
  ) {
    fail(`Founder Console onboarding health is missing expected fields: ${JSON.stringify(onboardingHealth)}`);
    return false;
  }
  const pendingInviteMatch = onboardingHealth.recentInvites.find(
    (row) => row.email === invite.json.data.email && row.status === "pending"
  );
  if (!pendingInviteMatch) {
    fail(`Founder Console onboarding health did not surface the new pending invite: ${JSON.stringify(onboardingHealth.recentInvites)}`);
    return false;
  }
  if (onboardingHealth.emailLockedInvites < 1) {
    fail(`Founder Console onboarding health should count email-locked invites. Got: ${JSON.stringify(onboardingHealth)}`);
    return false;
  }

  console.log("PASS: partner invite link smoke ok");
  console.log("PASS: founder onboarding health reflects pending email-locked invite");
  return true;
}

async function verifyBootstrapSmoke(accessToken) {
  if (!accessToken) {
    const message = "Skipping bootstrap smoke. Set SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN to verify first-run household creation.";
    if (requireBootstrapSmoke) {
      fail(message);
      return false;
    }
    warn(message);
    return true;
  }

  const name = `[smoke] Sayve First Household ${Date.now()}`;
  const bootstrap = await requestJsonWithAuth(
    "/api/households/bootstrap",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        defaultCurrency: "HKD",
        locale: "zh-Hant-HK"
      })
    },
    accessToken
  );

  if (!bootstrap.response.ok || bootstrap.json.ok !== true || !bootstrap.json.household?.id) {
    fail(`/api/households/bootstrap smoke failed with ${bootstrap.response.status}: ${JSON.stringify(bootstrap.json)}`);
    return false;
  }
  if (!verifyNoStoreHeaders(bootstrap.response, "/api/households/bootstrap smoke")) return false;
  if (bootstrap.json.created !== true) {
    fail(`/api/households/bootstrap smoke must use a fresh user and create the first household. Got: ${JSON.stringify(bootstrap.json)}`);
    return false;
  }
  if (bootstrap.json.household?.name !== name || bootstrap.json.household?.role !== "owner") {
    fail(`/api/households/bootstrap smoke did not preserve founder household identity/role: ${JSON.stringify(bootstrap.json)}`);
    return false;
  }

  const listed = await requestJsonWithAuth("/api/households", {}, accessToken);
  if (!listed.response.ok || listed.json.ok !== true || !Array.isArray(listed.json.households)) {
    fail(`/api/households bootstrap follow-up listing failed with ${listed.response.status}: ${JSON.stringify(listed.json)}`);
    return false;
  }
  if (!verifyNoStoreHeaders(listed.response, "/api/households bootstrap listing smoke")) return false;
  const createdHousehold = listed.json.households.find((household) => household.id === bootstrap.json.household.id);
  if (!createdHousehold || createdHousehold.role !== "owner") {
    fail(`/api/households bootstrap follow-up listing did not show the new owner household: ${JSON.stringify(listed.json.households)}`);
    return false;
  }

  console.log("PASS: bootstrap household smoke ok");
  return true;
}

async function verifyProductOwnerInviteSmoke(accessToken) {
  const invite = await requestJsonWithAuth(
    "/api/households/members/invite",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: `sayve-product-smoke-${Date.now()}@example.invalid`,
        role: "member",
        expiresInDays: 1
      })
    },
    accessToken
  );

  if (!invite.response.ok || invite.json.ok !== true || !invite.json.data?.token || !invite.json.data?.inviteUrl || !invite.json.data?.invitePath) {
    fail(`/api/households/members/invite smoke failed with ${invite.response.status}: ${JSON.stringify(invite.json)}`);
    return false;
  }

  const cacheControl = invite.response.headers.get("cache-control") ?? "";
  const robots = invite.response.headers.get("x-robots-tag") ?? "";
  if (!cacheControl.includes("no-store") || robots !== "noindex") {
    fail(`/api/households/members/invite must return no-store/noindex headers. Got cache-control=${cacheControl}, x-robots-tag=${robots}`);
    return false;
  }

  const inviteUrl = new URL(invite.json.data.inviteUrl);
  if (inviteUrl.origin !== baseUrl || inviteUrl.pathname !== "/invite" || inviteUrl.searchParams.get("token") !== invite.json.data.token) {
    fail(`Product invite URL is not bound to the deployment origin/token: ${JSON.stringify(invite.json.data)}`);
    return false;
  }

  if (appAccessToken) {
    if (!invite.json.data.privateBetaInviteUrl) {
      fail("Product invite smoke expected privateBetaInviteUrl because APP_ACCESS_TOKEN is configured.");
      return false;
    }
    const privateBetaInviteUrl = new URL(invite.json.data.privateBetaInviteUrl);
    if (
      privateBetaInviteUrl.origin !== baseUrl ||
      privateBetaInviteUrl.pathname !== "/invite" ||
      privateBetaInviteUrl.searchParams.get("token") !== invite.json.data.token ||
      privateBetaInviteUrl.searchParams.get("access_token") !== appAccessToken
    ) {
      fail(`Product private beta invite URL is not bound to deployment origin/token/access token: ${JSON.stringify(invite.json.data)}`);
      return false;
    }
  }

  const founder = await requestJson("/api/admin/founder");
  if (!founder.response.ok) {
    fail(`/api/admin/founder product invite smoke failed with ${founder.response.status}: ${JSON.stringify(founder.json)}`);
    return false;
  }
  if (!verifyNoStoreHeaders(founder.response, "/api/admin/founder product invite")) return false;
  const onboardingHealth = founder.json.onboardingHealth;
  const pendingInviteMatch = onboardingHealth?.recentInvites?.find(
    (row) => row.email === invite.json.data.email && row.status === "pending"
  );
  if (!pendingInviteMatch) {
    fail(`Founder Console onboarding health did not include the product invite row: ${JSON.stringify(onboardingHealth)}`);
    return false;
  }

  console.log("PASS: product owner invite smoke ok");
  console.log("PASS: founder onboarding health reflects product invite");
  return true;
}

async function verifyInviteAcceptanceSmoke(accessToken) {
  if (!testHouseholdId) {
    const message = "Skipping invite acceptance smoke. Set SAYVE_TEST_HOUSEHOLD_ID plus a fresh SAYVE_TEST_INVITE_ACCEPT_SUPABASE_ACCESS_TOKEN to prove end-to-end join flow.";
    if (requireInviteAcceptanceSmoke) {
      fail(message);
      return false;
    }
    warn(message);
    return true;
  }

  if (!accessToken) {
    const message = "Skipping invite acceptance smoke. Set SAYVE_TEST_INVITE_ACCEPT_SUPABASE_ACCESS_TOKEN to prove end-to-end partner join flow.";
    if (requireInviteAcceptanceSmoke) {
      fail(message);
      return false;
    }
    warn(message);
    return true;
  }

  const invite = await requestJson("/api/households/invite", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      householdId: testHouseholdId,
      role: "member",
      expiresInDays: 1
    })
  });

  if (!invite.response.ok || invite.json.ok !== true || !invite.json.data?.token) {
    fail(`/api/households/invite acceptance smoke setup failed with ${invite.response.status}: ${JSON.stringify(invite.json)}`);
    return false;
  }
  if (!verifyNoStoreHeaders(invite.response, "/api/households/invite acceptance setup")) return false;

  const accept = await requestJsonWithAuth(
    "/api/households/invite/accept",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: invite.json.data.token })
    },
    accessToken
  );

  if (!accept.response.ok || accept.json.ok !== true || accept.json.data?.householdId !== testHouseholdId) {
    fail(`/api/households/invite/accept smoke failed with ${accept.response.status}: ${JSON.stringify(accept.json)}`);
    return false;
  }
  if (!verifyNoStoreHeaders(accept.response, "/api/households/invite/accept smoke")) return false;
  if (accept.json.data?.role !== "member") {
    fail(`/api/households/invite/accept smoke expected member role. Got: ${JSON.stringify(accept.json)}`);
    return false;
  }

  const households = await requestJsonWithAuth("/api/households", {}, accessToken);
  if (!households.response.ok || households.json.ok !== true) {
    fail(`/api/households invite acceptance membership smoke failed with ${households.response.status}: ${JSON.stringify(households.json)}`);
    return false;
  }
  if (!verifyNoStoreHeaders(households.response, "/api/households invite acceptance")) return false;
  const householdIds = (households.json.households ?? []).map((household) => household.id);
  if (!householdIds.includes(testHouseholdId)) {
    fail(`invite acceptance smoke did not make the invited account a member of SAYVE_TEST_HOUSEHOLD_ID. Households returned: ${householdIds.join(", ")}`);
    return false;
  }

  console.log("PASS: invite acceptance smoke ok");
  return true;
}

async function verifyUnauthenticatedMediaUploadGuard() {
  const checks = [
    ["/api/captures/receipt", "receipt"],
    ["/api/captures/voice", "voice"]
  ];

  for (const [path, label] of checks) {
    const result = await requestJson(path, {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=sayve-smoke" },
      body: "this is intentionally invalid multipart data"
    });

    if (result.response.status !== 401 || result.json.current_state !== "auth_required") {
      fail(
        `/api/captures/${label} should reject unauthenticated multipart uploads before parsing bodies. Got ${result.response.status}: ${JSON.stringify(
          result.json
        )}`
      );
      return false;
    }
  }

  console.log("PASS: unauthenticated receipt/voice uploads rejected before multipart parsing");
  return true;
}

async function verifySupabaseImportPlanningSmoke() {
  const validation = await requestJson("/api/admin/import/supabase/validate");
  if (!validation.response.ok || validation.json.valid !== true) {
    fail(`/api/admin/import/supabase/validate smoke failed with ${validation.response.status}: ${JSON.stringify(validation.json)}`);
    return false;
  }
  if (!verifyNoStoreHeaders(validation.response, "/api/admin/import/supabase/validate smoke")) return false;
  if (typeof validation.json.tableCounts?.memory_facts !== "number" || typeof validation.json.tableCounts?.ai_telemetry_events !== "number") {
    fail(`Supabase import validate smoke is missing expected table counts: ${JSON.stringify(validation.json)}`);
    return false;
  }

  const dryRun = await requestJson("/api/admin/import/supabase/dry-run");
  if (!dryRun.response.ok || dryRun.json.configured !== true || dryRun.json.valid !== true) {
    fail(`/api/admin/import/supabase/dry-run smoke failed with ${dryRun.response.status}: ${JSON.stringify(dryRun.json)}`);
    return false;
  }
  if (!verifyNoStoreHeaders(dryRun.response, "/api/admin/import/supabase/dry-run smoke")) return false;
  const memoryObjects = dryRun.json.tables?.memory_objects;
  const telemetry = dryRun.json.tables?.ai_telemetry_events;
  if (typeof memoryObjects?.rowsInPlan !== "number" || typeof telemetry?.rowsToInsert !== "number") {
    fail(`Supabase import dry-run smoke is missing expected table summaries: ${JSON.stringify(dryRun.json)}`);
    return false;
  }

  console.log("PASS: Supabase import validate/dry-run smoke ok");
  return true;
}

async function main() {
  if (!verifyDeploymentTarget()) return;

  if (!adminToken) {
    fail("Missing ADMIN_CONSOLE_TOKEN. It is required for launch readiness and repository smoke test.");
    return;
  }
  verifySecretInputs();
  if (process.exitCode) return;

  console.log(`Checking Sayve deployment: ${baseUrl}`);

  const health = await requestJson("/api/health");
  if (!health.response.ok || health.json.ok !== true) {
    fail(`/api/health failed with ${health.response.status}: ${JSON.stringify(health.json)}`);
    return;
  }
  if (!verifyNoStoreHeaders(health.response, "/api/health")) return;
  console.log(`PASS: health ok (${health.json.repositoryMode})`);

  const adminPage = await requestText("/admin", { headers: adminToken ? { "x-admin-token": adminToken } : {} });
  const adminCacheControl = adminPage.response.headers.get("cache-control") ?? "";
  const adminRobots = adminPage.response.headers.get("x-robots-tag") ?? "";
  if (!adminPage.response.ok || !adminCacheControl.includes("no-store") || adminRobots !== "noindex") {
    fail(`/admin page must return no-store/noindex headers. Got ${adminPage.response.status}, cache-control=${adminCacheControl}, x-robots-tag=${adminRobots}`);
    return;
  }
  console.log("PASS: admin page no-store/noindex headers ok");

  if (appAccessToken) {
    const blockedPage = await requestTextWithoutPrivateAccess("/");
    if (blockedPage.response.status !== 401 || !blockedPage.text.includes("Sayve private beta access required")) {
      fail(`Private beta page gate failed. Got ${blockedPage.response.status}: ${blockedPage.text.slice(0, 120)}`);
      return;
    }
    const blockedApi = await requestJsonWithoutPrivateAccess("/api/captures/text", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Sayve private beta gate check" })
    });
    if (blockedApi.response.status !== 401 || blockedApi.json.error !== "private_beta_access_required") {
      fail(`Private beta API gate failed. Got ${blockedApi.response.status}: ${JSON.stringify(blockedApi.json)}`);
      return;
    }
    console.log("PASS: private beta gate blocks unauthenticated page and API access");
  }

  const readiness = await requestJson("/api/admin/launch-readiness");
  if (!readiness.response.ok) {
    fail(`/api/admin/launch-readiness failed with ${readiness.response.status}: ${JSON.stringify(readiness.json)}`);
    return;
  }
  latestLaunchReadiness = readiness.json;
  if (!verifyLaunchReadinessShape(readiness.json)) return;
  if (!verifySmokeProof(readiness.json)) return;

  const failedChecks = (readiness.json.checks ?? []).filter((check) => check.status === "fail");
  if (failedChecks.length > 0) {
    fail(`Launch readiness has failing checks: ${failedChecks.map((check) => check.label).join(", ")}`);
    for (const summary of summarizeLaunchReadinessChecks(readiness.json, ["fail"])) {
      console.error(`- ${summary}`);
    }
    if (Array.isArray(readiness.json.requiredMigrations) && readiness.json.requiredMigrations.length > 0) {
      console.error(`- rollout required migrations: ${readiness.json.requiredMigrations.join(", ")}`);
    }
    if (Array.isArray(readiness.json.recommendedActions) && readiness.json.recommendedActions.length > 0) {
      console.error(`- rollout next actions: ${readiness.json.recommendedActions.join(" | ")}`);
    }
    return;
  }

  const warningChecks = (readiness.json.checks ?? []).filter((check) => check.status === "warn");
  const nonSmokeWarnings = warningChecks.filter((check) => check.id !== "deployment_smoke");
  if (requirePublicReady && nonSmokeWarnings.length > 0) {
    fail(`Launch readiness has public-launch warnings: ${nonSmokeWarnings.map((check) => check.label).join(", ")}`);
    for (const summary of summarizeLaunchReadinessChecks({ checks: nonSmokeWarnings }, ["warn"])) {
      console.error(`- ${summary}`);
    }
    return;
  }
  console.log(`PASS: launch readiness config ${readiness.json.status}`);

  const setupBundleOk = await verifyFounderSetupBundleSmoke(readiness.json);
  if (!setupBundleOk) return;

  const schema = await requestJson("/api/admin/import/supabase/schema-check");
  if (!schema.response.ok || schema.json.ok !== true) {
    fail(`/api/admin/import/supabase/schema-check failed with ${schema.response.status}: ${JSON.stringify(schema.json)}`);
    return;
  }
  const snapshotPolicyCheck = (schema.json.securityChecks ?? []).find((check) => check.id === "memory_store_snapshots_service_role_only");
  if (!snapshotPolicyCheck?.ok) {
    fail(`Supabase snapshot policy hardening check failed: ${snapshotPolicyCheck?.message ?? "missing security check result"}`);
    return;
  }
  const householdRoleCheck = (schema.json.securityChecks ?? []).find((check) => check.id === "household_role_policies");
  if (!householdRoleCheck?.ok) {
    fail(`Supabase household role policy check failed: ${householdRoleCheck?.message ?? "missing security check result"}`);
    return;
  }
  const invitePolicyCheck = (schema.json.securityChecks ?? []).find((check) => check.id === "invites_service_role_only");
  if (!invitePolicyCheck?.ok) {
    fail(`Supabase invite policy hardening check failed: ${invitePolicyCheck?.message ?? "missing security check result"}`);
    return;
  }
  const inviteAtomicCheck = (schema.json.securityChecks ?? []).find((check) => check.id === "invites_atomic_acceptance");
  if (!inviteAtomicCheck?.ok) {
    fail(`Supabase atomic invite acceptance check failed: ${inviteAtomicCheck?.message ?? "missing security check result"}`);
    return;
  }
  const factPayloadCheck = (schema.json.securityChecks ?? []).find((check) => check.id === "memory_facts_payload_shape");
  if (!factPayloadCheck?.ok) {
    fail(`Supabase memory_facts payload constraint check failed: ${factPayloadCheck?.message ?? "missing security check result"}`);
    return;
  }
  const telemetryShapeCheck = (schema.json.securityChecks ?? []).find((check) => check.id === "ai_telemetry_shape");
  if (!telemetryShapeCheck?.ok) {
    fail(`Supabase ai_telemetry_events constraint check failed: ${telemetryShapeCheck?.message ?? "missing security check result"}`);
    return;
  }
  const mediaStorageBucketCheck = (schema.json.securityChecks ?? []).find((check) => check.id === "media_storage_bucket");
  if (!mediaStorageBucketCheck?.ok) {
    fail(`Supabase media storage bucket check failed: ${mediaStorageBucketCheck?.message ?? "missing security check result"}`);
    return;
  }
  console.log(`PASS: Supabase schema check ok (${schema.json.checkedTables} tables)`);
  console.log("PASS: Supabase snapshot policy hardening ok");
  console.log("PASS: Supabase household role policies ok");
  console.log("PASS: Supabase invite policy hardening ok");
  console.log("PASS: Supabase atomic invite acceptance ok");
  console.log("PASS: Supabase memory fact payload constraints ok");
  console.log("PASS: Supabase AI telemetry constraints ok");
  console.log("PASS: Supabase media storage bucket ok");

  const importPlanningOk = await verifySupabaseImportPlanningSmoke();
  if (!importPlanningOk) return;

  const smoke = await requestJson("/api/admin/repository/smoke-test", { method: "POST" });
  if (!smoke.response.ok || smoke.json.ok !== true || smoke.json.persistedSnapshot !== true) {
    fail(`/api/admin/repository/smoke-test failed with ${smoke.response.status}: ${JSON.stringify(smoke.json)}`);
    return;
  }
  if (typeof smoke.json.viewerCount !== "number") {
    fail(`Repository smoke test is missing viewerCount: ${JSON.stringify(smoke.json)}`);
    return;
  }
  if (
    !smoke.json.onboarding ||
    typeof smoke.json.onboarding.pendingInvites !== "number" ||
    typeof smoke.json.onboarding.acceptedInvites !== "number" ||
    typeof smoke.json.onboarding.emailLockedInvites !== "number"
  ) {
    fail(`Repository smoke test is missing onboarding counters: ${JSON.stringify(smoke.json)}`);
    return;
  }
  console.log(`PASS: repository smoke test ok (${smoke.json.repositoryMode})`);

  const inviteSmokeOk = await verifyInviteCreationSmoke();
  if (!inviteSmokeOk) return;
  const inviteAcceptanceOk = await verifyInviteAcceptanceSmoke(testInviteAcceptSupabaseAccessToken);
  if (!inviteAcceptanceOk) return;

  const bootstrapSmokeOk = await verifyBootstrapSmoke(testBootstrapSupabaseAccessToken);
  if (!bootstrapSmokeOk) return;
  if (!inviteAcceptanceOk) return;

  const canRunAuthSmoke = Boolean(testSupabaseAccessToken && testHouseholdId);
  const canRunTwoMemberSmoke = Boolean(testSupabaseAccessToken && testSecondSupabaseAccessToken && testHouseholdId);
  const canRunViewerSmoke = Boolean(testViewerSupabaseAccessToken && testHouseholdId);
  if (!canRunAuthSmoke) {
    const message =
      "Skipping authenticated household smoke test. Set SAYVE_TEST_SUPABASE_ACCESS_TOKEN and SAYVE_TEST_HOUSEHOLD_ID to verify real login/capture/dashboard.";
    if (requireAuthSmoke || requirePublicReady) {
      fail(message);
      return;
    }
    warn(message);
    console.log("Sayve deployment verification passed.");
    return;
  }

  if (requireTwoMemberSmoke && !canRunTwoMemberSmoke) {
    fail(
      "Two-member household smoke is required for public-ready verification. Set SAYVE_TEST_SUPABASE_ACCESS_TOKEN, SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN, and SAYVE_TEST_HOUSEHOLD_ID, or use SAYVE_REQUIRE_PUBLIC_READY=0 for private/local smoke."
    );
    return;
  }

  if (requireViewerSmoke && !canRunViewerSmoke) {
    fail(
      "Viewer read-only smoke is required for public-ready verification. Set SAYVE_TEST_VIEWER_SUPABASE_ACCESS_TOKEN and SAYVE_TEST_HOUSEHOLD_ID, or use SAYVE_REQUIRE_PUBLIC_READY=0 for private/local smoke."
    );
    return;
  }

  const unauthenticatedCapture = await requestJson("/api/captures/text", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{bad json"
  });
  if (readiness.json.checks?.some((check) => check.id === "supabase_auth_required" && check.status === "pass")) {
    if (unauthenticatedCapture.response.status !== 401 || unauthenticatedCapture.json.current_state !== "auth_required") {
      fail(
        `/api/captures/text should reject unauthenticated malformed JSON before body parsing when SUPABASE_AUTH_REQUIRED=1. Got ${unauthenticatedCapture.response.status}: ${JSON.stringify(
          unauthenticatedCapture.json
        )}`
      );
      return;
    }
    console.log("PASS: unauthenticated capture rejected before JSON parsing");
    const unauthenticatedAsk = await requestJson("/api/conversation/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{bad json"
    });
    if (unauthenticatedAsk.response.status !== 401 || unauthenticatedAsk.json.current_state !== "auth_required") {
      fail(
        `/api/conversation/ask should reject unauthenticated malformed JSON before body parsing when SUPABASE_AUTH_REQUIRED=1. Got ${unauthenticatedAsk.response.status}: ${JSON.stringify(
          unauthenticatedAsk.json
        )}`
      );
      return;
    }
    console.log("PASS: unauthenticated conversation rejected before JSON parsing");
    const mediaGuardOk = await verifyUnauthenticatedMediaUploadGuard();
    if (!mediaGuardOk) return;
  }

  const firstCapture = await verifyAuthenticatedMember({
    label: "primary member",
    accessToken: testSupabaseAccessToken,
    smokeText: "MTR HK$21"
  });
  if (!firstCapture) return;

  const mediaCaptureSmokeOk = await verifyAuthenticatedMediaCaptureSmoke(testSupabaseAccessToken);
  if (!mediaCaptureSmokeOk) return;

  const conversationSmokeOk = await verifyConversationSmoke(testSupabaseAccessToken);
  if (!conversationSmokeOk) return;

  const categorySmokeOk = await verifyCategoryLearningSmoke(testSupabaseAccessToken);
  if (!categorySmokeOk) return;

  const insightInboxSmokeOk = await verifyInsightInboxSmoke(testSupabaseAccessToken);
  if (!insightInboxSmokeOk) return;

  const privacySmokeOk = await verifyPrivacyRedactionSmoke(testSupabaseAccessToken);
  if (!privacySmokeOk) return;

  if (requireInviteSmoke || requirePublicReady) {
    const productInviteSmokeOk = await verifyProductOwnerInviteSmoke(testSupabaseAccessToken);
    if (!productInviteSmokeOk) return;
  } else {
    warn("Skipping product owner invite smoke. Set SAYVE_REQUIRE_INVITE_SMOKE=1 to prove in-app partner invite creation.");
  }

  if (testSecondSupabaseAccessToken) {
    const secondCapture = await verifyAuthenticatedMember({
      label: "second member",
      accessToken: testSecondSupabaseAccessToken,
      smokeText: "百佳 HK$233",
      expectedVisibleFacts: [{ id: firstCapture.factId, createdBy: firstCapture.createdBy }]
    });
    if (!secondCapture) return;
    console.log("PASS: two-member household smoke ok");
  } else {
    warn("Skipping second household member smoke. Set SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN to prove partner login writes to the same household.");
  }

  if (testViewerSupabaseAccessToken) {
    const viewerOk = await verifyViewerReadOnlySmoke(testViewerSupabaseAccessToken);
    if (!viewerOk) return;
    console.log("PASS: viewer read-only smoke ok");
  } else {
    warn("Skipping viewer read-only smoke. Set SAYVE_TEST_VIEWER_SUPABASE_ACCESS_TOKEN to prove viewer role can read but cannot write.");
  }

  if (requirePublicReady && readiness.json.readyForPublicLaunch !== true) {
    fail(
      "Live smoke checks passed, but server readiness is not public-ready yet. Set SAYVE_DEPLOYMENT_SMOKE_VERIFIED=1 on the deployment environment, redeploy, then re-run verify:deploy."
    );
    return;
  }

  console.log("Sayve deployment verification passed.");
}

main()
  .catch((error) => {
    fail(error instanceof Error ? error.message : String(error));
  })
  .finally(() => {
    writeProofArtifacts();
  });
