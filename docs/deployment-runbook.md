# Sayve Deployment Runbook

This runbook moves Sayve from local prototype mode to private beta production mode.

## 1. Supabase

Apply migrations in order:

1. `supabase/migrations/001_ai_native_memory_engine.sql`
2. `supabase/migrations/002_prototype_migration_path.sql`
3. `supabase/migrations/003_memory_store_snapshots.sql`
4. `supabase/migrations/004_harden_memory_store_access.sql`
5. `supabase/migrations/005_harden_household_role_policies.sql`
6. `supabase/migrations/006_harden_invite_access.sql`
7. `supabase/migrations/007_harden_memory_interpretation_writer_policy.sql`
8. `supabase/migrations/008_atomic_invite_acceptance.sql`
9. `supabase/migrations/009_revision_actor_attribution.sql`
10. `supabase/migrations/010_category_actor_attribution.sql`
11. `supabase/migrations/011_harden_memory_fact_payload_constraints.sql`
12. `supabase/migrations/012_harden_ai_telemetry_constraints.sql`

Create one founder household row and keep its UUID for `SUPABASE_DEFAULT_HOUSEHOLD_ID`. For private beta, use the onboarding API instead of editing rows by hand where possible:

```text
GET /api/households
POST /api/households/create
POST /api/households/invite
POST /api/households/members/invite
POST /api/households/invite/accept
```

`GET /api/households` is used by the client to select the active household after login. `create` and admin `invite` require Founder/Admin access. Product invite creation uses `POST /api/households/members/invite`; it requires the logged-in household `owner` and creates an invite for a `member` or `viewer` without exposing the `invites` table to the browser. `accept` is called after the second household member logs in. In local prototype mode it can use `x-user-id` or body `userId`; when `SUPABASE_AUTH_REQUIRED=1`, normal invite acceptance must prove the Supabase bearer login before parsing the request body, with body `userId` reserved for Founder Console override only when `ADMIN_CONSOLE_TOKEN` is configured and supplied. In the same real-auth mode, normal product traffic must carry an explicit `x-household-id`; authenticated requests do not silently fall back to `SUPABASE_DEFAULT_HOUSEHOLD_ID`. `GET /api/households` also must not silently fall back to a prototype household list in this mode; if the Supabase service client is unavailable, it returns `temporary_unavailable` so live misconfiguration is obvious during onboarding. The web client should clear any stale local `household_id` when this happens, when the signed-in account currently belongs to zero households, and when the browser session changes to another user or signs out. Home should also clear family/invite UI remnants when browser auth disappears, and `/invite` should reset any previous accepted state when another signed-in user lands there.

Founder onboarding routes should also return stable no-store JSON on unexpected server exceptions. A deploy-time regression should surface as structured `unexpected_admin_error` or `temporary_unavailable` JSON, not a framework HTML 500 page in the browser.

Financial fact ownership is separate from audit attribution. The acting login remains `createdBy`, but if a capture does not clearly say it belongs to one person personally, Sayve stores `ownershipScope=shared` and treats the item as 公家. Explicit personal wording such as "我自己" or "太太自己" can set `ownershipScope=member`. This is enforced after AI interpretation by a deterministic server-side guard, so a model cannot silently turn an unspecified household item into personal spending.

For the invited partner, use the `inviteUrl` returned by either invite endpoint. When `APP_ACCESS_TOKEN` is configured, use `privateBetaInviteUrl`; it includes the private-beta access token while preserving the invite token. These links now prefer `NEXT_PUBLIC_APP_URL` as the stable origin, so founder-generated invites do not accidentally point at a preview host while the real app uses a custom domain. If the invite targets a specific email, the partner must sign in with that same email before the API will accept the invite token. After acceptance, the browser stores the shared `household_id` for future capture/chat/dashboard calls.

For the lowest-friction private beta, enable Google OAuth in Supabase Auth and add the deployed Sayve URL plus `/invite` URL to the Supabase redirect allow list. Google OAuth is only the login method; shared family memory is still controlled by `household_members`, so each partner should use their own Google account rather than sharing one login.

The `invites` table is intentionally service-role only. Clients should not read or write invite rows directly; they go through the onboarding API so invite tokens, membership, and audit behavior stay server-controlled.

