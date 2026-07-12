# Sayve Founder Private Beta Checklist（中文版）

呢份係你揀咗 A 之後，最實際嘅做法：

先俾你自己同你老婆真用，跑順 `household / login / capture / ask / dashboard`，之後先公開。

目標唔係一開始做大。

目標係先證明：

- 兩個人可以用自己 Google account 登入
- 兩個人會寫入同一個家庭 memory
- capture / ask / dashboard 真係順
- Founder Console 睇到 AI 成本、質量、telemetry

---

## 0. 你要準備嘅 3 樣

正式開始前，先確認：

1. 有冇開 Supabase project
2. 想唔想而家接 Google Login
3. OpenAI API key 準備好未

如果未齊都唔緊要。

最少可以先開：

- Supabase
- Vercel
- Google OAuth

OpenAI key 可以最後先補。

---

## 1. 開 Supabase Project

去 Supabase：

1. Create new project
2. 記低以下 3 個 value：
   - `Project URL`
   - `anon public key`
   - `service_role secret key`

之後會對應到：

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

如果你另外設：

- `SUPABASE_URL`

佢都一定要指返同一個 Supabase project。

---

## 2. 跑 Supabase Migrations

要套用 `001` 到 `012` migration。

完成後，最少要確認以下幾樣存在：

- households / household_members
- invites
- memory snapshot storage
- AI telemetry tables / constraints
- category attribution
- fact payload constraints

原則好簡單：

**schema 未綠燈，唔好做 onboarding。**

你之後可以用 `/admin` 睇 schema / readiness。

---

## 3. 開 Google Login（推薦即刻做）

因為你已經講明：

你同你老婆要各自用自己 account 登入。

所以我建議而家就開 Google OAuth。

### 喺 Supabase Auth 做：

1. Enable Google provider
2. 貼入 Google Client ID / Secret
3. `Site URL` 設做你之後正式用嘅 Sayve 網址
4. Redirect allow-list 加：
   - 根網址
   - `/invite`

例如：

- `https://your-domain.com`
- `https://your-domain.com/invite`

唔好靠記憶手打。

以 `/admin` 入面 `Auth Setup Targets` 為準。

---

## 4. 開 Vercel Project

去 Vercel：

1. import 呢個 repo / project
2. 先唔好急住 public launch
3. 只做 private beta deploy

你現階段目標係：

**有一個真實網址俾你同老婆試用。**

---

## 5. 設 Vercel Environment Variables

最少要設呢批：

### Private beta 必需

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

### 建議一齊設

- `SUPABASE_URL`

### 之後 public launch 前要補

- `SUPABASE_MEDIA_BUCKET`
- `RECEIPT_UPLOAD_MAX_BYTES`
- `VOICE_UPLOAD_MAX_BYTES`
- OpenAI pricing env

### Token 點整

你可以本地 generate：

```bash
openssl rand -base64 32
```

`APP_ACCESS_TOKEN` 同 `ADMIN_CONSOLE_TOKEN` 要分開，唔好用同一條。

---

## 6. 設 `NEXT_PUBLIC_APP_URL`

呢個好重要。

例如你 Vercel 真網址係：

- `https://sayve.vercel.app`

咁：

- `NEXT_PUBLIC_APP_URL=https://sayve.vercel.app`

之後：

- Google login redirect
- `/invite`
- browser auth callback

全部都會跟呢個 base URL。

呢一步如果做錯，好容易出現：

- login 完跳錯 domain
- invite 開咗去 preview link
- 你老婆 join 唔到同一 household

---

## 7. Deploy 一次

deploy 完之後，先開：

```text
https://your-domain.com/?access_token=APP_ACCESS_TOKEN
```

目的：

- 入 private beta gate
- 產生 private beta cookie

之後再入：

- `/admin`

---

## 8. 建 Founder Household

喺 `/admin` 做：

1. create founder household
2. 把你自己 attach 做 `owner`
3. 記低 household UUID

呢個 household UUID 會成為：

- `SUPABASE_DEFAULT_HOUSEHOLD_ID`

之後檢查 `/admin`：

- `Default Household Binding`

你想見到：

- household exists
- member count >= 1
- owner count >= 1

---

