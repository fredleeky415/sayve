# Sayve Current Build Progress

Last updated: 2026-07-12

## Overall

Estimated overall progress to a real V1 private beta: **87%**

Audit reference: [Launch Completion Audit](launch-completion-audit.md)

Latest rollout improvement:
- strict private beta proof runs now also auto-generate `outputs/setup/deploy-proof-summary.md` beside `deploy-proof-report.json`, so founder review no longer depends on reading raw rollout JSON
- deploy-day proof JSON can still be regenerated into `outputs/setup/deploy-proof-summary.md` with `pnpm run report:deploy-proof`, so founder review has a manual fallback without rerunning smoke
- package scripts and founder handoff commands now also expose `verify:deploy:strict-private-beta:proof`, so the most common live-smoke path can write `outputs/setup/deploy-proof-report.json` without rebuilding the env string by hand
- `verify:deploy` now supports optional `SAYVE_DEPLOY_PROOF_REPORT_PATH`, so a real live smoke run can write a reusable JSON proof artifact instead of leaving founder evidence only in terminal scrollback
- Founder export now also supports a dedicated `live-proof` bundle plus generated `outputs/setup/live-proof-package.json` / `live-proof.md`, so deployed rollout evidence can be reviewed and archived separately from setup/integration handoff
- Launch Readiness now supports a real Supabase Storage smoke proof, so receipt/voice media storage is no longer treated as "ready" only because a bucket name exists; the server can now prove write + cleanup against the configured bucket
- Founder Console live rollout checklist now also surfaces that storage smoke proof, so `/admin` can show when a bucket is merely configured versus truly writable on the server path
- founder export now supports a dedicated `integration` bundle plus generated `outputs/setup/integration-package.json`, so deploy-day external setup can be handed off without carrying the full setup/report payload
- setup artifacts now also generate `outputs/setup/env-map.md`, giving a local `.env.local` vs Vercel vs provider-source mapping table from the same setup source-of-truth
- setup artifacts now also generate `outputs/setup/execution-checklist.md`, turning the private-beta rollout steps into `ready/open/pending/blocked` status instead of a static checklist
- setup artifacts now also generate `outputs/setup/provider-setup.md`, grouping Supabase / Google OAuth / Vercel / OpenAI / smoke setup into one provider-by-provider run sheet
- OpenAI capture/conversation now support separate output-token budgets, so Sayve can stay short and cheap instead of drifting toward general-chat verbosity

This means:

- the core Sayve product shell is working
- the shared household memory model is in place
- Founder Console, Launch Readiness, deployment verification, and Supabase migration path already exist
- the biggest remaining work is real environment hookup, final live smoke on Vercel + Supabase, and production-polish passes rather than inventing the system from zero

Estimated progress to a true public launch: **71%**

Public launch is lower because it still depends on:

- real live infra hookup
- real OpenAI telemetry under production conditions
- real privacy / media storage smoke on deployed infra
- actual household onboarding proof with live users

## Launch Audit Snapshot (2026-07-11)

This snapshot is based on current repo evidence, not memory:

- targeted audit pack passed: `118/118` tests across storage boundary, repository smoke, launch readiness, founder console, auth boundary, and API contract coverage
- deploy-handoff drift pack passed: `81/81` tests
- setup artifact drift verifier passed: `node scripts/verify-setup-artifacts.mjs`
- production build passed: `next build`

What is now strongly evidenced:

- receipt / voice production storage can now be proven with a real server write/delete smoke instead of env-only confidence
- production storage boundary is enforced when real auth mode is on and repository mode is misconfigured
- Supabase migration/security proof includes required migration ids plus founder-readable schema migration proof
- Founder Console/setup bundle/integration bundle now all carry bootstrap smoke, invite smoke, deploy env, smoke token, and command handoff data
- deployment verifier now covers capture, voice, receipt, dashboard, timeline, memory detail, conversation sources, insight dismiss, privacy redaction, invite creation, invite acceptance, viewer read-only, custom categories, and first-run bootstrap

