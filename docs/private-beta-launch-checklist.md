# Sayve Private Beta Launch Checklist

Use this checklist when moving from local prototype to a real Vercel + Supabase private beta.

Pair this checklist with `/admin`:

- `Launch Readiness`: overall gate status
- `Default Household Binding`: confirms the configured founder household really exists, has members, and has an owner
- `Onboarding Health`: pending / accepted / expired partner invites
- `Live Proof Gaps`: separates local code readiness from the real deployed / real user / real OpenAI proof still missing
- `Onboarding Proof Steps`: step-by-step founder / partner / bootstrap proof order for real household validation
- `Auth Setup Targets`: exact Supabase Auth Site URL + redirect allow-list targets
- `Env Setup Matrix`: Vercel env coverage for private beta / public launch / deploy smoke
- `Deploy Smoke Guide`: exact smoke commands and required session tokens
- `Deploy Smoke Env Template`: strict smoke flags and env names you can copy before running the command
- `Smoke Token Guide`: where to log in and which localStorage keys to copy for owner / partner / viewer / fresh-invite smoke tokens

## 1. Supabase

- Apply migrations `001` to `012` in order.
- Confirm `household_categories.created_by_user_id` exists after migration `010`.
- Confirm `memory_facts_payload_shape` passes after migration `011`.
- Confirm `ai_telemetry_shape` passes after migration `012`.
- Create two Supabase Auth users: one for the founder, one for the partner.
- Create one household for the family.
- Add both users to `household_members` with the same `household_id`.
- Founder role should be `owner`.
- Partner role should be `member`.
- Optional test account role should be `viewer`.

## 2. Vercel Env

- `MEMORY_REPOSITORY=supabase`
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_URL`, optional when server storage should reuse `NEXT_PUBLIC_SUPABASE_URL`; if set, it must use the same Supabase project host.
- `SUPABASE_SERVICE_ROLE_KEY`, server-only service-role/secret key, never the browser anon/publishable key.
- `SUPABASE_DEFAULT_HOUSEHOLD_ID`
- `SUPABASE_MEDIA_BUCKET`, required before public launch so receipt/voice source files are persisted in a private bucket.
- `RECEIPT_UPLOAD_MAX_BYTES` and `VOICE_UPLOAD_MAX_BYTES`, optional for private beta because safe defaults apply when unset, but required before public launch or whenever `SAYVE_REQUIRE_MEDIA_STORAGE=1`.
- `SUPABASE_AUTH_REQUIRED=1`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `APP_ACCESS_TOKEN`
- `ADMIN_CONSOLE_TOKEN`
- `PROTOTYPE_USAGE_LIMITS_DISABLED=0`

Quick pass target in `/admin`:

- `Env Setup Matrix` should show all private-beta rows as `ready` except optional items.
- `Auth Setup Targets` should show the exact production URL plus `/invite`.
- `Launch Readiness` -> `Receipt/voice media storage` should only be considered fully healthy after the server write/delete smoke passes against the real bucket.
- `Live Rollout Checklist` -> `Media storage` should say the bucket smoke passed; if it only says the bucket is configured, treat it as not fully proven yet.

Generate separate strong values for `APP_ACCESS_TOKEN` and `ADMIN_CONSOLE_TOKEN`:

```bash
openssl rand -base64 32
```

## 3. Preflight

Run locally before setting or promoting env:

```bash
SAYVE_ENV_TARGET=private-beta pnpm run verify:env
pnpm run verify
```

Shortcut:

```bash
pnpm run verify:private-beta
```

Expected:

- local env preflight passes
- `pnpm run verify` passes
- `/admin` -> `Launch Readiness` should at least move to private-beta config ready once real env is in place

## 4. Deploy Smoke

How to collect the session tokens shown in `/admin` -> `Smoke Token Guide`:

- `SAYVE_TEST_SUPABASE_ACCESS_TOKEN`
  - login as founder/owner
  - open DevTools -> Application -> Local Storage
  - copy `sayve_access_token`
- `SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN`
  - use a second browser profile or incognito
  - login as partner and accept the partner invite
  - copy `sayve_access_token`
- `SAYVE_TEST_VIEWER_SUPABASE_ACCESS_TOKEN`
  - create a viewer invite
  - login in a clean browser profile
  - accept the viewer invite
  - copy `sayve_access_token`
- `SAYVE_TEST_INVITE_ACCEPT_SUPABASE_ACCESS_TOKEN`
  - login with a fresh account that has not joined the household yet
  - copy `sayve_access_token` before pressing join
- `SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN`
  - login with another fresh account that belongs to zero households
  - copy `sayve_access_token` before the first-run initialization creates a household
- `SAYVE_TEST_HOUSEHOLD_ID`
  - copy `sayve_household_id` from the same browser localStorage after the correct household is selected

Run after Vercel deploy:

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
SAYVE_TEST_SUPABASE_ACCESS_TOKEN=<founder-session-token> \
SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN=<partner-session-token> \
SAYVE_TEST_VIEWER_SUPABASE_ACCESS_TOKEN=<viewer-session-token> \
SAYVE_TEST_INVITE_ACCEPT_SUPABASE_ACCESS_TOKEN=<fresh-unjoined-session-token> \
SAYVE_TEST_BOOTSTRAP_SUPABASE_ACCESS_TOKEN=<fresh-no-household-session-token> \
SAYVE_TEST_HOUSEHOLD_ID=<household uuid> \
pnpm run verify:deploy
```