## 9. 邀請你老婆

喺 `/admin`：

1. create partner invite
2. 如果有 `APP_ACCESS_TOKEN`，用 `privateBetaInviteUrl`
3. send 俾你老婆

你老婆流程：

1. 開 invite link
2. 用自己 Google account login
3. accept invite

之後去 `/admin` 睇：

- `Onboarding Health`
- `Household Roster View`

你想見到：

- invite accepted
- household member count >= 2

---

## 10. 驗證「同一個家庭 memory」

呢一步係 A 路線最重要。

你同你老婆都各自登入之後，要驗：

1. 你入一條 capture
2. 你老婆再入一條 capture
3. dashboard 睇到兩條都喺同一個 household
4. createdBy 會保留各自 attribution
5. 如果冇講明「我自己／太太自己」，就當 `shared`

即係：

- 係同一個家庭 memory
- 唔係兩本獨立帳

---

## 11. 收集 Smoke Tokens

去 `/admin` 睇：

- `Smoke Token Guide`

你要學識點拎：

- `sayve_access_token`
- `sayve_household_id`

最少收集：

1. founder / owner token
2. partner / member token

如果想做更完整 smoke，再加：

3. viewer token
4. fresh unjoined token

建議用：

- Chrome profile A：你
- Chrome profile B：你老婆
- Incognito：viewer / fresh invite test

避免 token 互相覆蓋。

---

## 12. 跑部署 Smoke Test

最基本：

```bash
SAYVE_DEPLOY_URL=https://your-domain.com \
APP_ACCESS_TOKEN=... \
ADMIN_CONSOLE_TOKEN=... \
pnpm run verify:deploy:private-beta
```

如果要驗真雙人 household：

```bash
SAYVE_DEPLOY_URL=https://your-domain.com \
APP_ACCESS_TOKEN=... \
ADMIN_CONSOLE_TOKEN=... \
SAYVE_TEST_SUPABASE_ACCESS_TOKEN=<owner-token> \
SAYVE_TEST_SECOND_SUPABASE_ACCESS_TOKEN=<partner-token> \
SAYVE_TEST_HOUSEHOLD_ID=<household-id> \
pnpm run verify:deploy:private-beta
```

如果之後你想連 viewer / invite acceptance 都驗埋，再加：

- `SAYVE_TEST_VIEWER_SUPABASE_ACCESS_TOKEN`
- `SAYVE_TEST_INVITE_ACCEPT_SUPABASE_ACCESS_TOKEN`

---

## 13. Smoke 後要睇咩

返 `/admin` 睇：

- `Launch Readiness`
- `Private Beta Handoff`
- `Live Rollout Checklist`
- `AI Runtime Health`
- `AI Decisions`
- `Onboarding Health`

你想見到：

- private beta 無 critical failure
- capture / ask 後有 telemetry
- household onboarding 係 visible
- deploy smoke 有 proof

---

## 14. 你而家呢個階段，咩先算 ready

對你而家嚟講，**ready 唔係 public launch**。

只係代表：

1. 你可以用自己 Google account login
2. 你老婆可以用自己 Google account login
3. 兩個人 join 同一 household
4. 兩個人寫入同一個 memory
5. dashboard / ask 睇到同一家庭資料
6. Founder Console 睇到真 telemetry
7. deploy smoke pass

做到呢 7 點，就已經係好健康嘅 private beta。

---

## 15. 暫時唔需要做嘅嘢

你而家唔需要急住做：

- public launch
- app store packaging
- 大量用戶 onboarding
- 成本極致優化
- growth / promotion system

而家最重要只係：

**你同你老婆每日真用，睇下 Sayve 係咪真係做到「講一聲就記得」。**

---

## 16. 我建議你下一步實際行動

照優先次序做：

1. 開 Supabase project
2. 開 Google OAuth
3. 設 Vercel env
4. deploy
5. 建 founder household
6. invite 你老婆
7. 跑 private beta smoke

如果你想，我下一步可以直接幫你出：

- 一份 **逐格逐格填嘅 `.env / Vercel / Supabase checklist`**
- 一份 **Google OAuth 設定圖文步驟**
- 一份 **你而家應該填入咩值嘅表格**

