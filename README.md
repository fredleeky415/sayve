# Sayve

Sayve is an AI Native Family Financial Memory, not a bookkeeping app with AI added on top. It is a memory system where capture comes first, AI interprets what happened, facts remain sacred, context evolves, and conversation becomes the primary way to read family finance.

Read the architecture north star first: [Core Architecture Philosophy](docs/core-architecture-philosophy.md).

Deployment handoff: [Sayve Deployment Runbook](docs/deployment-runbook.md).
Founder deploy-day playbook: [Founder Private Beta Execution](docs/founder-private-beta-execution.md).
Founder 中文 checklist: [Founder Private Beta Checklist（中文版）](docs/founder-private-beta-checklist-zh.md).
Founder env worksheet: [Private Beta Env Worksheet（中文版）](docs/founder-private-beta-env-worksheet-zh.md).
Redacted setup snapshot: `pnpm run report:setup` (includes summary, launch blockers, next actions, and ready-to-run smoke commands).
Founder go-live pack: `pnpm run report:go-live` (generates the deploy-day artifact pack and tells you which files to open first).
Deploy proof summary: `pnpm run report:deploy-proof` (turns `outputs/setup/deploy-proof-report.json` into a readable founder summary at `outputs/setup/deploy-proof-summary.md`).

Current launch status: [Production Readiness Audit](docs/production-readiness-audit.md).
Completion audit: [Launch Completion Audit](docs/launch-completion-audit.md).

Business/advisor handoff: [Sayve Manifesto & Mechanics](docs/sayve-manifesto-and-mechanics.md).

## Local development

Use Node `>=22 <25` with pnpm `11.7.0` through Corepack or the pinned `packageManager` field.

```bash
corepack enable
pnpm install
pnpm dev
```

CI uses `.github/workflows/verify.yml` to run the same `pnpm run verify` gate on pull requests and pushes to `main`.

## Local advisor artifacts

Founder/advisor PDFs and screenshots are local deliverables, not production app assets. Generated files live under `outputs/`, which is intentionally git-ignored so large screenshots and PDFs do not enter Vercel deployment bundles.

To regenerate the advisor PDF after starting the local app:

```bash
pnpm exec next dev -H 127.0.0.1 -p 3100
node scripts/capture-sayve-screenshots.mjs
/Users/fred/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/generate-sayve-pdf.py
```

Current local PDF output:

```text
outputs/pdf/sayve-manifesto-mechanics-ui.pdf
```

Optional environment variables:

```bash
OPENAI_API_KEY=
OPENAI_DEFAULT_MODEL=gpt-5.4-mini
OPENAI_CAPTURE_MODEL=gpt-5.4-mini
OPENAI_CAPTURE_MAX_OUTPUT_TOKENS=220
OPENAI_CONVERSATION_MODEL=gpt-5.4-mini
OPENAI_CONVERSATION_MAX_OUTPUT_TOKENS=120
OPENAI_ESCALATION_MODEL=gpt-5.5
OPENAI_RECEIPT_VISION_MODEL=gpt-5.4-mini
OPENAI_RECEIPT_VISION_DISABLED=0
RECEIPT_VISION_MAX_BYTES=8000000
RECEIPT_UPLOAD_MAX_BYTES=10000000
OPENAI_SPEECH_TO_TEXT_MODEL=gpt-4o-mini-transcribe
AUDIO_TRANSCRIPTION_MAX_BYTES=25000000
VOICE_UPLOAD_MAX_BYTES=25000000
MEMORY_STORE_FILE=.data/memory-store.json
MEMORY_STORE_DISABLED=0
MEMORY_REPOSITORY=local_file
APP_ACCESS_TOKEN=
PROTOTYPE_MONTHLY_CAPTURE_LIMIT=300
PROTOTYPE_MONTHLY_RECEIPT_LIMIT=80
PROTOTYPE_MONTHLY_VOICE_LIMIT=120
PROTOTYPE_MONTHLY_CHAT_LIMIT=300
PROTOTYPE_MONTHLY_AI_INTERPRETATION_LIMIT=500
PROTOTYPE_USAGE_LIMITS_DISABLED=0
FOUNDER_CONSOLE_ENABLED=1
ADMIN_CONSOLE_TOKEN=
SUPABASE_AUTH_REQUIRED=0
OPENAI_CAPTURE_INPUT_USD_PER_1M=0
OPENAI_CAPTURE_OUTPUT_USD_PER_1M=0
OPENAI_RECEIPT_VISION_INPUT_USD_PER_1M=0
OPENAI_RECEIPT_VISION_OUTPUT_USD_PER_1M=0
OPENAI_CONVERSATION_INPUT_USD_PER_1M=0
OPENAI_CONVERSATION_OUTPUT_USD_PER_1M=0
OPENAI_STT_INPUT_USD_PER_1M=0
OPENAI_STT_OUTPUT_USD_PER_1M=0
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_DEFAULT_HOUSEHOLD_ID=
SUPABASE_MEDIA_BUCKET=
SAYVE_REQUIRE_MEDIA_STORAGE=0
```

