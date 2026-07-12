#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const cwd = process.cwd();
const setupArtifactSpec = JSON.parse(readFileSync(join(cwd, "src", "shared", "setup-artifacts-spec.json"), "utf8"));

function buildTemplate(header, rows) {
  return `${header}\n${rows.map((row) => `${row.env}=${row.fallback}`).join("\n")}\n`;
}

function bulletList(items, emptyLine = "- none") {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : emptyLine;
}

function buildHandoffMarkdown(report, outputFiles) {
  const summary = report.summary ?? {};
  const app = report.app ?? {};
  const blockers = Array.isArray(report.launchBlockers) ? report.launchBlockers : [];
  const nextActions = Array.isArray(report.nextActions) ? report.nextActions : [];
  const oauthChecklist = Array.isArray(report.googleOAuthChecklist) ? report.googleOAuthChecklist : [];
  const deploySmokeEnvTemplate = Array.isArray(report.deploySmokeEnvTemplate) ? report.deploySmokeEnvTemplate : [];
  const repositorySmokeGuide = Array.isArray(report.repositorySmokeGuide) ? report.repositorySmokeGuide : [];
  const publicLaunchChecks = Array.isArray(report.publicLaunchChecks) ? report.publicLaunchChecks : [];
  const migrationInventory = Array.isArray(report.migrationInventory) ? report.migrationInventory : [];
  const privateBetaSetupGate = Array.isArray(report.privateBetaSetupGate) ? report.privateBetaSetupGate : [];
  const integrationReadiness = Array.isArray(report.integrationReadiness) ? report.integrationReadiness : [];
  const integrationPackage = Array.isArray(report.integrationPackage) ? report.integrationPackage : [];
  const launchCompletionAudit = Array.isArray(report.launchCompletionAudit) ? report.launchCompletionAudit : [];
  const commands = report.commands ?? {};

  const blockerLines = blockers.map((blocker) => {
    const level = String(blocker.level ?? "info").toUpperCase();
    const area = blocker.area ? ` [${blocker.area}]` : "";
    const detail = blocker.detail ? ` - ${blocker.detail}` : "";
    return `${level}${area}: ${blocker.blocker ?? "Unknown blocker"}${detail}`;
  });

  const oauthLines = oauthChecklist.map((row) => `${row.step}. ${row.label}: ${row.detail}`);

  return [
    "# Sayve Setup Handoff",
    "",
    `Generated at: ${report.generatedAt ?? "unknown"}`,
    `Target: ${report.target ?? "unknown"}`,
    `Repository mode: ${app.repositoryMode ?? "unknown"}`,
    `App URL: ${app.appBaseUrl || "not set"}`,
    `Deploy URL: ${app.deployUrl || "not set"}`,
    "",
    "## Summary",
    "",
    `- Required ready: ${summary.requiredReady ?? 0}/${summary.requiredTotal ?? 0}`,
    `- Open required: ${summary.openRequired ?? 0}`,
    `- Optional open: ${summary.optionalOpen ?? 0}`,
    `- Deploy smoke ready: ${summary.deploySmokeReady ? "yes" : "no"}`,
    "",
    "## Launch Blockers",
    "",
    bulletList(blockerLines, "- none; private beta handoff is currently aligned"),
    "",
    "## Next Actions",
    "",
    bulletList(nextActions, "- no immediate next actions"),
    "",
    "## Google OAuth Checklist",
    "",
    bulletList(oauthLines, "- no OAuth checklist rows"),
    "",
    "## Commands",
    "",
    "### Private Beta",
    "",
    "```bash",
    String(commands.privateBeta ?? ""),
    "```",
    "",
    "### Strict Private Beta",
    "",
    "```bash",
    String(commands.strictPrivateBeta ?? ""),
    "```",
    "",
    "### Strict Private Beta + Proof Report",
    "",
    "```bash",
    String(commands.strictPrivateBetaProof ?? ""),
    "```",
    "",
    "### Public Launch",
    "",
    "```bash",
    String(commands.publicLaunch ?? ""),
    "```",
    "",
    "## Deploy Smoke Env Template",
    "",
    "```bash",
    ...deploySmokeEnvTemplate.map((line) => String(line)),
    "```",
    "",
    "## Repository Smoke Guide",
    "",
    bulletList(repositorySmokeGuide.map((row) => `Step ${row.step}: ${row.label} - ${row.detail}`), "- no repository smoke guide rows"),
    "",
    "## Public Launch Checks",
    "",
    bulletList(publicLaunchChecks.map((row) => `${row.item}: ${row.detail}`), "- no public launch check rows"),
    "",
    "## Supabase Migration Inventory",
    "",
    bulletList(
      migrationInventory.map((row) => `${row.version} ${row.file} (${row.requiredFor}, ${row.checksum}) - ${row.purpose}`),
      "- no migration inventory rows"
    ),
    "",
    "## Private Beta Setup Gate",
    "",
    bulletList(privateBetaSetupGate.map((row) => `${row.step}. ${row.item} - ${row.detail} [${row.source}]`), "- no private beta setup gate rows"),
    "",
    "## Integration Readiness",
    "",
    bulletList(
      integrationReadiness.map((row) => `${row.system} (${row.stage}) - ${row.detail} [required: ${row.required}]`),
      "- no integration readiness rows"
    ),
    "",
    "## Integration Package",
    "",
    bulletList(
      integrationPackage.map((row) => `${row.system}.${row.field} (${row.stage}) -> ${row.target}: ${row.detail}`),
      "- no integration package rows"
    ),
    "",
    "## Launch Completion Audit",
    "",
    bulletList(
      launchCompletionAudit.map((row) => `${row.requirement}: ${row.evidence} | live proof: ${row.liveProof} | next: ${row.nextAction}`),
      "- no launch completion audit rows"
    ),
    "",
    "## Bundle Files",
    "",
    bulletList(outputFiles.map((file) => `outputs/setup/${file}`)),
    ""
  ].join("\n");
}

