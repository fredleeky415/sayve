# Sayve Launch Completion Audit

Last updated: 2026-07-11

## Objective

將 Sayve 由本地 demo 推進到可真正上線的 V1：完成以下五個範圍。

1. production storage boundary
2. Supabase migration path
3. AI telemetry / admin monitoring
4. 核心 API 穩定性
5. 測試與部署準備

這份文件只分兩件事：

- **已被目前 repo 證明**
- **仍然需要 live infra proof**

## Evidence Summary

目前最強本地證據：

- targeted audit pack passed: `118/118`
- deploy-handoff drift pack passed: `81/81`
- setup artifact verifier passed: `node scripts/verify-setup-artifacts.mjs`
- production build passed: `next build`

結論：

- **本地代碼與驗證面已相當完整**
- **主要剩餘風險已不是架構缺件，而是 live deployment proof**

## Completion Matrix

| Requirement | Current evidence | Status | What still needs live proof |
| --- | --- | --- | --- |
| Production storage boundary | `src/server/memory/store.ts`, `src/server/memory/repository.test.ts`, `src/app/api/auth-boundary.test.ts` enforce `SUPABASE_AUTH_REQUIRED=1` -> `MEMORY_REPOSITORY=supabase` | Locally proven | 真 Supabase/Vercel env 下實際以 service role + auth mode 運行一次 |
| Supabase migration path | `src/server/memory/supabase-schema-check.ts`, `src/server/memory/supabase-applied-migrations.ts`, `scripts/verify-deployment.mjs`, `src/server/admin/launch-readiness.ts`, import validate/dry-run/load flow, migration inventory/export docs | Locally proven | 真實 Supabase project 已套用 migrations `001`-`012`，並由 live `/api/admin/import/supabase/schema-check` 加上 Founder Console live applied-migration history 一齊證明 |
| AI telemetry / admin monitoring | Founder Console, telemetry constraints, completeness gates, cost/runtime/decision views, `src/server/admin/founder-console.ts`, `src/server/memory/telemetry`, tests around telemetry/import/export | Locally proven | 真 OpenAI traffic 喺 deployed 環境產生 token/cost/latency 資料，Founder Console 真係睇到 |
| Core API stability | `src/app/api/api-contract.test.ts`, route auth-boundary tests, deploy verifier now covers capture / dashboard / timeline / memory detail / conversation sources / insight dismiss / privacy / onboarding | Locally proven | 對真 deployed URL 跑完 `verify:deploy`，證明唔只係本地 mock/pass |
| Test & deploy readiness | `package.json` verify scripts, `vercel.json`, `.github/workflows/verify.yml`, founder setup bundle, integration bundle, `outputs/setup/` artifact generation, deploy env templates/checklists | Locally proven | 真 deploy URL、真 token、真 household/session token 跑 smoke；設置 smoke proof env 後重新 deploy |

## What Is Strongly Proven Already

### 1. Production storage boundary

Proven by code/tests:

- auth-required mode blocks non-Supabase repository mode
- production storage boundary is asserted before repository resolution
- local/test escape hatch is explicit, not accidental
- repository smoke and auth-boundary tests cover the guard

Primary evidence:

- `src/server/memory/store.ts`
- `src/server/memory/repository.test.ts`
- `src/server/admin/repository-smoke-test.test.ts`
- `src/app/api/auth-boundary.test.ts`

### 2. Supabase migration/security path

Proven by code/tests:

- required schema tables are enumerated
- security checks report exact migration ids and recommended actions
- schema check covers snapshot hardening, role-aware policies, invite isolation, atomic acceptance, fact payload constraints, telemetry constraints, media bucket
- deploy verifier refuses older/partial live schema-check payloads

Primary evidence:

- `src/server/memory/supabase-schema-check.ts`
- `src/server/admin/launch-readiness.ts`
- `scripts/verify-deployment.mjs`
- `src/server/memory/supabase-import.test.ts`
- `src/server/admin/launch-readiness.test.ts`