The same list is available in `.env.example` for deployment handoff.
Stage-specific handoff files also exist at `.env.private-beta.example` and `.env.public-launch.example`.
They can be regenerated from the shared spec with `node scripts/generate-setup-env-examples.mjs`.
For a founder-ready local handoff bundle, run `pnpm run report:setup:artifacts`; it writes `outputs/setup/private-beta.env`, `outputs/setup/public-launch.env`, `outputs/setup/deploy-smoke.env`, `outputs/setup/setup-report.json`, `outputs/setup/env-map.md`, `outputs/setup/execution-checklist.md`, `outputs/setup/provider-setup.md`, `outputs/setup/integration-package.json`, `outputs/setup/live-rollout-sequence.md`, `outputs/setup/private-beta-go-live-run-sheet.md`, `outputs/setup/live-deployment-execution-order.md`, and `outputs/setup/handoff.md`. The public-launch artifact now also carries pinned OpenAI model envs, AI media byte guardrails, plus pricing envs, so the founder handoff matches Launch Readiness and cost analytics requirements.

Local verification now also runs `scripts/verify-setup-artifacts.mjs`, which checks that `.env.example`, the redacted founder setup report, and deploy-smoke command templates have not drifted apart.

Without API keys, the app runs with a deterministic local Memory Engine so product flows can be tested.

For private beta deployment, set `APP_ACCESS_TOKEN`. Open the app once with:

```text
/?access_token=your-token
```

The middleware will store a private cookie and remove the token from the URL. API calls should use that cookie or pass `x-app-access-token`; API routes do not accept `access_token` query strings, so tokens do not remain in API URLs or logs.
Blocked API calls return JSON `{ "error": "private_beta_access_required" }`, so web/mobile clients and deployment smoke tests can handle private-beta gating consistently.

For household multi-user mode, Sayve treats a family as one `household` with multiple `household_members`. You and your partner should have separate Supabase Auth users, both linked to the same household. This is one shared Family Memory, not two personal ledgers: simultaneous captures from both members are written into the same household snapshot, while `createdBy` keeps member attribution for audit, corrections, and future member-level views. The app should send the Supabase bearer token plus `x-household-id`; during prototype testing, `x-user-id` can stand in for a logged-in user. Set `SUPABASE_AUTH_REQUIRED=1` when the real login flow is in place; after that, memory and household APIs ignore prototype `x-user-id` and require the bearer token.

`createdBy` is audit attribution, not spending ownership. If a capture does not clearly say the cost belongs to one person personally, Sayve stores the financial fact as `ownershipScope=shared` and the UI shows it as 公家. Only explicit wording such as "我自己", "我個人", "太太自己", or equivalent personal ownership should set `ownershipScope=member`. This is enforced as a server-side deterministic guard after AI interpretation, not only as a prompt instruction.

For the easiest family login, enable Google OAuth in Supabase Auth and add the deployed Sayve URL plus `/invite` callback URL to the Supabase redirect allow list. The web UI supports Google sign-in for both the main Family panel and `/invite`; magic-link email remains a fallback. Each person should use their own Google account, while both accounts are linked to the same `household_id`.

Household onboarding endpoints are available for private beta setup:

```text
GET /api/households
POST /api/households/create
POST /api/households/invite
POST /api/households/members/invite
POST /api/households/invite/accept
```

`GET /api/households` lists the households available to the logged-in user so the web app or future mobile app can choose the active Family Memory. `create` and admin `invite` are founder/admin-only and require `ADMIN_CONSOLE_TOKEN` when configured. Product invite creation uses `POST /api/households/members/invite` and requires the logged-in household `owner`. `GET /api/households/invite/status?token=...` is the lightweight partner-facing preflight endpoint for `/invite`, so the invite page can show pending / accepted / expired state before login instead of only failing after OAuth. `accept` can use either a Supabase Auth bearer token or prototype `x-user-id`; when `SUPABASE_AUTH_REQUIRED=1`, normal invite acceptance must prove the bearer login before parsing the request body, with body `userId` reserved for Founder Console override only when `ADMIN_CONSOLE_TOKEN` is configured and supplied. In real auth mode, product routes must also carry an explicit `x-household-id`; authenticated requests no longer fall back to `SUPABASE_DEFAULT_HOUSEHOLD_ID`, because that id is reserved for founder/smoke setup rather than day-to-day family traffic. In the same real-auth mode, `GET /api/households` must also not fall back to a prototype household list; if the Supabase service client is unavailable, it returns `temporary_unavailable` so deployment problems are visible instead of silently masking them. The web client should clear stale household selection when that happens, when the current account is not yet a member of any household, and when the signed-in browser user changes or signs out. Home should also clear stale family/invite UI state when browser auth disappears, and the invite page should reset previous "已加入" state when another signed-in user arrives. The result is still one shared Family Financial Memory; capture and conversation rows keep `createdBy`/`actorUserId` only for audit, correction history, and future member-level views.

