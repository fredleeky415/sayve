#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getMigrationInventory } from "./lib/migration-inventory.mjs";

const target = process.env.SAYVE_ENV_TARGET ?? process.argv[2] ?? "local";
const setupArtifactSpec = JSON.parse(
  readFileSync(join(process.cwd(), "src", "shared", "setup-artifacts-spec.json"), "utf8")
);

function value(name) {
  return process.env[name]?.trim() ?? "";
}

function present(name) {
  return Boolean(value(name));
}

function redactSecret(name) {
  return present(name) ? "configured" : "missing";
}

function item(group, env, requiredFor, note, options = {}) {
  return {
    group,
    env,
    requiredFor,
    status: options.status ?? (present(env) ? "ready" : options.optional ? "optional" : "open"),
    value: options.value ?? (options.secret ? redactSecret(env) : value(env)),
    note
  };
}

function isRequiredForTarget(requiredFor) {
  if (target === "local") return requiredFor === "private_beta";
  if (target === "private-beta") return requiredFor === "private_beta";
  if (target === "public-launch") return requiredFor === "private_beta" || requiredFor === "public_launch";
  return false;
}

function templateValueForEnv(env, fallback) {
  switch (env) {
    case "MEMORY_REPOSITORY":
      return value("MEMORY_REPOSITORY") || fallback;
    case "NEXT_PUBLIC_APP_URL":
      return value("NEXT_PUBLIC_APP_URL") || fallback;
    case "NEXT_PUBLIC_SUPABASE_URL":
      return value("NEXT_PUBLIC_SUPABASE_URL") || fallback;
    case "NEXT_PUBLIC_SUPABASE_ANON_KEY":
      return present("NEXT_PUBLIC_SUPABASE_ANON_KEY") ? "<configured>" : fallback;
    case "SUPABASE_URL":
      return value("SUPABASE_URL") || value("NEXT_PUBLIC_SUPABASE_URL") || fallback;
    case "SUPABASE_SERVICE_ROLE_KEY":
      return present("SUPABASE_SERVICE_ROLE_KEY") ? "<configured>" : fallback;
    case "SUPABASE_DEFAULT_HOUSEHOLD_ID":
      return value("SUPABASE_DEFAULT_HOUSEHOLD_ID") || fallback;
    case "SUPABASE_AUTH_REQUIRED":
      return value("SUPABASE_AUTH_REQUIRED") || fallback;
    case "APP_ACCESS_TOKEN":
      return present("APP_ACCESS_TOKEN") ? "<configured>" : fallback;
    case "ADMIN_CONSOLE_TOKEN":
      return present("ADMIN_CONSOLE_TOKEN") ? "<configured>" : fallback;
    case "OPENAI_API_KEY":
      return present("OPENAI_API_KEY") ? "<configured>" : fallback;
    case "OPENAI_CAPTURE_MODEL":
    case "OPENAI_CONVERSATION_MODEL":
    case "OPENAI_ESCALATION_MODEL":
    case "OPENAI_RECEIPT_VISION_MODEL":
    case "OPENAI_SPEECH_TO_TEXT_MODEL":
    case "AUDIO_TRANSCRIPTION_MAX_BYTES":
    case "RECEIPT_VISION_MAX_BYTES":
    case "OPENAI_CAPTURE_INPUT_USD_PER_1M":
    case "OPENAI_CAPTURE_OUTPUT_USD_PER_1M":
    case "OPENAI_RECEIPT_VISION_INPUT_USD_PER_1M":
    case "OPENAI_RECEIPT_VISION_OUTPUT_USD_PER_1M":
    case "OPENAI_CONVERSATION_INPUT_USD_PER_1M":
    case "OPENAI_CONVERSATION_OUTPUT_USD_PER_1M":
    case "OPENAI_STT_INPUT_USD_PER_1M":
    case "OPENAI_STT_OUTPUT_USD_PER_1M":
      return value(env) || fallback;
    case "SUPABASE_MEDIA_BUCKET":
      return value("SUPABASE_MEDIA_BUCKET") || fallback;
    case "RECEIPT_UPLOAD_MAX_BYTES":
      return value("RECEIPT_UPLOAD_MAX_BYTES") || fallback;
    case "VOICE_UPLOAD_MAX_BYTES":
      return value("VOICE_UPLOAD_MAX_BYTES") || fallback;
    case "SAYVE_DEPLOY_URL":
      return value("SAYVE_DEPLOY_URL") || fallback;
    case "SAYVE_DEPLOYMENT_SMOKE_VERIFIED":
      return value("SAYVE_DEPLOYMENT_SMOKE_VERIFIED") || fallback;
    case "SAYVE_DEPLOYMENT_SMOKE_VERIFIED_AT":
      return value("SAYVE_DEPLOYMENT_SMOKE_VERIFIED_AT") || fallback;
    case "SAYVE_DEPLOYMENT_SMOKE_TARGET":
      return value("SAYVE_DEPLOYMENT_SMOKE_TARGET") || fallback;
    default:
      return fallback;
  }
}