function buildEnvMapMarkdown(report) {
  const envMatrix = Array.isArray(report.envMatrix) ? report.envMatrix : [];
  const integrationPackage = Array.isArray(report.integrationPackage) ? report.integrationPackage : [];

  const integrationHints = new Map(
    integrationPackage.map((row) => [
      `${row.system}.${row.field}`,
      `${row.target}: ${row.detail}`
    ])
  );

  const providerHintForEnv = (env) => {
    switch (env) {
      case "NEXT_PUBLIC_SUPABASE_URL":
      case "SUPABASE_URL":
        return integrationHints.get("supabase.project_url") ?? "Supabase Project URL";
      case "NEXT_PUBLIC_SUPABASE_ANON_KEY":
        return integrationHints.get("supabase.anon_key") ?? "Supabase anon key";
      case "SUPABASE_SERVICE_ROLE_KEY":
        return integrationHints.get("supabase.service_role_key") ?? "Supabase service role key";
      case "NEXT_PUBLIC_APP_URL":
        return integrationHints.get("google_oauth.site_url") ?? "Supabase Auth Site URL / stable app origin";
      case "OPENAI_API_KEY":
        return integrationHints.get("openai.api_key") ?? "OpenAI API key";
      case "SAYVE_DEPLOY_URL":
        return integrationHints.get("vercel.deploy_url") ?? "Vercel deployment URL";
      default:
        return "";
    }
  };

  const whereToSet = (env) => {
    if (env.startsWith("NEXT_PUBLIC_")) return "local `.env.local` + Vercel";
    if (
      [
        "SUPABASE_SERVICE_ROLE_KEY",
        "SUPABASE_URL",
        "SUPABASE_DEFAULT_HOUSEHOLD_ID",
        "SUPABASE_AUTH_REQUIRED",
        "OPENAI_API_KEY",
        "OPENAI_CAPTURE_MODEL",
        "OPENAI_CAPTURE_MAX_OUTPUT_TOKENS",
        "OPENAI_CONVERSATION_MODEL",
        "OPENAI_CONVERSATION_MAX_OUTPUT_TOKENS",
        "OPENAI_ESCALATION_MODEL",
        "OPENAI_RECEIPT_VISION_MODEL",
        "OPENAI_SPEECH_TO_TEXT_MODEL",
        "OPENAI_CAPTURE_INPUT_USD_PER_1M",
        "OPENAI_CAPTURE_OUTPUT_USD_PER_1M",
        "OPENAI_RECEIPT_VISION_INPUT_USD_PER_1M",
        "OPENAI_RECEIPT_VISION_OUTPUT_USD_PER_1M",
        "OPENAI_CONVERSATION_INPUT_USD_PER_1M",
        "OPENAI_CONVERSATION_OUTPUT_USD_PER_1M",
        "OPENAI_STT_INPUT_USD_PER_1M",
        "OPENAI_STT_OUTPUT_USD_PER_1M",
        "SUPABASE_MEDIA_BUCKET",
        "RECEIPT_UPLOAD_MAX_BYTES",
        "VOICE_UPLOAD_MAX_BYTES",
        "AUDIO_TRANSCRIPTION_MAX_BYTES",
        "RECEIPT_VISION_MAX_BYTES",
        "APP_ACCESS_TOKEN",
        "ADMIN_CONSOLE_TOKEN",
        "SAYVE_DEPLOY_URL",
        "SAYVE_DEPLOYMENT_SMOKE_VERIFIED",
        "SAYVE_DEPLOYMENT_SMOKE_VERIFIED_AT",
        "SAYVE_DEPLOYMENT_SMOKE_TARGET"
      ].includes(env)
    ) {
      return "local `.env.local` + Vercel server env";
    }
    return "local `.env.local`";
  };

  const localOnlyRows = [
    ["SAYVE_TEST_SUPABASE_ACCESS_TOKEN", "browser localStorage -> owner session", "deployment smoke only"],
    ["SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN", "browser localStorage -> partner session", "deployment smoke only"],
    ["SAYVE_TEST_VIEWER_SUPABASE_ACCESS_TOKEN", "browser localStorage -> viewer session", "deployment smoke only"],
    ["SAYVE_TEST_INVITE_ACCEPT_SUPABASE_ACCESS_TOKEN", "browser localStorage -> fresh invite session", "deployment smoke only"],
    ["SAYVE_TEST_HOUSEHOLD_ID", "browser localStorage -> sayve_household_id", "deployment smoke only"]
  ];

  return [
    "# Sayve Local / Vercel Env Map",
    "",
    "呢份係 deploy 前真正用嚟填 env 嘅對照表。",
    "",
    "- `Where to set`：應該填喺本地 `.env.local`、Vercel，定兩邊都要",
    "- `Provider / Source`：個值喺邊度抄返嚟",
    "- `Stage`：private beta 定 public launch 先需要",
    "",
    "| Env | Where to set | Stage | Provider / Source | Note |",
    "| --- | --- | --- | --- | --- |",
    ...envMatrix.map((row) =>
      `| \`${row.env}\` | ${whereToSet(String(row.env))} | ${row.requiredFor} | ${providerHintForEnv(String(row.env)) || "-"} | ${String(row.note ?? "").replaceAll("|", "\\|")} |`
    ),
    "",
    "## Smoke-only locals",
    "",
    "| Env | Source | Note |",
    "| --- | --- | --- |",
    ...localOnlyRows.map(([env, source, note]) => `| \`${env}\` | ${source} | ${note} |`),
    ""
  ].join("\n");
}