`POST /api/households/bootstrap` is the first-run path for a freshly logged-in Supabase user with zero households. It should create exactly one owner household, return no-store/noindex JSON, and then make that household visible in the next `GET /api/households` call. Deployment smoke should prove this with a dedicated fresh account token rather than assuming the founder row was inserted manually.

## 2. Vercel Environment

Required for private beta:

```bash
MEMORY_REPOSITORY=supabase
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_DEFAULT_HOUSEHOLD_ID=...
SUPABASE_MEDIA_BUCKET=...
SUPABASE_AUTH_REQUIRED=1
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
APP_ACCESS_TOKEN=...
ADMIN_CONSOLE_TOKEN=...
PROTOTYPE_USAGE_LIMITS_DISABLED=0
```

Generate separate strong random values for `APP_ACCESS_TOKEN` and `ADMIN_CONSOLE_TOKEN`. They must not be reused, short, or placeholder-like values such as `secret`, `admin-token`, or `private-beta-token`.

```bash
openssl rand -base64 32
```

`SUPABASE_SERVICE_ROLE_KEY` must be a server-only service-role/secret key. Do not reuse `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and do not put a Supabase `sb_publishable_...` key in this variable.

Create a private Supabase Storage bucket for receipt and voice source files, then set `SUPABASE_MEDIA_BUCKET` to that bucket id. Do not make this bucket public. Private beta can run without it and will keep original file names as source refs, but public launch requires the private bucket so uploaded receipts/recordings remain retrievable source references for Family Memory without public exposure.

Required only after the live deployment smoke test passes and before public launch:

```bash
SAYVE_DEPLOYMENT_SMOKE_VERIFIED=1
SAYVE_DEPLOYMENT_SMOKE_VERIFIED_AT=2026-07-10T02:00:00.000Z
SAYVE_DEPLOYMENT_SMOKE_TARGET=https://your-domain
```

`SUPABASE_URL` can be omitted when the server should use `NEXT_PUBLIC_SUPABASE_URL` as the single Supabase project URL. If both are set, they must point to the same Supabase project host; otherwise browser Auth can succeed against one project while server-side memory writes go to another. `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` must both be set for browser magic-link login; a server-only `SUPABASE_URL` is not enough for you and your partner to sign in. These are hard requirements before real household members use Sayve together. Without them, the app can still run as a founder prototype, but Launch Readiness should not report public-ready.

Create one Supabase Auth user for each household member. Do not share one login between partners. Add both users to `household_members` with the same `household_id`, either through the onboarding API above or direct Supabase setup. The client should send:

```text
Authorization: Bearer <supabase-session-access-token>
x-household-id: <household uuid>
```

The web client already persists the selected household id locally, including after `/invite?token=...` acceptance, and includes these headers in capture, conversation, receipt, category, and dashboard calls. The future Expo/React Native app should follow the same contract.

`x-user-id` is a local prototype convenience only. Once `SUPABASE_AUTH_REQUIRED=1`, Sayve memory and household APIs require the Supabase bearer token, require an explicit `x-household-id`, and ignore prototype user-id spoofing.

Each capture and user conversation message should keep the authenticated member id as `createdBy`/`created_by`. This is not a separate personal ledger; it is attribution inside one shared household memory, so future member-level views and AI quality audits can explain who supplied or corrected a memory.

Use `owner` or `member` for people who can tell Sayve new things, correct memory, create categories, dismiss insights, or otherwise update the shared Family Memory. `viewer` is read-only at the Sayve API boundary: dashboard, timeline, context, and memory reads are allowed, while memory writes return `household_write_denied`.

Privacy/legal deletion is not a normal bookkeeping correction. Use `POST /api/memory/redact` for an explicit redaction request. It keeps an audit revision without sensitive before/after values, but redacts raw captures, file refs, fact payloads, AI interpretation output, related conversation text, and linked telemetry metadata for that memory. If a sourced assistant answer points to the redacted memory/fact/capture, Sayve also redacts the adjacent user question/assistant answer pair so sensitive merchant or amount text does not remain in chat history.

Required when `OPENAI_API_KEY` is configured, and before public launch:

```bash
OPENAI_API_KEY=...
OPENAI_CAPTURE_MODEL=gpt-5.4-mini
OPENAI_CAPTURE_MAX_OUTPUT_TOKENS=220
OPENAI_CONVERSATION_MODEL=gpt-5.4-mini
OPENAI_CONVERSATION_MAX_OUTPUT_TOKENS=120
OPENAI_ESCALATION_MODEL=gpt-5.5
OPENAI_RECEIPT_VISION_MODEL=gpt-5.4-mini
OPENAI_SPEECH_TO_TEXT_MODEL=gpt-4o-mini-transcribe
OPENAI_CAPTURE_INPUT_USD_PER_1M=...
OPENAI_CAPTURE_OUTPUT_USD_PER_1M=...
OPENAI_RECEIPT_VISION_INPUT_USD_PER_1M=...
OPENAI_RECEIPT_VISION_OUTPUT_USD_PER_1M=...
OPENAI_CONVERSATION_INPUT_USD_PER_1M=...
OPENAI_CONVERSATION_OUTPUT_USD_PER_1M=...
OPENAI_STT_INPUT_USD_PER_1M=...
OPENAI_STT_OUTPUT_USD_PER_1M=...
AUDIO_TRANSCRIPTION_MAX_BYTES=25000000
RECEIPT_VISION_MAX_BYTES=8000000
VOICE_UPLOAD_MAX_BYTES=25000000
RECEIPT_UPLOAD_MAX_BYTES=10000000
```

`AUDIO_TRANSCRIPTION_MAX_BYTES` and `RECEIPT_VISION_MAX_BYTES` are cost/latency guardrails. If a media file is unsupported or too large, Sayve still captures the event and records fallback telemetry, but it does not call the expensive media AI step.

`VOICE_UPLOAD_MAX_BYTES` and `RECEIPT_UPLOAD_MAX_BYTES` are storage guardrails for original source files. Public/required media storage requires both env vars to be explicitly configured, then rejects oversized uploads with a stable 413 JSON response instead of silently writing large files; prototype mode can still capture the event while recording `media_file_too_large` metadata.

Conversation uses `OPENAI_CONVERSATION_MODEL` when `OPENAI_API_KEY` is configured, but `OPENAI_CONVERSATION_MAX_OUTPUT_TOKENS` keeps Sayve replies intentionally short. Capture interpretation can also be capped separately with `OPENAI_CAPTURE_MAX_OUTPUT_TOKENS`. Sayve still keeps a deterministic evidence-pack fallback so asking Sayve does not fail just because the provider is temporarily unavailable. Founder telemetry records `provider`, `status`, token, cost, latency, and whether the OpenAI conversation model or deterministic fallback answered. Launch Readiness now also checks telemetry completeness, so public launch should not pass if these fields are still missing in live events.

Supabase import validation treats telemetry completeness as a staging requirement. `ai_telemetry_events` must carry non-negative token, cost, and latency fields before a batch is staged or loaded, because Founder Console cost and runtime health depend on those columns. Capture interpretation telemetry must also keep `capture_external_id`, `memory_object_external_id`, and AI Decisions metadata (`intent`, `decision`, `confidenceBand`, `needsUserInput`) so Founder Console can still explain what AI decided after migration.

For founder-only prototype migration, use the import endpoints in this order:

```text
GET  /api/admin/import/supabase/validate
GET  /api/admin/import/supabase/dry-run
POST /api/admin/import/supabase/stage
POST /api/admin/import/supabase/load
```

`load` writes the validated plan into normalized Memory Engine tables through the service role, resolves `*_external_id` fields into Supabase UUID foreign keys, and skips rows already present by `external_id`.

`dry-run` returns a `planSignature`. Only call `load` with that latest signature plus `confirmLoad=true`, so founder migration writes stay tied to a reviewed plan instead of a blind write:

```json
{
  "confirmLoad": true,
  "planSignature": "<latest dry-run planSignature>"
}
```

## 3. Local Verification

Before deploy:

```bash
pnpm run verify
```

This runs typecheck, unit tests, and production build.

Before configuring or promoting a deployed environment, run the env preflight for the intended stage:

```bash
SAYVE_ENV_TARGET=private-beta pnpm run verify:env
SAYVE_ENV_TARGET=public-launch pnpm run verify:env
```

Or use the bundled shortcuts:

```bash
pnpm run verify:private-beta
pnpm run verify:public-launch
```

`private-beta` requires Supabase repository mode, Supabase Auth, admin/private-beta protection, a default household, and usage limits. `public-launch` additionally requires `OPENAI_API_KEY`, all pricing env values, and a complete smoke proof: `SAYVE_DEPLOYMENT_SMOKE_VERIFIED=1`, `SAYVE_DEPLOYMENT_SMOKE_VERIFIED_AT`, and `SAYVE_DEPLOYMENT_SMOKE_TARGET`.
Set `NEXT_PUBLIC_APP_URL` to the real deployed origin before private beta so Google OAuth, email magic-link redirects, and invite acceptance all return to one stable URL instead of depending on whichever `window.location.origin` happened to open the app.

Vercel is pinned by `vercel.json`: install uses `pnpm install --frozen-lockfile`, and build runs `pnpm run verify:scripts`, `pnpm run verify:env`, `pnpm run typecheck`, `pnpm run verify:migrations`, and `pnpm run build`. For the first private beta deploy, configure Vercel with `SAYVE_ENV_TARGET=private-beta`. Do not promote the Vercel environment to `SAYVE_ENV_TARGET=public-launch` until the live smoke test has passed and `SAYVE_DEPLOYMENT_SMOKE_VERIFIED=1` has been set.

The unit tests include route-level API contract coverage for capture, conversation, dashboard, categories, health, admin readiness, invalid JSON, and empty body handling.
They also cover multi-member household capture and household onboarding route contracts.

`pnpm run verify` also runs `pnpm run verify:scripts` and `pnpm run verify:migrations`. This checks deployment script syntax, API/admin no-store security headers, the required Memory Engine tables, RLS, external IDs, telemetry fields, snapshot repository table, snapshot security boundary, and role-aware household policies.

GitHub Actions also runs the same verification on push to `main` and pull requests through `.github/workflows/verify.yml`.

CI proves the code builds. It does not prove the deployed Supabase/Vercel environment is configured correctly; that is handled by the production smoke test below.

## 4. Production Smoke Test

After deploy, open private beta once:

```text
https://your-domain/?access_token=APP_ACCESS_TOKEN
```

The middleware stores a private beta cookie and removes `access_token` from the URL. API clients can also send `x-app-access-token`; blocked API calls return JSON with `private_beta_access_required`.

Check launch readiness:

```text
GET https://your-domain/api/admin/launch-readiness
x-admin-token: ADMIN_CONSOLE_TOKEN
```

Launch Readiness checks environment variables, telemetry completeness, browser auth redirect readiness, and the live Supabase schema/security gate. It should fail if migrations `004`, `005`, `006`, `007`, `008`, `009`, `010`, `011`, or `012` are missing even when the env vars look correct. It also requires the schema-check response to include all expected security check ids, including `media_storage_bucket`, so an older deployed schema-check route cannot accidentally report public-ready. Deployment smoke requires the live Launch Readiness response itself to include the latest required top-level readiness fields (`configReadyForPrivateBeta`, `liveSmokeVerified`, `readyForPublicLaunch`) and check ids, including `app_base_url`, `supabase_url_consistency`, `supabase_key_boundary`, `media_upload_limits`, and `ai_telemetry_completeness`, so an older deployed app route cannot pass by omission.

Check public-safe health:

```text
GET https://your-domain/api/health
```

The health response is public-safe but still returns `Cache-Control: no-store` and `X-Robots-Tag: noindex`, because deployment smoke should read the live app state rather than a cached health response.

Verify Supabase Memory Engine schema:

```text
GET https://your-domain/api/admin/import/supabase/schema-check
x-admin-token: ADMIN_CONSOLE_TOKEN
```

This checks required migration columns plus live security boundaries. The `memory_store_snapshots_service_role_only` check must pass, proving `memory_store_snapshots` has zero direct client policies after migration `004`. The `household_role_policies` check must also pass, proving migration `005` has removed broad member-write policies and migration `007` has completed owner/member write policies for normalized interpretation rows; the live RPC explicitly reports `interpretationWriterPolicyCount`. The `invites_service_role_only` check must pass, proving migration `006` keeps invite rows service-role-only. The `invites_atomic_acceptance` check must pass, proving migration `008` installed the row-locking RPC that makes invite tokens single-use. The schema column check must include `memory_revisions.actor_user_id` from migration `009` and `household_categories.created_by_user_id` from migration `010`. The `memory_facts_payload_shape` check must pass, proving migration `011` installed Postgres constraints for financial fact direction, ownership, and money shape. The `ai_telemetry_shape` check must pass, proving migration `012` installed constraints for telemetry phase/provider/status and non-negative token, cost, and latency metrics. When `SUPABASE_MEDIA_BUCKET` is configured, `media_storage_bucket` must pass, proving the receipt/voice source-file bucket exists, is accessible, and is private.

Verify Supabase repository can write:

```text
POST https://your-domain/api/admin/repository/smoke-test
x-admin-token: ADMIN_CONSOLE_TOKEN
```

To verify a specific real household instead of only the default smoke binding, pass:

```json
{
  "householdId": "<target-household-id>"
}
```

The response now also reports whether the household row exists and how many `household_members` / `owner` roles were found, so founder rollout can catch "snapshot exists but the real family household is still half-set-up."

Expected:

```json
{
  "configured": true,
  "ok": true,
  "repositoryMode": "supabase",
  "persistedSnapshot": true
}
```

Or run the automated deployment verifier:

```bash
SAYVE_DEPLOY_URL=https://your-domain \
APP_ACCESS_TOKEN=... \
ADMIN_CONSOLE_TOKEN=... \
pnpm run verify:deploy
```

For public-ready smoke, `SAYVE_DEPLOY_URL` must be an HTTPS non-local deployment URL. Use `SAYVE_REQUIRE_PUBLIC_READY=0` only for local or private smoke tests such as `http://localhost:3000`.