const envMatrix = [
  item("core", "MEMORY_REPOSITORY", "private_beta", "Set to supabase before real household rollout.", {
    value: value("MEMORY_REPOSITORY") || "local_file"
  }),
  item("core", "NEXT_PUBLIC_APP_URL", "private_beta", "Stable app origin for browser auth and invite redirects."),
  item("supabase", "NEXT_PUBLIC_SUPABASE_URL", "private_beta", "Public browser auth project URL."),
  item("supabase", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "private_beta", "Browser auth anon key.", { secret: true }),
  item("supabase", "SUPABASE_URL", "private_beta_optional", "Optional server override; if set, must match NEXT_PUBLIC_SUPABASE_URL host.", {
    optional: true
  }),
  item("supabase", "SUPABASE_SERVICE_ROLE_KEY", "private_beta", "Server-only storage/admin key.", { secret: true }),
  item("supabase", "SUPABASE_DEFAULT_HOUSEHOLD_ID", "private_beta", "Founder default household binding and smoke fallback."),
  item("auth", "SUPABASE_AUTH_REQUIRED", "private_beta", "Must be 1 before real family login usage.", {
    value: value("SUPABASE_AUTH_REQUIRED") || "0"
  }),
  item("auth", "APP_ACCESS_TOKEN", "private_beta", "Private beta access gate token.", { secret: true }),
  item("auth", "ADMIN_CONSOLE_TOKEN", "private_beta", "Founder/admin console protection.", { secret: true }),
  item("ai", "OPENAI_API_KEY", "public_launch", "Required before public launch.", { secret: true }),
  item("ai", "OPENAI_CAPTURE_MODEL", "public_launch", "Pin capture interpretation model for telemetry and cost auditing."),
  item("ai", "OPENAI_CAPTURE_MAX_OUTPUT_TOKENS", "public_launch", "Keep capture interpretation output small and predictable."),
  item("ai", "OPENAI_CONVERSATION_MODEL", "public_launch", "Pin conversation model for concise answer telemetry and cost auditing."),
  item("ai", "OPENAI_CONVERSATION_MAX_OUTPUT_TOKENS", "public_launch", "Keep Sayve answers short and token-efficient."),
  item("ai", "OPENAI_ESCALATION_MODEL", "public_launch", "Pin escalation model for higher-complexity reasoning paths."),
  item("ai", "OPENAI_RECEIPT_VISION_MODEL", "public_launch", "Pin receipt vision model for OCR/understanding telemetry."),
  item("ai", "OPENAI_SPEECH_TO_TEXT_MODEL", "public_launch", "Pin speech-to-text model for voice capture telemetry."),
  item("ai", "AUDIO_TRANSCRIPTION_MAX_BYTES", "public_launch", "Speech-to-text cost/latency guardrail for uploaded audio."),
  item("ai", "RECEIPT_VISION_MAX_BYTES", "public_launch", "Receipt vision cost/latency guardrail for uploaded images."),
  item("cost", "OPENAI_CAPTURE_INPUT_USD_PER_1M", "public_launch", "Capture input pricing for founder cost analytics."),
  item("cost", "OPENAI_CAPTURE_OUTPUT_USD_PER_1M", "public_launch", "Capture output pricing for founder cost analytics."),
  item("cost", "OPENAI_RECEIPT_VISION_INPUT_USD_PER_1M", "public_launch", "Receipt vision input pricing for founder cost analytics."),
  item("cost", "OPENAI_RECEIPT_VISION_OUTPUT_USD_PER_1M", "public_launch", "Receipt vision output pricing for founder cost analytics."),
  item("cost", "OPENAI_CONVERSATION_INPUT_USD_PER_1M", "public_launch", "Conversation input pricing for founder cost analytics."),
  item("cost", "OPENAI_CONVERSATION_OUTPUT_USD_PER_1M", "public_launch", "Conversation output pricing for founder cost analytics."),
  item("cost", "OPENAI_STT_INPUT_USD_PER_1M", "public_launch", "Speech-to-text input pricing for founder cost analytics."),
  item("cost", "OPENAI_STT_OUTPUT_USD_PER_1M", "public_launch", "Speech-to-text output pricing for founder cost analytics."),
  item("media", "SUPABASE_MEDIA_BUCKET", "public_launch", "Private receipt/voice source-file bucket."),
  item("media", "RECEIPT_UPLOAD_MAX_BYTES", "public_launch", "Receipt source-file upload guardrail."),
  item("media", "VOICE_UPLOAD_MAX_BYTES", "public_launch", "Voice source-file upload guardrail."),
  item("deploy", "SAYVE_DEPLOY_URL", "deploy_smoke", "Target URL for deployment smoke."),
  item("deploy", "SAYVE_DEPLOYMENT_SMOKE_VERIFIED", "public_launch", "Set only after live deploy smoke passes.", {
    value: value("SAYVE_DEPLOYMENT_SMOKE_VERIFIED") || "0"
  }),
  item("deploy", "SAYVE_DEPLOYMENT_SMOKE_VERIFIED_AT", "public_launch", "Proof timestamp after smoke passes.", {
    optional: true
  }),
  item("deploy", "SAYVE_DEPLOYMENT_SMOKE_TARGET", "public_launch", "Proof target URL after smoke passes.", {
    optional: true
  })
];

