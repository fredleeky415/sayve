# Sayve Founder Private Beta Execution

This is the practical founder playbook for the day you actually move Sayve from local demo to a real private beta.

Use it together with:

- `/admin`
- `docs/private-beta-launch-checklist.md`
- `docs/deployment-runbook.md`

The principle is simple:

Do not guess.
Do not configure from memory.
Always set one page, then verify it in `/admin`.

Before you touch any live setting, you can print a redacted setup summary with:

```bash
pnpm run report:setup
```

Use it as a quick snapshot of current env coverage, OAuth redirect targets, smoke-token collection instructions, and the immediate next setup actions.

## 1. Create Supabase Project

In Supabase:

1. Create a new project.
2. Keep the project URL.
3. Copy:
   - `Project URL`
   - `anon public key`
   - `service_role secret key`

These map to:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

If you also set `SUPABASE_URL`, it must point to the same Supabase project host as `NEXT_PUBLIC_SUPABASE_URL`.

## 2. Apply Migrations

Apply migrations `001` to `012` in order.

After that, verify in `/admin` or schema-check that these are present:

- household tables
- invite protections
- memory snapshot storage
- role-aware RLS
- fact payload constraints
- AI telemetry constraints

The founder rule here is:

If schema-check is not green, do not continue to onboarding.

## 3. Configure Google OAuth in Supabase

In Supabase Auth:

1. Enable Google provider.
2. Paste Google client id / secret.
3. Set `Site URL` to the real Sayve app origin.
4. Add redirect allow-list entries:
   - root app URL
   - `/invite`

Use `/admin` -> `Auth Setup Targets` as the source of truth.

Do not manually reconstruct redirect URLs from memory.

## 4. Set Vercel Environment Variables

In Vercel Project Settings -> Environment Variables:

Set private-beta minimum:

- `SAYVE_ENV_TARGET=private-beta`
- `MEMORY_REPOSITORY=supabase`
- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DEFAULT_HOUSEHOLD_ID`
- `SUPABASE_AUTH_REQUIRED=1`
- `APP_ACCESS_TOKEN`
- `ADMIN_CONSOLE_TOKEN`

Optional now, required later:

- `SUPABASE_URL`
- `SUPABASE_MEDIA_BUCKET`
- `RECEIPT_UPLOAD_MAX_BYTES`
- `VOICE_UPLOAD_MAX_BYTES`
- OpenAI pricing vars

Use `/admin` -> `Env Setup Matrix` as the source of truth.

Do not promote to public-launch env target yet.

## 5. Create Founder Household

After deploy, open:

- `https://your-domain/?access_token=APP_ACCESS_TOKEN`

Then go to:

- `/admin`

Use `Household Setup` to:

1. create founder household
2. attach founder as `owner`
3. keep the resulting household UUID

That UUID becomes:

- `SUPABASE_DEFAULT_HOUSEHOLD_ID`

Then verify:

- `/admin` -> `Default Household Binding`

You want:

- household exists
- member count >= 1
- owner count >= 1

## 6. Invite Partner

Still in `/admin`:

1. create partner invite
2. use `privateBetaInviteUrl` if `APP_ACCESS_TOKEN` is enabled
3. send the link to your partner

Partner flow:

1. open invite link
2. login with their own Google account
3. accept invite

Then verify in `/admin`:

- `Onboarding Health`
- `Household Roster View`

You want:

- accepted invite visible
- member count >= 2

## 7. Collect Smoke Tokens

Use `/admin` -> `Smoke Token Guide`.

What to copy from browser localStorage:

- `sayve_access_token`
- `sayve_household_id`

Do this separately for:

- founder owner account
- partner member account
- viewer account
- fresh unjoined account if invite-acceptance smoke is required

Use separate browser profiles or incognito windows so tokens do not overwrite each other.

## 8. Run Private Beta Smoke

Run:

```bash
SAYVE_DEPLOY_URL=https://your-domain \
APP_ACCESS_TOKEN=... \
ADMIN_CONSOLE_TOKEN=... \
pnpm run verify:deploy:private-beta
```

For stricter live proof, include:

```bash
SAYVE_TEST_SUPABASE_ACCESS_TOKEN=<owner-token> \
SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN=<partner-token> \
SAYVE_TEST_VIEWER_SUPABASE_ACCESS_TOKEN=<viewer-token> \
SAYVE_TEST_INVITE_ACCEPT_SUPABASE_ACCESS_TOKEN=<fresh-token> \
SAYVE_TEST_HOUSEHOLD_ID=<household-id>
```

## 9. Verify Founder Console After Smoke

Check:

- `Launch Readiness`
- `Private Beta Handoff`
- `AI Runtime Health`
- `AI Decisions`
- `Onboarding Health`
- `Live Rollout Checklist`

What you want to see:

- no critical launch failures for private beta
- telemetry exists after capture and ask
- partner onboarding is visible
- deploy smoke is reflected

## 10. Only Then Treat It As Real Private Beta

Private beta is real only when all of these are true:

1. founder login works
2. partner login works
3. both write to the same household memory
4. unspecified spending remains shared/public household spending
5. dashboard reads shared state
6. Founder Console shows real AI telemetry
7. deploy smoke passes

## 11. Do Not Treat It As Public Launch Yet

Public launch still requires:

- full smoke proof marker
- OpenAI production proof
- pricing env completeness
- media storage completeness
- privacy redaction proof
- two-member + viewer proof

Private beta first means:

prove real usage,
then harden the public gate.