To prove real household login works, create a test Supabase Auth session for the owner of the target household and run the authenticated smoke test. The primary token should belong to a household `owner` because the verifier also checks product invite creation. The second token should belong to a `member`, and the viewer token should belong to a `viewer`:

```bash
SAYVE_DEPLOY_URL=https://your-domain \
APP_ACCESS_TOKEN=... \
ADMIN_CONSOLE_TOKEN=... \
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
SAYVE_TEST_HOUSEHOLD_ID=<household uuid> \
pnpm run verify:deploy
```

This checks:

- the private beta gate blocks page and API access without `APP_ACCESS_TOKEN`
- the deployed Supabase project has the required Memory Engine tables, columns, and security checks
- `memory_store_snapshots_service_role_only` passes after migration `004`
- `household_role_policies` passes after migrations `005` and `007`
- `invites_service_role_only` passes after migration `006`
- `invites_atomic_acceptance` passes after migration `008`
- `memory_revisions.actor_user_id` is present after migration `009`
- `household_categories.created_by_user_id` is present after migration `010`
- `memory_facts_payload_shape` passes after migration `011`
- `ai_telemetry_shape` passes after migration `012`
- `media_storage_bucket` passes when `SUPABASE_MEDIA_BUCKET` is configured, proving the bucket is private
- non-mutating Supabase import planning passes through `/api/admin/import/supabase/validate` and `/api/admin/import/supabase/dry-run` without calling the writer `/api/admin/import/supabase/load`
- partner invite link generation returns `inviteUrl`/`privateBetaInviteUrl` with onboarding no-store headers when `SAYVE_REQUIRE_INVITE_SMOKE=1`
- first-run household bootstrap succeeds for a fresh zero-household account when `SAYVE_REQUIRE_BOOTSTRAP_SMOKE=1`
- Founder Console `Onboarding Health` shows the new pending invite and counts it as email-locked when the invite targets a specific email
- the `/invite` page itself returns `Cache-Control: no-store` and `X-Robots-Tag: noindex`
- when `SAYVE_TEST_INVITE_ACCEPT_SUPABASE_ACCESS_TOKEN` is set, a fresh unjoined account can accept a new invite end-to-end and then sees the shared `household_id` in `/api/households`
- product owner invite creation returns `inviteUrl`/`privateBetaInviteUrl` with no-store headers when `SAYVE_REQUIRE_INVITE_SMOKE=1`
- Founder Console `Onboarding Health` also reflects the in-app product invite row so partner onboarding can be monitored without opening Supabase directly
- unauthenticated high-frequency capture and conversation requests are rejected before malformed JSON bodies are parsed when `SUPABASE_AUTH_REQUIRED=1`
- local route tests cover the same auth-before-parse boundary across broader private JSON writes: receipt/voice JSON capture, categories, context updates, context confirmation, memory interpretation, correction, split, and redaction
- unauthenticated receipt/voice multipart uploads are rejected before body parsing when `SUPABASE_AUTH_REQUIRED=1`
- the test user can list the target household
- the primary test user can create one `[smoke]` text capture
- the primary test user can create receipt and voice multipart captures with provided note/transcript, proving the upload routes, auth, no-store headers, Memory pipeline, and capture telemetry without forcing receipt vision or speech-to-text calls during smoke
- unspecified smoke captures return `ownershipScope=shared` and remain 公家 in dashboard even though `createdBy` records the acting user
- Founder Console recent telemetry contains the new capture interpretation event and records token, cost, latency, intent, decision, confidence band, and `needsUserInput` fields for that AI decision path
- the primary test user can ask one conversation question and Founder Console recent telemetry records the answer path
- OpenAI capture and conversation telemetry report `provider=openai` and `status=success` when `SAYVE_REQUIRE_OPENAI_SMOKE=1` or public-ready smoke is required
- privacy redaction archives a smoke memory, first asks a sourced question about that memory, then removes the sensitive token/amount from memory detail and Founder Console, redacts the user question/assistant answer pair, and redacts linked telemetry when `SAYVE_REQUIRE_PRIVACY_SMOKE=1` or public-ready smoke is required
- a custom category can be created by the logged-in writer, appears in dashboard `categoryOptions`, and appears in Founder Console raw categories with `createdByUserId`
- the second test user can create one `[smoke]` text capture when `SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN` is set; public-ready smoke requires this token
- the shared dashboard can read the exact new fact ids created by both household members and preserve each fact's `createdBy` attribution
- the shared timeline can read the same new memory/fact ids as the dashboard
- private household API smoke responses return `Cache-Control: no-store` and `X-Robots-Tag: noindex`
- the viewer test user can list the household and read dashboard, but cannot create a capture or custom category when `SAYVE_TEST_VIEWER_SUPABASE_ACCESS_TOKEN` is set; public-ready smoke requires this token