const copyPasteEnvTemplate = [
  "# Sayve private beta env template",
  ...setupArtifactSpec.privateBetaEnvTemplate.map((row) => `${row.env}=${templateValueForEnv(row.env, row.fallback)}`)
];

const deploymentEnvTemplate = [
  "# Sayve deployment/public-launch env template",
  ...setupArtifactSpec.deploymentEnvTemplate.map((row) => `${row.env}=${templateValueForEnv(row.env, row.fallback)}`)
];

const googleOAuthChecklist = [
  {
    step: 1,
    label: "Enable Google provider in Supabase Auth",
    detail: "Turn on Google under Supabase Auth providers and paste the Google client id / secret."
  },
  {
    step: 2,
    label: "Set Supabase Site URL",
    detail: value("NEXT_PUBLIC_APP_URL") || "Set Site URL to the real deployed Sayve origin."
  },
  {
    step: 3,
    label: "Add root redirect allow-list entry",
    detail: value("NEXT_PUBLIC_APP_URL") || "Add https://your-domain.com"
  },
  {
    step: 4,
    label: "Add invite redirect allow-list entry",
    detail: value("NEXT_PUBLIC_APP_URL") ? `${value("NEXT_PUBLIC_APP_URL")}/invite` : "Add https://your-domain.com/invite"
  },
  {
    step: 5,
    label: "Founder sanity check",
    detail: "Login as founder, then confirm /invite can also complete with a separate partner account."
  }
];

const deploymentCommands = {
  privateBeta: [
    `SAYVE_DEPLOY_URL=${value("SAYVE_DEPLOY_URL") || "https://your-domain"}`,
    `APP_ACCESS_TOKEN=${present("APP_ACCESS_TOKEN") ? "<configured>" : "..."}`,
    `ADMIN_CONSOLE_TOKEN=${present("ADMIN_CONSOLE_TOKEN") ? "<configured>" : "..."}`,
    "pnpm run verify:deploy:private-beta"
  ].join(" "),
  strictPrivateBeta: [
    `SAYVE_DEPLOY_URL=${value("SAYVE_DEPLOY_URL") || "https://your-domain"}`,
    `APP_ACCESS_TOKEN=${present("APP_ACCESS_TOKEN") ? "<configured>" : "..."}`,
    `ADMIN_CONSOLE_TOKEN=${present("ADMIN_CONSOLE_TOKEN") ? "<configured>" : "..."}`,
    "SAYVE_TEST_SUPABASE_ACCESS_TOKEN=<owner-session-token>",
    "SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN=<member-session-token>",
    "SAYVE_TEST_VIEWER_SUPABASE_ACCESS_TOKEN=<viewer-session-token>",
    "SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN=<fresh-no-household-session-token>",
    `SAYVE_TEST_HOUSEHOLD_ID=${value("SAYVE_TEST_HOUSEHOLD_ID") || value("SUPABASE_DEFAULT_HOUSEHOLD_ID") || "<household-uuid>"}`,
    "pnpm run verify:deploy:strict-private-beta"
  ].join(" \\\n"),
  strictPrivateBetaProof: [
    "SAYVE_DEPLOY_PROOF_REPORT_PATH=outputs/setup/deploy-proof-report.json",
    `SAYVE_DEPLOY_URL=${value("SAYVE_DEPLOY_URL") || "https://your-domain"}`,
    `APP_ACCESS_TOKEN=${present("APP_ACCESS_TOKEN") ? "<configured>" : "..."}`,
    `ADMIN_CONSOLE_TOKEN=${present("ADMIN_CONSOLE_TOKEN") ? "<configured>" : "..."}`,
    "SAYVE_TEST_SUPABASE_ACCESS_TOKEN=<owner-session-token>",
    "SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN=<member-session-token>",
    "SAYVE_TEST_VIEWER_SUPABASE_ACCESS_TOKEN=<viewer-session-token>",
    "SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN=<fresh-no-household-session-token>",
    `SAYVE_TEST_HOUSEHOLD_ID=${value("SAYVE_TEST_HOUSEHOLD_ID") || value("SUPABASE_DEFAULT_HOUSEHOLD_ID") || "<household-uuid>"}`,
    "pnpm run verify:deploy:strict-private-beta:proof"
  ].join(" \\\n"),
  publicLaunch: [
    `SAYVE_DEPLOY_URL=${value("SAYVE_DEPLOY_URL") || "https://your-domain"}`,
    `APP_ACCESS_TOKEN=${present("APP_ACCESS_TOKEN") ? "<configured>" : "..."}`,
    `ADMIN_CONSOLE_TOKEN=${present("ADMIN_CONSOLE_TOKEN") ? "<configured>" : "..."}`,
    "SAYVE_TEST_SUPABASE_ACCESS_TOKEN=<owner-session-token>",
    "SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN=<member-session-token>",
    "SAYVE_TEST_VIEWER_SUPABASE_ACCESS_TOKEN=<viewer-session-token>",
    "SAYVE_TEST_INVITE_ACCEPT_SUPABASE_ACCESS_TOKEN=<fresh-unjoined-session-token>",
    "SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN=<fresh-no-household-session-token>",
    "SAYVE_TEST_HOUSEHOLD_ID=<household-uuid>",
    "pnpm run verify:deploy:public-launch"
  ].join(" \\\n")
};

