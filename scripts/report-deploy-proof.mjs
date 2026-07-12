#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

const cwd = process.cwd();
const inputArg = process.argv[2]?.trim();
const outputArg = process.argv[3]?.trim();
const defaultInputPath = "outputs/setup/deploy-proof-report.json";
const defaultOutputPath = "outputs/setup/deploy-proof-summary.md";

function resolveFromCwd(filePath) {
  if (!filePath) return "";
  return isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
}

function readJson(filePath) {
  const resolvedPath = resolveFromCwd(filePath);
  return {
    path: resolvedPath,
    json: JSON.parse(readFileSync(resolvedPath, "utf8"))
  };
}

function statusLabel(status) {
  return status === "passed" ? "PASS" : status === "failed" ? "FAIL" : "UNKNOWN";
}

function truthyLabel(value) {
  return value ? "yes" : "no";
}

function buildMarkdownSummary(report, sourcePath) {
  const failures = Array.isArray(report.failures) ? report.failures : [];
  const warnings = Array.isArray(report.warnings) ? report.warnings : [];
  const env = report.env ?? {};
  const readiness = report.launchReadiness ?? null;
  const checks = Array.isArray(readiness?.checks) ? readiness.checks : [];
  const failedChecks = checks.filter((check) => check?.status === "fail");
  const warningChecks = checks.filter((check) => check?.status === "warn");
  const passedChecks = checks.filter((check) => check?.status === "pass");

  return [
    "# Sayve Deploy Proof Summary",
    "",
    `Source report: ${sourcePath}`,
    `Generated at: ${new Date().toISOString()}`,
    `Proof started at: ${report.startedAt ?? "unknown"}`,
    `Deploy URL: ${report.deployUrl || "not set"}`,
    `Overall status: ${statusLabel(report.status)}`,
    `Mode: ${report.requirePublicReady ? "public launch proof" : "private beta proof"}`,
    "",
    "## Headline",
    "",
    `- Launch Readiness status: ${readiness?.status ?? "unknown"}`,
    `- Config ready for private beta: ${truthyLabel(readiness?.configReadyForPrivateBeta)}`,
    `- Live smoke verified: ${truthyLabel(readiness?.liveSmokeVerified)}`,
    `- Ready for public launch: ${truthyLabel(readiness?.readyForPublicLaunch)}`,
    `- Failures: ${failures.length}`,
    `- Warnings: ${warnings.length}`,
    "",
    "## Smoke Inputs Present",
    "",
    `- Admin token: ${truthyLabel(env.hasAdminConsoleToken)}`,
    `- App access token: ${truthyLabel(env.hasAppAccessToken)}`,
    `- Owner token: ${truthyLabel(env.hasOwnerToken)}`,
    `- Second member token: ${truthyLabel(env.hasSecondMemberToken)}`,
    `- Viewer token: ${truthyLabel(env.hasViewerToken)}`,
    `- Invite acceptance token: ${truthyLabel(env.hasInviteAcceptanceToken)}`,
    `- Bootstrap token: ${truthyLabel(env.hasBootstrapToken)}`,
    `- Household id: ${truthyLabel(env.hasHouseholdId)}`,
    "",
    "## Blocking Failures",
    "",
    ...(failures.length ? failures.map((item) => `- ${item}`) : ["- none"]),
    "",
    "## Non-blocking Warnings",
    "",
    ...(warnings.length ? warnings.map((item) => `- ${item}`) : ["- none"]),
    "",
    "## Launch Readiness Checks: Failed",
    "",
    ...(failedChecks.length
      ? failedChecks.map((check) => `- ${check.id}: ${check.label}${check.detail ? ` - ${check.detail}` : ""}`)
      : ["- none"]),
    "",
    "## Launch Readiness Checks: Warning",
    "",
    ...(warningChecks.length
      ? warningChecks.map((check) => `- ${check.id}: ${check.label}${check.detail ? ` - ${check.detail}` : ""}`)
      : ["- none"]),
    "",
    "## Launch Readiness Checks: Passed",
    "",
    ...(passedChecks.length
      ? passedChecks.map((check) => `- ${check.id}: ${check.label}${check.detail ? ` - ${check.detail}` : ""}`)
      : ["- none"]),
    "",
    "## Suggested Next Move",
    "",
    failures.length > 0
      ? "- Fix blocking failures first, then rerun strict private beta proof."
      : readiness?.readyForPublicLaunch
        ? "- Proof looks healthy. You can archive this summary with the JSON report as rollout evidence."
        : readiness?.configReadyForPrivateBeta
          ? "- Private beta config looks ready; finish the remaining live proof items before public launch."
          : "- Keep working through Launch Readiness blockers before relying on this deploy.",
    ""
  ].join("\n");
}

const inputPath = inputArg || process.env.SAYVE_DEPLOY_PROOF_REPORT_PATH || defaultInputPath;
const outputPath = outputArg || process.env.SAYVE_DEPLOY_PROOF_SUMMARY_PATH || defaultOutputPath;
const { path: resolvedInputPath, json: report } = readJson(inputPath);
const markdown = buildMarkdownSummary(report, resolvedInputPath);
const resolvedOutputPath = resolveFromCwd(outputPath);

mkdirSync(dirname(resolvedOutputPath), { recursive: true });
writeFileSync(resolvedOutputPath, `${markdown}\n`);

process.stdout.write(
  `${JSON.stringify(
    {
      inputPath: resolvedInputPath,
      outputPath: resolvedOutputPath,
      status: report.status ?? "unknown"
    },
    null,
    2
  )}\n`
);