For public launch, rerun this authenticated smoke test with owner, second-member, and viewer Supabase session tokens. Public-ready smoke enforces two-member household writes, viewer read-only boundaries, product owner invite creation, successful OpenAI capture/conversation telemetry, and privacy redaction by default. The explicit flags `SAYVE_REQUIRE_TWO_MEMBER_SMOKE=1`, `SAYVE_REQUIRE_VIEWER_SMOKE=1`, `SAYVE_REQUIRE_INVITE_SMOKE=1`, `SAYVE_REQUIRE_OPENAI_SMOKE=1`, and `SAYVE_REQUIRE_PRIVACY_SMOKE=1` are still useful for making private-beta smoke stricter while `SAYVE_REQUIRE_PUBLIC_READY=0`. After public-ready smoke passes, set `SAYVE_DEPLOYMENT_SMOKE_VERIFIED=1`, `SAYVE_DEPLOYMENT_SMOKE_VERIFIED_AT=<ISO timestamp>`, and `SAYVE_DEPLOYMENT_SMOKE_TARGET=<deployed URL>` in the deployment environment and redeploy. Until that smoke proof is present, Launch Readiness should show private-beta config readiness but not public-launch readiness.

If you also want a reusable proof artifact for founder review or investor / operator handoff, add `SAYVE_DEPLOY_PROOF_REPORT_PATH` when you run the smoke command:

```text
SAYVE_DEPLOY_PROOF_REPORT_PATH=outputs/setup/deploy-proof-report.json SAYVE_DEPLOY_URL=https://your-domain APP_ACCESS_TOKEN=... ADMIN_CONSOLE_TOKEN=... pnpm run verify:deploy:strict-private-beta
```

That smoke path now writes both:

- `outputs/setup/deploy-proof-report.json`
- `outputs/setup/deploy-proof-summary.md`

The JSON report captures the deploy URL, required smoke mode, token presence summary, launch-readiness snapshot, and all warnings/failures from the run.

If you want to regenerate the summary later, run:

```text
pnpm run report:deploy-proof
```

This writes `outputs/setup/deploy-proof-summary.md`, so the deploy-day readout is immediately human-readable instead of living only inside raw JSON.

For private beta only, if Launch Readiness still has warnings but no failures:

```bash
SAYVE_REQUIRE_PUBLIC_READY=0 \
SAYVE_DEPLOY_URL=https://your-domain \
APP_ACCESS_TOKEN=... \
ADMIN_CONSOLE_TOKEN=... \
pnpm run verify:deploy
```

Shortcut:

```bash
SAYVE_DEPLOY_URL=https://your-domain APP_ACCESS_TOKEN=... ADMIN_CONSOLE_TOKEN=... pnpm run verify:deploy:private-beta
SAYVE_DEPLOY_URL=https://your-domain APP_ACCESS_TOKEN=... ADMIN_CONSOLE_TOKEN=... pnpm run verify:deploy:public-launch
```