const deploySmokeEnvTemplate = [
  "SAYVE_DEPLOY_URL=" + (value("SAYVE_DEPLOY_URL") || "https://your-domain"),
  `APP_ACCESS_TOKEN=${present("APP_ACCESS_TOKEN") ? "<configured>" : "<private-beta-access-token>"}`,
  `ADMIN_CONSOLE_TOKEN=${present("ADMIN_CONSOLE_TOKEN") ? "<configured>" : "<admin-console-token>"}`,
  "SAYVE_REQUIRE_AUTH_SMOKE=1",
  "SAYVE_REQUIRE_TWO_MEMBER_SMOKE=1",
  "SAYVE_REQUIRE_VIEWER_SMOKE=1",
  "SAYVE_REQUIRE_INVITE_SMOKE=1",
  `SAYVE_REQUIRE_INVITE_ACCEPT_SMOKE=${present("SAYVE_TEST_INVITE_ACCEPT_SUPABASE_ACCESS_TOKEN") ? "1" : "0"}`,
  "SAYVE_REQUIRE_BOOTSTRAP_SMOKE=1",
  "SAYVE_REQUIRE_OPENAI_SMOKE=1",
  "SAYVE_REQUIRE_PRIVACY_SMOKE=1",
  `SAYVE_TEST_SUPABASE_ACCESS_TOKEN=${present("SAYVE_TEST_SUPABASE_ACCESS_TOKEN") ? "<configured>" : "<owner-session-token>"}`,
  `SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN=${present("SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN") ? "<configured>" : "<member-session-token>"}`,
  `SAYVE_TEST_VIEWER_SUPABASE_ACCESS_TOKEN=${present("SAYVE_TEST_VIEWER_SUPABASE_ACCESS_TOKEN") ? "<configured>" : "<viewer-session-token>"}`,
  `SAYVE_TEST_INVITE_ACCEPT_SUPABASE_ACCESS_TOKEN=${present("SAYVE_TEST_INVITE_ACCEPT_SUPABASE_ACCESS_TOKEN") ? "<configured>" : "<fresh-unjoined-session-token>"}`,
  `SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN=${present("SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN") ? "<configured>" : "<fresh-no-household-session-token>"}`,
  `SAYVE_TEST_HOUSEHOLD_ID=${value("SAYVE_TEST_HOUSEHOLD_ID") || value("SUPABASE_DEFAULT_HOUSEHOLD_ID") || "<household-uuid>"}`
];

const repositorySmokeGuide = [
  {
    step: 1,
    label: "Call repository smoke endpoint",
    detail: "POST /api/admin/repository/smoke-test after Supabase env and migrations are configured."
  },
  {
    step: 2,
    label: "Send founder token",
    detail: "Use x-admin-token: ADMIN_CONSOLE_TOKEN. Do not use household bearer auth for this founder-only smoke."
  },
  {
    step: 3,
    label: "Target the real household",
    detail: `Send { "householdId": "${value("SUPABASE_DEFAULT_HOUSEHOLD_ID") || "<target-household-id>"}" } so rollout verifies the intended household.`
  },
  {
    step: 4,
    label: "Confirm response health",
    detail:
      "Success should show ok=true plus persistedSnapshot=true, householdExists=true, memberCount>0, ownerCount>0, viewerCount, and onboarding invite counters."
  }
];

