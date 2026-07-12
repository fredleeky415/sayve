# Sayve Private Beta Env Worksheet（中文版）

呢份唔係解釋文件。

呢份係你真係去開：

- Supabase
- Google OAuth
- Vercel

嗰陣可以逐格填嘅 worksheet。

---

## A. Supabase 要抄低嘅資料

### Project

- `Project URL` = ______________________________
- `Anon public key` = ______________________________
- `Service role key` = ______________________________

對應 Sayve env：

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

如果你有設 server override：

- `SUPABASE_URL` = ______________________________

注意：

`SUPABASE_URL` 同 `NEXT_PUBLIC_SUPABASE_URL` 必須係同一個 Supabase project host。

---

## B. Google OAuth 要填嘅資料

### Google Cloud / OAuth（呢兩個係填入 Supabase，不係填入 Sayve `.env.local`）

- `Google Client ID` = ______________________________
- `Google Client Secret` = ______________________________

注意：

- 呢兩個值應該貼去 `Supabase Auth > Providers > Google`
- **唔需要**另外加 `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` 去 Sayve app env
- Sayve web app 只會經 Supabase Auth 做 `signInWithOAuth({ provider: "google" })`

### Supabase Auth 要填

- `Site URL` = ______________________________
- `Redirect URL (root)` = ______________________________
- `Redirect URL (/invite)` = ______________________________

正常應該係：

- `Site URL` = `NEXT_PUBLIC_APP_URL`
- `Redirect URL (root)` = `NEXT_PUBLIC_APP_URL`
- `Redirect URL (/invite)` = `NEXT_PUBLIC_APP_URL/invite`

例如：

- `https://sayve.vercel.app`
- `https://sayve.vercel.app`
- `https://sayve.vercel.app/invite`

---

## C. Vercel 必填 env（private beta）

直接照呢個 format 填：

```env
SAYVE_ENV_TARGET=private-beta
MEMORY_REPOSITORY=supabase
NEXT_PUBLIC_APP_URL=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_DEFAULT_HOUSEHOLD_ID=
SUPABASE_AUTH_REQUIRED=1
APP_ACCESS_TOKEN=
ADMIN_CONSOLE_TOKEN=
```

---

## D. Vercel 之後要補，但 private beta 未必即刻要

```env
SUPABASE_MEDIA_BUCKET=
RECEIPT_UPLOAD_MAX_BYTES=
VOICE_UPLOAD_MAX_BYTES=
OPENAI_API_KEY=
OPENAI_CAPTURE_MODEL=
OPENAI_CONVERSATION_MODEL=
OPENAI_ESCALATION_MODEL=
OPENAI_RECEIPT_VISION_MODEL=
OPENAI_SPEECH_TO_TEXT_MODEL=
OPENAI_CAPTURE_INPUT_USD_PER_1M=
OPENAI_CAPTURE_OUTPUT_USD_PER_1M=
OPENAI_RECEIPT_VISION_INPUT_USD_PER_1M=
OPENAI_RECEIPT_VISION_OUTPUT_USD_PER_1M=
OPENAI_CONVERSATION_INPUT_USD_PER_1M=
OPENAI_CONVERSATION_OUTPUT_USD_PER_1M=
OPENAI_STT_INPUT_USD_PER_1M=
OPENAI_STT_OUTPUT_USD_PER_1M=
```

---

## E. 兩條 token 唔好用同一條

你要另外 generate：

- `APP_ACCESS_TOKEN`
- `ADMIN_CONSOLE_TOKEN`

本地 generate：

```bash
openssl rand -base64 32
```

檢查原則：

- 至少 24 個字元
- 唔好用簡單字
- 唔好兩條一樣

---

## F. Founder Household 綁定資料

Deploy 後，喺 `/admin` create founder household，然後記低：

- `Household UUID` = ______________________________

對應 env：

- `SUPABASE_DEFAULT_HOUSEHOLD_ID`

---

## G. Smoke test 要準備

最少：

- `SAYVE_DEPLOY_URL` = ______________________________
- `Owner token` = ______________________________
- `Partner token` = ______________________________
- `Household ID` = ______________________________

之後跑：

```bash
SAYVE_DEPLOY_URL=https://your-domain.com \
APP_ACCESS_TOKEN=... \
ADMIN_CONSOLE_TOKEN=... \
SAYVE_TEST_SUPABASE_ACCESS_TOKEN=<owner-token> \
SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN=<partner-token> \
SAYVE_TEST_HOUSEHOLD_ID=<household-id> \
pnpm run verify:deploy:private-beta
```

---

## H. 做完之後喺 `/admin` 要睇嘅 6 格

1. `Launch Readiness`
2. `Default Household Binding`
3. `Onboarding Health`
4. `Auth Setup Targets`
5. `Env Setup Matrix`
6. `Private Beta Handoff`

---

## I. 你而家真正想達到嘅 ready 狀態

唔係 public launch。

係以下狀態：

- 你同你老婆各自用 Google account 登入
- 你哋 join 同一 household
- 兩個人都可以 capture / ask
- 兩個人寫入同一個 memory
- dashboard 睇到同一家庭 aggregate
- `/admin` 睇到真 telemetry
- `verify:deploy:private-beta` pass

做到呢度，就已經係可以真用嘅 private beta。
