# Sayve Production Readiness Audit

Last updated: 2026-07-11

## Status

Sayve is locally well-prepared for private beta: storage boundary, Supabase migration proof, Founder Console telemetry, setup artifacts, and deployment smoke coverage are all in place in code and verification.

Sayve is still not fully proven launch-ready because real live infrastructure proof is pending:

- real Supabase project migrations/security have not yet been proven against the deployed project
- real Vercel deployment smoke has not yet been completed end-to-end
- real OpenAI production telemetry has not yet been observed under deployed traffic
- real founder/partner/viewer onboarding has not yet been completed on live infra

## Evidence Snapshot (2026-07-11)

Latest local evidence from this repo:

- targeted audit pack passed: `118/118`
- deploy-handoff drift pack passed: `81/81`
- setup artifact verifier passed: `node scripts/verify-setup-artifacts.mjs`
- production build passed: `next build`

This means the strongest remaining blockers are now live-environment proof rather than missing local architecture.

## Verified In Code

- Production storage boundary exists through `MemoryRepository`.
- Runtime can switch to Supabase with `MEMORY_REPOSITORY=supabase`.
- Supabase snapshot storage exists in `memory_store_snapshots`.
- Supabase snapshot reads/writes are scoped by request household id; `SUPABASE_DEFAULT_HOUSEHOLD_ID` is fallback/smoke-test binding.
- Launch Readiness now verifies that `SUPABASE_DEFAULT_HOUSEHOLD_ID` points to a real live Supabase household row, already has members, and includes an owner role, not just a configured env string.
- Financial facts separate audit actor from spending ownership: unspecified member ownership defaults to `ownershipScope=shared`/公家 through a deterministic server-side guard after AI interpretation, while explicit personal wording can set `ownershipScope=member`.
- Supabase snapshot commits use optimistic `revision` checks to avoid silent concurrent overwrite.
- Supabase snapshot duplicate first-insert races are treated as retryable repository conflicts, so simultaneous first household writes can reload and retry instead of failing as a non-retryable commit error.
- Supabase snapshot reads normalize malformed/legacy JSONB state into safe MemoryStoreState arrays instead of crashing production reads.
- Supabase snapshot direct client access is disabled by migration `004`; server service role owns MemoryStoreState reads/writes.
- Direct Supabase household RLS is role-aware after migrations `005` and `007`; `viewer` is read-only and `owner/member` can write normalized Memory projections.
- Supabase invite rows are service-role-only after migration `006`; invite tokens are handled through Sayve onboarding APIs.
- Invite acceptance is atomic after migration `008`; a row-locking service-role RPC adds the member and marks the invite accepted as one database operation.
- User revision actor attribution is queryable after migration `009`; `memory_revisions.actor_user_id` stores the acting household member where available.
- Custom category actor attribution is queryable after migration `010`; `household_categories.created_by_user_id` stores which member taught Sayve the category when available.
- Financial fact payload shape is database-guarded after migration `011`; `memory_facts.payload.ownershipScope` can only be `shared` or `member`, preserving 公家 defaults even during direct Supabase staging.
- AI telemetry shape is database-guarded after migration `012`; `ai_telemetry_events` phase/provider/status and token, cost, and latency metrics are constrained for Founder Console analytics.
- Supabase import export/validation only projects auth foreign-key fields when values are valid Supabase Auth UUIDs; prototype labels remain in metadata/diff.
- Core write paths share retry handling for stale `supabase_memory_repository_conflict` responses.
- Founder Console can aggregate multiple household snapshots for internal monitoring.
- Normalized Memory Engine schema exists for long-term projection/import.
- AI telemetry is recorded through async repository paths.
- Capture retry after Supabase snapshot conflicts reuses the prepared capture and AI interpretation draft, reducing duplicate OpenAI calls and keeping retry telemetry cleaner.
- Founder Console exposes AI cost, quality, usage, raw tables, and launch readiness.
- Founder Console raw tables include custom categories with `createdByUserId`, so category-learning changes are founder-auditable.
- Founder Console exposes AI runtime health, including fallback/error/limited rates and latency.
- Founder Console exposes telemetry completeness, including missing token, cost, and latency counts.
- Launch Readiness now reads Founder telemetry completeness and blocks public launch when live AI events are missing token, cost, or latency fields.
- Conversation answers use `OPENAI_CONVERSATION_MODEL` when configured, fall back to deterministic evidence-pack answers when unavailable, and record provider, status, token, cost, and latency metrics so chat usage contributes to Founder Console cost and performance monitoring.
- Env preflight and Launch Readiness require AI model env vars to be pinned whenever OpenAI is enabled, so capture, conversation, escalation, receipt vision, and speech telemetry remain cost-auditable.
- Env preflight and Launch Readiness now also require `AUDIO_TRANSCRIPTION_MAX_BYTES` and `RECEIPT_VISION_MAX_BYTES` whenever OpenAI is enabled, so audio/vision cost and latency guardrails are explicit before rollout.
- Launch Readiness marks missing `OPENAI_API_KEY` as a direct failure when `SAYVE_ENV_TARGET=public-launch`, matching the public-launch env preflight.
- Launch Readiness marks missing/invalid AI model, AI media guardrail, or pricing env as direct failures when `SAYVE_ENV_TARGET=public-launch`, matching the public-launch env preflight.
- Supabase import validation rejects AI telemetry rows without non-negative token, cost, and latency metrics before staging.
- Supabase import validation rejects capture interpretation telemetry without capture/memory links and AI Decisions metadata, so migrated Founder Console data can still explain what AI decided.
- Supabase import loader test proves capture interpretation telemetry keeps resolved capture/memory foreign keys and AI Decisions metadata when written into normalized tables.
- Supabase import validation rejects malformed financial fact payloads using the shared `FinancialFactPayloadSchema`, including invalid `ownershipScope`, direction, or money shape before staging.
- Founder-only Supabase import loading can write a validated import plan into normalized Memory Engine tables, resolving `*_external_id` fields into Supabase UUID foreign keys and skipping rows already present by `external_id`.
- Founder-only Supabase import loading now requires explicit `confirmLoad=true` plus the latest `planSignature` from `dry-run`, reducing accidental normalized-table writes during migration.
- Deployment verifier checks non-mutating Supabase import validate/dry-run endpoints, including `rowsInPlan`/`rowsToInsert` summaries, so the migration path can be proven without writing normalized tables.
- Supabase admin import/export routes return stable no-store JSON for unexpected server errors, so Founder Console and deployment scripts do not receive framework HTML 500 responses.
- Private beta access can be protected by `APP_ACCESS_TOKEN`.
- Private beta middleware returns JSON for blocked API calls and stores access in an HTTP-only cookie after `?access_token=...`.
- API routes reject `access_token` query strings; deployment scripts and non-browser clients must use `x-app-access-token`, while browsers use the HttpOnly cookie set by the sanitized page redirect.
- Private beta redirect/block responses are no-store/noindex so access-token flows are not cached or indexed.
- Admin endpoints can be protected by `ADMIN_CONSOLE_TOKEN`.
- Founder Console token URLs are sanitized by middleware: `/admin?token=...` sets a HttpOnly admin cookie and redirects to `/admin`; admin APIs reject query-string admin tokens and scripts use `x-admin-token`.
- Env preflight and Launch Readiness reject weak or reused `APP_ACCESS_TOKEN` / `ADMIN_CONSOLE_TOKEN` values.
- Env preflight, Launch Readiness, and deployment smoke enforce Supabase production storage boundaries: `SUPABASE_URL` must match the public project host when set, `supabase_url_consistency` must be present in readiness, and `SUPABASE_SERVICE_ROLE_KEY` must stay separated from browser anon/publishable keys through `supabase_key_boundary`.
- Launch Readiness does not report `configReadyForPrivateBeta` when private-beta access, token strength, Supabase repository mode, usage limits, or OpenAI-enabled model config are still only warnings.
- API, admin routes, and the exact Founder Console page are protected with `Cache-Control: no-store` and `X-Robots-Tag: noindex` headers.
- Private household memory API responses, including capture, conversation, dashboard, timeline, memory detail, context, insights, and invalid JSON envelopes, are no-store/noindex.
- Partner `/invite` page is protected with `Cache-Control: no-store` and `X-Robots-Tag: noindex` headers.
- Multi-member household API context supports Supabase Auth bearer token and `x-household-id`; prototype `x-user-id` is ignored once `SUPABASE_AUTH_REQUIRED=1`.
- Browser and future app private memory calls are guarded by the same `Authorization: Bearer <supabase token>` plus `x-household-id` contract; invite acceptance stores the household id before later capture/chat/dashboard calls.
- Captures and user conversation messages preserve member attribution with `createdBy`/`created_by` while still writing into one shared household memory.
- User corrections and context confirmations preserve the acting member id in revision metadata for AI learning and household audit.
- Household API role checks allow `owner/member` to write shared memory while `viewer` can only read.
- Privacy redaction API exists at `POST /api/memory/redact`; it is separate from normal correction flow and redacts raw captures, fact payloads, AI interpretation output, related conversation text including sourced user question/assistant answer pairs, and telemetry metadata while keeping a non-sensitive `privacy_redaction` audit revision.
- Receipt and voice multipart capture routes reject unauthenticated production requests before parsing upload bodies.
- Receipt and voice multipart capture routes can upload original files to a private Supabase Storage bucket through `SUPABASE_MEDIA_BUCKET`; public-ready smoke requires returned `fileRefs` to use `supabase://...` storage refs.
- Launch Readiness marks missing `SUPABASE_MEDIA_BUCKET` as a direct failure when `SAYVE_ENV_TARGET=public-launch` or `SAYVE_REQUIRE_MEDIA_STORAGE=1`, while private beta without media storage remains a warning.
- Receipt and voice source-file uploads have storage byte guardrails through `RECEIPT_UPLOAD_MAX_BYTES` and `VOICE_UPLOAD_MAX_BYTES`; public/required media storage requires these env vars to be explicitly configured and rejects oversized uploads with stable 413 JSON instead of silently storing large files.
- Speech-to-text has file type and size guardrails before calling OpenAI; unsupported or oversized audio is still captured with fallback telemetry.
- Receipt vision and speech-to-text provider errors record non-zero attempt latency in telemetry, so Founder Console can distinguish cheap expected fallback from slow/erroring AI calls.
- Receipt vision and speech-to-text telemetry is linked back to the resulting capture and memory object where available, so Founder Console and Supabase import can trace media AI cost/error events to the exact Memory.
- Household listing responses are explicitly `no-store`/`noindex` because they expose the logged-in member's available Family Memories.
- In real auth mode, `GET /api/households` no longer falls back to a prototype household list when the Supabase service client is unavailable; it returns `temporary_unavailable` so live auth/storage misconfiguration is visible.
- The web client now clears stale household selection when `/api/households` returns `temporary_unavailable` or when the signed-in account has zero household memberships, reducing wrong-household carry-over during real multi-user onboarding.
- Browser auth storage now also clears the local `household_id` when the signed-in Supabase user changes or signs out, reducing account-switch carry-over on shared devices during real beta usage.
- Home now clears stale family/invite UI state when browser auth disappears, and `/invite` resets stale accepted-state when a different signed-in user arrives, reducing misleading handoff state during real onboarding.
- Browser auth and invite acceptance now share one redirect-origin helper that prefers `NEXT_PUBLIC_APP_URL`, reducing Google login / magic-link breakage when moving from localhost to the real deployment.
- Env preflight now requires `NEXT_PUBLIC_APP_URL` for private beta/public launch and warns locally when it is missing, so deploy-time OAuth redirect mistakes are caught before founder/member onboarding.
- Deployment smoke now also requires the live Launch Readiness payload to expose `app_base_url`, so an older deployed build cannot silently skip the stable browser-auth redirect gate.
- Founder Console now exposes a `Household Setup View` export so the founder can inspect default household binding plus recent invite status in a Google-Sheet-style table instead of only KPI cards.
- Founder Console now also exposes a `Household Roster View` export for the live default household, showing current members/roles plus invite rows in one founder-facing table.
- Founder Console now exposes a `Supabase Migration View` export so the founder can inspect normalized import-plan table counts, validation state, and dry-run insert/existing summaries without leaving `/admin`.
- Founder Console now exposes a `Live Rollout Checklist` panel so Vercel URL, Supabase Auth/storage, Google OAuth redirect allow-list, media bucket, telemetry proof, and deploy smoke setup can be reviewed in one place before live rollout.
- Founder Console now also exposes a `Launch Completion Audit` view, keeping the locally-proven vs live-proof-pending split visible inside `/admin` and founder exports instead of only docs.
- Household onboarding routes now catch unexpected server exceptions and return stable no-store JSON (`unexpected_admin_error` or `temporary_unavailable`) instead of leaking framework HTML 500 pages during founder/member onboarding.
- Household onboarding API exists for founder household creation, partner invite creation, and invite acceptance.
- Partner invite creation returns ready-to-open `inviteUrl` and private-beta `privateBetaInviteUrl` links for Founder Console setup.
- Invite acceptance now enforces invited-email matching when an invite was issued to a specific email, reducing wrong-account household joins during private beta onboarding.
- Product Family panel can create owner-only partner invite links without exposing invite rows to the browser.
- Invite acceptance returns stable error codes and user-facing HTTP statuses for missing, expired, already-used, and invalid invite states.
- Invite acceptance rejects unauthenticated real-auth requests before parsing malformed JSON bodies unless a valid Founder Console override token is supplied.
- Household onboarding responses use `Cache-Control: no-store` and `X-Robots-Tag: noindex` because they can contain invite/private beta tokens.
- Supabase invite rows are service-role only; browser/mobile clients use onboarding APIs.
- Web client has a lightweight Family panel for magic-link login, prototype user id testing, household selection, and automatic auth headers.
- Web and invite flows support Google OAuth through Supabase Auth, with magic-link email kept as fallback; partners should use their own Google account and join the same `household_id`.
- Partner-facing `/invite?token=...` flow exists for accepting a household invite with a separate Supabase login.
- Founder Console has a Household Setup panel for private beta household/member setup.
- Founder Console now shows a `Default Household Binding` summary with household id, member count, owner count, and any setup issue so live founder setup can be checked without digging through logs.
- Founder Console also includes a `Setup Guide` panel that turns launch/setup state into concrete founder next steps for private beta handoff.
- Founder Console also includes a `Private Beta Handoff` summary with progress, done/open steps, and the next blocking action for real private beta setup.
- Founder Console also includes a `Deploy Smoke Guide` panel with exact `verify:deploy:private-beta` / `verify:deploy:public-launch` commands and the required owner/member/viewer token checklist.
- Founder Console also includes a `Deploy Smoke Env Template` panel so strict smoke flags plus owner/member/viewer/fresh-invite env names can be copied as one deploy-day block.
- Founder Console also includes a `Repository Smoke Guide` panel so founder rollout can verify the intended household id, snapshot persistence, and member/owner health without mentally unpacking the endpoint contract.
- Founder Console also includes a `Public Launch Checks` panel so the remaining fail/warn readiness checks are visible as a list before the founder reruns public-ready smoke.
- Founder Console also includes an `Auth Setup Targets` panel so the founder can copy the exact Supabase Auth Site URL and redirect allow-list values without reconstructing them from docs.
- Founder Console also includes an `Env Setup Matrix` panel so private-beta/public-launch/deploy-smoke env requirements can be exported and checked without manually comparing multiple docs.
- Founder Console also includes a `Smoke Token Guide` panel so deploy-day owner/member/viewer/fresh-invite session-token collection is explicit and repeatable.
- A founder-facing deploy-day execution doc now exists, bridging `/admin`, the launch checklist, and the deployment runbook into one practical setup sequence.
- A redacted CLI setup report now exists, so founder setup state can be exported without exposing secrets and without manually reading every env value.
- The redacted CLI setup report now also includes a copy-paste private-beta env template and Google OAuth checklist, reducing deploy-day misconfiguration risk.
- Founder-facing Chinese checklist and env worksheet now exist for Supabase / Google OAuth / Vercel handoff without requiring live translation from engineering docs.
- Founder Console now also exposes the copy-paste env template and Google OAuth checklist directly in `/admin`, so founder setup/export flows share the same source of truth.
- Founder setup bundle endpoint now exists at `/api/admin/founder/setup-bundle`, so launch readiness plus deploy-day auth/env/checklist views can be fetched as one no-store JSON payload for handoff automation.
- Deployment verifier now also checks the live `/api/admin/founder/setup-bundle` payload shape, so founder handoff automation cannot silently drift from the deployed build.
- Founder setup bundle now also includes ready-to-run private-beta/public-launch smoke commands, keeping deploy-day command handoff aligned with the Founder Console.
- The redacted CLI setup report now also includes ready-to-run private-beta/public-launch smoke commands, keeping terminal handoff aligned with Founder Console and setup-bundle exports.
- Founder setup bundle now also includes explicit nextActions, so handoff automation can surface the next founder setup blockers without reconstructing readiness state.
- Founder setup bundle now also includes a stable signature, so external handoff tooling can compare bundle content without depending on `generatedAt`.
- Founder Console also includes an `Onboarding Health` panel so partner-invite state can be monitored without opening Supabase tables manually; this onboarding health visibility is now part of launch readiness.
- The partner `/invite` page now has a separate no-store preview check, so real beta users can see whether a link is pending, accepted, or expired before they spend time on login and invite acceptance.
- Launch Readiness now also checks Founder onboarding-health visibility, so missing invite monitoring becomes a readiness warning in private beta and a failure for public launch.
- Founder export can download both raw tables and readable views as CSV or JSON, so database fields, ledger-style projections, `schemaDictionary`, and AI work traces are inspectable outside the app during founder review and handoff.
- Founder export endpoint can now also return the full setup bundle artifact as JSON, so one export entrypoint can serve both tabular views and rollout handoff payloads.
- Founder export endpoint now also returns a smaller integration-only bundle at `/api/admin/export?scope=bundle&name=integration&format=json`, so external setup handoff can fetch just auth/env/integration payloads without the full rollout bundle.
- Founder export endpoint now also returns a dedicated live-proof bundle at `/api/admin/export?scope=bundle&name=live-proof&format=json`, so deploy-day evidence review can fetch proof gaps, onboarding steps, migration proof, smoke envs, and smoke-token guidance without the full setup payload.
- Deployment verifier now also checks the exported setup-bundle artifact path, so founder handoff automation is protected on both `/api/admin/founder/setup-bundle` and `/api/admin/export?scope=bundle&name=setup&format=json`.
- Deployment verifier now also checks the exported integration-bundle artifact path, so external setup handoff for Supabase / Google OAuth / OpenAI cannot silently drift from the deployed build.
- Deployment verifier now also checks the exported live-proof bundle artifact path, so rollout evidence automation cannot silently drift from the deployed build.
- Strict deploy proof runs now also auto-generate `outputs/setup/deploy-proof-summary.md` beside the JSON proof artifact, and `pnpm run report:deploy-proof` remains available to regenerate that founder-readable summary later.
- Deployment verifier now also checks that both setup-bundle routes return the same signature, so deploy-day handoff payload drift is caught even when timestamps differ.
- Founder Console now also has a direct `Launch Blockers` panel, so fail/warn rollout issues plus missing second-member onboarding are visible before digging through env/auth tables.
- `Launch Blockers` is now also a readable founder export/setup-bundle view, so rollout blockers can be consumed consistently across `/admin`, `/api/admin/export`, and deploy-day handoff payloads.
- Local verify now also runs `scripts/verify-setup-artifacts.mjs`, so `.env.example`, founder setup report env templates, and deploy-smoke command placeholders stay aligned before deployment handoff.
- `pnpm run report:setup` now also includes `launchBlockers`, so CLI founder handoff can surface the same rollout blockers already shown in `/admin` and setup-bundle exports.
- Founder Console and CLI handoff now also include a `Deployment Env Template`, so public-launch envs plus smoke-proof placeholders can be copied without reconstructing them from `envSetup`.
- Env template ordering/detail now comes from one shared setup-artifact spec used by both Founder Console and CLI handoff, reducing deploy-day drift when env requirements change.
- Public-launch setup artifacts now also include pinned OpenAI model envs and pricing envs, so founder handoff stays aligned with Launch Readiness model-audit and cost-analytics gates.
- Stage-specific `.env.private-beta.example` and `.env.public-launch.example` files now exist and are verified against the shared setup-artifact spec, so deploy handoff can start from smaller target-specific env files.
- `pnpm run report:setup:artifacts` now writes a git-ignored `outputs/setup/` bundle containing stage-specific env files, the redacted setup report JSON, a direct `live-rollout-sequence.md`, a founder-friendly `private-beta-go-live-run-sheet.md`, a step-by-step `live-deployment-execution-order.md`, plus a human-readable `handoff.md`, making founder deployment handoff portable without relying on terminal scrollback.
- Public-safe health endpoint exists at `/api/health`.
- Public-safe health endpoint returns no-store/noindex headers, so deployment smoke does not read cached readiness state.
- Live Supabase schema/security check exists at `GET /api/admin/import/supabase/schema-check`, including `memory_store_snapshots_service_role_only`, `household_role_policies`, explicit `interpretationWriterPolicyCount`, `invites_service_role_only`, `invites_atomic_acceptance`, `memory_facts_payload_shape`, `ai_telemetry_shape`, and `media_storage_bucket`.
- Deployment verifier explicitly fails if the live `memory_facts_payload_shape`, `ai_telemetry_shape`, or `media_storage_bucket` check is missing or failing, so migrations `011`/`012` and the private receipt/voice source-file bucket are part of the smoke gate rather than only documented requirements.
- Repository smoke test exists at `POST /api/admin/repository/smoke-test`.
- Repository smoke test can now target a specific household snapshot via founder-only JSON input, and also verifies whether that target household row exists plus member/owner counts, so rollout checks can verify the real family household and not only the default smoke binding.
- Deployment verifier exists as `pnpm run verify:deploy`.
- Deployment verifier rejects invalid deployment URLs and requires HTTPS non-local targets for public-ready smoke; `SAYVE_REQUIRE_PUBLIC_READY=0` is reserved for local/private smoke.
- Deployment/env/migration scripts are syntax-checked by `pnpm run verify:scripts`.
- Security headers are verified by `pnpm run verify:scripts`.
- Environment preflight exists as `pnpm run verify:env` with local, private-beta, and public-launch targets.
- Stage-specific shortcuts exist as `pnpm run verify:private-beta` and `pnpm run verify:public-launch`, reducing manual `SAYVE_ENV_TARGET` mistakes during deployment handoff.
- Deployment smoke shortcuts exist as `pnpm run verify:deploy:private-beta` and `pnpm run verify:deploy:public-launch`, reducing manual `SAYVE_REQUIRE_PUBLIC_READY` mistakes during live verification.
- Deployment verifier checks that the private beta page/API gate blocks unauthenticated access when `APP_ACCESS_TOKEN` is configured.
- Deployment verifier checks the deployed Founder Console page returns no-store/noindex headers.
- Deployment verifier can run authenticated household smoke tests with `SAYVE_REQUIRE_AUTH_SMOKE=1`, two-member shared household smoke with `SAYVE_REQUIRE_TWO_MEMBER_SMOKE=1`, viewer read-only smoke with `SAYVE_REQUIRE_VIEWER_SMOKE=1`, and partner invite link smoke with `SAYVE_REQUIRE_INVITE_SMOKE=1`; public-ready smoke enforces the two-member and viewer checks by default.
- Deployment verifier now checks Founder Console `Onboarding Health` after invite creation, so pending and email-locked partner onboarding state is covered by live smoke rather than only UI inspection.
- Deployment verifier checks custom category creation, dashboard `categoryOptions`, Founder Console raw category actor attribution, and viewer category write denial.
- Deployment verifier checks dashboard and timeline visibility for newly captured shared household facts, so both structured summary and monthly memory list views are proven against the live deployment.
- Deployment verifier can require successful OpenAI capture and conversation telemetry with `SAYVE_REQUIRE_OPENAI_SMOKE=1`, and public-ready smoke enforces it by default.
- Deployment verifier can require live privacy redaction with `SAYVE_REQUIRE_PRIVACY_SMOKE=1`, and public-ready smoke enforces it by default, including the sourced user question/assistant answer pair.
- Partner invite smoke now covers both Founder Console invite generation and product owner invite generation.
- Partner invite smoke verifies the deployed `/invite` page returns no-store/noindex headers.
- Deployment verifier checks unauthenticated text capture and conversation malformed JSON are rejected before body parsing when Supabase Auth is required.
- Route-level auth boundary tests cover auth-before-parse behavior across broader private JSON writes: receipt/voice JSON capture, categories, context updates, context confirmation, memory interpretation, correction, split, and redaction.
- Deployment verifier checks unauthenticated receipt/voice multipart uploads are rejected before body parsing when Supabase Auth is required.
- Deployment verifier checks authenticated text, receipt multipart, and voice multipart capture paths, with capture telemetry for each, while using provided receipt note/voice transcript to avoid extra media AI calls during smoke.
- Deployment verifier requires each authenticated capture smoke to produce a `capture_interpretation` telemetry event with token/cost/latency and AI Decisions metadata (`intent`, `decision`, `confidenceBand`, `needsUserInput`) in Founder Console.
- Deployment verifier requires receipt/voice multipart captures to persist uploaded files to Supabase Storage during public-ready smoke.
- Launch Readiness separates private-beta config readiness from public-launch readiness with a complete smoke proof: `SAYVE_DEPLOYMENT_SMOKE_VERIFIED=1`, `SAYVE_DEPLOYMENT_SMOKE_VERIFIED_AT`, and `SAYVE_DEPLOYMENT_SMOKE_TARGET`.
- Launch Readiness now includes the live Supabase schema/security gate, so missing migrations `004`, `005`, `006`, `007`, `008`, `009`, `010`, `011`, or `012` block public readiness.
- Launch Readiness requires the live schema/security response to include all expected security check ids, including `memory_facts_payload_shape`, `ai_telemetry_shape`, and `media_storage_bucket`, so an older deployed schema-check route cannot accidentally pass public readiness.
- Deployment verifier requires the live Launch Readiness response to include top-level readiness fields (`configReadyForPrivateBeta`, `liveSmokeVerified`, `readyForPublicLaunch`) and all expected readiness check ids, including `supabase_url_consistency`, `supabase_key_boundary`, `media_upload_limits`, and `ai_telemetry_completeness`, so an older deployed admin route cannot accidentally pass public readiness.
- Launch Readiness now requires all AI pricing env vars to be valid non-negative numbers before reporting public-launch ready, so cost analytics cannot silently pass with partial or invalid pricing.
- CI verification workflow exists at `.github/workflows/verify.yml`.
- Package manager is pinned with `packageManager=pnpm@11.7.0`, Node engine is `>=22 <25`, CI runs `pnpm run verify`, and static tests guard the workflow against accidental downgrade.
- Vercel deploy config is pinned in `vercel.json`: it installs with `pnpm install --frozen-lockfile` and runs `pnpm run verify:scripts`, `pnpm run verify:env`, `pnpm run typecheck`, `pnpm run verify:migrations`, and `pnpm run build`. First private beta deploy should use `SAYVE_ENV_TARGET=private-beta`; public launch deploy should only use `SAYVE_ENV_TARGET=public-launch` after the live smoke marker is set.
- Founder/advisor PDFs and screenshots are generated under git-ignored `outputs/`, keeping business handoff artifacts out of production deployment bundles.
- Web client blocks capture/chat actions until a Supabase session and household are selected when browser auth is configured, reducing wrong-household writes for partner login.
- In real auth mode, authenticated product requests no longer fall back to `SUPABASE_DEFAULT_HOUSEHOLD_ID`; an explicit household selection/header is required, preventing founder smoke defaults from leaking into real family traffic.
- Core API contract tests cover capture, conversation, dashboard, categories, health, admin readiness, invalid JSON, empty body handling, multi-member household capture, and auth-required rejection.
- Core capture/conversation/category APIs return no-store JSON envelopes with `temporary_unavailable` when production memory storage is unavailable, instead of leaking framework 500/HTML responses.
- Supabase migration static verifier exists as `pnpm run verify:migrations`.