Founder household create / invite / accept routes should also fail with stable no-store JSON if an unexpected server exception happens, rather than leaking framework HTML 500 pages into the onboarding flow.

The partner-facing invite path is `/invite?token=<invite-token>`. The invite API returns `invitePath`, `inviteUrl`, and, when `APP_ACCESS_TOKEN` is configured, `privateBetaInviteUrl` so the Founder Console can send a ready-to-open private beta link. These invite links now also prefer `NEXT_PUBLIC_APP_URL` as the stable origin instead of whichever preview/request host generated the link. `/invite` now preloads a no-store invite status preview so a partner can immediately see the target household, role, masked invited email, or whether the link is already accepted / expired before they go through Google OAuth. If the invite was created for a specific email, Sayve now requires the logged-in account email to match that invite before acceptance. The invited member signs in with their own Google account or magic link, accepts the invite, and Sayve stores the shared `household_id` locally so future capture, chat, and dashboard requests point to the same Family Memory.

The web UI stores the selected `household_id` locally and automatically sends `Authorization: Bearer <supabase token>` plus `x-household-id` with capture, conversation, receipt, category, and dashboard calls. When Supabase browser auth is configured, the UI blocks capture/chat actions until a Supabase session and household are selected, so a partner cannot accidentally write to the wrong memory. Browser auth and invite acceptance now prefer `NEXT_PUBLIC_APP_URL` as the stable OAuth redirect origin, falling back to `window.location.origin` only for local-only testing. In local prototype mode, the small Family panel can also use a prototype user id without Supabase Auth.

Invite rows are service-role only. Browser and future mobile clients should use the onboarding API rather than directly accessing `invites`.

## Prototype storage

For the free prototype stage, Memory Engine state is persisted locally to `.data/memory-store.json` by default. This keeps your demo memories after a dev server restart without paying for Supabase yet.

This is intentionally a prototype storage path:

- Facts remain append-only inside the Memory Engine model.
- Captures, interpretations, facts, context, relationships, revisions, insights, and conversation messages are saved together.
- `.data` is ignored by git because it may contain private household finance data.
- Set `MEMORY_STORE_DISABLED=1` to return to in-memory-only mode.
- Set `MEMORY_STORE_FILE=/path/to/file.json` if you want a different local store.

The storage boundary lives in `src/server/memory/store.ts` as a `MemoryRepository` facade. The default implementation uses the local prototype store; `src/server/memory/supabase-repository.ts` provides the private-beta Supabase snapshot repository. New Memory Engine work should move through that repository boundary instead of reaching deeper into file persistence details.

Current production hardening rule:

- Product code should use `getMemoryRepository(householdId)` rather than importing `getStore()` or `saveStore()` directly.
- The local file repository is fine for founder testing, but not for public multi-user launch.
- Supabase should become the active repository before onboarding real households.
- Set `MEMORY_REPOSITORY=supabase` only after Supabase credentials, `SUPABASE_DEFAULT_HOUSEHOLD_ID`, migrations `003` through `012`, and all auth env vars are configured. Runtime requests use their authenticated `x-household-id`; `SUPABASE_DEFAULT_HOUSEHOLD_ID` is the fallback and smoke-test binding. Missing Supabase config intentionally fails fast instead of silently falling back to local storage.

When real users arrive, replace this local store boundary with the Supabase schema in:

- `supabase/migrations/001_ai_native_memory_engine.sql`
- `supabase/migrations/002_prototype_migration_path.sql`
- `supabase/migrations/003_memory_store_snapshots.sql`
- `supabase/migrations/004_harden_memory_store_access.sql`
- `supabase/migrations/005_harden_household_role_policies.sql`
- `supabase/migrations/006_harden_invite_access.sql`
- `supabase/migrations/007_harden_memory_interpretation_writer_policy.sql`
- `supabase/migrations/008_atomic_invite_acceptance.sql`
- `supabase/migrations/009_revision_actor_attribution.sql`
- `supabase/migrations/010_category_actor_attribution.sql`
- `supabase/migrations/011_harden_memory_fact_payload_constraints.sql`
- `supabase/migrations/012_harden_ai_telemetry_constraints.sql`