function buildLiveRolloutSequenceMarkdown(report) {
  const privateBetaSetupGate = Array.isArray(report.privateBetaSetupGate) ? report.privateBetaSetupGate : [];
  const launchCompletionAudit = Array.isArray(report.launchCompletionAudit) ? report.launchCompletionAudit : [];
  const commands = report.commands ?? {};
  const smokeGuide = Array.isArray(report.smokeTokenGuide) ? report.smokeTokenGuide : [];

  return [
    "# Sayve Live Rollout Sequence",
    "",
    "呢份係最後由本地 demo 推去真 private beta / public launch 嘅實戰順序。",
    "",
    "## Phase 1: Prepare Real Infra",
    "",
    ...privateBetaSetupGate.slice(0, 4).map((row) => `- Step ${row.step}: ${row.item} - ${row.detail}`),
    "",
    "## Phase 2: Real Household Onboarding",
    "",
    ...privateBetaSetupGate.slice(4, 6).map((row) => `- Step ${row.step}: ${row.item} - ${row.detail}`),
    "",
    "## Phase 3: Collect Smoke Inputs",
    "",
    ...smokeGuide.map((row) => `- ${row.role}: ${row.action} (${row.env})`),
    "",
    "## Phase 4: Run Live Verification",
    "",
    "### Private Beta",
    "```bash",
    String(commands.privateBeta ?? ""),
    "```",
    "",
    "### Strict Private Beta",
    "```bash",
    String(commands.strictPrivateBeta ?? ""),
    "```",
    "",
    "### Save proof report",
    "```bash",
    String(commands.strictPrivateBetaProof ?? ""),
    "```",
    "",
    "This command also writes `outputs/setup/deploy-proof-summary.md` automatically.",
    "",
    "### Public Launch",
    "```bash",
    String(commands.publicLaunch ?? ""),
    "```",
    "",
    "## Phase 5: What Must Be Proven Live",
    "",
    ...launchCompletionAudit.map((row) => `- ${row.requirement}: ${row.liveProof} Next: ${row.nextAction}`),
    ""
  ].join("\n");
}