For public launch, use `pnpm run verify:deploy:public-launch` and do not override it with `SAYVE_REQUIRE_PUBLIC_READY=0`.

## 5. Founder Console

Open:

```text
https://your-domain/admin?token=ADMIN_CONSOLE_TOKEN
```

The first `/admin?token=...` visit stores a HttpOnly `sayve_admin` cookie and redirects to `/admin` without the token in the URL. Admin APIs do not accept query-string admin tokens; scripts and non-browser clients must use `x-admin-token`, while browser requests should rely on the `sayve_admin` cookie.

Check:

- Launch Readiness has no `FAIL`.
- Founder Console page and admin APIs return `Cache-Control: no-store` and `X-Robots-Tag: noindex`.
- Household Setup can create the founder household, invite the partner, and confirm both users are members of the same household.
- AI Cost Analytics updates after capture/voice/receipt/conversation calls.
- AI Decisions shows capture decision outcomes from telemetry: auto-confirm, review-later, ask-user, low confidence, intent mix, and decision mix.
- Memory Quality shows confidence, auto-confirm, review-later, correction rate.
- Raw tables show captures, memories, facts, context, revisions, categories, telemetry.

## 6. Current Production Storage Shape

Private beta runtime storage uses `memory_store_snapshots.state` as a Supabase JSONB snapshot of the Memory Engine.