`003_memory_store_snapshots.sql` is the transitional production repository. It stores the active `MemoryStoreState` in Supabase JSONB so the web app can run beyond a local demo while the normalized memory tables mature as projections/import targets. Each snapshot is scoped by `household_id`; request handlers pass the active household into the repository so two families cannot write into the same snapshot by accident.

Snapshot commits use an optimistic `revision` guard. If two requests read the same household snapshot and both try to write, the stale commit fails with `supabase_memory_repository_conflict` instead of silently overwriting newer memory. Core write paths use the shared repository retry helper to invalidate the stale household snapshot, re-read the latest memory, and retry the same user action once.

The snapshot table is intentionally service-role-only after migration `004`. Browser and future mobile clients should not read or write `memory_store_snapshots` directly; all memory changes go through Sayve API routes so auth, telemetry, retry, and audit behavior stay consistent.

Migration `005` makes household RLS role-aware for direct Supabase access: `viewer` can read shared memory projections, while only `owner` and `member` can write.

Migration `006` keeps invite rows service-role-only. Browser and future mobile clients should accept invites through Sayve API routes, not by directly reading invite rows or tokens from Supabase.

Migration `007` completes writer policy coverage for normalized Memory interpretation rows, so owner/member write access matches the rest of the projected Memory tables.

Migration `008` moves invite acceptance into a service-role RPC with row locking. This keeps partner onboarding single-use even if two acceptance requests hit the same invite token at nearly the same time.

Migration `009` adds `memory_revisions.actor_user_id` so user corrections, splits, context confirmations, and privacy redactions can be attributed to the acting household member as a queryable field.

Migration `010` adds `household_categories.created_by_user_id` so custom categories that teach Sayve's future classification can be attributed to the household member who created them.

Migration `011` adds Postgres constraints for normalized `memory_facts.payload`, including `ownershipScope` only allowing `shared` or `member`. This keeps the rule "unspecified spending is 公家" protected even if data is staged directly into Supabase.

Migration `012` adds Postgres constraints for normalized `ai_telemetry_events`, including valid phase/provider/status values and non-negative token, cost, and latency metrics. This keeps Founder Console cost and AI health analytics trustworthy even if telemetry is staged directly into Supabase.

Privacy/legal deletion is handled as a separate high-impact path, not as normal memory editing. `POST /api/memory/redact` requires a logged-in household writer and redacts the selected memory's raw capture text, transcripts, file references, structured fact payload, AI interpretation output, related conversation/source text, and linked telemetry metadata while leaving a non-sensitive `privacy_redaction` revision. If a sourced assistant answer points to the redacted memory/fact/capture, Sayve also redacts the adjacent user question/assistant answer pair so sensitive merchant or amount text does not remain in chat history. Ordinary corrections still preserve Facts and only add revisions/context.

Prototype memories can be exported as a Supabase import plan from:

```text
/api/admin/export/supabase
```

The export intentionally keeps local ids such as `cap_xxx`, `mem_xxx`, and `fact_xxx` as `external_id`. The server-side loader resolves those external ids into Supabase UUID foreign keys. This avoids rewriting historical memory references during migration.

The import validator also treats AI telemetry as launch-critical product intelligence. `ai_telemetry_events` rows must include non-negative `total_tokens`, `estimated_cost_usd`, and `duration_ms` values before staging, so migrated data remains useful for Founder Console cost and latency analysis. Capture interpretation telemetry must also keep `capture_external_id`, `memory_object_external_id`, and AI Decisions metadata (`intent`, `decision`, `confidenceBand`, `needsUserInput`) so migrated data can still explain what AI decided.