function buildExecutionChecklistMarkdown(report) {
  const rows = Array.isArray(report.privateBetaSetupGate) ? report.privateBetaSetupGate : [];
  const summary = report.summary ?? {};

  return [
    "# Sayve Private Beta Execution Checklist",
    "",
    `Generated at: ${report.generatedAt ?? "unknown"}`,
    "",
    `Required ready: ${summary.requiredReady ?? 0}/${summary.requiredTotal ?? 0}`,
    `Open required: ${summary.openRequired ?? 0}`,
    "",
    "| Step | Status | Owner | Item | Detail | Source |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows.map((row) =>
      `| ${row.step} | ${String(row.status ?? "").toUpperCase()} | ${row.owner ?? "-"} | ${row.item ?? "-"} | ${String(row.detail ?? "").replaceAll("|", "\\|")} | ${row.source ?? "-"} |`
    ),
    ""
  ].join("\n");
}

function buildLiveDeploymentExecutionOrderMarkdown(report) {
  const app = report.app ?? {};
  const nextActions = Array.isArray(report.nextActions) ? report.nextActions : [];
  const blockers = Array.isArray(report.launchBlockers) ? report.launchBlockers : [];
  const commands = report.commands ?? {};

  return [
    "# Sayve Live Deployment Execution Order",
    "",
    "呢份係由你而家個狀態開始，排到第一個真 private beta smoke pass 嘅次序。",
    "",
    `Current app URL: ${app.appBaseUrl || "not set"}`,
    `Current deploy URL: ${app.deployUrl || "not set"}`,
    `Current repository mode: ${app.repositoryMode || "unknown"}`,
    "",
    "## 1. 先補最硬 blocker",
    "",
    ...(blockers.slice(0, 5).map((row, index) => `${index + 1}. ${row.blocker} - ${row.detail}`)),
    "",
    "## 2. 再做真 infra 設定",
    "",
    "1. Supabase migrations apply 完 001-012",
    "2. Google OAuth redirect allow-list 設好 root + /invite",
    "3. Vercel env set 好 private beta minimum",
    "4. Deploy 最新 build",
    "",
    "## 3. Deploy 後做 founder household init",
    "",
    "1. Founder login",
    "2. 建立 household",
    "3. attach founder 做 owner",
    "4. 記低 household UUID",
    "",
    "## 4. 再做 partner onboarding",
    "",
    "1. 建立 partner invite",
    "2. partner 用另一個 Google account login",
    "3. accept 入同一個 household",
    "4. 確認 member count >= 2",
    "",
    "## 5. 然後抄 smoke inputs",
    "",
    "1. owner token",
    "2. partner token",
    "3. viewer token",
    "4. fresh unjoined token",
    "5. fresh no-household token",
    "6. household id",
    "",
    "## 6. 跑第一個真 smoke",
    "",
    "```bash",
    String(commands.privateBeta ?? ""),
    "```",
    "",
    "如果想一次過證明 owner/member/viewer/bootstrap/OpenAI/privacy，全套用：",
    "",
    "```bash",
    String(commands.strictPrivateBeta ?? ""),
    "```",
    "",
    "## 7. Smoke pass 後立即確認",
    "",
    "1. /admin -> Launch Completion Audit",
    "2. /admin -> Launch Readiness",
    "3. /admin -> Onboarding Health",
    "4. /admin -> AI Runtime Health",
    "5. /admin -> Live Rollout Checklist",
    "",
    "## 8. 如果未 pass，下一輪優先做",
    "",
    ...(nextActions.length ? nextActions.map((item, index) => `${index + 1}. ${item}`) : ["1. 冇 next action，代表應該已接近 private beta 可用。"]),
    ""
  ].join("\n");
}