## Verification Evidence

Latest local verification:

```bash
pnpm run verify
```

Result:

- TypeScript passed.
- Supabase migration static verification passed.
- Unit tests passed: 266 tests.
- Production build passed.
- Home first load is 111 kB.

## Required Before Private Beta

- Apply Supabase migrations `001`, `002`, `003`, `004`, `005`, `006`, `007`, `008`, `009`, `010`, `011`, and `012`.
- Create one founder household and set `SUPABASE_DEFAULT_HOUSEHOLD_ID`.
- Create/invite household members through `/api/households/create`, `/api/households/invite`, partner `/invite?token=...`, and `/api/households/invite/accept` or direct Supabase setup.
- Confirm the founder and partner use separate Supabase Auth logins, write to the same `household_id`, and preserve member attribution with `created_by`.
- Enable Google OAuth in Supabase Auth if using Google account login, then add the deployed Sayve URL and `/invite` path to the Supabase redirect allow list.
- Set Vercel env:
  - `MEMORY_REPOSITORY=supabase`
  - `NEXT_PUBLIC_SUPABASE_URL` with `NEXT_PUBLIC_SUPABASE_ANON_KEY` so browser magic-link login can start Supabase Auth sessions
  - `SUPABASE_URL`, only if it points to the same Supabase project host as `NEXT_PUBLIC_SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`, using a server-only service-role/secret key that is different from `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_DEFAULT_HOUSEHOLD_ID`
  - `SUPABASE_MEDIA_BUCKET`
  - `RECEIPT_UPLOAD_MAX_BYTES`
  - `VOICE_UPLOAD_MAX_BYTES`
  - `APP_ACCESS_TOKEN`
  - `ADMIN_CONSOLE_TOKEN`
  - `SUPABASE_AUTH_REQUIRED=1`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `PROTOTYPE_USAGE_LIMITS_DISABLED=0`