### 3. AI telemetry / Founder monitoring

Proven by code/tests:

- every core AI path records telemetry or fallback telemetry
- telemetry completeness is measured and can block public launch
- Founder Console exposes cost, quality, usage, runtime health, onboarding health, setup bundle, migration proof, deploy env template, smoke token guide
- setup artifact bundle and deploy verifier are drift-checked

Primary evidence:

- `src/server/admin/founder-console.ts`
- `src/server/memory/engine.ts`
- `src/server/memory/telemetry.ts`
- `src/server/admin/founder-console.test.ts`
- `src/server/admin/verify-env-script.test.ts`
- `scripts/verify-setup-artifacts.mjs`

### 4. Core API stability

Proven by code/tests:

- stable JSON envelope + no-store/noindex coverage
- auth-before-parse on receipt/voice/private writes
- capture / ask / dashboard / timeline / memory detail / conversation sources / insights / categories / redaction / onboarding are contract-tested or smoke-tested
- deploy verifier now covers bootstrap, invite acceptance, viewer read-only, dashboard payload shape, memory detail retrieval, conversation source retrieval, insight dismiss

Primary evidence:

- `src/app/api/api-contract.test.ts`
- `src/server/admin/verify-env-script.test.ts`
- `scripts/verify-deployment.mjs`

### 5. Deploy readiness / handoff

Proven by code/tests:

- stage-specific env examples exist
- founder setup report + integration package + env map + execution checklist are generated
- public launch / private beta commands are explicit
- drift verification catches setup bundle divergence

Primary evidence:

- `package.json`
- `.env.example`
- `.env.private-beta.example`
- `.env.public-launch.example`
- `scripts/founder-setup-report.mjs`
- `scripts/generate-setup-env-examples.mjs`
- `scripts/verify-setup-artifacts.mjs`
- `README.md`
- `docs/founder-private-beta-execution.md`
- `docs/private-beta-launch-checklist.md`
- `docs/deployment-runbook.md`

## What Is Not Yet Proven

以下四項，現時仍然屬於 **未完成 live proof**，所以暫時唔應該宣稱 fully launch-ready：

1. 真 Supabase project 已成功套用所有 migrations，並且 live schema/security check pass
2. 真 Vercel deploy 已跑完 `pnpm run verify:deploy:private-beta` 或 `pnpm run verify:deploy:public-launch`
3. 真 OpenAI deployed traffic 已產生健康 telemetry（token / cost / latency）
4. founder + partner + viewer + fresh-no-household account 已喺 live infra 走完 onboarding / bootstrap

## Real Remaining Steps

### Before private beta can honestly be called live-ready

1. 在真 Supabase project 套用 migrations
2. 在 Vercel 配好 env
3. deploy 最新 build
4. 準備 founder/member/viewer/fresh-no-household session tokens
5. 對 deployed URL 跑 `pnpm run verify:deploy:private-beta`
6. founder + partner 真實登入同 household 共用 memory
7. 在 `/admin` 確認已有真 telemetry

### Before public launch can honestly be called proven

1. 對 HTTPS 正式域名跑 `pnpm run verify:deploy:public-launch`
2. 設定 `SAYVE_DEPLOYMENT_SMOKE_VERIFIED=1`
3. 設定 `SAYVE_DEPLOYMENT_SMOKE_VERIFIED_AT=<ISO timestamp>`
4. 設定 `SAYVE_DEPLOYMENT_SMOKE_TARGET=<deploy URL>`
5. 重新 deploy
6. 確認 `/api/admin/launch-readiness` 回傳 `readyForPublicLaunch: true`

## Practical Readout

如果用一句話總結：

**Sayve 而家唔係缺 core system，而係差 live hookup + live proof。**

所以之後每一步，重點唔係再大幅發明架構；而係：

- 接真 infra
- 跑真 smoke
- 收真 telemetry
- 完成真 household onboarding

完成呢幾步，先可以由「本地非常接近可上線」變成「真正在 production 可上線」。