function buildPrivateBetaGoLiveRunSheetMarkdown(report) {
  const app = report.app ?? {};
  const launchBlockers = Array.isArray(report.launchBlockers) ? report.launchBlockers : [];
  const nextActions = Array.isArray(report.nextActions) ? report.nextActions : [];
  const setupGate = Array.isArray(report.privateBetaSetupGate) ? report.privateBetaSetupGate : [];
  const smokeGuide = Array.isArray(report.smokeTokenGuide) ? report.smokeTokenGuide : [];
  const commands = report.commands ?? {};

  const topBlockers = launchBlockers.slice(0, 6).map((row) => `- ${String(row.level ?? "info").toUpperCase()}: ${row.blocker} - ${row.detail}`);

  return [
    "# Sayve Private Beta Go-Live Run Sheet",
    "",
    "呢份唔係 architecture note，係 deploy 當日照住做嘅 run sheet。",
    "",
    `- App URL: ${app.appBaseUrl || "not set"}`,
    `- Deploy URL: ${app.deployUrl || "not set"}`,
    `- Repository: ${app.repositoryMode || "unknown"}`,
    "",
    "## A. 開始前先睇",
    "",
    ...(topBlockers.length ? topBlockers : ["- 目前冇額外 blocker 摘要，可直接跟下面步驟走。"]),
    "",
    "## B. 今日要完成嘅順序",
    "",
    ...setupGate.map((row) => `- Step ${row.step} [${String(row.status ?? "open").toUpperCase()}] ${row.item}: ${row.detail}`),
    "",
    "## C. 真實登入與邀請",
    "",
    "- Founder：用自己 Google account 登入，建立 household，確認自己係 owner。",
    "- Partner：用另一個 Google account 開 invite link，accept 入同一個 household。",
    "- Viewer：如果今日要做 viewer smoke，就另外開 viewer invite。",
    "",
    "## D. 要抄低嘅 smoke inputs",
    "",
    ...smokeGuide.map((row) => `- ${row.role}: ${row.env} -> ${row.action}`),
    "",
    "## E. Deploy 後先跑",
    "",
    "### Private beta smoke",
    "```bash",
    String(commands.privateBeta ?? ""),
    "```",
    "",
    "### Strict private beta smoke",
    "```bash",
    String(commands.strictPrivateBeta ?? ""),
    "```",
    "",
    "### Strict private beta smoke + proof report",
    "```bash",
    String(commands.strictPrivateBetaProof ?? ""),
    "```",
    "",
    "Expected artifacts after the run:",
    "- `outputs/setup/deploy-proof-report.json`",
    "- `outputs/setup/deploy-proof-summary.md`",
    "",
    "### Public launch smoke",
    "```bash",
    String(commands.publicLaunch ?? ""),
    "```",
    "",
    "## F. 跑完之後一定要確認",
    "",
    "- /admin -> Launch Completion Audit",
    "- /admin -> Launch Blockers",
    "- /admin -> Onboarding Health",
    "- /admin -> AI Runtime Health",
    "- /admin -> Live Rollout Checklist",
    "",
    "## G. 如果今日只做 private beta，成功定義係：",
    "",
    "- founder login work",
    "- partner login work",
    "- 兩個人寫入同一 household",
    "- dashboard / ask / capture 正常",
    "- /admin 睇到真 telemetry",
    "- verify:deploy:private-beta pass",
    "",
    "## H. 下一步",
    "",
    ...(nextActions.length ? nextActions.map((item) => `- ${item}`) : ["- 冇即時 next action。"]) ,
    ""
  ].join("\n");
}

