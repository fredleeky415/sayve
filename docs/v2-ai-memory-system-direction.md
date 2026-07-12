# Sayve V2 Direction: AI Memory System Initialization

Status: Future direction, not active V1 scope

This document records the intended V2 direction for Sayve. It should guide product and engineering decisions after the V1 private beta core loop is stable.

V1 remains the priority:

- User can say, type, or upload a receipt.
- Sayve reliably creates memory.
- User can ask back and receive short, contextual answers.
- The memory database is readable enough for founder review.
- User and spouse can log in separately and write into the same household.

V2 should not replace V1 work. V2 should build on a working memory system.

Important architecture correction:

Context schema and the Context Extraction Contract are not optional V2 product features. They should be defined during V1.

V1 does not need to show context to users, but the V1 database must already have a place to store household context, source references, confidence, and revision history. Otherwise, V2 would require painful migration of old memory data and may lose the lineage between raw captures, AI interpretations, facts, and household context.

Therefore:

- V1 product surface can stay simple.
- V1 database must be memory-native.
- V1 should write context quietly when AI can infer it.
- V2 can later expose, refine, and build product experiences on top of that context.

## 1. Product Definition

Sayve is not a bookkeeping app.

Sayve is a household AI memory system, starting with financial life.

Chinese definition:

Sayve 是一個家庭 AI 記憶系統，從財務生活開始。

The product direction is to make users feel:

> I do not need to keep books. I tell Sayve what happened, and Sayve remembers.

## 2. V2 Core Idea

V2 introduces a stronger first-run experience:

**Memory Initialization**

This is not onboarding. It is not a setup form. It is a short ritual that makes users understand that Sayve is building a living household memory.

The goal is to change first perception within the first minute:

- Not “another expense tracker”
- Not “AI added to bookkeeping”
- But “a financial memory system for my household”

## 3. The MacBook Pro Moment

Internal codename:

**The MacBook Pro Moment**

Meaning:

The first experience should feel like an intelligent system starting up, not a cheap app asking for permissions and forms.

### First Launch Ritual

Visual direction:

- Deep black background
- One quiet breathing memory light in the center
- No heavy dashboard
- No permission spam
- No accounting UI

Suggested text, appearing line by line:

1. 這不是另一款記帳 App。
2. Sayve 會記住你家的財務生活。
3. 你照常生活，跟 Sayve 說一聲就可以。

Duration guideline:

- 8 to 12 seconds maximum
- Enough to create ritual
- Not long enough to feel like a loading screen

## 4. First Conversation

After the ritual, Sayve starts a conversation.

It should not show “Question 1 of 8”.

It should feel like Sayve is getting to know the household.

Each question should be answerable in one sentence. Sensitive questions must allow skip or later.

### Suggested Eight Topics

1. Name and identity

   “Hi，你叫咩名呀？可唔可以簡單介紹吓自己？”

2. Household structure

   “你自己住，定係同屋企人一齊住？”

3. Work and income rhythm

   “你收入通常係固定月薪，定係比較浮動？如果方便，可以講個大概範圍；唔講都可以。呢樣可以幫我俾到更貼身嘅 advise。”

4. Family stage

   “屋企有冇小朋友、長輩、寵物，或者其他需要長期照顧嘅人？”

5. Fixed commitments

   “有冇每月一定要交嘅大支出？例如租金、供樓、供車、保險、學費、姐姐人工。”

6. Annual or seasonal expenses

   “有冇一年某幾個月特別多支出？例如保險、開學、旅行、稅。”

7. Current financial focus

   “你而家最想 Sayve 幫你留意咩？例如控制支出、儲錢、唔好漏 subscription、了解家庭開支。”

8. Recent life event

   “最近有冇一件會影響開支嘅大事？例如搬屋、BB 出世、轉工、裝修、買車。”

### Sayve Response Style

Every answer receives a short acknowledgement.

Example:

User:

“我同太太，仲有兩個小朋友，大女 4 歲，細仔啱啱出世。”

Sayve:

“收到。我會記住你屋企而家有幼稚園同初生 BB 兩個重要脈絡，之後分析開支時會用呢個背景。”

The response should be short. It should show understanding, not over-explain.

## 5. Initialization Completion

After the first conversation, Sayve should summarize what it has learned.

Suggested copy:

“我已經建立咗你屋企嘅第一份 Financial Memory。”

“目前我記得：”

- 家庭成員
- 收入節奏
- 固定開支
- 年度開支月份
- 近期生活事件
- 目前想留意的財務方向

Final line:

“之後你唔需要記帳。有事跟 Sayve 說一聲就可以。”

## 6. Daily Memory Prompt

V2 should introduce progressive memory building.

Principle:

**8 questions to create belief. 1 question a day to build memory.**

Daily prompt rules:

- At most one question per day
- Non-blocking
- Can skip
- Can answer later
- Should not feel like homework
- Should only ask when the answer improves future memory

Example prompts:

- “Sayve 見到你常提到 BB，BB 依家大概幾多歲？”
- “呢筆 HK$88 Netflix 係每月固定支出嗎？”
- “上次 HK$8,000 裝修訂金係一次性嗎？”
- “ParknShop、百佳、PNS 可以當同一個商戶嗎？”
- “Netflix 係咪已經取消？”
- “呢筆係公家數，定係你自己個人開支？”

### Prompt Priority

Questions should be ranked by value:

1. Context affecting future reminders
2. Event affecting monthly status judgment
3. Recurring or subscription confirmation
4. Merchant alias or category cleanup
5. Low-value profile completion

Sayve should ask the smallest question that makes future memory more useful.

## 7. Database Principle

The hard part is not asking questions.

The hard part is turning conversational answers into a readable, reliable database.

Core rule:

**AI extracts. Code validates. Database remembers. Views explain.**

AI output should never be blindly written into the database.

Flow:

```text
User answer
-> Raw capture
-> AI extraction
-> Zod validation
-> Confidence check
-> Merge / dedupe
-> Write facts, context, relationships, revisions
-> Readable founder/user views
```

## 8. Context Extraction Contract

Build timing:

The Context Extraction Contract should be designed in V1, even if the full V2 interface is not built yet.

This is a schema and memory integrity requirement, not a visible user feature.

Before building the full V2 interface, Sayve needs a strict Context Extraction Contract.

Every conversational answer should produce:

- Original user text
- AI interpretation
- Structured context
- Confidence
- Source reference
- Relationship to household, member, fact, or memory
- Revision history

Example:

User:

“7 月通常要交全家保險。”

Structured context:

```json
{
  "context_type": "annual_expense",
  "subject_type": "insurance",
  "subject_label": "全家保險",
  "frequency": "yearly",
  "month": 7,
  "status": "expected",
  "confidence": 0.86,
  "evidence_text": "7 月通常要交全家保險"
}
```

## 9. Suggested Database Concepts

V2 should extend the existing memory system with these concepts:

- `captures`
- `conversation_messages`
- `memory_interpretations`
- `household_context`
- `household_members`
- `memory_facts`
- `memory_relationships`
- `memory_revisions`
- `memory_prompt_queue`

### Household Context Fields

Suggested fields:

- `id`
- `household_id`
- `context_type`
- `subject_type`
- `subject_label`
- `value`
- `amount`
- `currency`
- `frequency`
- `month`
- `status`
- `confidence`
- `source_type`
- `source_id`
- `evidence_text`
- `valid_from`
- `valid_until`
- `last_confirmed_at`
- `created_at`
- `updated_at`

## 10. Readable Database Views

Founder and user-facing views should make the memory easy to inspect.

Suggested views:

- Household Profile
- Fixed Expenses
- Annual Expenses
- Subscriptions
- Life Events
- Open Questions
- Confidence Issues

The goal is that the database feels like a clean memory table, not a hidden black box.

## 11. Status-first Dashboard

V2 dashboard should not start from traditional P&L.

It should start from household status:

- 本月正常
- 留意一下
- 需要關注

Then explain:

- 因為什麼
- Sayve 記得什麼
- 哪些 facts support this
- 哪些 context affected the judgment

Numbers should be available, but not be the product center.

## 12. Because-based Ask

Ask should not only answer SQL-style numbers.

It should answer:

- Number
- Comparison
- Reason
- Confidence
- Sources

Example:

“上個月食飯 HK$6,200，比平時多 HK$1,400。主要因為兩次家庭聚餐；扣除後日常飲食仍然正常。”

This is the difference between a financial database and a financial memory.

## 13. Product Principles For V2

- Initialization creates belief. Progressive prompts create memory.
- Sayve learns like a conversation, not like a form.
- Do not ask eight form questions. Have a first conversation.
- Do not ask daily random questions. Ask the highest-value missing context.
- Reveal intelligence through context, not through more interface.
- Keep answers short to reduce token cost and reduce user fatigue.
- The memory system must remain readable and correctable.

## 14. Recommended Build Order

### V1 Foundation

These should exist in V1, even if most are hidden from users:

1. Memory-native database schema
2. Household context table
3. Context Extraction Contract
4. Source references and confidence fields
5. Revision history
6. Basic context writes from capture interpretation

This prevents V2 migration problems and keeps old memories re-interpretable.

### V2 Product Layer

After V1 private beta proves the capture-to-memory-to-answer loop, V2 can build the user-facing experiences:

1. First Conversation
2. Daily Prompt Queue
3. Friendly Database Views
4. Status-first Dashboard
5. Because-based Ask

V2 product work should begin only after the V1 private beta proves that the capture-to-memory-to-answer loop works. However, the context foundation must be included in V1.