const publicLaunchChecks = [
  {
    item: "Smoke proof",
    detail: "Public launch still requires SAYVE_DEPLOYMENT_SMOKE_VERIFIED=1 plus a valid verifiedAt and targetUrl proof."
  },
  {
    item: "Model + media guardrails",
    detail:
      "Pinned AI model envs, AUDIO_TRANSCRIPTION_MAX_BYTES, RECEIPT_VISION_MAX_BYTES, and pricing envs must all be present before public launch."
  },
  {
    item: "Two-member + viewer proof",
    detail: "Public-ready smoke should prove second-member writes, viewer read-only access, and shared-household dashboard/timeline visibility."
  }
];

const liveProofGaps = [
  {
    area: "supabase_schema_security",
    proofType: "external_live_proof",
    proof: present("SUPABASE_SERVICE_ROLE_KEY")
      ? "Supabase live schema/security can be checked once deploy smoke runs."
      : "Real Supabase project migrations and schema checks still need live proof.",
    nextAction: present("SUPABASE_SERVICE_ROLE_KEY")
      ? "Run live schema-check plus deploy smoke against the real project."
      : "Configure Supabase project URL and service-role key first."
  },
  {
    area: "deployment_smoke",
    proofType: "external_live_proof",
    proof: value("SAYVE_DEPLOYMENT_SMOKE_VERIFIED") === "1"
      ? "Deployed Sayve smoke proof has been recorded."
      : "No verified deploy-smoke proof has been recorded for the real app URL yet.",
    nextAction: value("SAYVE_DEPLOYMENT_SMOKE_VERIFIED") === "1"
      ? "Keep the same verifier as regression proof."
      : "Run pnpm run verify:deploy:private-beta on the real deployment."
  },
  {
    area: "shared_household_onboarding",
    proofType: "real_user_proof",
    proof: present("SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN")
      ? "Partner token exists, but shared-household proof still depends on live deploy smoke."
      : "Partner join proof has not been collected yet.",
    nextAction: present("SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN")
      ? "Use the partner token in strict private beta smoke."
      : "Invite partner, let them join, then collect the second-member token."
  },
  {
    area: "bootstrap",
    proofType: "real_user_proof",
    proof: present("SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN")
      ? "Fresh zero-household token is available, but bootstrap proof still depends on live smoke."
      : "Fresh zero-household bootstrap proof has not been prepared yet.",
    nextAction: present("SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN")
      ? "Use the bootstrap token in strict private beta smoke."
      : "Prepare a fresh account that belongs to zero households and collect the token."
  }
];

const onboardingProofSteps = [
  {
    step: 1,
    item: "Founder login proof",
    proof: present("SAYVE_TEST_SUPABASE_ACCESS_TOKEN")
      ? "Founder session token has been collected."
      : "Founder session proof is not collected yet.",
    nextAction: present("SAYVE_TEST_SUPABASE_ACCESS_TOKEN")
      ? "Move to household proof."
      : "Login as founder and collect sayve_access_token."
  },
  {
    step: 2,
    item: "Household proof",
    proof: value("SUPABASE_DEFAULT_HOUSEHOLD_ID")
      ? `Household ${value("SUPABASE_DEFAULT_HOUSEHOLD_ID")} is configured.`
      : "No default household binding is configured yet.",
    nextAction: value("SUPABASE_DEFAULT_HOUSEHOLD_ID")
      ? "Move to partner invite proof."
      : "Create the founder household and record the UUID."
  },
  {
    step: 3,
    item: "Partner invite proof",
    proof: present("SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN")
      ? "Partner token exists, so invite/join proof has at least been prepared."
      : "No partner invite/join proof exists yet.",
    nextAction: present("SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN")
      ? "Move to shared-household proof."
      : "Send partner invite and collect the second-member token after join."
  },
  {
    step: 4,
    item: "Shared-household proof",
    proof: present("SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN") && value("SUPABASE_DEFAULT_HOUSEHOLD_ID")
      ? "Two-member shared-household proof can now be exercised by live smoke."
      : "Shared-household proof still depends on both a household id and partner token.",
    nextAction: present("SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN") && value("SUPABASE_DEFAULT_HOUSEHOLD_ID")
      ? "Run strict private beta smoke."
      : "Complete founder household + partner join first."
  },
  {
    step: 5,
    item: "Bootstrap proof",
    proof: present("SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN")
      ? "Fresh zero-household bootstrap token is ready."
      : "Bootstrap proof still needs a fresh zero-household account.",
    nextAction: present("SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN")
      ? "Keep it for strict private beta smoke."
      : "Create a fresh account and collect its token before first-run household creation."
  }
];

const migrationInventory = getMigrationInventory().map((row) => ({
  version: row.version,
  file: row.file,
  requiredFor: row.requiredFor,
  checksum: row.shortChecksum,
  purpose: row.purpose
}));