function buildProviderSetupMarkdown(report) {
  const authTargets = report.authTargets ?? {};
  const oauthChecklist = Array.isArray(report.googleOAuthChecklist) ? report.googleOAuthChecklist : [];
  const commands = report.commands ?? {};

  const envMatrix = Array.isArray(report.envMatrix) ? report.envMatrix : [];
  const privateBetaRows = envMatrix.filter((row) => row.requiredFor === "private_beta");
  const publicLaunchRows = envMatrix.filter((row) => row.requiredFor === "public_launch");
  const deployRows = envMatrix.filter((row) => row.requiredFor === "deploy_smoke");

  const linesFor = (rows) => rows.map((row) => `- \`${row.env}\` = ${row.value ?? row.note ?? ""}`);

  return [
    "# Sayve Provider Setup",
    "",
    "呢份係 deploy 當日用嘅 provider-by-provider setup guide。",
    "",
    "## 1. Supabase",
    "",
    "要拎返：",
    "- `Project URL`",
    "- `anon public key`",
    "- `service_role key`",
    "",
    "對應 Sayve env：",
    "- `NEXT_PUBLIC_SUPABASE_URL`",
    "- `NEXT_PUBLIC_SUPABASE_ANON_KEY`",
    "- `SUPABASE_SERVICE_ROLE_KEY`",
    "- `SUPABASE_URL`（如果你有設 server override）",
    "",
    "Private beta minimum:",
    ...linesFor(privateBetaRows.filter((row) => String(row.group ?? "").includes("supabase") || String(row.env).startsWith("SUPABASE") || String(row.env).startsWith("NEXT_PUBLIC_SUPABASE"))),
    "",
    "## 2. Google OAuth + Supabase Auth",
    "",
    `- Site URL: ${authTargets.siteUrl || "Set NEXT_PUBLIC_APP_URL first"}`,
    `- Root redirect: ${authTargets.rootRedirect || "Set NEXT_PUBLIC_APP_URL first"}`,
    `- Invite redirect: ${authTargets.inviteRedirect || "Set NEXT_PUBLIC_APP_URL first"}`,
    "",
    "Checklist:",
    ...oauthChecklist.map((row) => `- ${row.step}. ${row.label}: ${row.detail}`),
    "",
    "## 3. Vercel (Private Beta Minimum)",
    "",
    ...linesFor(privateBetaRows),
    "",
    "## 4. OpenAI (Public Launch Before Required)",
    "",
    ...linesFor(publicLaunchRows.filter((row) => String(row.group ?? "") === "ai" || String(row.group ?? "") === "cost")),
    "",
    "## 5. Deploy Smoke",
    "",
    ...linesFor(deployRows),
    "",
    "Private beta command:",
    "```bash",
    String(commands.privateBeta ?? ""),
    "```",
    "",
    "Strict private beta command:",
    "```bash",
    String(commands.strictPrivateBeta ?? ""),
    "```",
    "",
    "Strict private beta + proof report command:",
    "```bash",
    String(commands.strictPrivateBetaProof ?? ""),
    "```",
    "",
    "Public launch command:",
    "```bash",
    String(commands.publicLaunch ?? ""),
    "```",
    ""
  ].join("\n");
}