If `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are configured, the current local memory can also be staged into Supabase:

```text
POST /api/admin/import/supabase/stage
```

Before staging, the app validates external ids and relationships:

```text
GET /api/admin/import/supabase/validate
```

With Supabase env configured, dry-run checks what already exists by `external_id`:

```text
GET /api/admin/import/supabase/dry-run
```

`stage` writes one row into `memory_import_batches` with the full import plan only after validation passes:

```text
POST /api/admin/import/supabase/stage
```

`load` writes the validated import plan into normalized Memory Engine tables through the service role. It resolves `*_external_id` references into Supabase UUID foreign keys, skips existing `external_id` rows, and is intended as a founder-only migration tool rather than a user product path. To reduce accidental writes, first run `dry-run`, then pass its `planSignature` back into `load` with `confirmLoad=true`:

```text
POST /api/admin/import/supabase/load
```

Example:

```json
{
  "confirmLoad": true,
  "planSignature": "<latest dry-run planSignature>"
}
```

## Model routing and cost guardrails

Capture and conversation should not blindly use the same AI path.

- Capture interpretation uses `OPENAI_CAPTURE_MODEL`.
- Capture interpretation output can be kept intentionally small with `OPENAI_CAPTURE_MAX_OUTPUT_TOKENS`.
- Receipt images can use `OPENAI_RECEIPT_VISION_MODEL` before entering the same Memory pipeline.
- Conversation answers use `OPENAI_CONVERSATION_MODEL` when `OPENAI_API_KEY` is configured, and `OPENAI_CONVERSATION_MAX_OUTPUT_TOKENS` keeps replies short; if the provider fails or is not configured, Sayve falls back to a deterministic evidence-pack answer and records the provider/status in telemetry.
- Escalation cases can use `OPENAI_ESCALATION_MODEL`.
- Voice transcription uses `OPENAI_SPEECH_TO_TEXT_MODEL`, then the transcript enters the same Memory pipeline.

Prototype usage limits protect cost without breaking the receipt-inbox habit. If a capture quota is reached, the raw capture is still saved and queued for later interpretation instead of asking the user to re-enter it.

## Founder Console

The internal Founder Console is available at `/admin`. It is a developer/founder tool for monitoring AI Memory Engine health, cost, quality, usage patterns, and telemetry.

- It is not linked from the user interface.
- Set `FOUNDER_CONSOLE_ENABLED=0` to disable it.
- Set `ADMIN_CONSOLE_TOKEN=...` to protect Founder Console and admin APIs.
- Open `/admin?token=...` once to store a HttpOnly admin cookie and clean the token out of the URL.
- Deployment scripts and non-browser clients must send `x-admin-token`; admin APIs do not accept query-string admin tokens.
- API endpoint: `/api/admin/founder`.
- Founder export endpoint supports raw tables and readable views in CSV or JSON, for example:
  - `/api/admin/export?table=facts`
  - `/api/admin/export?scope=raw&name=telemetry&format=json`
  - `/api/admin/export?scope=view&name=schemaDictionary&format=json`
  - `/api/admin/export?scope=bundle&name=setup&format=json`
- Founder setup bundle endpoint exists at `/api/admin/founder/setup-bundle`; it returns launch-readiness, next actions, deploy-day `launchBlockers`, the deploy-day auth/env/template/checklist payload, ready-to-run smoke commands, and a stable signature as one no-store JSON object for handoff tooling.
- Supabase schema/security check endpoint: `GET /api/admin/import/supabase/schema-check`.
- Supabase repository smoke test endpoint: `POST /api/admin/repository/smoke-test`. It can optionally accept `{ "householdId": "<uuid-or-test-id>" }` so founder rollout checks can verify a specific household snapshot instead of only the default smoke household, and it now reports whether that target household row exists plus member/owner/viewer counts and onboarding invite counters.
- Privacy redaction endpoint: `POST /api/memory/redact`.
- Public-safe health endpoint: `/api/health`.
- Household Setup panel can create a founder household, create a partner invite, and accept an invite for private beta setup.
- Founder Console also shows a `Default Household Binding` summary so you can immediately see whether the configured fallback household exists, how many members it has, and whether an owner is present.
- Founder Console now includes a `Setup Guide` panel that translates readiness into concrete next steps such as fixing the default household, adding the partner, or running live smoke.
- Founder Console also includes a `Private Beta Handoff` summary so the founder can see setup progress, what is already done, and the single next action blocking a real private beta.
- Founder Console now includes a `Deploy Smoke Guide` panel with exact private-beta/public-launch commands and the required owner/member/viewer session-token checklist.
- Founder Console now includes a `Deploy Smoke Env Template` panel so strict smoke flags plus owner/member/viewer/fresh-invite env names can be copied as one block on deploy day.
- Founder Console now includes a `Repository Smoke Guide` panel so the founder can target the correct household id, call the founder-only repository smoke endpoint, and read the success fields without reconstructing the contract from docs.
- Founder Console plus the setup-bundle handoff now also include a `Supabase Migration Inventory`, listing every rollout migration file with its stage and checksum so real Supabase setup can verify exactly what should be applied.
- Founder Console now includes a `Public Launch Checks` panel so fail/warn readiness checks are listed directly instead of hiding inside one overall `readyForPublicLaunch` boolean.
- Founder Console now includes a `Live Rollout Checklist` panel that gathers Vercel domain, Supabase Auth/storage, Google OAuth redirect allow-list, media bucket, telemetry proof, and deploy smoke status into one founder-facing setup list.
- Founder Console now also includes a `Launch Completion Audit` view, separating what is already locally proven from what still needs live infrastructure proof.
- Founder Console now includes an `Auth Setup Targets` panel that exposes the exact `NEXT_PUBLIC_APP_URL`, Supabase Auth Site URL, and root + `/invite` redirect allow-list targets for copy/paste setup.
- Founder Console now includes an `Env Setup Matrix` panel so founder/developer handoff can verify private-beta, public-launch, and deploy-smoke env coverage in one exportable table.
- Founder Console plus setup-bundle / handoff artifacts now also include a `Private Beta Setup Gate`, turning the real founder rollout into step-by-step `ready/open/pending/blocked` setup evidence instead of only prose docs.
- Founder Console plus setup-bundle / handoff artifacts now also include an `Integration Readiness` view, grouping Supabase, Google OAuth, Vercel, onboarding, smoke tokens, and OpenAI by external system so real setup can see which integration is still incomplete.
- Founder Console plus setup-bundle / handoff artifacts now also include an `Integration Package`, so the exact fields/targets for Supabase, Google OAuth, Vercel, and OpenAI can be exported as one copy-paste integration table.
- Founder export now also supports `/api/admin/export?scope=bundle&name=integration&format=json`, a smaller handoff bundle focused only on external system setup: auth targets, env setup, integration readiness, integration package, OAuth checklist, and smoke-token guidance.
- Founder export now also supports `/api/admin/export?scope=bundle&name=live-proof&format=json`, a rollout-evidence bundle focused on live proof gaps, onboarding proof steps, public-launch checks, migration proof, deploy-smoke envs, and smoke-token guidance.
- Founder Console now includes a `Deployment Env Template` panel so real Vercel/public-launch env values and smoke-proof placeholders can be copied from one exportable block.
- Founder Console now includes a `Smoke Token Guide` panel so deploy-day owner/member/viewer/fresh-invite session-token collection can be done from one exportable checklist instead of memory or guesswork.
- Founder Console now includes an `Onboarding Health` panel for pending / accepted / expired / email-locked household invites.
- Launch Readiness now also checks that Founder `Onboarding Health` is readable, so partner invite monitoring cannot silently break before public launch.
- Every AI call or AI decision path should leave telemetry in `aiTelemetry`.
- AI Runtime Health tracks fallback rate, error rate, limited rate, average latency, P95 latency, slowest phase, and telemetry completeness.
- AI Decisions tracks capture decision outcomes from telemetry: auto-confirm, review-later, ask-user, low confidence, intent mix, and decision mix.

Cost numbers are estimated from telemetry and configurable per-token pricing env vars. Keep the pricing vars updated when models or vendor pricing changes.

## Public launch gate

Before exposing Sayve to public users, check:

```text
GET /api/admin/launch-readiness
```

or view the Launch Readiness panel in `/admin`. This now includes the live Supabase schema/security gate, telemetry completeness, and browser auth redirect readiness, not only environment variables. Deployment smoke also requires the live response to include the latest readiness check ids, including `app_base_url`, `supabase_url_consistency`, `supabase_key_boundary`, `ai_media_limits`, and `ai_telemetry_completeness`, so an older deployed build cannot accidentally pass.

Before setting Vercel env, run the local preflight for the target stage:

```bash
SAYVE_ENV_TARGET=private-beta pnpm run verify:env
SAYVE_ENV_TARGET=public-launch pnpm run verify:env
```

Or use the bundled shortcuts:

```bash
pnpm run verify:private-beta
pnpm run verify:public-launch
```

Vercel uses `vercel.json` so deployment installs with `pnpm install --frozen-lockfile` and runs `pnpm run verify:scripts`, `pnpm run verify:env`, `pnpm run typecheck`, `pnpm run verify:migrations`, and `pnpm run build` before serving the app. For the first real private beta deploy, set `SAYVE_ENV_TARGET=private-beta` in Vercel. Only switch a deployment to `SAYVE_ENV_TARGET=public-launch` after the live smoke test has passed and `SAYVE_DEPLOYMENT_SMOKE_VERIFIED=1` has been set, because public launch preflight intentionally blocks unproven deployments.

After deployment, run:

```bash
SAYVE_DEPLOY_URL=https://your-domain APP_ACCESS_TOKEN=... ADMIN_CONSOLE_TOKEN=... pnpm run verify:deploy
```

Public-ready deployment smoke must target an HTTPS non-local URL. Use `SAYVE_REQUIRE_PUBLIC_READY=0` only for local or private smoke tests such as `http://localhost:3000`.