const schemaMigrationProof = [
  {
    view: "live_schema_check",
    requiredFor: "private_beta",
    status: present("SUPABASE_SERVICE_ROLE_KEY") ? "ready_for_live_check" : "open",
    recommendedAction: present("SUPABASE_SERVICE_ROLE_KEY")
      ? "Run the live schema/security endpoint and confirm required checks pass."
      : "Configure SUPABASE_SERVICE_ROLE_KEY before attempting live schema/security proof."
  },
  ...migrationInventory
    .filter((row) => row.requiredFor === "private_beta" || row.requiredFor === "public_launch")
    .map((row) => ({
      view: "applied_migration",
      version: row.version,
      file: row.file,
      requiredFor: row.requiredFor,
      checksum: row.checksum,
      status: "pending_live_proof"
    }))
];

const privateBetaConfigReady = envMatrix.filter((row) => row.requiredFor === "private_beta").every((row) => row.status === "ready");

const privateBetaSetupGate = [
  {
    step: 1,
    item: "Supabase project env",
    status:
      value("MEMORY_REPOSITORY") === "supabase" &&
      present("NEXT_PUBLIC_SUPABASE_URL") &&
      present("NEXT_PUBLIC_SUPABASE_ANON_KEY") &&
      present("SUPABASE_SERVICE_ROLE_KEY")
        ? "ready"
        : "open",
    owner: "founder",
    detail: "Set MEMORY_REPOSITORY=supabase plus NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY.",
    source: "Env Setup Matrix"
  },
  {
    step: 2,
    item: "Google OAuth redirect targets",
    status: present("NEXT_PUBLIC_APP_URL") ? "ready" : "open",
    owner: "founder",
    detail: present("NEXT_PUBLIC_APP_URL")
      ? "Use NEXT_PUBLIC_APP_URL and NEXT_PUBLIC_APP_URL/invite in Supabase Auth + Google OAuth allow-list."
      : "Set NEXT_PUBLIC_APP_URL first, then copy root + /invite redirect targets.",
    source: "Auth Setup Targets"
  },
  {
    step: 3,
    item: "Founder household binding",
    status: present("SUPABASE_DEFAULT_HOUSEHOLD_ID") ? "pending" : "open",
    owner: "founder",
    detail: "Create founder household and bind SUPABASE_DEFAULT_HOUSEHOLD_ID before real usage.",
    source: "Default Household Binding"
  },
  {
    step: 4,
    item: "Owner role confirmed",
    status: present("SUPABASE_DEFAULT_HOUSEHOLD_ID") ? "pending" : "open",
    owner: "founder",
    detail: "Attach at least one owner to the founder household before sending invites.",
    source: "Default Household Binding"
  },
  {
    step: 5,
    item: "Partner joined household",
    status: "pending",
    owner: "partner",
    detail: "Invite partner, login with a second Google account, then accept invite into the same household.",
    source: "Onboarding Health / Household Roster View"
  },
  {
    step: 6,
    item: "Smoke tokens collected",
    status:
      present("SAYVE_TEST_SUPABASE_ACCESS_TOKEN") &&
      present("SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN") &&
      (present("SAYVE_TEST_HOUSEHOLD_ID") || present("SUPABASE_DEFAULT_HOUSEHOLD_ID"))
        ? "ready"
        : "open",
    owner: "founder",
    detail:
      present("SAYVE_TEST_SUPABASE_ACCESS_TOKEN") &&
      present("SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN") &&
      (present("SAYVE_TEST_HOUSEHOLD_ID") || present("SUPABASE_DEFAULT_HOUSEHOLD_ID"))
        ? "Owner token, partner token, and household id are available for live smoke."
        : "Collect owner token, partner token, bootstrap token, and household id from browser localStorage.",
    source: "Smoke Token Guide"
  },
  {
    step: 7,
    item: "Private beta launch readiness",
    status: privateBetaConfigReady ? "ready" : "blocked",
    owner: "system",
    detail:
      privateBetaConfigReady
        ? "Current config passes the private beta gate."
        : "Resolve required env/auth blockers before treating rollout as a real private beta.",
    source: "Launch Readiness"
  },
  {
    step: 8,
    item: "Live deployment smoke",
    status: value("SAYVE_DEPLOYMENT_SMOKE_VERIFIED") === "1" ? "ready" : present("SAYVE_DEPLOY_URL") ? "pending" : "open",
    owner: "founder",
    detail: "Run pnpm run verify:deploy:private-beta against the deployed app.",
    source: "Deploy Smoke Guide"
  }
];