function buildLiveProofMarkdown(report) {
  const app = report.app ?? {};
  const launchCompletionAudit = Array.isArray(report.launchCompletionAudit) ? report.launchCompletionAudit : [];
  const liveProofGaps = Array.isArray(report.liveProofGaps) ? report.liveProofGaps : [];
  const onboardingProofSteps = Array.isArray(report.onboardingProofSteps) ? report.onboardingProofSteps : [];
  const publicLaunchChecks = Array.isArray(report.publicLaunchChecks) ? report.publicLaunchChecks : [];
  const commands = report.commands ?? {};

  return [
    "# Sayve Live Proof Pack",
    "",
    "呢份唔係 setup guide，而係真 deploy 後用嚟收集同保存上線證據嘅 proof pack。",
    "",
    `- App URL: ${app.appBaseUrl || "not set"}`,
    `- Deploy URL: ${app.deployUrl || "not set"}`,
    `- Repository: ${app.repositoryMode || "unknown"}`,
    "",
    "## 1. Locally Proven vs Still Needs Live Proof",
    "",
    ...launchCompletionAudit.map((row) => `- ${row.requirement}: evidence=${row.evidence} | live=${row.liveProof} | next=${row.nextAction}`),
    "",
    "## 2. Current Live Proof Gaps",
    "",
    ...(liveProofGaps.length
      ? liveProofGaps.map((row) => `- ${row.area}: ${row.proof} ${row.nextAction ? `Next: ${row.nextAction}` : ""}`.trim())
      : ["- no live proof gap rows"]),
    "",
    "## 3. Onboarding Proof Steps",
    "",
    ...(onboardingProofSteps.length
      ? onboardingProofSteps.map((row) => `- Step ${row.step}: ${row.item} | ${row.proof} | ${row.nextAction}`)
      : ["- no onboarding proof steps"]),
    "",
    "## 4. Public Launch Checks",
    "",
    ...(publicLaunchChecks.length
      ? publicLaunchChecks.map((row) => `- ${row.item}: ${row.detail}`)
      : ["- no public launch check rows"]),
    "",
    "## 5. Run These Commands After Deploy",
    "",
    "### Private Beta",
    "```bash",
    String(commands.privateBeta ?? ""),
    "```",
    "",
    "### Strict Private Beta",
    "```bash",
    String(commands.strictPrivateBeta ?? ""),
    "```",
    "",
    "### Save proof report",
    "```bash",
    String(commands.strictPrivateBetaProof ?? ""),
    "```",
    "",
    "Expected artifacts after the run:",
    "- `outputs/setup/deploy-proof-report.json`",
    "- `outputs/setup/deploy-proof-summary.md`",
    "",
    "### Public Launch",
    "```bash",
    String(commands.publicLaunch ?? ""),
    "```",
    ""
  ].join("\n");
}

const templates = {
  privateBeta: buildTemplate("# Sayve private beta deployment example", setupArtifactSpec.privateBetaEnvTemplate ?? []),
  publicLaunch: buildTemplate("# Sayve public launch / deploy smoke example", setupArtifactSpec.deploymentEnvTemplate ?? [])
};

const mode = process.argv[2] ?? "json";

