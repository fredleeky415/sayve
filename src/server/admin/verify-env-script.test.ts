import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = join(process.cwd(), "scripts", "verify-env.mjs");
const deploymentScriptPath = join(process.cwd(), "scripts", "verify-deployment.mjs");
const founderSetupReportScriptPath = join(process.cwd(), "scripts", "founder-setup-report.mjs");

function runVerifyEnv(env: Record<string, string | undefined>) {
  return spawnSync(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH ?? "",
      NODE_ENV: "test",
      ...env
    },
    encoding: "utf8"
  });
}

function runVerifyDeployment(env: Record<string, string | undefined>) {
  return spawnSync(process.execPath, [deploymentScriptPath], {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH ?? "",
      NODE_ENV: "test",
      ADMIN_CONSOLE_TOKEN: "admin_console_access_32_chars_123",
      APP_ACCESS_TOKEN: "private_beta_access_32_chars_123456",
      ...env
    },
    encoding: "utf8"
  });
}

function runFounderSetupReport(env: Record<string, string | undefined>) {
  return spawnSync(process.execPath, [founderSetupReportScriptPath], {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH ?? "",
      NODE_ENV: "test",
      ...env
    },
    encoding: "utf8"
  });
}

function privateBetaEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    SAYVE_ENV_TARGET: "private-beta",
    MEMORY_REPOSITORY: "supabase",
    NEXT_PUBLIC_APP_URL: "https://sayve.app",
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    SUPABASE_DEFAULT_HOUSEHOLD_ID: "00000000-0000-0000-0000-000000000001",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_AUTH_REQUIRED: "1",
    APP_ACCESS_TOKEN: "private_beta_access_32_chars_123456",
    ADMIN_CONSOLE_TOKEN: "admin_console_access_32_chars_123",
    PROTOTYPE_USAGE_LIMITS_DISABLED: "0",
    ...overrides
  };
}