What is still not fully proven by local evidence alone:

- real Supabase project has actually applied the migrations and passes the live schema/security endpoint
- real Vercel deployment passes `pnpm run verify:deploy:private-beta` / `public-launch` with live tokens
- real OpenAI production traffic produces healthy cost / token / latency telemetry under deployed conditions
- real household onboarding with founder + partner + viewer accounts has been completed on live infra

So the current state is:

- code + verification surface: strong
- live infrastructure proof: still pending
- private beta readiness: near-ready, but not yet proven on deployed infra

## Step Map

### 1. Product Core

Status: **90%**

Done:

- Sayve positioning is now capture-first, memory-first, not bookkeeping-first
- product naming and core UI language are aligned around `Sayve`, `Sayved.`, `跟 Sayve 說一件事`, `問一問 Sayve`
- Home / Ask / Dashboard mental model has been shaped
- dashboard is treated as a view over memory, not the product core

Still to do:

- one more copy/UX tightening pass after real usage

### 2. Web UI Prototype

Status: **85%**

Done:

- dark, lightweight UI direction is in place
- Home is kept light instead of dashboard-heavy
- Ask and Home are more clearly separated
- Dashboard has category color treatment, charts, calendar-like daily spend, monthly list direction
- lazy-loading direction has already been considered so Home stays light

Still to do:

- one focused polish pass on spacing, hierarchy, and motion
- final mobile-feel tuning before App handoff

### 3. Memory Engine + API Shape

Status: **80%**

Done:

- memory-oriented API surface exists
- household shared-memory model exists
- facts vs context direction is reflected in architecture
- corrections, merge/split/reprocess/redact endpoints exist
- ownership default for unspecified spend is guarded as shared / 公家

Still to do:

- deeper real-AI interpretation behaviour tuning once live OpenAI traffic is connected

### 4. Multi-member Household Model

Status: **82%**

Done:

- separate household members can belong to one shared household
- member attribution is preserved on captures/facts/revisions/categories
- unspecified spending defaults to shared household spending
- viewer / member / owner roles are enforced
- Google login direction through Supabase Auth is already wired in architecture/tests
- browser auth / invite redirects now centralize through `NEXT_PUBLIC_APP_URL`, env preflight blocks private beta if that stable app origin is missing, and Founder Console now exposes sheet-style household setup, live roster, Supabase migration inspection, and live rollout checklist views

Still to do:

- final live end-to-end proof with your account + your wife’s account on real Supabase

### 5. Founder Console

Status: **84%**

Done:

- Founder Console exists at `/admin`
- cost, quality, usage, launch readiness, raw tables, and telemetry completeness are already in place
- AI calls are treated as product intelligence
- telemetry completeness now blocks public launch if token/cost/latency data is incomplete
- founder-only repository smoke can now target a specific household snapshot and verify household/member/owner health instead of only the default smoke binding
- founder/product invite links now prefer `NEXT_PUBLIC_APP_URL`, reducing preview-domain / custom-domain invite drift during real rollout
- `/invite` now preloads a lightweight no-store invite status preview, so partner onboarding can surface pending / accepted / expired state before login instead of only failing after OAuth
- Founder Console now exposes exact auth setup targets for Supabase / Google OAuth handoff, so founder rollout does not depend on manually reconstructing redirect URLs
- Founder Console now exposes an env setup matrix for private beta / public launch / deploy smoke handoff, reducing Vercel env guesswork before live rollout
- founder execution doc now exists for deploy-day setup, turning the rollout from abstract checklist into a page-by-page founder playbook
- Founder Console / setup bundle now also expose a Private Beta Setup Gate, so the founder rollout sequence is exportable as machine-readable ready/open/pending/blocked steps
- Founder Console / setup bundle now also expose Integration Readiness by external system, so Supabase / Google OAuth / Vercel / OpenAI setup drift is visible without mentally merging several panels
- Founder Console / setup bundle now also expose an Integration Package, so the exact per-system fields and targets can be exported as one implementation table before real credential entry
- redacted founder setup report script now exists, so deploy-day env/auth/smoke readiness can be exported from the CLI instead of checked by memory alone
- founder setup export now also includes a copy-paste private-beta env template plus a Google OAuth checklist, reducing deploy-day reconstruction work
- founder setup/export now also includes a deploy-smoke env template, so strict smoke flags and required session-token env names can be copied without rebuilding the command by hand
- OpenAI rollout guardrails are now tighter: setup artifacts/readiness/env preflight all align on pinned STT model plus explicit `AUDIO_TRANSCRIPTION_MAX_BYTES` / `RECEIPT_VISION_MAX_BYTES` requirements when OpenAI is enabled
- founder handoff now also includes a repository-smoke guide, so deploy-day verification of the real household binding is exportable instead of buried in API docs
- founder-facing Chinese checklist and env worksheet now exist, so setup can be executed without translating engineering docs in real time
- Founder Console now directly surfaces the same copy-paste env template and Google OAuth checklist, so deploy-day setup no longer depends on bouncing between CLI output and `/admin`
- founder setup bundle API now exists, so external handoff tooling can fetch launch readiness plus deploy-day setup views from one no-store JSON endpoint
- deployment verifier now also proves the live founder setup bundle shape, so deploy-day handoff payload regressions are caught before rollout
- founder setup bundle now also carries ready-to-run deploy smoke commands, so external handoff tooling no longer needs to reconstruct verify commands separately
- CLI `report:setup` now also carries the same smoke commands, reducing drift between terminal handoff and Founder Console/API handoff
- founder setup bundle now also carries explicit next actions, so external handoff tooling can show the founder the next blocking steps without re-deriving readiness logic
- founder export endpoint can now return the setup bundle directly, so one `/api/admin/export` entrypoint can serve raw tables, readable views, and full rollout handoff artifacts
- deployment verifier now also proves the exported setup-bundle artifact path, so founder handoff regressions are caught on both bundle routes
- founder setup bundle now also carries a stable signature, and deploy smoke compares that signature across both bundle routes so handoff payload drift is caught without depending on timestamps
- Founder Console, setup bundle, and CLI handoff now also expose a Supabase Migration Inventory with checksums, so real rollout can verify exactly which migrations belong to private beta vs public launch
- Founder Console migration proof now also reads live `supabase_migrations.schema_migrations` history when service-role access allows it, so the founder can see which local migration files are actually applied on the real Supabase project instead of relying only on import-plan dry run
- deploy verifier now also enforces those live `applied_migration` proof rows by rollout stage, so private beta/public launch smoke cannot pass while the real Supabase project is still missing required migrations
- Launch Readiness itself now also fails when live `applied_migration` history is missing required stage migrations, so `/api/admin/launch-readiness`, Founder Console, and deploy smoke all share the same migration truth
- founder setup bundle now also includes `schemaMigrationProof`, so setup handoff and integration handoff both carry the same live applied-migration proof instead of only the integration bundle doing so
- package scripts and founder handoff commands now also expose a turnkey `verify:deploy:strict-private-beta`, so the full owner/member/viewer/bootstrap/OpenAI/privacy private-beta smoke no longer depends on manually composing every `SAYVE_REQUIRE_*` flag
- Founder Console now also surfaces a direct `Launch Blockers` panel, so the founder can see fail/warn rollout issues and second-member onboarding gaps without reading every setup table first
- Founder Console now also surfaces a direct `Live Proof Gaps` panel, separating what local tests already proved from what still needs real deploy / real household / real OpenAI evidence
- Founder Console now also surfaces `Onboarding Proof Steps`, turning founder login -> partner invite -> partner join -> shared-household proof -> bootstrap token collection into an explicit sequence instead of scattered notes
- the same `Launch Blockers` data is now a readable founder export/setup-bundle view, so UI, exports, and handoff payloads all point at one rollout blocker source of truth
- local verify now also runs a setup-artifacts drift check, so `.env.example`, founder setup report output, and deploy-smoke command templates cannot silently diverge
- CLI `report:setup` now also carries launchBlockers, so terminal handoff sees the same rollout blocker view as Founder Console and setup-bundle exports
- Founder Console plus CLI handoff now also expose a Deployment Env Template, so public-launch/smoke-proof env values no longer need to be reconstructed from the matrix by hand
- private-beta/deployment env template order and wording now come from one shared setup-artifact spec, reducing drift between Founder Console and CLI handoff
- `.env.private-beta.example` and `.env.public-launch.example` now exist and are drift-checked against the shared spec, so real rollout setup has stage-specific files instead of one giant catch-all env sample
- `pnpm run report:setup:artifacts` now writes a local `outputs/setup/` handoff bundle, so founder deployment prep can move around as real files instead of only terminal output
- the setup artifact bundle now also writes `outputs/setup/handoff.md`, so founder rollout has a human-readable summary of blockers, next actions, OAuth steps, and deploy commands alongside the machine-readable JSON
- public-launch setup artifacts now also include pinned OpenAI model envs and pricing envs, so founder rollout handoff matches the same model/cost requirements enforced by Launch Readiness and Founder Console analytics