- Deploy to Vercel.
- Confirm GitHub Actions `Verify` passes on the deployment commit.
- Run `SAYVE_ENV_TARGET=private-beta pnpm run verify:env` before configuring Vercel env.
- Use separate strong random values for `APP_ACCESS_TOKEN` and `ADMIN_CONSOLE_TOKEN`; do not use placeholder values such as `secret`, `admin-token`, or `private-beta-token`.
- `pnpm run verify:deploy` also rejects weak or reused private-beta/admin tokens before calling the deployment.
- Run `pnpm run verify:deploy` against the deployed URL with authenticated two-member household smoke.

## Required Before Public Launch

- Run deployed smoke with bootstrap proof using `SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN`, proving a fresh zero-household account can finish first-run household initialization.
- Run deployed smoke that proves dashboard payload shape, monthly timeline visibility, memory detail retrieval, conversation source retrieval, and insight dismiss flow on the live deployment.
- Confirm the Founder setup bundle, integration bundle, and setup artifact exports all remain in sync on the deployed build.
- `GET /api/admin/launch-readiness` returns `readyForPublicLaunch: true`.
- `GET /api/admin/import/supabase/schema-check` returns `ok: true`.
- `POST /api/admin/repository/smoke-test` returns `ok: true` and `persistedSnapshot: true`.
- `SAYVE_DEPLOYMENT_SMOKE_VERIFIED=1` plus `SAYVE_DEPLOYMENT_SMOKE_VERIFIED_AT` and `SAYVE_DEPLOYMENT_SMOKE_TARGET` are set only after the live deployment smoke test passes.
- `docs/private-beta-launch-checklist.md` has been completed against the live Vercel + Supabase environment.
- Founder Console shows AI telemetry after real capture/conversation usage.
- Usage limits and all AI pricing env vars are configured as valid non-negative numbers.
- AI model env vars are explicitly pinned for capture, conversation, escalation, receipt vision, and speech-to-text before enabling OpenAI/public launch.
- Decide whether `APP_ACCESS_TOKEN` remains private beta protection or is replaced with full Supabase Auth onboarding.
- Confirm both household members are present in `household_members`, can write to the same household memory, and dashboard/conversation read the household aggregate rather than separate personal ledgers.

## What Is Actually Left

### Already strongly proven locally

- storage boundary and production repository enforcement
- Supabase schema/migration/security proof surface
- Founder Console/setup bundle/deploy handoff artifacts
- deploy smoke coverage for capture, dashboard, timeline, memory detail, conversation sources, insight dismiss, privacy redaction, invites, viewer access, custom categories, and bootstrap
- CI/build/typecheck/test verification

### Still requires live proof

- apply migrations to the real Supabase project
- connect real Vercel env and deploy latest build
- collect founder/member/viewer/fresh-no-household session tokens
- run `pnpm run verify:deploy:private-beta` or `pnpm run verify:deploy:public-launch` against the real URL
- verify OpenAI telemetry, cost, token, and latency fields from actual deployed usage

### Practical conclusion

The repo is no longer blocked on missing core launch architecture. It is mainly blocked on real environment hookup and live smoke evidence.

## Known Transitional Choice

Private beta runtime storage uses a JSONB snapshot in `memory_store_snapshots`.

This is intentional for speed to production. It preserves the Memory Engine state while normalized tables mature as projections/import targets.