describe("verify-env script", () => {
  it("keeps local advisor artifacts out of the production deployment boundary", () => {
    const gitignore = readFileSync(join(process.cwd(), ".gitignore"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");

    expect(gitignore).toContain("outputs");
    expect(readme).toContain("Local advisor artifacts");
    expect(readme).toContain("sayve-manifesto-mechanics-ui.pdf");
    expect(readme).toContain("not production app assets");
    expect(audit).toContain("git-ignored `outputs/`");
  });

  it("passes local preflight without production credentials", () => {
    const result = runVerifyEnv({ SAYVE_ENV_TARGET: "local" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Sayve env preflight passed for local.");
  });

  it("can output a redacted founder setup report without leaking secrets", () => {
    const result = runFounderSetupReport({
      SAYVE_ENV_TARGET: "private-beta",
      NEXT_PUBLIC_APP_URL: "https://sayve.app",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-secret-value",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-secret-value",
      APP_ACCESS_TOKEN: "private_beta_access_32_chars_123456",
      ADMIN_CONSOLE_TOKEN: "admin_console_access_32_chars_123"
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"target": "private-beta"');
    expect(result.stdout).toContain('"env": "APP_ACCESS_TOKEN"');
    expect(result.stdout).toContain('"value": "configured"');
    expect(result.stdout).not.toContain("private_beta_access_32_chars_123456");
    expect(result.stdout).not.toContain("service-role-secret-value");
    expect(result.stdout).toContain('"rootRedirect": "https://sayve.app"');
    expect(result.stdout).toContain('"inviteRedirect": "https://sayve.app/invite"');
    expect(result.stdout).toContain('"summary"');
    expect(result.stdout).toContain('"nextActions"');
    expect(result.stdout).toContain('"copyPasteEnvTemplate"');
    expect(result.stdout).toContain('"deploymentEnvTemplate"');
    expect(result.stdout).toContain('"googleOAuthChecklist"');
    expect(result.stdout).toContain('"launchBlockers"');
    expect(result.stdout).toContain('"commands"');
    expect(result.stdout).toContain('"privateBeta"');
    expect(result.stdout).toContain('pnpm run verify:deploy:private-beta');
    expect(result.stdout).toContain('pnpm run verify:deploy:strict-private-beta:proof');
    expect(result.stdout).toContain('pnpm run verify:deploy:public-launch');
    expect(result.stdout).toContain('"Add invite redirect allow-list entry"');
    expect(result.stdout).toContain('"NEXT_PUBLIC_APP_URL=https://sayve.app"');
  });

  it("fails private beta when the Founder Console token is missing", () => {
    const result = runVerifyEnv(privateBetaEnv({ ADMIN_CONSOLE_TOKEN: undefined }));

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("ADMIN_CONSOLE_TOKEN is required");
  });

  it("fails private beta when browser Supabase URL is missing", () => {
    const result = runVerifyEnv(privateBetaEnv({ NEXT_PUBLIC_SUPABASE_URL: undefined, SUPABASE_URL: "https://server-only.supabase.co" }));

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("NEXT_PUBLIC_SUPABASE_URL is required");
    expect(result.stderr).toContain("Browser and future mobile clients need the public Supabase project URL for Auth");
  });

  it("warns locally when NEXT_PUBLIC_APP_URL is missing and fails private beta without it", () => {
    const local = runVerifyEnv({ SAYVE_ENV_TARGET: "local" });
    expect(local.status).toBe(0);
    expect(local.stderr).toContain("NEXT_PUBLIC_APP_URL is not configured");

    const beta = runVerifyEnv(privateBetaEnv({ NEXT_PUBLIC_APP_URL: undefined }));
    expect(beta.status).not.toBe(0);
    expect(beta.stderr).toContain("NEXT_PUBLIC_APP_URL is required");
    expect(beta.stderr).toContain("Google OAuth, magic links, and invite acceptance");
  });

  it("fails when NEXT_PUBLIC_APP_URL is invalid", () => {
    const result = runVerifyEnv(privateBetaEnv({ NEXT_PUBLIC_APP_URL: "not-a-url" }));

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("NEXT_PUBLIC_APP_URL must be a valid URL");
  });

  it("fails private beta when browser auth and server storage point to different Supabase projects", () => {
    const result = runVerifyEnv(
      privateBetaEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://browser-project.supabase.co",
        SUPABASE_URL: "https://server-project.supabase.co"
      })
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_URL must point to the same Supabase project host");
    expect(result.stderr).toContain("browser-project.supabase.co");
    expect(result.stderr).toContain("server-project.supabase.co");
  });

  it("fails private beta when Supabase service role and browser anon keys are not separated", () => {
    const reused = runVerifyEnv(
      privateBetaEnv({
        SUPABASE_SERVICE_ROLE_KEY: "same-supabase-key",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "same-supabase-key"
      })
    );

    expect(reused.status).not.toBe(0);
    expect(reused.stderr).toContain("SUPABASE_SERVICE_ROLE_KEY must be different from NEXT_PUBLIC_SUPABASE_ANON_KEY");

    const publishable = runVerifyEnv(
      privateBetaEnv({
        SUPABASE_SERVICE_ROLE_KEY: "sb_publishable_wrong_server_key"
      })
    );

    expect(publishable.status).not.toBe(0);
    expect(publishable.stderr).toContain("SUPABASE_SERVICE_ROLE_KEY must be a service-role/secret key");
  });

  it("fails private beta when admin/private-beta tokens are weak or reused", () => {
    const weak = runVerifyEnv(privateBetaEnv({ APP_ACCESS_TOKEN: "private-beta-token", ADMIN_CONSOLE_TOKEN: "secret" }));
    expect(weak.status).not.toBe(0);
    expect(weak.stderr).toContain("APP_ACCESS_TOKEN must be at least 24 characters");
    expect(weak.stderr).toContain("ADMIN_CONSOLE_TOKEN must be at least 24 characters");

    const reused = runVerifyEnv(
      privateBetaEnv({
        APP_ACCESS_TOKEN: "same_strong_access_value_123456",
        ADMIN_CONSOLE_TOKEN: "same_strong_access_value_123456"
      })
    );
    expect(reused.status).not.toBe(0);
    expect(reused.stderr).toContain("APP_ACCESS_TOKEN and ADMIN_CONSOLE_TOKEN must be different values");
  });

  it("keeps deployment verifier guarded against weak or reused tokens", () => {
    const deploymentVerifier = readFileSync(join(process.cwd(), "scripts", "verify-deployment.mjs"), "utf8");

    expect(deploymentVerifier).toContain("verifySecretInputs");
    expect(deploymentVerifier).toContain("must be at least 24 characters");
    expect(deploymentVerifier).toContain("APP_ACCESS_TOKEN and ADMIN_CONSOLE_TOKEN must be different values");
  });

  it("keeps admin API auth away from query-string tokens", () => {
    const adminHttp = readFileSync(join(process.cwd(), "src", "server", "admin", "http.ts"), "utf8");

    expect(adminHttp).toContain("x-admin-token");
    expect(adminHttp).toContain("ADMIN_COOKIE");
    expect(adminHttp).not.toContain('searchParams.get("token")');
  });

  it("keeps private beta API access away from query-string tokens", () => {
    const middleware = readFileSync(join(process.cwd(), "src", "middleware.ts"), "utf8");
    const middlewareTest = readFileSync(join(process.cwd(), "src", "middleware.test.ts"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");

    expect(middleware).toContain("(isApi ? undefined : request.nextUrl.searchParams.get(\"access_token\"))");
    expect(middlewareTest).toContain("rejects API access_token query strings");
    expect(readme).toContain("API routes do not accept `access_token` query strings");
    expect(audit).toContain("API routes reject `access_token` query strings");
  });

  it("requires public launch smoke verification and pricing env", () => {
    const result = runVerifyEnv({
      ...privateBetaEnv(),
      SAYVE_ENV_TARGET: "public-launch",
      OPENAI_API_KEY: "openai-key"
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("SAYVE_DEPLOYMENT_SMOKE_VERIFIED is required");
    expect(result.stderr).toContain("OPENAI_CAPTURE_MODEL is required");
    expect(result.stderr).toContain("OPENAI_ESCALATION_MODEL is required");
    expect(result.stderr).toContain("OPENAI_CAPTURE_INPUT_USD_PER_1M is required");
    expect(result.stderr).toContain("RECEIPT_UPLOAD_MAX_BYTES is required");
    expect(result.stderr).toContain("VOICE_UPLOAD_MAX_BYTES is required");
  });

  it("requires valid smoke proof metadata when the deployment smoke marker is set", () => {
    const missing = runVerifyEnv(
      privateBetaEnv({
        SAYVE_DEPLOYMENT_SMOKE_VERIFIED: "1"
      })
    );

    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain("SAYVE_DEPLOYMENT_SMOKE_VERIFIED_AT is required");
    expect(missing.stderr).toContain("SAYVE_DEPLOYMENT_SMOKE_TARGET is required");

    const invalid = runVerifyEnv(
      privateBetaEnv({
        SAYVE_DEPLOYMENT_SMOKE_VERIFIED: "1",
        SAYVE_DEPLOYMENT_SMOKE_VERIFIED_AT: "not-a-date",
        SAYVE_DEPLOYMENT_SMOKE_TARGET: "not-a-url"
      })
    );

    expect(invalid.status).not.toBe(0);
    expect(invalid.stderr).toContain("SAYVE_DEPLOYMENT_SMOKE_VERIFIED_AT must be a valid ISO timestamp");
    expect(invalid.stderr).toContain("SAYVE_DEPLOYMENT_SMOKE_TARGET must be a valid URL");

    const mismatch = runVerifyEnv(
      privateBetaEnv({
        SAYVE_DEPLOYMENT_SMOKE_VERIFIED: "1",
        SAYVE_DEPLOYMENT_SMOKE_VERIFIED_AT: "2026-07-10T02:00:00.000Z",
        SAYVE_DEPLOYMENT_SMOKE_TARGET: "https://preview.sayve.app"
      })
    );

    expect(mismatch.status).not.toBe(0);
    expect(mismatch.stderr).toContain("SAYVE_DEPLOYMENT_SMOKE_TARGET should match NEXT_PUBLIC_APP_URL host");
  });

  it("rejects invalid receipt or voice upload byte limits", () => {
    const result = runVerifyEnv(
      privateBetaEnv({
        SUPABASE_MEDIA_BUCKET: "sayve-capture-media",
        RECEIPT_UPLOAD_MAX_BYTES: "0",
        VOICE_UPLOAD_MAX_BYTES: "not-a-number"
      })
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("RECEIPT_UPLOAD_MAX_BYTES must be a positive integer byte count");
    expect(result.stderr).toContain("VOICE_UPLOAD_MAX_BYTES must be a positive integer byte count");
  });

  it("requires explicit receipt and voice upload limits when media storage is required", () => {
    const result = runVerifyEnv(
      privateBetaEnv({
        SAYVE_REQUIRE_MEDIA_STORAGE: "1",
        SUPABASE_MEDIA_BUCKET: "sayve-capture-media"
      })
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("RECEIPT_UPLOAD_MAX_BYTES is required");
    expect(result.stderr).toContain("VOICE_UPLOAD_MAX_BYTES is required");
  });

  it("requires pinned model env values when private beta enables OpenAI", () => {
    const missingModels = runVerifyEnv(
      privateBetaEnv({
        OPENAI_API_KEY: "openai-key"
      })
    );

    expect(missingModels.status).not.toBe(0);
    expect(missingModels.stderr).toContain("OPENAI_CAPTURE_MODEL is required");
    expect(missingModels.stderr).toContain("OPENAI_CAPTURE_MAX_OUTPUT_TOKENS is required");
    expect(missingModels.stderr).toContain("OPENAI_ESCALATION_MODEL is required");
    expect(missingModels.stderr).toContain("Pin AI model names and output budgets whenever OpenAI is enabled");

    const configured = runVerifyEnv(
      privateBetaEnv({
        OPENAI_API_KEY: "openai-key",
        OPENAI_CAPTURE_MODEL: "gpt-test-capture",
        OPENAI_CAPTURE_MAX_OUTPUT_TOKENS: "220",
        OPENAI_CONVERSATION_MODEL: "gpt-test-conversation",
        OPENAI_CONVERSATION_MAX_OUTPUT_TOKENS: "120",
        OPENAI_ESCALATION_MODEL: "gpt-test-escalation",
        OPENAI_RECEIPT_VISION_MODEL: "gpt-test-vision",
        OPENAI_SPEECH_TO_TEXT_MODEL: "gpt-test-transcribe",
        AUDIO_TRANSCRIPTION_MAX_BYTES: "25000000",
        RECEIPT_VISION_MAX_BYTES: "8000000"
      })
    );

    expect(configured.status).toBe(0);
  });

  it("requires valid positive integer AI output budgets when OpenAI is enabled", () => {
    const invalid = runVerifyEnv(
      privateBetaEnv({
        OPENAI_API_KEY: "openai-key",
        OPENAI_CAPTURE_MODEL: "gpt-test-capture",
        OPENAI_CAPTURE_MAX_OUTPUT_TOKENS: "0",
        OPENAI_CONVERSATION_MODEL: "gpt-test-conversation",
        OPENAI_CONVERSATION_MAX_OUTPUT_TOKENS: "-5",
        OPENAI_ESCALATION_MODEL: "gpt-test-escalation",
        OPENAI_RECEIPT_VISION_MODEL: "gpt-test-vision",
        OPENAI_SPEECH_TO_TEXT_MODEL: "gpt-test-transcribe",
        AUDIO_TRANSCRIPTION_MAX_BYTES: "25000000",
        RECEIPT_VISION_MAX_BYTES: "8000000"
      })
    );

    expect(invalid.status).not.toBe(0);
    expect(invalid.stderr).toContain("OPENAI_CAPTURE_MAX_OUTPUT_TOKENS must be a positive integer token budget.");
    expect(invalid.stderr).toContain("OPENAI_CONVERSATION_MAX_OUTPUT_TOKENS must be a positive integer token budget.");
  });

  it("requires AI media byte guardrails when private beta enables OpenAI", () => {
    const missingLimits = runVerifyEnv(
      privateBetaEnv({
        OPENAI_API_KEY: "openai-key",
        OPENAI_CAPTURE_MODEL: "gpt-test-capture",
        OPENAI_CAPTURE_MAX_OUTPUT_TOKENS: "220",
        OPENAI_CONVERSATION_MODEL: "gpt-test-conversation",
        OPENAI_CONVERSATION_MAX_OUTPUT_TOKENS: "120",
        OPENAI_ESCALATION_MODEL: "gpt-test-escalation",
        OPENAI_RECEIPT_VISION_MODEL: "gpt-test-vision",
        OPENAI_SPEECH_TO_TEXT_MODEL: "gpt-test-transcribe"
      })
    );

    expect(missingLimits.status).not.toBe(0);
    expect(missingLimits.stderr).toContain("AUDIO_TRANSCRIPTION_MAX_BYTES is required");
    expect(missingLimits.stderr).toContain("RECEIPT_VISION_MAX_BYTES is required");

    const configured = runVerifyEnv(
      privateBetaEnv({
        OPENAI_API_KEY: "openai-key",
        OPENAI_CAPTURE_MODEL: "gpt-test-capture",
        OPENAI_CAPTURE_MAX_OUTPUT_TOKENS: "220",
        OPENAI_CONVERSATION_MODEL: "gpt-test-conversation",
        OPENAI_CONVERSATION_MAX_OUTPUT_TOKENS: "120",
        OPENAI_ESCALATION_MODEL: "gpt-test-escalation",
        OPENAI_RECEIPT_VISION_MODEL: "gpt-test-vision",
        OPENAI_SPEECH_TO_TEXT_MODEL: "gpt-test-transcribe",
        AUDIO_TRANSCRIPTION_MAX_BYTES: "25000000",
        RECEIPT_VISION_MAX_BYTES: "8000000"
      })
    );

    expect(configured.status).toBe(0);
  });

  it("keeps public-launch setup artifacts aligned with speech model default and AI media guardrails", () => {
    const envExample = readFileSync(join(process.cwd(), ".env.example"), "utf8");
    const publicLaunchExample = readFileSync(join(process.cwd(), ".env.public-launch.example"), "utf8");
    const setupSpec = readFileSync(join(process.cwd(), "src", "shared", "setup-artifacts-spec.json"), "utf8");
    const runbook = readFileSync(join(process.cwd(), "docs", "deployment-runbook.md"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const launchReadiness = readFileSync(join(process.cwd(), "src", "server", "admin", "launch-readiness.ts"), "utf8");
    const deploymentVerifier = readFileSync(join(process.cwd(), "scripts", "verify-deployment.mjs"), "utf8");

    for (const content of [envExample, publicLaunchExample, setupSpec, runbook, readme]) {
      expect(content).toContain("OPENAI_SPEECH_TO_TEXT_MODEL");
      expect(content).toContain("OPENAI_CAPTURE_MAX_OUTPUT_TOKENS");
      expect(content).toContain("OPENAI_CONVERSATION_MAX_OUTPUT_TOKENS");
      expect(content).toContain("AUDIO_TRANSCRIPTION_MAX_BYTES");
      expect(content).toContain("RECEIPT_VISION_MAX_BYTES");
    }
    expect(publicLaunchExample).toContain("OPENAI_SPEECH_TO_TEXT_MODEL=gpt-4o-mini-transcribe");
    expect(setupSpec).toContain('"fallback": "gpt-4o-mini-transcribe"');
    expect(launchReadiness).toContain('id: "ai_media_limits"');
    expect(deploymentVerifier).toContain('"ai_media_limits"');
  });

  it("keeps viewer read-only deployment smoke documented and configurable", () => {
    const deploymentVerifier = readFileSync(join(process.cwd(), "scripts", "verify-deployment.mjs"), "utf8");
    const envExample = readFileSync(join(process.cwd(), ".env.example"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const runbook = readFileSync(join(process.cwd(), "docs", "deployment-runbook.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");

    for (const content of [deploymentVerifier, envExample, readme, runbook]) {
      expect(content).toContain("SAYVE_REQUIRE_VIEWER_SMOKE");
      expect(content).toContain("SAYVE_TEST_VIEWER_SUPABASE_ACCESS_TOKEN");
    }
    expect(deploymentVerifier).toContain('const requireViewerSmoke = process.env.SAYVE_REQUIRE_VIEWER_SMOKE === "1" || requirePublicReady');
    expect(deploymentVerifier).toContain("viewer capture write denied");
    expect(readme).toContain("viewer read-only");
    expect(runbook).toContain("viewer test user can list the household and read dashboard");
    expect(audit).toContain("public-ready smoke enforces");
  });

  it("keeps deployment smoke checking founder onboarding health after invite creation", () => {
    const deploymentVerifier = readFileSync(join(process.cwd(), "scripts", "verify-deployment.mjs"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const runbook = readFileSync(join(process.cwd(), "docs", "deployment-runbook.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");

    expect(deploymentVerifier).toContain("onboardingHealth");
    expect(deploymentVerifier).toContain("emailLockedInvites");
    expect(deploymentVerifier).toContain("founder onboarding health reflects pending email-locked invite");
    expect(deploymentVerifier).toContain("founder onboarding health reflects product invite");
    for (const content of [readme, runbook, audit]) {
      expect(content).toContain("Onboarding Health");
      expect(content).toContain("email-locked");
    }
  });

  it("keeps launch readiness checking founder onboarding health visibility", () => {
    const launchReadiness = readFileSync(join(process.cwd(), "src", "server", "admin", "launch-readiness.ts"), "utf8");
    const launchReadinessTest = readFileSync(join(process.cwd(), "src", "server", "admin", "launch-readiness.test.ts"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");

    expect(launchReadiness).toContain("onboardingHealthReadinessCheck");
    expect(launchReadiness).toContain('id: "onboarding_health"');
    expect(launchReadiness).toContain('id: "app_base_url"');
    expect(launchReadinessTest).toContain("fails public launch readiness when founder onboarding health is missing");
    expect(readme).toContain("Onboarding Health");
    expect(audit).toContain("onboarding health");
  });

  it("keeps two-member deployment smoke required for public-ready verification", () => {
    const deploymentVerifier = readFileSync(join(process.cwd(), "scripts", "verify-deployment.mjs"), "utf8");
    const envExample = readFileSync(join(process.cwd(), ".env.example"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const runbook = readFileSync(join(process.cwd(), "docs", "deployment-runbook.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");

    for (const content of [deploymentVerifier, envExample, readme, runbook]) {
      expect(content).toContain("SAYVE_REQUIRE_TWO_MEMBER_SMOKE");
      expect(content).toContain("SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN");
    }
    expect(deploymentVerifier).toContain('const requireTwoMemberSmoke = process.env.SAYVE_REQUIRE_TWO_MEMBER_SMOKE === "1" || requirePublicReady');
    expect(deploymentVerifier).toContain("Two-member household smoke is required for public-ready verification");
    expect(readme).toContain("second member");
    expect(runbook).toContain("second test user");
    expect(audit).toContain("public-ready smoke enforces");
  });

  it("keeps partner invite deployment smoke documented and configurable", () => {
    const deploymentVerifier = readFileSync(join(process.cwd(), "scripts", "verify-deployment.mjs"), "utf8");
    const envExample = readFileSync(join(process.cwd(), ".env.example"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const runbook = readFileSync(join(process.cwd(), "docs", "deployment-runbook.md"), "utf8");

    for (const content of [deploymentVerifier, envExample, readme, runbook]) {
      expect(content).toContain("SAYVE_REQUIRE_INVITE_SMOKE");
    }
    expect(deploymentVerifier).toContain("partner invite link smoke ok");
    expect(deploymentVerifier).toContain("privateBetaInviteUrl");
    expect(deploymentVerifier).toContain("no-store");
    expect(runbook).toContain("partner invite link generation");
  });

  it("keeps first-run bootstrap smoke documented and deployment-gated", () => {
    const deploymentVerifier = readFileSync(join(process.cwd(), "scripts", "verify-deployment.mjs"), "utf8");
    const envExample = readFileSync(join(process.cwd(), ".env.example"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const runbook = readFileSync(join(process.cwd(), "docs", "deployment-runbook.md"), "utf8");
    const checklist = readFileSync(join(process.cwd(), "docs", "private-beta-launch-checklist.md"), "utf8");

    for (const content of [deploymentVerifier, envExample, readme, runbook, checklist]) {
      expect(content).toContain("SAYVE_REQUIRE_BOOTSTRAP_SMOKE");
      expect(content).toContain("SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN");
    }
    expect(deploymentVerifier).toContain("verifyBootstrapSmoke");
    expect(deploymentVerifier).toContain("/api/households/bootstrap");
    expect(deploymentVerifier).toContain("create the first household");
    expect(deploymentVerifier).toContain("bootstrap household smoke ok");
    expect(deploymentVerifier).toContain("smokeTokenGuide is missing bootstrap token instructions");
    expect(deploymentVerifier).toContain("SAYVE_REQUIRE_BOOTSTRAP_SMOKE=1");
    expect(deploymentVerifier).toContain("SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN=");
    expect(readme).toContain("first-run household bootstrap");
    expect(runbook).toContain("freshly logged-in Supabase user with zero households");
    expect(checklist).toContain("fresh-no-household-session-token");
    expect(checklist).toContain("zero households can finish first-run bootstrap");
  });

  it("keeps migration 006 invite hardening documented and deployment-gated", () => {
    const migrationVerifier = readFileSync(join(process.cwd(), "scripts", "verify-migrations.mjs"), "utf8");
    const deploymentVerifier = readFileSync(join(process.cwd(), "scripts", "verify-deployment.mjs"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const runbook = readFileSync(join(process.cwd(), "docs", "deployment-runbook.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");

    for (const content of [migrationVerifier, readme, runbook, audit]) {
      expect(content).toContain("006");
    }
    for (const content of [deploymentVerifier, readme, runbook, audit]) {
      expect(content).toContain("invites_service_role_only");
    }
    expect(migrationVerifier).toContain("006_harden_invite_access.sql");
    expect(migrationVerifier).toContain("sayve_invite_policy_count");
    expect(deploymentVerifier).toContain("Supabase invite policy hardening ok");
    expect(runbook).toContain("supabase/migrations/006_harden_invite_access.sql");
  });

  it("keeps migration 007 interpretation writer hardening documented and deployment-gated", () => {
    const migrationVerifier = readFileSync(join(process.cwd(), "scripts", "verify-migrations.mjs"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const runbook = readFileSync(join(process.cwd(), "docs", "deployment-runbook.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");
    const schemaCheck = readFileSync(join(process.cwd(), "src", "server", "memory", "supabase-schema-check.ts"), "utf8");

    for (const content of [migrationVerifier, readme, runbook, audit]) {
      expect(content).toContain("007");
    }
    expect(migrationVerifier).toContain("007_harden_memory_interpretation_writer_policy.sql");
    expect(migrationVerifier).toContain("writer_insert_memory_interpretations");
    expect(schemaCheck).toContain("writerPolicyCount >= 11");
    expect(schemaCheck).toContain("interpretationWriterPolicyCount");
    expect(runbook).toContain("supabase/migrations/007_harden_memory_interpretation_writer_policy.sql");
  });

  it("keeps migration 008 atomic invite acceptance documented and deployment-gated", () => {
    const migrationVerifier = readFileSync(join(process.cwd(), "scripts", "verify-migrations.mjs"), "utf8");
    const deploymentVerifier = readFileSync(join(process.cwd(), "scripts", "verify-deployment.mjs"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const runbook = readFileSync(join(process.cwd(), "docs", "deployment-runbook.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");
    const schemaCheck = readFileSync(join(process.cwd(), "src", "server", "memory", "supabase-schema-check.ts"), "utf8");

    for (const content of [migrationVerifier, readme, runbook, audit]) {
      expect(content).toContain("008");
    }
    for (const content of [deploymentVerifier, readme, runbook, audit, schemaCheck]) {
      expect(content).toContain("invites_atomic_acceptance");
    }
    expect(migrationVerifier).toContain("008_atomic_invite_acceptance.sql");
    expect(migrationVerifier).toContain("sayve_accept_household_invite");
    expect(schemaCheck).toContain("acceptFunctionCount");
    expect(runbook).toContain("supabase/migrations/008_atomic_invite_acceptance.sql");
  });

  it("keeps migration 009 revision actor attribution documented and schema-gated", () => {
    const migrationVerifier = readFileSync(join(process.cwd(), "scripts", "verify-migrations.mjs"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const runbook = readFileSync(join(process.cwd(), "docs", "deployment-runbook.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");
    const schemaCheck = readFileSync(join(process.cwd(), "src", "server", "memory", "supabase-schema-check.ts"), "utf8");

    for (const content of [migrationVerifier, readme, runbook, audit]) {
      expect(content).toContain("009");
      expect(content).toContain("actor_user_id");
    }
    expect(migrationVerifier).toContain("009_revision_actor_attribution.sql");
    expect(migrationVerifier).toContain("memory_revisions_actor_user_idx");
    expect(schemaCheck).toContain("actor_user_id");
    expect(runbook).toContain("supabase/migrations/009_revision_actor_attribution.sql");
  });

  it("keeps migration 010 category actor attribution documented and schema-gated", () => {
    const migrationVerifier = readFileSync(join(process.cwd(), "scripts", "verify-migrations.mjs"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const runbook = readFileSync(join(process.cwd(), "docs", "deployment-runbook.md"), "utf8");
    const checklist = readFileSync(join(process.cwd(), "docs", "private-beta-launch-checklist.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");
    const schemaCheck = readFileSync(join(process.cwd(), "src", "server", "memory", "supabase-schema-check.ts"), "utf8");
    const exportPlan = readFileSync(join(process.cwd(), "src", "server", "memory", "supabase-export.ts"), "utf8");
    const importValidator = readFileSync(join(process.cwd(), "src", "server", "memory", "supabase-import-validator.ts"), "utf8");

    for (const content of [migrationVerifier, readme, runbook, checklist, audit]) {
      expect(content).toContain("010");
      expect(content).toContain("created_by_user_id");
    }
    expect(migrationVerifier).toContain("010_category_actor_attribution.sql");
    expect(migrationVerifier).toContain("household_categories_created_by_user_idx");
    expect(schemaCheck).toContain("created_by_user_id");
    expect(exportPlan).toContain("created_by_user_id");
    expect(importValidator).toContain("created_by_user_id");
    expect(runbook).toContain("supabase/migrations/010_category_actor_attribution.sql");
  });

  it("keeps migration 011 memory fact payload constraints documented and deployment-gated", () => {
    const migrationVerifier = readFileSync(join(process.cwd(), "scripts", "verify-migrations.mjs"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const runbook = readFileSync(join(process.cwd(), "docs", "deployment-runbook.md"), "utf8");
    const checklist = readFileSync(join(process.cwd(), "docs", "private-beta-launch-checklist.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");
    const schemaCheck = readFileSync(join(process.cwd(), "src", "server", "memory", "supabase-schema-check.ts"), "utf8");
    const launchReadiness = readFileSync(join(process.cwd(), "src", "server", "admin", "launch-readiness.ts"), "utf8");
    const launchReadinessTest = readFileSync(join(process.cwd(), "src", "server", "admin", "launch-readiness.test.ts"), "utf8");
    const migration = readFileSync(join(process.cwd(), "supabase", "migrations", "011_harden_memory_fact_payload_constraints.sql"), "utf8");
    const deploymentVerifier = readFileSync(join(process.cwd(), "scripts", "verify-deployment.mjs"), "utf8");

    for (const content of [readme, runbook, checklist, audit, schemaCheck]) {
      expect(content).toContain("011");
      expect(content).toContain("memory_facts_payload_shape");
    }
    expect(migrationVerifier).toContain("011_harden_memory_fact_payload_constraints.sql");
    expect(migrationVerifier).toContain("memory_facts_payload_ownership_scope_check");
    expect(migration).toContain("payload->>'ownershipScope' in ('shared', 'member')");
    expect(schemaCheck).toContain("sayve_memory_fact_payload_constraint_status");
    expect(schemaCheck).toContain("ownershipConstraintCount");
    expect(deploymentVerifier).toContain('check.id === "memory_facts_payload_shape"');
    expect(deploymentVerifier).toContain("memory_facts payload constraint check failed");
    expect(deploymentVerifier).toContain("memory fact payload constraints ok");
    expect(launchReadiness).toContain("requiredSupabaseSecurityChecks");
    expect(launchReadiness).toContain("memory_facts_payload_shape");
    expect(launchReadinessTest).toContain("missing required check ids");
    expect(runbook).toContain("supabase/migrations/011_harden_memory_fact_payload_constraints.sql");
  });

  it("keeps migration 012 AI telemetry constraints documented and deployment-gated", () => {
    const migrationVerifier = readFileSync(join(process.cwd(), "scripts", "verify-migrations.mjs"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const runbook = readFileSync(join(process.cwd(), "docs", "deployment-runbook.md"), "utf8");
    const checklist = readFileSync(join(process.cwd(), "docs", "private-beta-launch-checklist.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");
    const schemaCheck = readFileSync(join(process.cwd(), "src", "server", "memory", "supabase-schema-check.ts"), "utf8");
    const launchReadiness = readFileSync(join(process.cwd(), "src", "server", "admin", "launch-readiness.ts"), "utf8");
    const migration = readFileSync(join(process.cwd(), "supabase", "migrations", "012_harden_ai_telemetry_constraints.sql"), "utf8");
    const deploymentVerifier = readFileSync(join(process.cwd(), "scripts", "verify-deployment.mjs"), "utf8");

    for (const content of [readme, runbook, checklist, audit, schemaCheck]) {
      expect(content).toContain("012");
      expect(content).toContain("ai_telemetry_shape");
    }
    expect(migrationVerifier).toContain("012_harden_ai_telemetry_constraints.sql");
    expect(migrationVerifier).toContain("ai_telemetry_events_token_metrics_check");
    expect(migrationVerifier).toContain("ai_telemetry_events_cost_latency_check");
    expect(migration).toContain("prompt_tokens is null or prompt_tokens >= 0");
    expect(migration).toContain("estimated_cost_usd is null or estimated_cost_usd >= 0");
    expect(schemaCheck).toContain("sayve_ai_telemetry_constraint_status");
    expect(schemaCheck).toContain("costLatencyConstraintCount");
    expect(deploymentVerifier).toContain('check.id === "ai_telemetry_shape"');
    expect(deploymentVerifier).toContain("ai_telemetry_events constraint check failed");
    expect(deploymentVerifier).toContain("AI telemetry constraints ok");
    expect(launchReadiness).toContain("ai_telemetry_shape");
    expect(runbook).toContain("supabase/migrations/012_harden_ai_telemetry_constraints.sql");
  });

  it("keeps private-beta Supabase Auth requirements documented for shared household login", () => {
    const envExample = readFileSync(join(process.cwd(), ".env.example"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const runbook = readFileSync(join(process.cwd(), "docs", "deployment-runbook.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");

    expect(envExample).toContain("SUPABASE_AUTH_REQUIRED=");
    for (const content of [readme, runbook, audit]) {
      expect(content).toContain("NEXT_PUBLIC_SUPABASE_URL");
      expect(content).toContain("SUPABASE_URL");
      expect(content).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
      expect(content).toContain("SUPABASE_AUTH_REQUIRED=1");
    }
    expect(envExample).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(envExample).toContain("SUPABASE_URL");
    expect(envExample).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    expect(readme).toContain("separate Supabase Auth users");
    expect(readme).toContain("one shared Family Memory");
    expect(runbook).toContain("Do not share one login between partners");
    expect(audit).toContain("Confirm both household members");
  });

  it("keeps live deployment smoke checking shared household member attribution", () => {
    const deploymentVerifier = readFileSync(join(process.cwd(), "scripts", "verify-deployment.mjs"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const runbook = readFileSync(join(process.cwd(), "docs", "deployment-runbook.md"), "utf8");

    expect(deploymentVerifier).toContain("expectedVisibleFacts");
    expect(deploymentVerifier).toContain("dashboard lost member attribution");
    expect(deploymentVerifier).toContain("createdBy");
    expect(readme).toContain("createdBy` attribution from both members");
    expect(runbook).toContain("createdBy` attribution");
  });

  it("keeps live deployment smoke checking custom category learning attribution", () => {
    const deploymentVerifier = readFileSync(join(process.cwd(), "scripts", "verify-deployment.mjs"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const runbook = readFileSync(join(process.cwd(), "docs", "deployment-runbook.md"), "utf8");
    const checklist = readFileSync(join(process.cwd(), "docs", "private-beta-launch-checklist.md"), "utf8");

    expect(deploymentVerifier).toContain("verifyCategoryLearningSmoke");
    expect(deploymentVerifier).toContain("/api/categories");
    expect(deploymentVerifier).toContain("createdByUserId");
    expect(deploymentVerifier).toContain("categoryOptions");
    expect(deploymentVerifier).toContain("viewer category write denied");
    expect(readme).toContain("custom category creation with `createdByUserId` preserved");
    expect(runbook).toContain("appears in dashboard `categoryOptions`");
    expect(runbook).toContain("cannot create a capture or custom category");
    expect(checklist).toContain("Custom category smoke preserves `createdByUserId`");
  });

  it("keeps live deployment smoke checking privacy redaction", () => {
    const deploymentVerifier = readFileSync(join(process.cwd(), "scripts", "verify-deployment.mjs"), "utf8");
    const envExample = readFileSync(join(process.cwd(), ".env.example"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const runbook = readFileSync(join(process.cwd(), "docs", "deployment-runbook.md"), "utf8");
    const checklist = readFileSync(join(process.cwd(), "docs", "private-beta-launch-checklist.md"), "utf8");

    expect(deploymentVerifier).toContain("SAYVE_REQUIRE_PRIVACY_SMOKE");
    expect(deploymentVerifier).toContain("verifyPrivacyRedactionSmoke");
    expect(deploymentVerifier).toContain("/api/memory/redact");
    expect(deploymentVerifier).toContain("privacy_redacted");
    expect(deploymentVerifier).toContain("linked telemetry metadata");
    expect(deploymentVerifier).toContain("/api/conversation/ask");
    expect(deploymentVerifier).toContain("SAYVEPRIVACYSMOKE");
    expect(deploymentVerifier).toContain("sourced user question/assistant answer pair");
    expect(deploymentVerifier).toContain("Redacted for privacy.");
    expect(envExample).toContain("SAYVE_REQUIRE_PRIVACY_SMOKE");
    expect(readme).toContain("live privacy redaction");
    expect(runbook).toContain("privacy redaction archives a smoke memory");
    expect(checklist).toContain("Privacy redaction smoke has passed");
  });

  it("keeps the web app requiring a selected household before Supabase memory writes", () => {
    const app = readFileSync(join(process.cwd(), "src", "components", "family-memory-app.tsx"), "utf8");
    const authContext = readFileSync(join(process.cwd(), "src", "server", "auth", "request-context.ts"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const runbook = readFileSync(join(process.cwd(), "docs", "deployment-runbook.md"), "utf8");

    expect(app).toContain("memoryAccessIssue");
    expect(app).toContain("請先登入 Sayve。");
    expect(app).toContain("請先選擇家庭。");
    expect(app).toContain("if (!requireMemoryAccess()) return;");
    expect(app).toContain("setAuthOpen(true)");
    expect(authContext).toContain("userId && !explicitHouseholdId");
    expect(authContext).toContain('authError(400, "household_required"');
    expect(readme).toContain("blocks capture/chat actions until a Supabase session and household are selected");
    expect(readme).toContain("must also carry an explicit `x-household-id`");
    expect(runbook).toContain("normal product traffic must carry an explicit `x-household-id`");
  });

  it("keeps live deployment smoke checking new capture telemetry completeness", () => {
    const deploymentVerifier = readFileSync(join(process.cwd(), "scripts", "verify-deployment.mjs"), "utf8");
    const launchReadiness = readFileSync(join(process.cwd(), "src", "server", "admin", "launch-readiness.ts"), "utf8");
    const envExample = readFileSync(join(process.cwd(), ".env.example"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const runbook = readFileSync(join(process.cwd(), "docs", "deployment-runbook.md"), "utf8");
    const checklist = readFileSync(join(process.cwd(), "docs", "private-beta-launch-checklist.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");

    expect(launchReadiness).toContain("getFounderConsoleData");
    expect(launchReadiness).toContain("telemetryCompletenessReadinessCheck");
    expect(launchReadiness).toContain('id: "ai_telemetry_completeness"');
    expect(launchReadiness).toContain("health.totalAiEvents === 0");
    expect(launchReadiness).toContain("health.telemetryCompletenessPercent < 100");
    expect(launchReadiness).toContain('publicLaunch ? "fail" : "warn"');
    expect(deploymentVerifier).toContain("verifyFounderTelemetryForCapture");
    expect(deploymentVerifier).toContain("verifyCaptureDecisionTelemetryEvent");
    expect(deploymentVerifier).toContain("verifyAuthenticatedMediaCaptureSmoke");
    expect(deploymentVerifier).toContain("/api/captures/receipt");
    expect(deploymentVerifier).toContain("/api/captures/voice");
    expect(deploymentVerifier).toContain("authenticated receipt/voice multipart capture smoke ok");
    expect(deploymentVerifier).toContain("verifyFounderTelemetryForConversation");
    expect(deploymentVerifier).toContain("verifyConversationSmoke");
    expect(deploymentVerifier).toContain("verifyConversationSourcesSmoke");
    expect(deploymentVerifier).toContain("/api/conversation/:id/sources");
    expect(deploymentVerifier).toContain("conversation sources should expose non-empty sourceRefs");
    expect(deploymentVerifier).toContain("conversation sources should resolve at least one concrete source payload");
    expect(deploymentVerifier).toContain("conversationMessageId");
    expect(deploymentVerifier).toContain("phase=conversation_answer");
    expect(deploymentVerifier).toContain("SAYVE_REQUIRE_OPENAI_SMOKE");
    expect(deploymentVerifier).toContain("verifyOpenAiTelemetryEvent");
    expect(deploymentVerifier).toContain("verifyOpenAiRuntimeHealth");
    expect(deploymentVerifier).toContain('provider !== "openai"');
    expect(deploymentVerifier).toContain('status !== "success"');
    expect(deploymentVerifier).toContain("openAiEvents");
    expect(deploymentVerifier).toContain("openAiSuccessRate");
    expect(deploymentVerifier).toContain("openAiFallbackRate");
    expect(deploymentVerifier).toContain("openAiErrorEvents");
    expect(deploymentVerifier).toContain("totalTokens");
    expect(deploymentVerifier).toContain("estimatedCostUsd");
    expect(deploymentVerifier).toContain("durationMs");
    expect(deploymentVerifier).toContain("capture_interpretation");
    expect(deploymentVerifier).toContain("decision metadata");
    expect(deploymentVerifier).toContain("aiDecisionAnalytics");
    expect(deploymentVerifier).toContain("captureDecisionEvents");
    expect(deploymentVerifier).toContain("telemetryCompletenessPercent");
    expect(deploymentVerifier).toContain("/api/views/timeline");
    expect(deploymentVerifier).toContain("timeline did not show expected shared household fact ids");
    expect(deploymentVerifier).toContain("verifyDashboardPayloadShape");
    expect(deploymentVerifier).toContain("dashboard payload is missing numeric field");
    expect(deploymentVerifier).toContain("dashboard monthlyTrend should contain exactly one selected row");
    expect(deploymentVerifier).toContain("verifyMemoryDetailSmoke");
    expect(deploymentVerifier).toContain("/api/memory/:id");
    expect(deploymentVerifier).toContain("memory detail did not include expected fact");
    expect(deploymentVerifier).toContain("verifyInsightInboxSmoke");
    expect(deploymentVerifier).toContain("/api/insights");
    expect(deploymentVerifier).toContain("/api/insights/:id/dismiss");
    expect(deploymentVerifier).toContain("insight inbox smoke ok");
    expect(deploymentVerifier).toContain("dismissed insight visible in inbox");
    expect(envExample).toContain("SAYVE_REQUIRE_OPENAI_SMOKE");
    expect(readme).toContain("successful OpenAI capture and conversation telemetry");
    expect(readme).toContain("SAYVE_REQUIRE_OPENAI_SMOKE=1");
    expect(readme).toContain("token/cost/latency");
    expect(readme).toContain("AI Decisions");
    expect(runbook).toContain("capture and conversation telemetry");
    expect(runbook).toContain("provider=openai");
    expect(runbook).toContain("token, cost, and latency");
    expect(runbook).toContain("AI Decisions");
    expect(checklist).toContain("SAYVE_REQUIRE_OPENAI_SMOKE=1");
    expect(checklist).toContain("conversation answering");
    expect(audit).toContain("telemetry completeness");
  });

  it("keeps receipt and voice media storage production-gated", () => {
    const storage = readFileSync(join(process.cwd(), "src", "server", "media", "storage.ts"), "utf8");
    const receiptRoute = readFileSync(join(process.cwd(), "src", "app", "api", "captures", "receipt", "route.ts"), "utf8");
    const voiceRoute = readFileSync(join(process.cwd(), "src", "app", "api", "captures", "voice", "route.ts"), "utf8");
    const envScript = readFileSync(join(process.cwd(), "scripts", "verify-env.mjs"), "utf8");
    const deploymentVerifier = readFileSync(join(process.cwd(), "scripts", "verify-deployment.mjs"), "utf8");
    const launchReadiness = readFileSync(join(process.cwd(), "src", "server", "admin", "launch-readiness.ts"), "utf8");
    const schemaCheck = readFileSync(join(process.cwd(), "src", "server", "memory", "supabase-schema-check.ts"), "utf8");
    const envExample = readFileSync(join(process.cwd(), ".env.example"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const runbook = readFileSync(join(process.cwd(), "docs", "deployment-runbook.md"), "utf8");
    const checklist = readFileSync(join(process.cwd(), "docs", "private-beta-launch-checklist.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");

    expect(storage).toContain("SUPABASE_MEDIA_BUCKET");
    expect(storage).toContain("supabase://");
    expect(storage).toContain("capture_media_storage_failed");
    expect(storage).toContain("RECEIPT_UPLOAD_MAX_BYTES");
    expect(storage).toContain("VOICE_UPLOAD_MAX_BYTES");
    expect(storage).toContain("capture_media_file_too_large");
    expect(receiptRoute).toContain("storeCaptureFile");
    expect(receiptRoute).toContain("CaptureMediaStorageError");
    expect(voiceRoute).toContain("storeCaptureFile");
    expect(voiceRoute).toContain("CaptureMediaStorageError");
    expect(envScript).toContain("SUPABASE_MEDIA_BUCKET");
    expect(envScript).toContain("SAYVE_REQUIRE_MEDIA_STORAGE");
    expect(envScript).toContain("RECEIPT_UPLOAD_MAX_BYTES");
    expect(envScript).toContain("VOICE_UPLOAD_MAX_BYTES");
    expect(envExample).toContain("SAYVE_REQUIRE_MEDIA_STORAGE=0");
    expect(launchReadiness).toContain("mediaStorageRequired");
    expect(launchReadiness).toContain("publicLaunchTarget");
    expect(launchReadiness).toContain("SAYVE_ENV_TARGET=public-launch");
    expect(launchReadiness).toContain("SAYVE_REQUIRE_MEDIA_STORAGE=1");
    expect(launchReadiness).toContain("OPENAI_API_KEY is required when SAYVE_ENV_TARGET=public-launch");
    expect(launchReadiness).toContain("publicLaunch ? \"fail\" : \"warn\"");
    expect(launchReadiness).toContain("publicLaunchTarget() ? \"fail\" : \"warn\"");
    expect(launchReadiness).toContain("media_storage");
    expect(launchReadiness).toContain("media_upload_limits");
    expect(launchReadiness).toContain("media_storage_bucket");
    expect(schemaCheck).toContain("media_storage_bucket");
    expect(schemaCheck).toContain("getBucket");
    expect(schemaCheck).toContain("is private");
    expect(deploymentVerifier).toContain("verifyCaptureMediaStored");
    expect(deploymentVerifier).toContain("media_upload_limits");
    expect(deploymentVerifier).toContain("media_storage_bucket");
    expect(deploymentVerifier).toContain("mediaStored");
    for (const content of [envExample, readme, runbook, checklist, audit]) {
      expect(content).toContain("SUPABASE_MEDIA_BUCKET");
      expect(content).toContain("RECEIPT_UPLOAD_MAX_BYTES");
      expect(content).toContain("VOICE_UPLOAD_MAX_BYTES");
    }
    for (const content of [readme, runbook, checklist, audit]) {
      expect(content).toContain("private");
    }
  });

  it("keeps Launch Readiness verifying the configured default household against live Supabase", () => {
    const launchReadiness = readFileSync(join(process.cwd(), "src", "server", "admin", "launch-readiness.ts"), "utf8");
    const launchReadinessTest = readFileSync(join(process.cwd(), "src", "server", "admin", "launch-readiness.test.ts"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const runbook = readFileSync(join(process.cwd(), "docs", "deployment-runbook.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");

    expect(launchReadiness).toContain("readDefaultHouseholdBinding");
    expect(launchReadiness).toContain('from("households")');
    expect(launchReadiness).toContain('from("household_members")');
    expect(launchReadiness).toContain("no matching household row exists");
    expect(launchReadiness).toContain("has no household members yet");
    expect(launchReadiness).toContain("has no owner role member yet");
    expect(launchReadiness).toContain("Could not verify SUPABASE_DEFAULT_HOUSEHOLD_ID against live Supabase");
    expect(launchReadinessTest).toContain("fails readiness when the configured Supabase default household does not exist");
    expect(launchReadinessTest).toContain("warns in private beta when live default household verification errors");
    expect(launchReadinessTest).toContain("fails readiness when the configured default household has no members yet");
    expect(launchReadinessTest).toContain("fails readiness when the configured default household has no owner member");

    for (const content of [readme, runbook, audit]) {
      expect(content).toContain("SUPABASE_DEFAULT_HOUSEHOLD_ID");
      expect(content).toContain("exists");
      expect(content).toContain("owner");
    }
  });

  it("keeps Founder Console exposing default household binding setup visibility", () => {
    const founderConsole = readFileSync(join(process.cwd(), "src", "server", "admin", "founder-console.ts"), "utf8");
    const founderConsoleTest = readFileSync(join(process.cwd(), "src", "server", "admin", "founder-console.test.ts"), "utf8");
    const adminPage = readFileSync(join(process.cwd(), "src", "app", "admin", "page.tsx"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");

    expect(founderConsole).toContain("readFounderDefaultHouseholdBinding");
    expect(founderConsole).toContain("defaultHouseholdBinding");
    expect(founderConsole).toContain('from("households")');
    expect(founderConsole).toContain('from("household_members")');
    expect(founderConsoleTest).toContain("surfaces the configured default household binding summary");
    expect(adminPage).toContain("Default Household Binding");
    expect(adminPage).toContain("ownerCount");
    expect(readme).toContain("Default Household Binding");
    expect(audit).toContain("Default Household Binding");
  });

  it("keeps Founder Console exposing onboarding health for partner invite monitoring", () => {
    const founderConsole = readFileSync(join(process.cwd(), "src", "server", "admin", "founder-console.ts"), "utf8");
    const founderConsoleTest = readFileSync(join(process.cwd(), "src", "server", "admin", "founder-console.test.ts"), "utf8");
    const adminPage = readFileSync(join(process.cwd(), "src", "app", "admin", "page.tsx"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");

    expect(founderConsole).toContain("readFounderOnboardingHealth");
    expect(founderConsole).toContain('from("invites")');
    expect(founderConsole).toContain("emailLockedInvites");
    expect(founderConsoleTest).toContain("surfaces onboarding invite health");
    expect(adminPage).toContain("Onboarding Health");
    expect(adminPage).toContain("Recent Invites");
    expect(readme).toContain("Onboarding Health");
    expect(audit).toContain("Onboarding Health");
  });

  it("keeps Founder Console exposing current build progress for founder tracking", () => {
    const adminPage = readFileSync(join(process.cwd(), "src", "app", "admin", "page.tsx"), "utf8");
    const progressDoc = readFileSync(join(process.cwd(), "docs", "current-build-progress.md"), "utf8");

    expect(adminPage).toContain("Current Build Progress");
    expect(adminPage).toContain("Private Beta Progress");
    expect(adminPage).toContain("Public Launch Progress");
    expect(adminPage).toContain("Next For Private Beta");
    expect(adminPage).toContain("Next For Public Launch");
    expect(progressDoc).toContain("Estimated overall progress to a real V1 private beta");
    expect(progressDoc).toContain("Estimated progress to a true public launch");
  });

  it("keeps Founder Console translating setup state into concrete next steps", () => {
    const adminPage = readFileSync(join(process.cwd(), "src", "app", "admin", "page.tsx"), "utf8");
    const styles = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");

    expect(adminPage).toContain("Setup Guide");
    expect(adminPage).toContain("Run verify:deploy:private-beta on the real deployment");
    expect(adminPage).toContain("Invite your partner");
    expect(adminPage).toContain("Default household");
    expect(styles).toContain(".adminStepDetail");
    expect(readme).toContain("Setup Guide");
    expect(audit).toContain("Setup Guide");
  });

  it("keeps Founder Console exposing one live rollout checklist for Vercel, OAuth, and smoke setup", () => {
    const adminPage = readFileSync(join(process.cwd(), "src", "app", "admin", "page.tsx"), "utf8");
    const founderConsole = readFileSync(join(process.cwd(), "src", "server", "admin", "founder-console.ts"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");

    expect(adminPage).toContain("Live Rollout Checklist");
    expect(founderConsole).toContain("Google OAuth allow list");
    expect(founderConsole).toContain("Media storage");
    expect(founderConsole).toContain("Deploy smoke");
    expect(readme).toContain("Live Rollout Checklist");
    expect(audit).toContain("Live Rollout Checklist");
  });

  it("keeps Founder Console exposing exact auth setup targets for Supabase OAuth handoff", () => {
    const adminPage = readFileSync(join(process.cwd(), "src", "app", "admin", "page.tsx"), "utf8");
    const founderConsole = readFileSync(join(process.cwd(), "src", "server", "admin", "founder-console.ts"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");

    expect(adminPage).toContain("Auth Setup Targets");
    expect(founderConsole).toContain("supabase_site_url");
    expect(founderConsole).toContain("supabase_redirect_url_invite");
    expect(readme).toContain("Auth Setup Targets");
    expect(audit).toContain("Auth Setup Targets");
  });

  it("keeps Founder Console exposing an env setup matrix for deployment handoff", () => {
    const adminPage = readFileSync(join(process.cwd(), "src", "app", "admin", "page.tsx"), "utf8");
    const founderConsole = readFileSync(join(process.cwd(), "src", "server", "admin", "founder-console.ts"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");

    expect(adminPage).toContain("Env Setup Matrix");
    expect(founderConsole).toContain("MEMORY_REPOSITORY");
    expect(founderConsole).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(founderConsole).toContain("SAYVE_DEPLOYMENT_SMOKE_VERIFIED");
    expect(readme).toContain("Env Setup Matrix");
    expect(audit).toContain("Env Setup Matrix");
  });

  it("keeps Founder Console exposing a smoke token guide for deploy-day setup", () => {
    const adminPage = readFileSync(join(process.cwd(), "src", "app", "admin", "page.tsx"), "utf8");
    const founderConsole = readFileSync(join(process.cwd(), "src", "server", "admin", "founder-console.ts"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const checklist = readFileSync(join(process.cwd(), "docs", "private-beta-launch-checklist.md"), "utf8");

    expect(adminPage).toContain("Smoke Token Guide");
    expect(founderConsole).toContain("SAYVE_TEST_SUPABASE_ACCESS_TOKEN");
    expect(founderConsole).toContain("sayve_access_token");
    expect(readme).toContain("Smoke Token Guide");
    expect(checklist).toContain("sayve_access_token");
  });

  it("keeps a founder private beta execution playbook linked from the repo docs", () => {
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const progress = readFileSync(join(process.cwd(), "docs", "current-build-progress.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");
    const execution = readFileSync(join(process.cwd(), "docs", "founder-private-beta-execution.md"), "utf8");

    expect(readme).toContain("Founder Private Beta Execution");
    expect(progress).toContain("founder execution doc");
    expect(audit).toContain("deploy-day execution doc");
    expect(execution).toContain("Create Supabase Project");
    expect(execution).toContain("Configure Google OAuth in Supabase");
    expect(execution).toContain("Collect Smoke Tokens");
    expect(execution).toContain("Run Private Beta Smoke");
  });

  it("keeps a founder setup report script wired into package scripts and docs", () => {
    const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const execution = readFileSync(join(process.cwd(), "docs", "founder-private-beta-execution.md"), "utf8");

    expect(packageJson).toContain('"report:setup": "node scripts/founder-setup-report.mjs"');
    expect(packageJson).toContain('"report:deploy-proof": "node scripts/report-deploy-proof.mjs"');
    expect(packageJson).toContain('"report:go-live": "node scripts/report-go-live.mjs"');
    expect(packageJson).toContain('"verify:deploy:strict-private-beta": "SAYVE_REQUIRE_PUBLIC_READY=0 SAYVE_REQUIRE_AUTH_SMOKE=1 SAYVE_REQUIRE_TWO_MEMBER_SMOKE=1 SAYVE_REQUIRE_VIEWER_SMOKE=1 SAYVE_REQUIRE_INVITE_SMOKE=1 SAYVE_REQUIRE_BOOTSTRAP_SMOKE=1 SAYVE_REQUIRE_OPENAI_SMOKE=1 SAYVE_REQUIRE_PRIVACY_SMOKE=1 pnpm run verify:deploy"');
    expect(packageJson).toContain('"verify:deploy:strict-private-beta:proof": "SAYVE_DEPLOY_PROOF_REPORT_PATH=outputs/setup/deploy-proof-report.json SAYVE_REQUIRE_PUBLIC_READY=0 SAYVE_REQUIRE_AUTH_SMOKE=1 SAYVE_REQUIRE_TWO_MEMBER_SMOKE=1 SAYVE_REQUIRE_VIEWER_SMOKE=1 SAYVE_REQUIRE_INVITE_SMOKE=1 SAYVE_REQUIRE_BOOTSTRAP_SMOKE=1 SAYVE_REQUIRE_OPENAI_SMOKE=1 SAYVE_REQUIRE_PRIVACY_SMOKE=1 pnpm run verify:deploy"');
    expect(packageJson).toContain("node --check scripts/founder-setup-report.mjs");
    expect(packageJson).toContain("node --check scripts/report-deploy-proof.mjs");
    expect(packageJson).toContain("node --check scripts/report-go-live.mjs");
    expect(readme).toContain("pnpm run report:setup");
    expect(readme).toContain("pnpm run report:deploy-proof");
    expect(readme).toContain("pnpm run report:go-live");
    expect(readme).toContain("live-rollout-sequence.md");
    expect(readme).toContain("private-beta-go-live-run-sheet.md");
    expect(readme).toContain("live-deployment-execution-order.md");
    expect(readme).toContain("deploy-smoke.env");
    expect(readme).toContain("Launch Completion Audit");
    expect(execution).toContain("pnpm run report:setup");
  });

  it("keeps Founder Console exposing a private beta handoff summary", () => {
    const adminPage = readFileSync(join(process.cwd(), "src", "app", "admin", "page.tsx"), "utf8");
    const styles = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");

    expect(adminPage).toContain("Private Beta Handoff");
    expect(adminPage).toContain("Live smoke verified");
    expect(adminPage).toContain("Private beta config ready");
    expect(adminPage).toContain("Run verify:deploy:private-beta on the live deployment");
    expect(styles).toContain(".adminHandoff");
    expect(styles).toContain(".adminHandoffBar");
    expect(readme).toContain("Private Beta Handoff");
    expect(audit).toContain("Private Beta Handoff");
  });

  it("keeps Founder Console showing deploy smoke commands and required tokens", () => {
    const adminPage = readFileSync(join(process.cwd(), "src", "app", "admin", "page.tsx"), "utf8");
    const founderConsole = readFileSync(join(process.cwd(), "src", "server", "admin", "founder-console.ts"), "utf8");
    const founderSetupReport = readFileSync(join(process.cwd(), "scripts", "founder-setup-report.mjs"), "utf8");
    const styles = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");

    expect(adminPage).toContain("Deploy Smoke Guide");
    expect(adminPage).toContain("Deploy Proof Pack");
    expect(adminPage).toContain("Live Proof Coverage");
    expect(adminPage).toContain("Live Smoke Evidence");
    expect(adminPage).toContain("Onboarding Proof Status");
    expect(adminPage).toContain("Deploy Smoke Env Template");
    expect(adminPage).toContain("Repository Smoke Guide");
    expect(adminPage).toContain("Public Launch Checks");
    expect(adminPage).toContain("buildDeploymentSmokeCommands");
    expect(adminPage).toContain("SAYVE_TEST_SUPABASE_ACCESS_TOKEN");
    expect(adminPage).toContain("SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN");
    expect(adminPage).toContain("SAYVE_TEST_VIEWER_SUPABASE_ACCESS_TOKEN");
    expect(adminPage).toContain("SAYVE_TEST_INVITE_ACCEPT_SUPABASE_ACCESS_TOKEN");
    expect(adminPage).toContain("SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN");
    expect(adminPage).toContain("outputs/setup/deploy-proof-report.json");
    expect(adminPage).toContain("outputs/setup/deploy-proof-summary.md");
    expect(adminPage).toContain("pnpm run report:deploy-proof");
    expect(adminPage).toContain("DeploySmokeEnvTemplateBlock");
    expect(founderConsole).toContain("pnpm run verify:deploy:private-beta");
    expect(founderConsole).toContain("pnpm run verify:deploy:public-launch");
    expect(founderConsole).toContain('"deploySmokeEnvTemplate"');
    expect(founderConsole).toContain('"repositorySmokeGuide"');
    expect(founderConsole).toContain('"publicLaunchChecks"');
    expect(founderConsole).toContain('"liveSmokeEvidence"');
    expect(founderConsole).toContain('"launchCompletionAudit"');
    expect(founderConsole).toContain('"privateBetaSetupGate"');
    expect(founderConsole).toContain('"integrationReadiness"');
    expect(founderConsole).toContain('"integrationPackage"');
    expect(founderConsole).toContain("SAYVE_REQUIRE_AUTH_SMOKE");
    expect(founderConsole).toContain("SAYVE_REQUIRE_BOOTSTRAP_SMOKE");
    expect(founderConsole).toContain("SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN");
    expect(founderSetupReport).toContain("deploySmokeEnvTemplate");
    expect(founderSetupReport).toContain("SAYVE_REQUIRE_BOOTSTRAP_SMOKE=1");
    expect(founderSetupReport).toContain("SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN");
    expect(founderSetupReport).toContain("repositorySmokeGuide");
    expect(founderSetupReport).toContain("publicLaunchChecks");
    expect(founderSetupReport).toContain("launchCompletionAudit");
    expect(founderSetupReport).toContain("privateBetaSetupGate");
    expect(founderSetupReport).toContain("integrationReadiness");
    expect(founderSetupReport).toContain("integrationPackage");
    expect(founderSetupReport).toContain("viewerCount");
    expect(founderSetupReport).toContain("onboarding invite counters");
    expect(founderSetupReport).toContain("SAYVE_REQUIRE_TWO_MEMBER_SMOKE=1");
    expect(styles).toContain(".adminDeployGuide");
    expect(styles).toContain(".adminCodeBlock");
    expect(readme).toContain("Deploy Smoke Guide");
    expect(readme).toContain("Deploy Smoke Env Template");
    expect(readme).toContain("repository smoke");
    expect(readme).toContain("member/owner/viewer counts");
    expect(readme).toContain("Public Launch Checks");
    expect(readme).toContain("Private Beta Setup Gate");
    expect(readme).toContain("Integration Readiness");
    expect(readme).toContain("Integration Package");
    expect(audit).toContain("Deploy Smoke Guide");
    expect(audit).toContain("Deploy Smoke Env Template");
    expect(audit).toContain("Public Launch Checks");
  });

  it("keeps conversation answers routed through the configured model with deterministic fallback telemetry", () => {
    const models = readFileSync(join(process.cwd(), "src", "server", "ai", "models.ts"), "utf8");
    const engine = readFileSync(join(process.cwd(), "src", "server", "memory", "engine.ts"), "utf8");
    const engineTest = readFileSync(join(process.cwd(), "src", "server", "memory", "engine.test.ts"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const runbook = readFileSync(join(process.cwd(), "docs", "deployment-runbook.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");

    expect(models).toContain("get conversation()");
    expect(models).toContain("OPENAI_CONVERSATION_MODEL");
    expect(engine).toContain("answerConversationWithModel");
    expect(engine).toContain("usedOpenAiConversationModel");
    expect(engine).toContain("conversationProviderError");
    expect(engineTest).toContain("routes conversation answers through OpenAI");
    for (const content of [readme, runbook, audit]) {
      expect(content).toContain("OPENAI_CONVERSATION_MODEL");
      expect(content).toContain("deterministic");
      expect(content).toContain("telemetry");
    }
  });

  it("keeps live deployment smoke checking unauthenticated JSON is rejected before parsing", () => {
    const deploymentVerifier = readFileSync(join(process.cwd(), "scripts", "verify-deployment.mjs"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const runbook = readFileSync(join(process.cwd(), "docs", "deployment-runbook.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");

    expect(deploymentVerifier).toContain("malformed JSON before body parsing");
    expect(deploymentVerifier).toContain("/api/conversation/ask");
    expect(deploymentVerifier).toContain("body: \"{bad json\"");
    expect(readme).toContain("broader private JSON write boundary");
    expect(runbook).toContain("broader private JSON writes");
    expect(audit).toContain("malformed JSON are rejected before body parsing");
    expect(audit).toContain("broader private JSON writes");
  });

  it("keeps invite acceptance login-gated before body parsing in real auth mode", () => {
    const route = readFileSync(join(process.cwd(), "src", "app", "api", "households", "invite", "accept", "route.ts"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const runbook = readFileSync(join(process.cwd(), "docs", "deployment-runbook.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");

    expect(route.indexOf("resolveSupabaseBearerUserId(request)")).toBeLessThan(route.indexOf("readJsonObject(request)"));
    expect(route).toContain("Founder Console override");
    expect(readme).toContain("prove the bearer login before parsing the request body");
    expect(runbook).toContain("prove the Supabase bearer login before parsing the request body");
    expect(audit).toContain("Invite acceptance rejects unauthenticated real-auth requests before parsing malformed JSON bodies");
  });

  it("keeps Supabase import validation checking telemetry completeness", () => {
    const importValidator = readFileSync(join(process.cwd(), "src", "server", "memory", "supabase-import-validator.ts"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const runbook = readFileSync(join(process.cwd(), "docs", "deployment-runbook.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");

    expect(importValidator).toContain("FinancialFactPayloadSchema");
    expect(importValidator).toContain("payload must match FinancialFactPayloadSchema");
    expect(importValidator).toContain("addRequiredNonNegativeNumberIssues");
    expect(importValidator).toContain("total_tokens");
    expect(importValidator).toContain("estimated_cost_usd");
    expect(importValidator).toContain("duration_ms");
    expect(importValidator).toContain("addCaptureDecisionTelemetryIssues");
    expect(importValidator).toContain('["decision", typeof decision === "string"');
    expect(importValidator).toContain('["needsUserInput", typeof metadata.needsUserInput === "boolean"]');
    expect(importValidator).toContain("AI Decisions analytics");
    expect(readme).toContain("ai_telemetry_events");
    expect(readme).toContain("AI Decisions metadata");
    expect(runbook).toContain("ai_telemetry_events");
    expect(runbook).toContain("AI Decisions metadata");
    expect(audit).toContain("Supabase import validation rejects AI telemetry rows");
    expect(audit).toContain("Supabase import validation rejects capture interpretation telemetry");
    expect(audit).toContain("Supabase import validation rejects malformed financial fact payloads");
  });

  it("keeps the founder-only Supabase normalized import loader documented and guarded", () => {
    const loader = readFileSync(join(process.cwd(), "src", "server", "memory", "supabase-load.ts"), "utf8");
    const route = readFileSync(join(process.cwd(), "src", "app", "api", "admin", "import", "supabase", "load", "route.ts"), "utf8");
    const importTest = readFileSync(join(process.cwd(), "src", "server", "memory", "supabase-import.test.ts"), "utf8");
    const deploymentVerifier = readFileSync(join(process.cwd(), "scripts", "verify-deployment.mjs"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const runbook = readFileSync(join(process.cwd(), "docs", "deployment-runbook.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");

    expect(loader).toContain("applySupabaseImportPlan");
    expect(loader).toContain("requiresConfirmation");
    expect(loader).toContain("planSignature");
    expect(loader).toContain("referencedId");
    expect(loader).toContain("memory_object_external_id");
    expect(loader).toContain("capture_external_id");
    expect(loader).toContain("conversation_message_external_id");
    expect(route).toContain("canAccessFounderConsole");
    expect(route).toContain("loadCurrentMemoryIntoSupabase");
    expect(route).toContain("confirmLoad");
    expect(route).toContain("status: 409");
    expect(importTest).toContain("loads a valid import plan into normalized Supabase tables");
    expect(importTest).toContain("requires the latest dry-run plan signature");
    expect(importTest).toContain("secondInsertedRows");
    expect(deploymentVerifier).toContain("verifySupabaseImportPlanningSmoke");
    expect(deploymentVerifier).toContain("/api/admin/import/supabase/validate");
    expect(deploymentVerifier).toContain("/api/admin/import/supabase/dry-run");
    expect(deploymentVerifier).toContain("rowsInPlan");
    expect(deploymentVerifier).toContain("rowsToInsert");
    for (const content of [readme, runbook]) {
      expect(content).toContain("/api/admin/import/supabase/load");
      expect(content).toContain("*_external_id");
      expect(content).toContain("service role");
      expect(content).toContain("/api/admin/import/supabase/validate");
      expect(content).toContain("/api/admin/import/supabase/dry-run");
      expect(content).toContain("planSignature");
    }
    expect(audit).toContain("Founder-only Supabase import loading");
    expect(audit).toContain("confirmLoad=true");
    expect(audit).toContain("Deployment verifier checks non-mutating Supabase import validate/dry-run endpoints");
  });

  it("keeps Supabase admin import and export routes returning stable no-store JSON on unexpected errors", () => {
    const adminHttp = readFileSync(join(process.cwd(), "src", "server", "admin", "http.ts"), "utf8");
    const routePaths = [
      ["export", "supabase", "route.ts"],
      ["import", "supabase", "validate", "route.ts"],
      ["import", "supabase", "dry-run", "route.ts"],
      ["import", "supabase", "stage", "route.ts"],
      ["import", "supabase", "load", "route.ts"],
      ["import", "supabase", "schema-check", "route.ts"]
    ];

    expect(adminHttp).toContain("unexpectedAdminErrorResponse");
    expect(adminHttp).toContain("unexpected_admin_error");
    expect(adminHttp).toContain("ADMIN_NO_STORE_HEADERS");

    for (const parts of routePaths) {
      const route = readFileSync(join(process.cwd(), "src", "app", "api", "admin", ...parts), "utf8");
      expect(route).toContain("unexpectedAdminErrorResponse");
      expect(route).toContain("try {");
      expect(route).toContain("catch (error)");
    }
  });

  it("keeps Supabase snapshot first-insert races retryable", () => {
    const repository = readFileSync(join(process.cwd(), "src", "server", "memory", "supabase-repository.ts"), "utf8");
    const repositoryTest = readFileSync(join(process.cwd(), "src", "server", "memory", "repository.test.ts"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");

    expect(repository).toContain("isDuplicateSnapshotError");
    expect(repository).toContain('error.code === "23505"');
    expect(repository).toContain('throw new Error("supabase_memory_repository_conflict")');
    expect(repositoryTest).toContain("concurrent first snapshot inserts");
    expect(audit).toContain("duplicate first-insert races");
    expect(audit).toContain("retryable repository conflicts");
  });

  it("keeps core product APIs returning stable envelopes on unexpected storage failures", () => {
    const jsonHelpers = readFileSync(join(process.cwd(), "src", "server", "api", "json.ts"), "utf8");
    const textCapture = readFileSync(join(process.cwd(), "src", "app", "api", "captures", "text", "route.ts"), "utf8");
    const receiptCapture = readFileSync(join(process.cwd(), "src", "app", "api", "captures", "receipt", "route.ts"), "utf8");
    const voiceCapture = readFileSync(join(process.cwd(), "src", "app", "api", "captures", "voice", "route.ts"), "utf8");
    const conversation = readFileSync(join(process.cwd(), "src", "app", "api", "conversation", "ask", "route.ts"), "utf8");
    const categories = readFileSync(join(process.cwd(), "src", "app", "api", "categories", "route.ts"), "utf8");
    const apiContract = readFileSync(join(process.cwd(), "src", "app", "api", "api-contract.test.ts"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");

    expect(jsonHelpers).toContain("unexpectedApiErrorResponse");
    expect(jsonHelpers).toContain("temporary_unavailable");
    expect(jsonHelpers).toContain("unexpected_server_error");
    for (const content of [textCapture, receiptCapture, voiceCapture, conversation, categories]) {
      expect(content).toContain("unexpectedApiErrorResponse");
    }
    expect(apiContract).toContain("production memory storage is unavailable");
    expect(apiContract).toContain("temporary_unavailable");
    expect(audit).toContain("temporary_unavailable");
  });

  it("keeps public health responses uncached for deployment smoke", () => {
    const healthRoute = readFileSync(join(process.cwd(), "src", "app", "api", "health", "route.ts"), "utf8");
    const deploymentVerifier = readFileSync(join(process.cwd(), "scripts", "verify-deployment.mjs"), "utf8");
    const apiContract = readFileSync(join(process.cwd(), "src", "app", "api", "api-contract.test.ts"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");

    expect(healthRoute).toContain("noStoreJson");
    expect(healthRoute).not.toContain("Response.json");
    expect(deploymentVerifier).toContain('verifyNoStoreHeaders(health.response, "/api/health")');
    expect(apiContract).toContain("expectNoStore(healthResponse)");
    expect(audit).toContain("Public-safe health endpoint returns no-store/noindex");
  });

  it("keeps capture retries from re-running AI interpretation unnecessarily", () => {
    const engine = readFileSync(join(process.cwd(), "src", "server", "memory", "engine.ts"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");

    expect(engine).toContain("type PreparedCaptureAttempt");
    expect(engine).toContain("prepared.capture ??");
    expect(engine).toContain("if (!prepared.draft)");
    expect(engine).toContain("const prepared: PreparedCaptureAttempt = {}");
    expect(engine).toContain("captureMemoryOnce(input, prepared)");
    expect(audit).toContain("reuses the prepared capture and AI interpretation draft");
  });

  it("keeps deployment handoff commands on the pinned package manager", () => {
    const deploymentVerifier = readFileSync(join(process.cwd(), "scripts", "verify-deployment.mjs"), "utf8");
    const launchReadiness = readFileSync(join(process.cwd(), "src", "server", "admin", "launch-readiness.ts"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const runbook = readFileSync(join(process.cwd(), "docs", "deployment-runbook.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");

    for (const content of [deploymentVerifier, launchReadiness, readme, runbook, audit]) {
      expect(content).not.toMatch(/(^|[^p])npm run/);
      expect(content).toContain("pnpm run");
    }
  });

  it("keeps deployment smoke gated on the latest Launch Readiness check shape", () => {
    const deploymentVerifier = readFileSync(join(process.cwd(), "scripts", "verify-deployment.mjs"), "utf8");
    const launchReadiness = readFileSync(join(process.cwd(), "src", "server", "admin", "launch-readiness.ts"), "utf8");
    const exportRoute = readFileSync(join(process.cwd(), "src", "app", "api", "admin", "export", "route.ts"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const runbook = readFileSync(join(process.cwd(), "docs", "deployment-runbook.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");

    expect(deploymentVerifier).toContain("requiredLaunchReadinessCheckIds");
    expect(deploymentVerifier).toContain("verifyLaunchReadinessShape");
    expect(deploymentVerifier).toContain("missing required boolean fields");
    for (const field of ["configReadyForPrivateBeta", "liveSmokeVerified", "readyForPublicLaunch"]) {
      expect(deploymentVerifier).toContain(field);
      expect(launchReadiness).toContain(field);
      expect(readme).toContain(field);
      expect(runbook).toContain(field);
      expect(audit).toContain(field);
    }
    expect(deploymentVerifier).toContain('["pass", "warn", "fail"]');
    expect(deploymentVerifier).toContain("missing required check ids");
    expect(exportRoute).toContain("getLaunchReadinessReport");
    expect(exportRoute).toContain('getFounderExportRows(scope === "raw" ? "raw" : "view", name, {');
    expect(exportRoute).toContain("configReadyForPrivateBeta");
    expect(exportRoute).toContain("liveSmokeVerified");
    expect(exportRoute).toContain("readyForPublicLaunch");
    expect(deploymentVerifier).toContain("smokeProof");
    expect(deploymentVerifier).toContain("verifySmokeProof");
    expect(launchReadiness).toContain("SAYVE_DEPLOYMENT_SMOKE_VERIFIED_AT");
    expect(launchReadiness).toContain("SAYVE_DEPLOYMENT_SMOKE_TARGET");
    for (const id of ["app_base_url", "supabase_url_consistency", "supabase_key_boundary", "ai_telemetry_completeness"]) {
      expect(deploymentVerifier).toContain(id);
      expect(launchReadiness).toContain(id);
      expect(readme).toContain(id);
      expect(runbook).toContain(id);
      expect(audit).toContain(id);
    }
  });

  it("fails deployment smoke before network calls when the deploy URL is unsafe for the target", () => {
    const invalid = runVerifyDeployment({ SAYVE_DEPLOY_URL: "not-a-url" });
    expect(invalid.status).not.toBe(0);
    expect(invalid.stderr).toContain("SAYVE_DEPLOY_URL must be a valid URL");

    const publicLocalhost = runVerifyDeployment({ SAYVE_DEPLOY_URL: "http://localhost:3000" });
    expect(publicLocalhost.status).not.toBe(0);
    expect(publicLocalhost.stderr).toContain("Public-ready deployment smoke must target an HTTPS non-local deployment URL");

    const publicHttp = runVerifyDeployment({ SAYVE_DEPLOY_URL: "http://sayve.example.com" });
    expect(publicHttp.status).not.toBe(0);
    expect(publicHttp.stderr).toContain("SAYVE_DEPLOY_URL must use https");
  });

  it("keeps Vercel deployments running the production preflight before build", () => {
    const vercelConfig = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as {
      framework?: string;
      installCommand?: string;
      buildCommand?: string;
    };
    const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const runbook = readFileSync(join(process.cwd(), "docs", "deployment-runbook.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");

    expect(vercelConfig.framework).toBe("nextjs");
    expect(vercelConfig.installCommand).toBe("pnpm install --frozen-lockfile");
    expect(vercelConfig.buildCommand).toContain("pnpm run verify:scripts");
    expect(vercelConfig.buildCommand).toContain("pnpm run verify:env");
    expect(vercelConfig.buildCommand).toContain("pnpm run typecheck");
    expect(vercelConfig.buildCommand).toContain("pnpm run verify:migrations");
    expect(vercelConfig.buildCommand).toContain("pnpm run build");
    expect(vercelConfig.installCommand).not.toMatch(/(^|\s)npm\s/);
    expect(vercelConfig.buildCommand).not.toMatch(/(^|[^p])npm run/);
    expect(packageJson).toContain('"packageManager": "pnpm@11.7.0"');
    expect(packageJson).toContain('"node": ">=22 <25"');
    expect(packageJson).toContain('"verify:private-beta": "SAYVE_ENV_TARGET=private-beta pnpm run verify:env && pnpm run verify"');
    expect(packageJson).toContain('"verify:public-launch": "SAYVE_ENV_TARGET=public-launch pnpm run verify:env && pnpm run verify"');
    expect(packageJson).toContain('"verify:deploy:private-beta": "SAYVE_REQUIRE_PUBLIC_READY=0 pnpm run verify:deploy"');
    expect(packageJson).toContain('"verify:deploy:public-launch": "SAYVE_REQUIRE_PUBLIC_READY=1 pnpm run verify:deploy"');

    for (const content of [readme, runbook, audit]) {
      expect(content).toContain("vercel.json");
      expect(content).toContain("pnpm install --frozen-lockfile");
      expect(content).toContain("pnpm run verify:env");
      expect(content).toContain("pnpm run verify:private-beta");
      expect(content).toContain("pnpm run verify:deploy:private-beta");
      expect(content).toContain("pnpm run verify:deploy:public-launch");
      expect(content).toContain("SAYVE_ENV_TARGET=private-beta");
    }
  });

  it("keeps browser household auth centralized and documents Google login", () => {
    const authClient = readFileSync(join(process.cwd(), "src", "components", "auth-client.ts"), "utf8");
    const authClientTest = readFileSync(join(process.cwd(), "src", "components", "auth-client.test.ts"), "utf8");
    const app = readFileSync(join(process.cwd(), "src", "components", "family-memory-app.tsx"), "utf8");
    const dashboard = readFileSync(join(process.cwd(), "src", "components", "dashboard-view.tsx"), "utf8");
    const invite = readFileSync(join(process.cwd(), "src", "components", "invite-acceptance.tsx"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const runbook = readFileSync(join(process.cwd(), "docs", "deployment-runbook.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");

    expect(authClient).toContain("signInWithOAuth");
    expect(authClient).toContain("storedAuthHeaders");
    expect(authClient).toContain("sayve_household_id");
    expect(authClient).toContain("headers.authorization = `Bearer ${token}`");
    expect(authClient).toContain('headers["x-household-id"] = householdId');
    expect(authClient).toContain('window.localStorage.removeItem(authStorageKeys.householdId)');
    expect(authClient).toContain("@supabase/supabase-js");
    expect(authClientTest).toContain("clears the stored household when the signed-in user changes");
    expect(authClientTest).toContain("clears the stored household when the browser session is removed");
    expect(app).toContain('from "./auth-client"');
    expect(dashboard).toContain('from "./auth-client"');
    expect(invite).toContain('from "./auth-client"');
    expect(app).toContain('provider: "google"');
    expect(invite).toContain('provider: "google"');
    expect(invite).toContain("browserInviteRedirectUrl");
    expect(dashboard).not.toContain("sayve_access_token");
    expect(invite).not.toContain("@supabase/supabase-js");

    for (const content of [readme, runbook, audit]) {
      expect(content).toContain("Google OAuth");
      expect(content).toContain("own Google account");
      expect(content).toContain("household_id");
    }
  });

  it("keeps browser auth handoff clearing stale family and invite state after session loss or user switch", () => {
    const app = readFileSync(join(process.cwd(), "src", "components", "family-memory-app.tsx"), "utf8");
    const invite = readFileSync(join(process.cwd(), "src", "components", "invite-acceptance.tsx"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const runbook = readFileSync(join(process.cwd(), "docs", "deployment-runbook.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");

    expect(app).toContain("if (session?.accessToken || prototypeUserId) return;");
    expect(app).toContain('setHouseholds([]);');
    expect(app).toContain('setInviteLink("");');
    expect(app).toContain('setInviteEmail("");');
    expect(invite).toContain("previousUserIdRef");
    expect(invite).toContain("setAcceptedHouseholdId(\"\")");
    expect(invite).toContain("previousUserId !== currentUserId");

    expect(readme).toContain("signed-in browser user changes");
    expect(readme).toContain("household_id");
    expect(runbook).toContain("changes to another user");
    expect(runbook).toContain("household_id");
    expect(audit).toContain("signed-in Supabase user changes");
    expect(audit).toContain("household_id");
  });

  it("keeps household onboarding routes returning stable JSON on unexpected failures", () => {
    const createRoute = readFileSync(join(process.cwd(), "src", "app", "api", "households", "create", "route.ts"), "utf8");
    const inviteRoute = readFileSync(join(process.cwd(), "src", "app", "api", "households", "invite", "route.ts"), "utf8");
    const productInviteRoute = readFileSync(join(process.cwd(), "src", "app", "api", "households", "members", "invite", "route.ts"), "utf8");
    const acceptRoute = readFileSync(join(process.cwd(), "src", "app", "api", "households", "invite", "accept", "route.ts"), "utf8");
    const routeTests = readFileSync(join(process.cwd(), "src", "app", "api", "households-routes.test.ts"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const runbook = readFileSync(join(process.cwd(), "docs", "deployment-runbook.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");

    expect(createRoute).toContain("unexpectedAdminErrorResponse");
    expect(inviteRoute).toContain("unexpectedAdminErrorResponse");
    expect(productInviteRoute).toContain("unexpectedApiErrorResponse");
    expect(acceptRoute).toContain("unexpectedAdminErrorResponse");
    expect(routeTests).toContain("returns stable admin JSON when founder household creation throws unexpectedly");
    expect(routeTests).toContain("returns stable product JSON when owner invite creation throws unexpectedly");
    expect(readme).toContain("stable");
    expect(runbook).toContain("temporary_unavailable");
    expect(audit).toContain("temporary_unavailable");
  });

  it("keeps deployment smoke able to prove end-to-end invite acceptance with a fresh account", () => {
    const deploymentVerifier = readFileSync(join(process.cwd(), "scripts", "verify-deployment.mjs"), "utf8");
    const adminPage = readFileSync(join(process.cwd(), "src", "app", "admin", "page.tsx"), "utf8");
    const progressDoc = readFileSync(join(process.cwd(), "docs", "current-build-progress.md"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const runbook = readFileSync(join(process.cwd(), "docs", "deployment-runbook.md"), "utf8");

    expect(deploymentVerifier).toContain("SAYVE_TEST_INVITE_ACCEPT_SUPABASE_ACCESS_TOKEN");
    expect(deploymentVerifier).toContain("SAYVE_REQUIRE_INVITE_ACCEPT_SMOKE");
    expect(deploymentVerifier).toContain("verifyInviteAcceptanceSmoke");
    expect(deploymentVerifier).toContain("/api/households/invite/accept");
    expect(deploymentVerifier).toContain("invite acceptance smoke ok");
    expect(adminPage).toContain("Invite Accept Token");
    expect(adminPage).toContain("SAYVE_TEST_INVITE_ACCEPT_SUPABASE_ACCESS_TOKEN");
    expect(progressDoc).toContain("invite acceptance");
    expect(readme).toContain("SAYVE_TEST_INVITE_ACCEPT_SUPABASE_ACCESS_TOKEN");
    expect(runbook).toContain("SAYVE_TEST_INVITE_ACCEPT_SUPABASE_ACCESS_TOKEN");
  });

  it("keeps browser and future app private API calls on the bearer plus household header contract", () => {
    const app = readFileSync(join(process.cwd(), "src", "components", "family-memory-app.tsx"), "utf8");
    const dashboard = readFileSync(join(process.cwd(), "src", "components", "dashboard-view.tsx"), "utf8");
    const invite = readFileSync(join(process.cwd(), "src", "components", "invite-acceptance.tsx"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const runbook = readFileSync(join(process.cwd(), "docs", "deployment-runbook.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");

    const appPostJson = app.slice(app.indexOf("async function postJson"), app.indexOf("function confidenceText"));
    expect(appPostJson).toContain("storedAuthHeaders()");
    expect(app).toContain('fetch("/api/households", { headers: storedAuthHeaders() })');
    expect(app).toContain('headers: { "content-type": "application/json", ...storedAuthHeaders() }');
    expect(app).toContain('fetch("/api/captures/receipt", { method: "POST", headers: storedAuthHeaders(), body: form })');

    for (const endpoint of ["/api/captures/text", "/api/captures/voice", "/api/conversation/ask"]) {
      expect(app).toContain(endpoint);
    }

    const dashboardPostJson = dashboard.slice(dashboard.indexOf("async function postJson"), dashboard.indexOf("async function getDashboard"));
    const dashboardGet = dashboard.slice(dashboard.indexOf("async function getDashboard"), dashboard.indexOf("function money"));
    expect(dashboardPostJson).toContain("storedAuthHeaders()");
    expect(dashboardGet).toContain("storedAuthHeaders()");
    for (const endpoint of ["/api/categories", "/api/memory/correct", "/api/views/dashboard"]) {
      expect(dashboard).toContain(endpoint);
    }

    expect(invite).toContain('authorization: `Bearer ${session.accessToken}`');
    expect(invite).toContain("window.localStorage.setItem(authStorageKeys.householdId, householdId)");

    for (const content of [readme, runbook, audit]) {
      expect(content).toContain("Authorization: Bearer");
      expect(content).toContain("x-household-id");
      expect(content).toContain("future");
    }
  });

  it("keeps household listing from silently falling back to prototype mode during real auth", () => {
    const householdsRoute = readFileSync(join(process.cwd(), "src", "app", "api", "households", "route.ts"), "utf8");
    const authBoundary = readFileSync(join(process.cwd(), "src", "app", "api", "auth-boundary.test.ts"), "utf8");
    const app = readFileSync(join(process.cwd(), "src", "components", "family-memory-app.tsx"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const runbook = readFileSync(join(process.cwd(), "docs", "deployment-runbook.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");

    expect(householdsRoute).toContain('error: "temporary_unavailable"');
    expect(householdsRoute).toContain("if (isSupabaseAuthRequired())");
    expect(authBoundary).toContain("does not fall back to a prototype household list when service storage is unavailable in real auth mode");
    expect(app).toContain('setHouseholds([]);');
    expect(app).toContain('setSelectedHouseholdId("");');
    expect(app).toContain("家庭資料暫時未連上，請稍後再試。");
    expect(app).toContain("呢個帳戶未加入任何家庭。");

    for (const content of [readme, runbook, audit]) {
      expect(content).toContain("temporary_unavailable");
      expect(content).toContain("prototype");
      expect(content).toContain("household");
    }
  });

  it("keeps founder export useful for raw tables and readable views during handoff", () => {
    const adminPage = readFileSync(join(process.cwd(), "src", "app", "admin", "page.tsx"), "utf8");
    const exportRoute = readFileSync(join(process.cwd(), "src", "app", "api", "admin", "export", "route.ts"), "utf8");
    const setupBundleRoute = readFileSync(join(process.cwd(), "src", "app", "api", "admin", "founder", "setup-bundle", "route.ts"), "utf8");
    const founderConsole = readFileSync(join(process.cwd(), "src", "server", "admin", "founder-console.ts"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");

    expect(adminPage).toContain("ExportLinks");
    expect(adminPage).toContain("scope=\"view\"");
    expect(adminPage).toContain("JSON");
    expect(exportRoute).toContain('const scope = scopeParam === "view" ? "view" : scopeParam === "bundle" ? "bundle" : "raw"');
    expect(exportRoute).toContain('const format = url.searchParams.get("format") === "json" ? "json" : "csv"');
    expect(exportRoute).toContain("getFounderExportRows");
    expect(exportRoute).toContain("getFounderSetupBundle");
    expect(exportRoute).toContain("getFounderIntegrationBundle");
    expect(exportRoute).toContain('name === "integration"');
    expect(exportRoute).toContain("Unknown founder");
    expect(setupBundleRoute).toContain("getFounderSetupBundle");
    expect(setupBundleRoute).toContain("getLaunchReadinessReport");
    expect(founderConsole).toContain("getFounderReadableViews");
    expect(founderConsole).toContain("schemaMigrationProof");
    expect(founderConsole).toContain("liveProofGaps");
    expect(founderConsole).toContain("getFounderExportRows");
    expect(founderConsole).toContain("getFounderSetupBundle");
    expect(founderConsole).toContain("getFounderIntegrationBundle");
    expect(setupBundleRoute).toContain("Founder Console is not available");

    expect(readme).toContain("launch-completion-audit");
    expect(readme).toContain("schemaDictionary");
    expect(readme).toContain("/api/admin/founder/setup-bundle");
    expect(readme).toContain('/api/admin/export?scope=bundle&name=integration&format=json');
    expect(readme).toContain('/api/admin/export?scope=bundle&name=live-proof&format=json');
    expect(readme).toContain("SAYVE_DEPLOY_PROOF_REPORT_PATH=outputs/setup/deploy-proof-report.json");
    expect(readme).toContain("outputs/setup/deploy-proof-summary.md");
    expect(readme).toContain("format=json");
    expect(audit).toContain("schemaDictionary");
    expect(audit).toContain("/api/admin/founder/setup-bundle");
    expect(audit).toContain('/api/admin/export?scope=bundle&name=integration&format=json');
    expect(audit).toContain('/api/admin/export?scope=bundle&name=live-proof&format=json');
    expect(audit).toContain("deploy-proof-summary.md");
  });

  it("keeps deployment verifier proving founder setup bundle on live deployments", () => {
    const deploymentVerifier = readFileSync(join(process.cwd(), "scripts", "verify-deployment.mjs"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");

    expect(deploymentVerifier).toContain("function summarizeLaunchReadinessChecks");
    expect(deploymentVerifier).toContain("Required migrations:");
    expect(deploymentVerifier).toContain("rollout required migrations");
    expect(deploymentVerifier).toContain("rollout next actions");
    expect(deploymentVerifier).toContain('requestJson("/api/admin/founder/setup-bundle")');
    expect(deploymentVerifier).toContain("SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN=");
    expect(deploymentVerifier).toContain("smokeTokenGuide is missing bootstrap token instructions");
    expect(deploymentVerifier).toContain("SAYVE_REQUIRE_BOOTSTRAP_SMOKE=1");
    expect(deploymentVerifier).toContain('/api/admin/export?scope=bundle&name=setup&format=json');
    expect(deploymentVerifier).toContain('/api/admin/export?scope=bundle&name=integration&format=json');
    expect(deploymentVerifier).toContain('/api/admin/export?scope=bundle&name=live-proof&format=json');
    expect(deploymentVerifier).toContain("integration bundle is missing bootstrap token guide row");
    expect(deploymentVerifier).toContain("integration bundle is missing bootstrap deploy smoke rows");
    expect(deploymentVerifier).toContain("integration bundle publicLaunch command is missing bootstrap token env");
    expect(deploymentVerifier).toContain("integration bundle is missing schema migration proof rows");
    expect(deploymentVerifier).toContain("live-proof bundle is missing required proof views");
    expect(deploymentVerifier).toContain("founder live-proof bundle export ok");
    expect(deploymentVerifier).toContain("verifyAppliedMigrationProofRows");
    expect(deploymentVerifier).toContain("is missing applied_migration proof rows");
    expect(deploymentVerifier).toContain("has missing applied migrations for");
    expect(deploymentVerifier).toContain("capture_output_budget");
    expect(deploymentVerifier).toContain("conversation_output_budget");
    expect(deploymentVerifier).toContain("launchCompletionAudit");
    expect(deploymentVerifier).toContain("commands.strictPrivateBetaProof");
    expect(deploymentVerifier).toContain("strict private beta proof commands are missing");
    expect(deploymentVerifier).toContain("verifyFounderSetupBundleSmoke");
    expect(deploymentVerifier).toContain("signature");
    expect(deploymentVerifier).toContain("commands.privateBeta");
    expect(deploymentVerifier).toContain("commands.strictPrivateBeta");
    expect(deploymentVerifier).toContain("commands.publicLaunch");
    expect(deploymentVerifier).toContain("SAYVE_DEPLOY_PROOF_REPORT_PATH");
    expect(deploymentVerifier).toContain("SAYVE_DEPLOY_PROOF_SUMMARY_PATH");
    expect(deploymentVerifier).toContain("writeProofReport");
    expect(deploymentVerifier).toContain("writeProofSummary");
    expect(deploymentVerifier).toContain('report-deploy-proof.mjs');
    expect(deploymentVerifier).toContain("deploy-proof-summary.md");
    expect(deploymentVerifier).toContain("envTemplate");
    expect(deploymentVerifier).toContain("deployEnvTemplate");
    expect(deploymentVerifier).toContain("oauthChecklist");
    expect(deploymentVerifier).toContain("smokeTokenGuide");
    expect(readme).toContain("deploy-day auth/env/template/checklist payload");
    expect(readme).toContain("stable signature");
    expect(audit).toContain("deploy-day auth/env/checklist views");
    expect(audit).toContain("signature");
  });

  it("keeps founder console surfacing a direct launch blockers panel", () => {
    const adminPage = readFileSync(join(process.cwd(), "src", "app", "admin", "page.tsx"), "utf8");
    const progress = readFileSync(join(process.cwd(), "docs", "current-build-progress.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");

    expect(adminPage).toContain("function LaunchBlockers");
    expect(adminPage).toContain('Panel title="Launch Completion Audit"');
    expect(adminPage).toContain('ExportLinks name="launchCompletionAudit" scope="view"');
    expect(adminPage).toContain('rows={data.readableViews.launchCompletionAudit}');
    expect(adminPage).toContain('Panel title="Launch Blockers"');
    expect(adminPage).toContain('Panel title="Live Proof Gaps"');
    expect(adminPage).toContain('Panel title="Onboarding Proof Steps"');
    expect(adminPage).toContain('Panel title="Schema Migration Proof"');
    expect(adminPage).toContain('ExportLinks name="liveProofGaps" scope="view"');
    expect(adminPage).toContain('ExportLinks name="onboardingProofSteps" scope="view"');
    expect(adminPage).toContain('ExportLinks name="schemaMigrationProof" scope="view"');
    expect(adminPage).toContain("Critical Blockers");
    expect(adminPage).toContain('ExportLinks name="launchBlockers" scope="view"');
    expect(adminPage).toContain("rows={data.readableViews.launchBlockers}");
    expect(progress).toContain("Launch Blockers");
    expect(audit).toContain("Launch Blockers");
  });

  it("keeps setup artifact drift checks in the local verification gate", () => {
    const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");
    const setupVerifier = readFileSync(join(process.cwd(), "scripts", "verify-setup-artifacts.mjs"), "utf8");
    const privateBetaExample = readFileSync(join(process.cwd(), ".env.private-beta.example"), "utf8");
    const publicLaunchExample = readFileSync(join(process.cwd(), ".env.public-launch.example"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");

    expect(packageJson).toContain("verify-setup-artifacts.mjs");
    expect(packageJson).toContain("generate-setup-env-examples.mjs");
    expect(setupVerifier).toContain("founder-setup-report.mjs");
    expect(setupVerifier).toContain("generate-setup-env-examples.mjs");
    expect(setupVerifier).toContain(".env.example");
    expect(setupVerifier).toContain(".env.private-beta.example");
    expect(setupVerifier).toContain(".env.public-launch.example");
    expect(setupVerifier).toContain("copyPasteEnvTemplate");
    expect(setupVerifier).toContain("deploymentEnvTemplate");
    expect(setupVerifier).toContain("content drifted");
    expect(setupVerifier).toContain("smokeTokenGuide");
    expect(setupVerifier).toContain("SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN");
    expect(setupVerifier).toContain("live-rollout-sequence.md");
    expect(setupVerifier).toContain("private-beta-go-live-run-sheet.md");
    expect(setupVerifier).toContain("live-deployment-execution-order.md");
    expect(setupVerifier).toContain("integration-package.json launchCompletionAudit");
    expect(setupVerifier).toContain("deploy-smoke.env is missing required token");
    expect(setupVerifier).toContain("strictPrivateBeta");
    expect(setupVerifier).toContain("verify:deploy:strict-private-beta");
    expect(setupVerifier).toContain("launchCompletionAudit");
    expect(setupVerifier).toContain("launchBlockers");
    expect(privateBetaExample).toContain("SAYVE_ENV_TARGET=private-beta");
    expect(publicLaunchExample).toContain("SAYVE_ENV_TARGET=public-launch");
    expect(readme).toContain(".env.example");
    expect(audit).toContain(".env.example");
  });

  it("keeps founder console exposing a deployment env template for real rollout handoff", () => {
    const adminPage = readFileSync(join(process.cwd(), "src", "app", "admin", "page.tsx"), "utf8");
    const founderConsole = readFileSync(join(process.cwd(), "src", "server", "admin", "founder-console.ts"), "utf8");
    const founderSetupReport = readFileSync(join(process.cwd(), "scripts", "founder-setup-report.mjs"), "utf8");
    const setupSpec = readFileSync(join(process.cwd(), "src", "shared", "setup-artifacts-spec.json"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");

    expect(adminPage).toContain("function DeployEnvTemplateBlock");
    expect(adminPage).toContain('Panel title="Deployment Env Template"');
    expect(adminPage).toContain('ExportLinks name="deployEnvTemplate" scope="view"');
    expect(founderConsole).toContain('"deployEnvTemplate"');
    expect(founderConsole).toContain("setup-artifacts-spec.json");
    expect(founderSetupReport).toContain("setup-artifacts-spec.json");
    expect(setupSpec).toContain('"privateBetaEnvTemplate"');
    expect(setupSpec).toContain('"deploymentEnvTemplate"');
    expect(readme).toContain("Deployment Env Template");
    expect(audit).toContain("Deployment Env Template");
  });

  it("keeps a generator for stage-specific setup env examples", () => {
    const generator = readFileSync(join(process.cwd(), "scripts", "generate-setup-env-examples.mjs"), "utf8");
    const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");
    const setupSpec = readFileSync(join(process.cwd(), "src", "shared", "setup-artifacts-spec.json"), "utf8");
    const founderSetupReport = readFileSync(join(process.cwd(), "scripts", "founder-setup-report.mjs"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const setupVerifier = readFileSync(join(process.cwd(), "scripts", "verify-setup-artifacts.mjs"), "utf8");

    expect(generator).toContain("setup-artifacts-spec.json");
    expect(generator).toContain('"private-beta"');
    expect(generator).toContain('"public-launch"');
    expect(generator).toContain('"write"');
    expect(generator).toContain("outputs");
    expect(generator).toContain("setup-report.json");
    expect(generator).toContain("handoff.md");
    expect(packageJson).toContain('"report:setup:artifacts": "node scripts/generate-setup-env-examples.mjs write"');
    expect(setupVerifier).toContain("# Sayve Live Rollout Sequence");
    expect(setupSpec).toContain('"privateBetaEnvTemplate"');
    expect(setupSpec).toContain('"deploymentEnvTemplate"');
    expect(setupSpec).toContain('"OPENAI_CAPTURE_MODEL"');
    expect(setupSpec).toContain('"OPENAI_CAPTURE_INPUT_USD_PER_1M"');
    expect(founderSetupReport).toContain('item("ai", "OPENAI_CAPTURE_MODEL", "public_launch"');
    expect(founderSetupReport).toContain('item("cost", "OPENAI_CAPTURE_INPUT_USD_PER_1M", "public_launch"');
    expect(readme).toContain(".env.private-beta.example");
    expect(readme).toContain(".env.public-launch.example");
    expect(readme).toContain("outputs/setup/handoff.md");
    expect(setupVerifier).toContain("handoff.md");
  });

  it("keeps household spending ownership separate from audit attribution", () => {
    const types = readFileSync(join(process.cwd(), "src", "shared", "memory", "types.ts"), "utf8");
    const provider = readFileSync(join(process.cwd(), "src", "server", "ai", "provider.ts"), "utf8");
    const engine = readFileSync(join(process.cwd(), "src", "server", "memory", "engine.ts"), "utf8");
    const dashboard = readFileSync(join(process.cwd(), "src", "components", "dashboard-view.tsx"), "utf8");
    const deploymentVerifier = readFileSync(join(process.cwd(), "scripts", "verify-deployment.mjs"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const runbook = readFileSync(join(process.cwd(), "docs", "deployment-runbook.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");

    expect(types).toContain('ownershipScope: z.enum(["shared", "member"]).default("shared")');
    expect(provider).toContain("function applyOwnershipGuard");
    expect(provider).toContain("No personal owner was specified");
    expect(provider).toContain("ownershipScope='shared'");
    expect(engine).toContain('ownershipScope: draft.financial.ownershipScope ?? "shared"');
    expect(dashboard).toContain('return "公家"');
    expect(deploymentVerifier).toContain('ownershipScope !== "shared"');
    expect(deploymentVerifier).toContain("dashboard lost shared spending ownership");
    for (const content of [readme, runbook, audit]) {
      expect(content).toContain("ownershipScope=shared");
      expect(content).toContain("createdBy");
      expect(content).toContain("公家");
      expect(content).toContain("server-side");
    }
  });

  it("keeps CI running the same full local verification gate", () => {
    const workflow = readFileSync(join(process.cwd(), ".github", "workflows", "verify.yml"), "utf8");
    const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    const runbook = readFileSync(join(process.cwd(), "docs", "deployment-runbook.md"), "utf8");
    const audit = readFileSync(join(process.cwd(), "docs", "production-readiness-audit.md"), "utf8");

    expect(packageJson).toContain('"packageManager": "pnpm@11.7.0"');
    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("branches:");
    expect(workflow).toContain("- main");
    expect(workflow).toContain("pnpm/action-setup@v4");
    expect(workflow).toContain("version: 11.7.0");
    expect(workflow).toContain("actions/setup-node@v4");
    expect(workflow).toContain("node-version: 22");
    expect(workflow).toContain("cache: pnpm");
    expect(workflow).toContain('NEXT_TELEMETRY_DISABLED: "1"');
    expect(workflow).toContain("pnpm install --frozen-lockfile");
    expect(workflow).toContain("pnpm run verify");
    expect(workflow).not.toContain("pnpm run test");

    for (const content of [readme, runbook, audit]) {
      expect(content).toContain(".github/workflows/verify.yml");
      expect(content).toContain("pnpm run verify");
    }
  });
});