Still to do:

- real live data population after deployment
- another pass on founder-facing readability once real numbers exist

### 6. Supabase Production Boundary

Status: **83%**

Done:

- repository boundary exists
- Supabase snapshot storage works
- migrations `001` to `012` are covered
- schema/security checks exist
- import/export/validate/dry-run path exists
- media storage boundary and upload limits are now launch-gated
- Launch Readiness can now consume a real Supabase Storage write/delete smoke proof for the private receipt/voice bucket

Still to do:

- apply everything to the real Supabase project
- validate bucket, auth, and invite flows against live infra

### 7. Deployment + Verification

Status: **88%**

Done:

- `pnpm run verify`
- `pnpm run verify:private-beta`
- `pnpm run verify:public-launch`
- `pnpm run verify:deploy`
- `pnpm run verify:deploy:private-beta`
- `pnpm run verify:deploy:public-launch`
- Launch Readiness gates private beta vs public launch correctly
- deployment docs/checklists are already written
- deployment smoke can now optionally prove end-to-end invite acceptance with a fresh unjoined account token
- deployment smoke now also carries proof metadata (`verified_at` + target URL) instead of only a boolean marker

Still to do:

- run the live deployment smoke on Vercel
- set the real smoke marker only after live proof passes

### 8. AI Integration

Status: **58%**

Done:

- OpenAI provider boundary exists
- model pinning and pricing env gates exist
- capture vs conversation model separation is supported by architecture
- AI telemetry is stored and monitored

Still to do:

- connect real OpenAI API key in deployment
- tune prompts for short, low-token Sayve answers
- validate capture/voice/receipt behaviour with real household usage
- decide final production model mix for capture, vision, speech, and conversation

### 9. Go-live Readiness

Status: **45%**

Done:

- most code-level safeguards are already in place
- deployment checklist exists
- launch readiness logic exists

Still to do:

- real Vercel env setup
- real Supabase env setup
- real member accounts
- real deployment smoke
- real OpenAI smoke
- first founder household live test

## What Is Left Before You Can Really Use It

The next practical sequence is:

1. connect a real Supabase project
2. set real Vercel env
3. create your household + your wife’s login
4. run private beta deployment smoke
5. connect OpenAI for real capture / ask behaviour
6. test one week of real usage
7. tighten prompts, UX, and founder metrics from real data

## Best Current Description

Right now Sayve is **past prototype-only UI**, but **not yet fully live**.

Best label today:

**production-shaped private beta candidate**

That means the hard part of system shape is mostly there. The remaining work is turning the existing architecture into a fully proven live product.