Shortcuts:

```bash
SAYVE_DEPLOY_URL=https://your-domain APP_ACCESS_TOKEN=... ADMIN_CONSOLE_TOKEN=... pnpm run verify:deploy:private-beta
SAYVE_DEPLOY_URL=https://your-domain APP_ACCESS_TOKEN=... ADMIN_CONSOLE_TOKEN=... pnpm run verify:deploy:public-launch
```

After smoke:

- set `SAYVE_DEPLOYMENT_SMOKE_VERIFIED=1`
- set `SAYVE_DEPLOYMENT_SMOKE_VERIFIED_AT=<ISO timestamp>`
- set `SAYVE_DEPLOYMENT_SMOKE_TARGET=https://your-domain`
- redeploy

Media storage proof expectation:

- `/admin` -> `Launch Readiness` should show `Receipt/voice media storage = pass`
- if it shows `warn` or `fail`, treat it as real bucket drift: wrong bucket name, missing storage permission, or failed cleanup in the private media bucket

Then `/admin` should show:

- `Live smoke verified = YES`
- `Private Beta Handoff` near-complete
- `Live Rollout Checklist` deploy smoke row = `READY`

## 5. Must Pass

- A brand-new account with zero households can finish first-run bootstrap and becomes `owner` of the created household.
- Founder and partner can log in with separate Supabase accounts.
- Both users write to the same household memory.
- Captures preserve `created_by`.
- Dashboard reads the household aggregate.
- Viewer can read but cannot write.
- Custom category smoke preserves `createdByUserId` and appears in Dashboard category options.
- Private household API smoke responses return no-store/noindex headers.
- Partner invite link returns no-store/noindex headers.
- Founder Console Launch Readiness has no failures.
- Founder Console Launch Readiness shows `ai_telemetry_completeness` as `pass` before public launch.
- Raw tables show captures, facts, interpretations, revisions, categories, telemetry, and member attribution.
- Founder Console `AI Runtime Health` has real telemetry events after live capture / ask.
- Founder Console `Onboarding Health` reflects the real partner join state.

## 6. Do Not Public Launch Yet Unless

- `SAYVE_DEPLOYMENT_SMOKE_VERIFIED=1` is set after live smoke passes.
- All AI pricing env values are configured.
- Founder Console shows real telemetry after real captures and conversations.
- OpenAI smoke has passed with `provider=openai` and `status=success` for both capture interpretation and conversation answering.
- Privacy redaction smoke has passed and removed the sensitive smoke token from memory detail and Founder Console.