Shortcuts:

```bash
SAYVE_DEPLOY_URL=https://your-domain APP_ACCESS_TOKEN=... ADMIN_CONSOLE_TOKEN=... pnpm run verify:deploy:private-beta
SAYVE_DEPLOY_URL=https://your-domain APP_ACCESS_TOKEN=... ADMIN_CONSOLE_TOKEN=... pnpm run verify:deploy:public-launch
```

For a real multi-member smoke test, add:

```bash
SAYVE_REQUIRE_AUTH_SMOKE=1 \
SAYVE_REQUIRE_TWO_MEMBER_SMOKE=1 \
SAYVE_REQUIRE_VIEWER_SMOKE=1 \
SAYVE_REQUIRE_INVITE_SMOKE=1 \
SAYVE_REQUIRE_BOOTSTRAP_SMOKE=1 \
SAYVE_REQUIRE_OPENAI_SMOKE=1 \
SAYVE_REQUIRE_PRIVACY_SMOKE=1 \
SAYVE_TEST_SUPABASE_ACCESS_TOKEN=<supabase-session-access-token> \
SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN=<partner-supabase-session-access-token> \
SAYVE_TEST_VIEWER_SUPABASE_ACCESS_TOKEN=<viewer-supabase-session-access-token> \
SAYVE_TEST_INVITE_ACCEPT_SUPABASE_ACCESS_TOKEN=<fresh-unjoined-supabase-session-access-token> \
SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN=<fresh-no-household-supabase-session-access-token> \
SAYVE_TEST_HOUSEHOLD_ID=<household uuid>
```