const integrationReadiness = [
  {
    system: "supabase",
    stage: "private_beta",
    required: "repository + browser/server keys",
    detail: "Configure repository=supabase plus NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY."
  },
  {
    system: "google_oauth",
    stage: "private_beta",
    required: "site url + root/invite redirects",
    detail: "Copy NEXT_PUBLIC_APP_URL and NEXT_PUBLIC_APP_URL/invite into Supabase Auth and Google OAuth allow-lists."
  },
  {
    system: "vercel",
    stage: "private_beta",
    required: "deploy url + gate/admin tokens",
    detail: "Set SAYVE_DEPLOY_URL, APP_ACCESS_TOKEN, and ADMIN_CONSOLE_TOKEN before live smoke."
  },
  {
    system: "household_onboarding",
    stage: "private_beta",
    required: "founder owner + partner member",
    detail: "Create founder owner household, then invite partner into the same household."
  },
  {
    system: "smoke_tokens",
    stage: "private_beta",
    required: "owner token + partner token + bootstrap token + household id",
    detail: "Collect owner, partner, and fresh zero-household session tokens plus sayve_household_id."
  },
  {
    system: "openai",
    stage: "public_launch",
    required: "api key + pinned models + pricing env",
    detail: "Keep heuristic fallback for private beta, but set OPENAI_API_KEY plus model/pricing env before public launch."
  }
];

const integrationPackage = [
  {
    system: "supabase",
    field: "project_url",
    stage: "private_beta",
    target: "Supabase project / browser env",
    detail: "Maps to NEXT_PUBLIC_SUPABASE_URL."
  },
  {
    system: "supabase",
    field: "anon_key",
    stage: "private_beta",
    target: "Vercel env",
    detail: "Maps to NEXT_PUBLIC_SUPABASE_ANON_KEY."
  },
  {
    system: "supabase",
    field: "service_role_key",
    stage: "private_beta",
    target: "Vercel env / server runtime",
    detail: "Maps to SUPABASE_SERVICE_ROLE_KEY."
  },
  {
    system: "google_oauth",
    field: "site_url",
    stage: "private_beta",
    target: "Supabase Auth Site URL",
    detail: "Use NEXT_PUBLIC_APP_URL."
  },
  {
    system: "google_oauth",
    field: "redirect_invite",
    stage: "private_beta",
    target: "Supabase Auth / Google redirect allow-list",
    detail: "Use NEXT_PUBLIC_APP_URL/invite."
  },
  {
    system: "vercel",
    field: "deploy_url",
    stage: "private_beta",
    target: "Deployment smoke / handoff",
    detail: "Maps to SAYVE_DEPLOY_URL."
  },
  {
    system: "openai",
    field: "api_key",
    stage: "public_launch",
    target: "Vercel env",
    detail: "Required before public launch."
  }
];

const requiredRows = envMatrix.filter((row) => isRequiredForTarget(row.requiredFor));
const readyRequired = requiredRows.filter((row) => row.status === "ready").length;
const openRequiredRows = requiredRows.filter((row) => row.status !== "ready");
const nextActions = openRequiredRows.slice(0, 5).map((row) => `Set ${row.env}: ${row.note}`);
const launchCompletionAudit = [
  {
    requirement: "production_storage_boundary",
    status: "locally_proven",
    evidence: "Memory repository boundary + auth-boundary tests",
    liveProof: "Run real auth mode against deployed Supabase/Vercel runtime.",
    nextAction: value("SAYVE_DEPLOYMENT_SMOKE_VERIFIED") === "1" ? "Keep monitoring live usage." : "Prove on deployed runtime with verify:deploy + real auth/session flow."
  },
  {
    requirement: "supabase_migration_path",
    status: "locally_proven",
    evidence: "schema-check + launch readiness + import validate/dry-run + deploy verifier",
    liveProof: "Apply migrations 001-012 to the real Supabase project and pass the live schema/security endpoint.",
    nextAction: "Run /api/admin/import/supabase/schema-check against the deployed app."
  },
  {
    requirement: "ai_telemetry_admin_monitoring",
    status: "locally_proven",
    evidence: "Founder Console telemetry views, completeness gates, import/export validation, telemetry tests",
    liveProof: "Observe real deployed OpenAI token/cost/latency data in /admin.",
    nextAction: present("OPENAI_API_KEY") ? "Create a real capture and ask flow on deployed infra, then confirm telemetry appears." : "Configure OPENAI_API_KEY plus pinned model/pricing env before public launch proof."
  },
  {
    requirement: "core_api_stability",
    status: "locally_proven",
    evidence: "API contract tests + deploy verifier coverage for capture/dashboard/timeline/detail/sources/insights/privacy/onboarding",
    liveProof: "Run verify:deploy against the real URL and confirm all smoke checks pass.",
    nextAction: value("SAYVE_DEPLOYMENT_SMOKE_VERIFIED") === "1" ? "Keep using the same verifier for regression proof." : "Run pnpm run verify:deploy:private-beta on the real deployment."
  },
  {
    requirement: "test_and_deploy_preparation",
    status: target === "public-launch" ? "config_ready_live_proof_pending" : "locally_proven",
    evidence: "package scripts + vercel config + CI + setup artifacts + env templates + founder handoff bundles",
    liveProof: "Deploy latest build, collect owner/member/viewer/bootstrap tokens, then rerun deploy smoke.",
    nextAction: value("SAYVE_DEPLOYMENT_SMOKE_VERIFIED") === "1" ? "Mark smoke proof envs after public-launch smoke passes." : "Collect live tokens and finish deployment smoke."
  }
];