if (mode === "private-beta") {
  process.stdout.write(templates.privateBeta);
} else if (mode === "public-launch") {
  process.stdout.write(templates.publicLaunch);
} else if (mode === "write") {
  const outputDir = join(cwd, "outputs", "setup");
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, "private-beta.env"), templates.privateBeta);
  writeFileSync(join(outputDir, "public-launch.env"), templates.publicLaunch);
  const setupReport = execFileSync(process.execPath, [join(cwd, "scripts", "founder-setup-report.mjs")], {
    cwd,
    encoding: "utf8"
  });
  const report = JSON.parse(setupReport);
  writeFileSync(join(outputDir, "setup-report.json"), setupReport);
  writeFileSync(join(outputDir, "env-map.md"), buildEnvMapMarkdown(report));
  writeFileSync(join(outputDir, "execution-checklist.md"), buildExecutionChecklistMarkdown(report));
  writeFileSync(join(outputDir, "provider-setup.md"), buildProviderSetupMarkdown(report));
  writeFileSync(join(outputDir, "deploy-smoke.env"), `${(report.deploySmokeEnvTemplate ?? []).map((line) => String(line)).join("\n")}\n`);
  writeFileSync(join(outputDir, "private-beta-go-live-run-sheet.md"), buildPrivateBetaGoLiveRunSheetMarkdown(report));
  writeFileSync(join(outputDir, "live-deployment-execution-order.md"), buildLiveDeploymentExecutionOrderMarkdown(report));
  writeFileSync(join(outputDir, "live-proof.md"), buildLiveProofMarkdown(report));
  writeFileSync(
    join(outputDir, "integration-package.json"),
    `${JSON.stringify(
      {
        generatedAt: report.generatedAt,
        authTargets: report.authTargets ?? {},
        googleOAuthChecklist: report.googleOAuthChecklist ?? [],
        integrationReadiness: report.integrationReadiness ?? [],
        integrationPackage: report.integrationPackage ?? [],
        launchCompletionAudit: report.launchCompletionAudit ?? [],
        commands: report.commands ?? {}
      },
      null,
      2
    )}\n`
  );
  writeFileSync(
    join(outputDir, "live-proof-package.json"),
    `${JSON.stringify(
      {
        generatedAt: report.generatedAt,
        app: report.app ?? {},
        defaultHouseholdBinding: report.defaultHouseholdBinding ?? {},
        onboardingHealth: report.onboardingHealth ?? {},
        launchCompletionAudit: report.launchCompletionAudit ?? [],
        liveProofGaps: report.liveProofGaps ?? [],
        onboardingProofSteps: report.onboardingProofSteps ?? [],
        publicLaunchChecks: report.publicLaunchChecks ?? [],
        deployEnvTemplate: report.deploymentEnvTemplate ?? [],
        deploySmokeEnvTemplate: report.deploySmokeEnvTemplate ?? [],
        migrationInventory: report.migrationInventory ?? [],
        schemaMigrationProof: report.schemaMigrationProof ?? [],
        smokeTokenGuide: report.smokeTokenGuide ?? [],
        commands: report.commands ?? {}
      },
      null,
      2
    )}\n`
  );
  writeFileSync(join(outputDir, "live-rollout-sequence.md"), buildLiveRolloutSequenceMarkdown(report));
  const files = [
    "private-beta.env",
    "public-launch.env",
    "setup-report.json",
    "env-map.md",
    "execution-checklist.md",
    "provider-setup.md",
    "deploy-smoke.env",
    "integration-package.json",
    "live-proof-package.json",
    "live-proof.md",
    "live-rollout-sequence.md",
    "private-beta-go-live-run-sheet.md",
    "live-deployment-execution-order.md",
    "handoff.md"
  ];
  writeFileSync(join(outputDir, "handoff.md"), buildHandoffMarkdown(report, files));
  process.stdout.write(`${JSON.stringify({ outputDir, files }, null, 2)}\n`);
} else {
  process.stdout.write(`${JSON.stringify(templates, null, 2)}\n`);
}