The verifier will check the private beta gate, Launch Readiness response shape including `configReadyForPrivateBeta`, `liveSmokeVerified`, `readyForPublicLaunch`, `app_base_url`, `supabase_url_consistency`, `supabase_key_boundary`, `ai_media_limits`, and `ai_telemetry_completeness`, the live founder setup bundle payload at `/api/admin/founder/setup-bundle`, the exported setup-bundle artifact at `/api/admin/export?scope=bundle&name=setup&format=json`, the exported integration bundle at `/api/admin/export?scope=bundle&name=integration&format=json`, the exported live-proof bundle at `/api/admin/export?scope=bundle&name=live-proof&format=json`, and the stable signature shared by the setup-bundle routes, plus deployed Supabase schema/security checks, non-mutating Supabase import validate/dry-run planning, partner invite link generation, optional end-to-end invite acceptance with `SAYVE_TEST_INVITE_ACCEPT_SUPABASE_ACCESS_TOKEN`, optional first-run household bootstrap with `SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN`, onboarding no-store headers, Founder Console `Onboarding Health` visibility for pending and email-locked invites, unauthenticated malformed JSON rejection before body parsing on high-frequency capture/conversation routes, authenticated household list, one `[smoke]` text capture for the primary member, receipt and voice multipart captures with provided note/transcript, Founder Console capture interpretation telemetry for those new captures with token/cost/latency fields and AI Decisions metadata, one authenticated conversation question with Founder Console telemetry, successful OpenAI capture and conversation telemetry when `SAYVE_REQUIRE_OPENAI_SMOKE=1` or public-ready smoke is required, live privacy redaction of memory detail, linked telemetry, and the sourced user question/assistant answer pair when `SAYVE_REQUIRE_PRIVACY_SMOKE=1` or public-ready smoke is required, one `[smoke]` capture for the second member, custom category creation with `createdByUserId` preserved in Dashboard and Founder Console raw tables, viewer read-only enforcement for capture and categories, and the shared household dashboard/timeline containing the exact new fact ids, `createdBy` attribution from both members, and default `ownershipScope=shared` for unspecified spending. Public-ready smoke now also enforces bootstrap proof for a fresh zero-household account, alongside the second member and viewer checks by default; use `SAYVE_REQUIRE_PUBLIC_READY=0` only for local/private smoke. Local route tests also cover the broader private JSON write boundary for capture, category, context, and memory correction endpoints. The schema/security checks include `memory_store_snapshots_service_role_only` from migration `004`, `household_role_policies` from migrations `005` and `007`, `invites_service_role_only` from migration `006`, `invites_atomic_acceptance` from migration `008`, the `memory_revisions.actor_user_id` column from migration `009`, the `household_categories.created_by_user_id` column from migration `010`, `memory_facts_payload_shape` from migration `011`, `ai_telemetry_shape` from migration `012`, and `media_storage_bucket` for the configured receipt/voice Supabase Storage bucket. The deployment smoke intentionally does not call `/api/admin/import/supabase/load`; loading normalized tables remains a founder-controlled write step after validate/dry-run looks correct.

For private beta verification, use `pnpm run verify:deploy:private-beta` if config is ready but the public launch smoke marker has not been set yet. For public launch, use `pnpm run verify:deploy:public-launch`.