Snapshots are scoped by `household_id`. Runtime API routes resolve the logged-in household first, then read/commit that household's snapshot. `SUPABASE_DEFAULT_HOUSEHOLD_ID` remains a fallback for smoke tests and founder-only flows, not the global storage target for every user. Launch Readiness now also verifies that this configured household id really exists in live Supabase, already has at least one household member, and includes an `owner`, so a copied-but-wrong UUID or half-finished founder setup is caught before launch.

After migration `004`, `memory_store_snapshots` is service-role-only. Browser and future mobile clients must not write this table directly; they should use Sayve API routes so retry, telemetry, and audit behavior stay intact.

After migrations `005` and `007`, direct Supabase RLS policies also respect household roles: `viewer` can read projections, while only `owner` and `member` can write normalized Memory projection rows. Sayve API routes enforce the same boundary before service-role writes.

After migration `006`, `invites` is service-role-only. Browser and future mobile clients must accept invites through Sayve API routes, not by directly reading invite rows or tokens from Supabase.

After migration `008`, invite acceptance is atomic inside Postgres through `sayve_accept_household_invite`. The function locks the invite row before checking `accepted_at`, adding the household member, and marking the invite accepted, so the same token cannot add two different users during a race.

After migration `009`, `memory_revisions.actor_user_id` keeps user corrections, splits, context confirmations, and privacy redactions attributable to the acting household member.

After migration `010`, `household_categories.created_by_user_id` keeps custom category creation attributable to the member who taught Sayve that category.

After migration `011`, normalized `memory_facts.payload` is constrained in Postgres. `ownershipScope` can only be `shared` or `member`, so unspecified spending remains 公家 unless the capture clearly says it is personal.

After migration `012`, normalized `ai_telemetry_events` is constrained in Postgres. Telemetry phase/provider/status values are bounded, and token, cost, and latency metrics must be non-negative when present.

Snapshot commits use optimistic revision checks. Core write paths retry once after `supabase_memory_repository_conflict` by re-reading the household snapshot and applying the same user action again. New write paths should use `withMemoryRepositoryRetry` rather than ignoring the conflict.

The normalized Memory Engine tables remain available as the long-term projection/import target:

- captures
- memory_objects
- memory_interpretations
- memory_facts
- household_context
- memory_relationships
- memory_revisions
- insights
- conversation_messages
- ai_telemetry_events

This keeps V1 shippable while preserving the AI Native Memory architecture. Founder Console aggregates all Supabase snapshot rows for product/AI monitoring, while user-facing routes only operate on the active household.