const launchBlockers = [
  ...openRequiredRows.map((row) => ({
    level: row.requiredFor === "public_launch" ? "warn" : "critical",
    area: row.group,
    blocker: `Set ${row.env}`,
    detail: row.note,
    status: row.status,
    requiredFor: row.requiredFor
  })),
  ...(value("SAYVE_DEPLOYMENT_SMOKE_VERIFIED") === "1"
    ? []
    : [
        {
          level: "warn",
          area: "deploy_smoke",
          blocker: "Live deployment smoke is not verified",
          detail: "Run pnpm run verify:deploy:private-beta on the real deployment and record the smoke proof envs.",
          status: "open",
          requiredFor: "public_launch"
        }
      ])
].slice(0, 8);

const report = {
  target,
  generatedAt: new Date().toISOString(),
  summary: {
    requiredReady: readyRequired,
    requiredTotal: requiredRows.length,
    openRequired: openRequiredRows.length,
    optionalOpen: envMatrix.filter((row) => row.status === "optional").length,
    deploySmokeReady: Boolean(value("SAYVE_DEPLOY_URL") && value("APP_ACCESS_TOKEN") && value("ADMIN_CONSOLE_TOKEN"))
  },
  app: {
    appBaseUrl: value("NEXT_PUBLIC_APP_URL"),
    deployUrl: value("SAYVE_DEPLOY_URL"),
    repositoryMode: value("MEMORY_REPOSITORY") || "local_file"
  },
  authTargets: {
    siteUrl: value("NEXT_PUBLIC_APP_URL"),
    rootRedirect: value("NEXT_PUBLIC_APP_URL"),
    inviteRedirect: value("NEXT_PUBLIC_APP_URL") ? `${value("NEXT_PUBLIC_APP_URL")}/invite` : ""
  },
  commands: deploymentCommands,
  copyPasteEnvTemplate,
  deploymentEnvTemplate,
  deploySmokeEnvTemplate,
  repositorySmokeGuide,
  publicLaunchChecks,
  migrationInventory,
  privateBetaSetupGate,
  integrationReadiness,
  integrationPackage,
  googleOAuthChecklist,
  launchCompletionAudit,
  liveProofGaps,
  onboardingProofSteps,
  launchBlockers,
  schemaMigrationProof,
  nextActions,
  envMatrix,
  smokeTokenGuide: [
    {
      role: "owner",
      env: "SAYVE_TEST_SUPABASE_ACCESS_TOKEN",
      where: `${value("NEXT_PUBLIC_APP_URL") || "https://your-domain"}?access_token=APP_ACCESS_TOKEN`,
      action: "Login as founder/owner, then copy sayve_access_token from browser localStorage.",
      extra: "Copy sayve_household_id from the same browser for SAYVE_TEST_HOUSEHOLD_ID."
    },
    {
      role: "partner",
      env: "SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN",
      where: `${value("NEXT_PUBLIC_APP_URL") || "https://your-domain"}/invite?token=<invite-token>`,
      action: "Use a second browser profile, login as partner, accept invite, then copy sayve_access_token.",
      extra: "Confirm the same household is selected before using the token."
    },
    {
      role: "viewer",
      env: "SAYVE_TEST_VIEWER_SUPABASE_ACCESS_TOKEN",
      where: `${value("NEXT_PUBLIC_APP_URL") || "https://your-domain"}/invite?token=<viewer-invite-token>`,
      action: "Create a viewer invite, login in a clean browser profile, accept invite, then copy sayve_access_token.",
      extra: "Viewer smoke expects reads to pass and writes to fail."
    },
    {
      role: "fresh_unjoined",
      env: "SAYVE_TEST_INVITE_ACCEPT_SUPABASE_ACCESS_TOKEN",
      where: `${value("NEXT_PUBLIC_APP_URL") || "https://your-domain"}/invite?token=<fresh-invite-token>`,
      action: "Login with an account not yet in the household, copy sayve_access_token before pressing join.",
      extra: "Only needed when smoke should prove live invite acceptance."
    },
    {
      role: "fresh_no_household",
      env: "SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN",
      where: `${value("NEXT_PUBLIC_APP_URL") || "https://your-domain"}?access_token=APP_ACCESS_TOKEN`,
      action: "Login with a fresh account that belongs to zero households, copy sayve_access_token before first-run initialization creates a household.",
      extra: "Use this to prove /api/households/bootstrap can create the first owner household on a real deployment."
    }
  ]
};

console.log(JSON.stringify(report, null, 2));