If you want a reusable proof artifact after a live smoke run, add `SAYVE_DEPLOY_PROOF_REPORT_PATH`:

```text
SAYVE_DEPLOY_PROOF_REPORT_PATH=outputs/setup/deploy-proof-report.json SAYVE_DEPLOY_URL=https://your-domain APP_ACCESS_TOKEN=... ADMIN_CONSOLE_TOKEN=... pnpm run verify:deploy:strict-private-beta
```

The JSON report records the deploy URL, whether public-ready smoke was required, which live session tokens were present, launch-readiness snapshot/checks, plus any warnings/failures from the run.

There is also a ready-made shortcut for the common founder case:

```text
pnpm run verify:deploy:strict-private-beta:proof
```

It uses the same strict private-beta smoke coverage and writes:

- `outputs/setup/deploy-proof-report.json`
- `outputs/setup/deploy-proof-summary.md`

If you want to regenerate the human-readable summary later:

```text
pnpm run report:deploy-proof
```

That writes `outputs/setup/deploy-proof-summary.md`, which gives you the pass/fail headline, missing live proof, and suggested next move without opening raw JSON.

After the live deployment smoke test passes, set `SAYVE_DEPLOYMENT_SMOKE_VERIFIED=1`, `SAYVE_DEPLOYMENT_SMOKE_VERIFIED_AT=<ISO timestamp>`, and `SAYVE_DEPLOYMENT_SMOKE_TARGET=<deployed URL>` in the deployment environment and redeploy. The app should not be treated as public-launch ready unless `/api/admin/launch-readiness` returns `readyForPublicLaunch: true`.

Hard launch requirements:

- `ADMIN_CONSOLE_TOKEN` is configured.
- `APP_ACCESS_TOKEN` is configured for private beta access unless full Supabase Auth is in place.
- Supabase service credentials are configured.
- `SUPABASE_URL`, when configured for server-side Supabase access, points to the same project host as `NEXT_PUBLIC_SUPABASE_URL`.
- `NEXT_PUBLIC_SUPABASE_URL` is configured as a valid public Supabase project URL; server-only `SUPABASE_URL` is not enough for browser login.
- `SUPABASE_SERVICE_ROLE_KEY` is a server-only service-role/secret key and is different from `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- `SUPABASE_MEDIA_BUCKET` is configured as a private Supabase Storage bucket so receipt/voice uploads persist original source files without public exposure.
- `RECEIPT_UPLOAD_MAX_BYTES` and `VOICE_UPLOAD_MAX_BYTES` are explicitly configured before public launch or whenever media storage is required.
- `SUPABASE_AUTH_REQUIRED=1` is configured for real household member access.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` is configured so browser/mobile clients can log in.
- `SUPABASE_DEFAULT_HOUSEHOLD_ID` is configured when `MEMORY_REPOSITORY=supabase`, and Launch Readiness now checks that the household row actually exists in live Supabase, has at least one member, and already has an `owner` before treating the binding as healthy.
- The active Memory Repository is no longer the local prototype store.
- Usage limits are enabled.
- All AI pricing env vars are configured as valid non-negative numbers for Founder Console cost analytics.
- `ai_telemetry_shape` passes after migration `012`, proving telemetry phase/provider/status and token/cost/latency metrics are database-guarded.
- `SAYVE_DEPLOYMENT_SMOKE_VERIFIED=1` plus `SAYVE_DEPLOYMENT_SMOKE_VERIFIED_AT` and `SAYVE_DEPLOYMENT_SMOKE_TARGET` are set only after `pnpm run verify:deploy` passes against the live deployment with authenticated household smoke.
- `SAYVE_REQUIRE_TWO_MEMBER_SMOKE=1` has passed before treating the app as ready for real family use.
- `SAYVE_REQUIRE_VIEWER_SMOKE=1` has passed before treating viewer/read-only access as ready.
- `SAYVE_REQUIRE_INVITE_SMOKE=1` has passed before treating partner invite onboarding as ready.
- `SAYVE_REQUIRE_OPENAI_SMOKE=1` has passed before treating the configured OpenAI capture and conversation models as ready.
- `SAYVE_REQUIRE_PRIVACY_SMOKE=1` has passed before treating privacy/legal redaction as ready.
- `OPENAI_CAPTURE_MODEL`, `OPENAI_CONVERSATION_MODEL`, `OPENAI_ESCALATION_MODEL`, `OPENAI_RECEIPT_VISION_MODEL`, and `OPENAI_SPEECH_TO_TEXT_MODEL` are explicitly pinned whenever `OPENAI_API_KEY` is configured, so telemetry and Founder Console cost/model mix stay auditable.

Warnings can still be acceptable for founder-only testing, but failures mean the app is still in prototype mode.
