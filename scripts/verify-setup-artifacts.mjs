#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function parseEnvNamesFromTemplate(lines) {
  return lines
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => line.slice(0, line.indexOf("=")).trim());
}

function parseEnvNamesFromDotenv(content) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => line.slice(0, line.indexOf("=")).trim());
}

function normalizeTemplateLines(lines) {
  return lines
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function normalizeDotenvLines(content) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

const cwd = process.cwd();
const reportJson = execFileSync(process.execPath, [join(cwd, "scripts", "founder-setup-report.mjs")], {
  cwd,
  encoding: "utf8"
});
const generatedPrivateBetaExample = execFileSync(process.execPath, [join(cwd, "scripts", "generate-setup-env-examples.mjs"), "private-beta"], {
  cwd,
  encoding: "utf8"
});
const generatedPublicLaunchExample = execFileSync(process.execPath, [join(cwd, "scripts", "generate-setup-env-examples.mjs"), "public-launch"], {
  cwd,
  encoding: "utf8"
});
const generatedArtifacts = JSON.parse(
  execFileSync(process.execPath, [join(cwd, "scripts", "generate-setup-env-examples.mjs"), "write"], {
    cwd,
    encoding: "utf8"
  })
);
const report = JSON.parse(reportJson);
const envExample = readFileSync(join(cwd, ".env.example"), "utf8");
const privateBetaExample = readFileSync(join(cwd, ".env.private-beta.example"), "utf8");
const publicLaunchExample = readFileSync(join(cwd, ".env.public-launch.example"), "utf8");
const handoffMarkdown = readFileSync(join(cwd, "outputs", "setup", "handoff.md"), "utf8");
const integrationPackageJson = JSON.parse(readFileSync(join(cwd, "outputs", "setup", "integration-package.json"), "utf8"));
const envMapMarkdown = readFileSync(join(cwd, "outputs", "setup", "env-map.md"), "utf8");
const executionChecklistMarkdown = readFileSync(join(cwd, "outputs", "setup", "execution-checklist.md"), "utf8");
const providerSetupMarkdown = readFileSync(join(cwd, "outputs", "setup", "provider-setup.md"), "utf8");
const deploySmokeEnvFile = readFileSync(join(cwd, "outputs", "setup", "deploy-smoke.env"), "utf8");
const liveRolloutSequenceMarkdown = readFileSync(join(cwd, "outputs", "setup", "live-rollout-sequence.md"), "utf8");
const goLiveRunSheetMarkdown = readFileSync(join(cwd, "outputs", "setup", "private-beta-go-live-run-sheet.md"), "utf8");
const executionOrderMarkdown = readFileSync(join(cwd, "outputs", "setup", "live-deployment-execution-order.md"), "utf8");
const liveProofMarkdown = readFileSync(join(cwd, "outputs", "setup", "live-proof.md"), "utf8");
const liveProofPackageJson = JSON.parse(readFileSync(join(cwd, "outputs", "setup", "live-proof-package.json"), "utf8"));

const envExampleNames = new Set(parseEnvNamesFromDotenv(envExample));
const privateBetaExampleNames = parseEnvNamesFromDotenv(privateBetaExample);
const publicLaunchExampleNames = parseEnvNamesFromDotenv(publicLaunchExample);
const templateNames = parseEnvNamesFromDotenv(generatedPrivateBetaExample);
const deploymentTemplateNames = parseEnvNamesFromDotenv(generatedPublicLaunchExample);
const privateBetaTemplateLines = normalizeDotenvLines(generatedPrivateBetaExample);
const deploymentTemplateLines = normalizeDotenvLines(generatedPublicLaunchExample);
const privateBetaExampleLines = normalizeDotenvLines(privateBetaExample);
const publicLaunchExampleLines = normalizeDotenvLines(publicLaunchExample);
const matrixNames = (report.envMatrix ?? []).map((row) => row.env).filter(Boolean);
const smokeGuideNames = (report.smokeTokenGuide ?? []).map((row) => row.env).filter((name) => name && name !== "browser localStorage");
if (!Array.isArray(report.launchCompletionAudit) || report.launchCompletionAudit.length === 0) {
  fail("Founder setup report is missing launchCompletionAudit.");
}
if (!Array.isArray(report.launchBlockers)) {
  fail("Founder setup report is missing launchBlockers.");
}
if (!Array.isArray(report.deploymentEnvTemplate)) {
  fail("Founder setup report is missing deploymentEnvTemplate.");
}
if (!Array.isArray(report.deploySmokeEnvTemplate)) {
  fail("Founder setup report is missing deploySmokeEnvTemplate.");
}
if (!Array.isArray(report.repositorySmokeGuide)) {
  fail("Founder setup report is missing repositorySmokeGuide.");
}
if (!Array.isArray(report.publicLaunchChecks)) {
  fail("Founder setup report is missing publicLaunchChecks.");
}
if (!Array.isArray(report.migrationInventory) || report.migrationInventory.length === 0) {
  fail("Founder setup report is missing migrationInventory.");
}
if (!Array.isArray(report.privateBetaSetupGate) || report.privateBetaSetupGate.length === 0) {
  fail("Founder setup report is missing privateBetaSetupGate.");
}
if (!Array.isArray(report.integrationReadiness) || report.integrationReadiness.length === 0) {
  fail("Founder setup report is missing integrationReadiness.");
}
if (!Array.isArray(report.integrationPackage) || report.integrationPackage.length === 0) {
  fail("Founder setup report is missing integrationPackage.");
}
if (!Array.isArray(generatedArtifacts.files) || !generatedArtifacts.files.includes("handoff.md")) {
  fail("Setup artifact generator is missing handoff.md in write mode.");
}
if (!Array.isArray(generatedArtifacts.files) || !generatedArtifacts.files.includes("live-rollout-sequence.md")) {
  fail("Setup artifact generator is missing live-rollout-sequence.md in write mode.");
}
if (!Array.isArray(generatedArtifacts.files) || !generatedArtifacts.files.includes("private-beta-go-live-run-sheet.md")) {
  fail("Setup artifact generator is missing private-beta-go-live-run-sheet.md in write mode.");
}
if (!Array.isArray(generatedArtifacts.files) || !generatedArtifacts.files.includes("live-deployment-execution-order.md")) {
  fail("Setup artifact generator is missing live-deployment-execution-order.md in write mode.");
}
if (!Array.isArray(generatedArtifacts.files) || !generatedArtifacts.files.includes("integration-package.json")) {
  fail("Setup artifact generator is missing integration-package.json in write mode.");
}
if (!Array.isArray(generatedArtifacts.files) || !generatedArtifacts.files.includes("env-map.md")) {
  fail("Setup artifact generator is missing env-map.md in write mode.");
}
if (!Array.isArray(generatedArtifacts.files) || !generatedArtifacts.files.includes("execution-checklist.md")) {
  fail("Setup artifact generator is missing execution-checklist.md in write mode.");
}
if (!Array.isArray(generatedArtifacts.files) || !generatedArtifacts.files.includes("provider-setup.md")) {
  fail("Setup artifact generator is missing provider-setup.md in write mode.");
}
if (!Array.isArray(generatedArtifacts.files) || !generatedArtifacts.files.includes("deploy-smoke.env")) {
  fail("Setup artifact generator is missing deploy-smoke.env in write mode.");
}
if (!Array.isArray(generatedArtifacts.files) || !generatedArtifacts.files.includes("live-proof.md")) {
  fail("Setup artifact generator is missing live-proof.md in write mode.");
}
if (!Array.isArray(generatedArtifacts.files) || !generatedArtifacts.files.includes("live-proof-package.json")) {
  fail("Setup artifact generator is missing live-proof-package.json in write mode.");
}

const requiredNames = [...new Set([...templateNames, ...deploymentTemplateNames, ...matrixNames, ...smokeGuideNames])];
const missingFromEnvExample = requiredNames.filter((name) => !envExampleNames.has(name));
if (missingFromEnvExample.length > 0) {
  fail(`.env.example is missing setup env keys required by founder setup artifacts: ${missingFromEnvExample.join(", ")}`);
}
if (JSON.stringify(privateBetaExampleNames) !== JSON.stringify(templateNames)) {
  fail(`.env.private-beta.example drifted from copyPasteEnvTemplate. Got ${privateBetaExampleNames.join(", ")} expected ${templateNames.join(", ")}`);
}
if (JSON.stringify(publicLaunchExampleNames) !== JSON.stringify(deploymentTemplateNames)) {
  fail(
    `.env.public-launch.example drifted from deploymentEnvTemplate. Got ${publicLaunchExampleNames.join(", ")} expected ${deploymentTemplateNames.join(", ")}`
  );
}
if (JSON.stringify(privateBetaExampleLines) !== JSON.stringify(privateBetaTemplateLines)) {
  fail(
    `.env.private-beta.example content drifted from copyPasteEnvTemplate. Got ${privateBetaExampleLines.join(" | ")} expected ${privateBetaTemplateLines.join(" | ")}`
  );
}
if (JSON.stringify(publicLaunchExampleLines) !== JSON.stringify(deploymentTemplateLines)) {
  fail(
    `.env.public-launch.example content drifted from deploymentEnvTemplate. Got ${publicLaunchExampleLines.join(" | ")} expected ${deploymentTemplateLines.join(" | ")}`
  );
}
if (privateBetaExample !== generatedPrivateBetaExample) {
  fail(".env.private-beta.example drifted from generate-setup-env-examples.mjs output.");
}
if (publicLaunchExample !== generatedPublicLaunchExample) {
  fail(".env.public-launch.example drifted from generate-setup-env-examples.mjs output.");
}
for (const token of [
  "# Sayve Setup Handoff",
  "## Launch Blockers",
  "## Next Actions",
  "## Commands",
  "## Deploy Smoke Env Template",
  "## Repository Smoke Guide",
  "## Public Launch Checks",
  "## Supabase Migration Inventory",
  "## Private Beta Setup Gate",
  "## Integration Readiness",
  "## Integration Package",
  "outputs/setup/handoff.md",
  "outputs/setup/live-rollout-sequence.md",
  "outputs/setup/private-beta-go-live-run-sheet.md",
  "outputs/setup/live-deployment-execution-order.md",
  "outputs/setup/live-proof-package.json",
  "outputs/setup/live-proof.md",
  "outputs/setup/deploy-smoke.env"
]) {
  if (!handoffMarkdown.includes(token)) {
    fail(`handoff.md is missing required token: ${token}`);
  }
}
for (const token of ["production_storage_boundary", "supabase_migration_path", "core_api_stability"]) {
  if (!(report.launchCompletionAudit ?? []).some((row) => JSON.stringify(row).includes(token))) {
    fail(`Founder setup launchCompletionAudit is missing ${token}.`);
  }
}
for (const token of ["Smoke proof", "Model + media guardrails", "Two-member + viewer proof"]) {
  if (!(report.publicLaunchChecks ?? []).some((row) => JSON.stringify(row).includes(token))) {
    fail(`Founder setup publicLaunchChecks is missing ${token}.`);
  }
}
for (const token of ["001_ai_native_memory_engine.sql", "012_harden_ai_telemetry_constraints.sql"]) {
  if (!(report.migrationInventory ?? []).some((row) => JSON.stringify(row).includes(token))) {
    fail(`Founder setup migrationInventory is missing ${token}.`);
  }
}
for (const token of ["Supabase project env", "Partner joined household", "Live deployment smoke"]) {
  if (!(report.privateBetaSetupGate ?? []).some((row) => JSON.stringify(row).includes(token))) {
    fail(`Founder setup privateBetaSetupGate is missing ${token}.`);
  }
}
for (const token of ["supabase", "google_oauth", "vercel", "openai"]) {
  if (!(report.integrationReadiness ?? []).some((row) => JSON.stringify(row).includes(token))) {
    fail(`Founder setup integrationReadiness is missing ${token}.`);
  }
}
for (const token of ["project_url", "redirect_invite", "api_key"]) {
  if (!(report.integrationPackage ?? []).some((row) => JSON.stringify(row).includes(token))) {
    fail(`Founder setup integrationPackage is missing ${token}.`);
  }
}
for (const token of ["project_url", "redirect_invite", "api_key"]) {
  if (!(integrationPackageJson.integrationPackage ?? []).some((row) => JSON.stringify(row).includes(token))) {
    fail(`integration-package.json is missing ${token}.`);
  }
}
for (const token of ["production_storage_boundary", "supabase_migration_path", "core_api_stability"]) {
  if (!(integrationPackageJson.launchCompletionAudit ?? []).some((row) => JSON.stringify(row).includes(token))) {
    fail(`integration-package.json launchCompletionAudit is missing ${token}.`);
  }
}
for (const token of ["google_oauth", "supabase", "openai"]) {
  if (!(integrationPackageJson.integrationReadiness ?? []).some((row) => JSON.stringify(row).includes(token))) {
    fail(`integration-package.json readiness is missing ${token}.`);
  }
}
for (const token of [
  "# Sayve Local / Vercel Env Map",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENAI_API_KEY",
  "SAYVE_TEST_SUPABASE_ACCESS_TOKEN",
  "local `.env.local` + Vercel"
]) {
  if (!envMapMarkdown.includes(token)) {
    fail(`env-map.md is missing required token: ${token}`);
  }
}
for (const token of [
  "# Sayve Private Beta Execution Checklist",
  "| Step | Status | Owner | Item | Detail | Source |",
  "Supabase project env",
  "Private beta launch readiness",
  "Live deployment smoke"
]) {
  if (!executionChecklistMarkdown.includes(token)) {
    fail(`execution-checklist.md is missing required token: ${token}`);
  }
}
for (const token of [
  "# Sayve Live Rollout Sequence",
  "## Phase 1: Prepare Real Infra",
  "## Phase 4: Run Live Verification",
  "outputs/setup/deploy-proof-summary.md",
  "production_storage_boundary",
  "supabase_migration_path",
  "core_api_stability"
]) {
  if (!liveRolloutSequenceMarkdown.includes(token)) {
    fail(`live-rollout-sequence.md is missing required token: ${token}`);
  }
}

for (const token of [
  "# Sayve Private Beta Go-Live Run Sheet",
  "## B. 今日要完成嘅順序",
  "## E. Deploy 後先跑",
  "outputs/setup/deploy-proof-summary.md",
  "verify:deploy:private-beta",
  "verify:deploy:strict-private-beta",
  "Launch Completion Audit"
]) {
  if (!goLiveRunSheetMarkdown.includes(token)) {
    fail(`private-beta-go-live-run-sheet.md is missing required token: ${token}`);
  }
}

for (const token of [
  "SAYVE_REQUIRE_AUTH_SMOKE=1",
  "SAYVE_REQUIRE_BOOTSTRAP_SMOKE=1",
  "SAYVE_TEST_SUPABASE_ACCESS_TOKEN=<owner-session-token>",
  "SAYVE_TEST_HOUSEHOLD_ID=<household-uuid>"
]) {
  if (!deploySmokeEnvFile.includes(token)) {
    fail(`deploy-smoke.env is missing required token: ${token}`);
  }
}

for (const token of [
  "# Sayve Live Deployment Execution Order",
  "## 1. 先補最硬 blocker",
  "## 6. 跑第一個真 smoke",
  "Launch Completion Audit",
  "verify:deploy:private-beta",
  "verify:deploy:strict-private-beta"
]) {
  if (!executionOrderMarkdown.includes(token)) {
    fail(`live-deployment-execution-order.md is missing required token: ${token}`);
  }
}

for (const token of [
  "# Sayve Provider Setup",
  "## 1. Supabase",
  "## 2. Google OAuth + Supabase Auth",
  "## 3. Vercel (Private Beta Minimum)",
  "## 4. OpenAI (Public Launch Before Required)",
  "## 5. Deploy Smoke",
  "NEXT_PUBLIC_SUPABASE_URL",
  "APP_ACCESS_TOKEN",
  "OPENAI_API_KEY",
  "SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN",
  "pnpm run verify:deploy:private-beta",
  "pnpm run verify:deploy:strict-private-beta"
]) {
  if (!providerSetupMarkdown.includes(token)) {
    fail(`provider-setup.md is missing required token: ${token}`);
  }
}
for (const token of ["POST /api/admin/repository/smoke-test", "x-admin-token: ADMIN_CONSOLE_TOKEN", "memberCount>0", "viewerCount", "onboarding invite counters"] ) {
  if (!(report.repositorySmokeGuide ?? []).some((row) => JSON.stringify(row).includes(token))) {
    fail(`Founder setup repositorySmokeGuide is missing ${token}.`);
  }
}
for (const token of ["SAYVE_REQUIRE_AUTH_SMOKE=1", "SAYVE_REQUIRE_TWO_MEMBER_SMOKE=1", "SAYVE_TEST_SUPABASE_ACCESS_TOKEN"]) {
  if (!(report.deploySmokeEnvTemplate ?? []).some((line) => String(line).includes(token))) {
    fail(`Founder setup deploySmokeEnvTemplate is missing ${token}.`);
  }
}

const privateBetaCommand = String(report.commands?.privateBeta ?? "");
const strictPrivateBetaCommand = String(report.commands?.strictPrivateBeta ?? "");
const strictPrivateBetaProofCommand = String(report.commands?.strictPrivateBetaProof ?? "");
const publicLaunchCommand = String(report.commands?.publicLaunch ?? "");

for (const token of ["APP_ACCESS_TOKEN", "ADMIN_CONSOLE_TOKEN", "pnpm run verify:deploy:private-beta"]) {
  if (!privateBetaCommand.includes(token)) {
    fail(`Founder setup privateBeta command is missing ${token}.`);
  }
}

for (const token of [
  "SAYVE_TEST_SUPABASE_ACCESS_TOKEN",
  "SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN",
  "SAYVE_TEST_VIEWER_SUPABASE_ACCESS_TOKEN",
  "SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN",
  "SAYVE_TEST_HOUSEHOLD_ID",
  "pnpm run verify:deploy:strict-private-beta"
]) {
  if (!strictPrivateBetaCommand.includes(token)) {
    fail(`Founder setup strictPrivateBeta command is missing ${token}.`);
  }
}

for (const token of [
  "SAYVE_DEPLOY_PROOF_REPORT_PATH=outputs/setup/deploy-proof-report.json",
  "SAYVE_TEST_SUPABASE_ACCESS_TOKEN",
  "SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN",
  "SAYVE_TEST_VIEWER_SUPABASE_ACCESS_TOKEN",
  "SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN",
  "SAYVE_TEST_HOUSEHOLD_ID",
  "pnpm run verify:deploy:strict-private-beta:proof"
]) {
  if (!strictPrivateBetaProofCommand.includes(token)) {
    fail(`Founder setup strictPrivateBetaProof command is missing ${token}.`);
  }
}

for (const token of [
  "SAYVE_TEST_SUPABASE_ACCESS_TOKEN",
  "SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN",
  "SAYVE_TEST_VIEWER_SUPABASE_ACCESS_TOKEN",
  "SAYVE_TEST_INVITE_ACCEPT_SUPABASE_ACCESS_TOKEN",
  "SAYVE_TEST_HOUSEHOLD_ID",
  "pnpm run verify:deploy:public-launch"
]) {
  if (!publicLaunchCommand.includes(token)) {
    fail(`Founder setup publicLaunch command is missing ${token}.`);
  }
}
for (const token of [
  "# Sayve Live Proof Pack",
  "## 1. Locally Proven vs Still Needs Live Proof",
  "## 2. Current Live Proof Gaps",
  "## 3. Onboarding Proof Steps",
  "## 4. Public Launch Checks",
  "SAYVE_DEPLOY_PROOF_REPORT_PATH=outputs/setup/deploy-proof-report.json",
  "outputs/setup/deploy-proof-summary.md",
  "verify:deploy:strict-private-beta"
]) {
  if (!liveProofMarkdown.includes(token)) {
    fail(`live-proof.md is missing required token: ${token}`);
  }
}
for (const token of ["production_storage_boundary", "supabase_migration_path", "core_api_stability"]) {
  if (!(liveProofPackageJson.launchCompletionAudit ?? []).some((row) => JSON.stringify(row).includes(token))) {
    fail(`live-proof-package.json launchCompletionAudit is missing ${token}.`);
  }
}
for (const token of ["external_live_proof", "real_user_proof"]) {
  if (!(liveProofPackageJson.liveProofGaps ?? []).some((row) => JSON.stringify(row).includes(token))) {
    fail(`live-proof-package.json liveProofGaps is missing ${token}.`);
  }
}
for (const token of ["Smoke proof", "Two-member + viewer proof"]) {
  if (!(liveProofPackageJson.publicLaunchChecks ?? []).some((row) => JSON.stringify(row).includes(token))) {
    fail(`live-proof-package.json publicLaunchChecks is missing ${token}.`);
  }
}
for (const token of ["001_ai_native_memory_engine.sql", "012_harden_ai_telemetry_constraints.sql"]) {
  if (!(liveProofPackageJson.migrationInventory ?? []).some((row) => JSON.stringify(row).includes(token))) {
    fail(`live-proof-package.json migrationInventory is missing ${token}.`);
  }
}
for (const token of ["applied_migration", "live_schema_check"]) {
  if (!(liveProofPackageJson.schemaMigrationProof ?? []).some((row) => JSON.stringify(row).includes(token))) {
    fail(`live-proof-package.json schemaMigrationProof is missing ${token}.`);
  }
}
for (const token of [
  "SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN",
  "pnpm run verify:deploy:strict-private-beta",
  "pnpm run verify:deploy:public-launch"
]) {
  if (!JSON.stringify(liveProofPackageJson).includes(token)) {
    fail(`live-proof-package.json is missing ${token}.`);
  }
}

console.log("Setup artifacts verified.");
