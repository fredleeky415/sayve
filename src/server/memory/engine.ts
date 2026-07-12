import { createAiProvider, type AiInterpretationDraft } from "@/server/ai/provider";
import { aiModels } from "@/server/ai/models";
import { listActiveCategoriesAsync } from "@/server/memory/categories";
import { createId, nowIso } from "@/server/memory/id";
import { getMemoryRepository, withMemoryRepositoryRetry, type MemoryStoreState } from "@/server/memory/store";
import { estimateCostUsd, estimateTokensFromText, recordAiTelemetryAsync } from "@/server/memory/telemetry";
import { canRunCaptureInterpretation, recordCaptureUsage, recordConversationUsage } from "@/server/memory/usage";
import { confidenceBand, nextBestQuestion, shouldInterruptCapture, statusForConfidence } from "@/shared/memory/decision";
import type {
  ApiEnvelope,
  Capture,
  CaptureSource,
  ConversationMessage,
  HouseholdContext,
  Insight,
  MemoryFact,
  MemoryInterpretation,
  MemoryObject,
  MemoryRelationship,
  SourceRef
} from "@/shared/memory/types";

const DEFAULT_HOUSEHOLD_ID = "household_demo";
const PROMPT_VERSION = "memory-engine-v1";

async function getStoreAsync(householdId = DEFAULT_HOUSEHOLD_ID): Promise<MemoryStoreState> {
  return getMemoryRepository(householdId).readAsync();
}

async function saveStoreAsync(householdId = DEFAULT_HOUSEHOLD_ID): Promise<void> {
  await getMemoryRepository(householdId).commitAsync();
}

export type CaptureInput = {
  householdId?: string;
  actorUserId?: string;
  sourceType: CaptureSource;
  text?: string;
  transcript?: string;
  fileRefs?: string[];
  metadata?: Record<string, unknown>;
};

type PreparedCaptureAttempt = {
  capture?: Capture;
  draft?: AiInterpretationDraft;
};

export type CaptureResult = ApiEnvelope & {
  data: {
    capture: Capture;
    memory?: MemoryObject;
    interpretation?: MemoryInterpretation;
    fact?: MemoryFact;
    context?: HouseholdContext;
    relationship?: MemoryRelationship;
    mergedInto?: MemoryObject;
    usageLimitReason?: string;
  };
};

function textFromCapture(capture: Capture): string {
  return capture.rawText ?? capture.transcript ?? String(capture.metadata.description ?? "");
}

function envelope(input: {
  memory?: MemoryObject | null;
  confidence?: number | null;
  sourceRefs?: SourceRef[];
  currentState?: string | null;
  needsUserInput?: boolean;
  nextQuestion?: string;
  data?: unknown;
}): ApiEnvelope {
  return {
    memory_object_id: input.memory?.id ?? null,
    confidence: input.confidence ?? input.memory?.confidence ?? null,
    source_refs: input.sourceRefs ?? input.memory?.sourceRefs ?? [],
    current_state: input.currentState ?? input.memory?.currentState ?? null,
    needs_user_input: input.needsUserInput ?? input.memory?.status === "needs_user_input",
    next_best_question: input.nextQuestion,
    data: input.data
  };
}

function sourceForCapture(capture: Capture, strength: SourceRef["strength"] = "medium"): SourceRef {
  return {
    type: "capture",
    id: capture.id,
    label: capture.sourceType,
    strength
  };
}

function createRelationship(
  store: MemoryStoreState,
  householdId: string,
  relationship: Omit<MemoryRelationship, "id" | "householdId" | "createdAt">
): MemoryRelationship {
  const next: MemoryRelationship = {
    id: createId("rel"),
    householdId,
    createdAt: nowIso(),
    ...relationship
  };
  store.relationships.unshift(next);
  return next;
}

async function queueCaptureForLater(input: {
  store: MemoryStoreState;
  householdId: string;
  capture: Capture;
  reason: string;
  usage: unknown;
  limits: unknown;
}): Promise<CaptureResult> {
  const sourceRefs = [sourceForCapture(input.capture, input.capture.sourceType === "receipt" ? "strong" : "medium")];
  const memory: MemoryObject = {
    id: createId("mem"),
    householdId: input.householdId,
    domain: "financial",
    title: `Pending ${input.capture.sourceType} memory`,
    currentState: "needs_review",
    confidence: 0.2,
    status: "review_later",
    sourceRefs,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  input.store.memoryObjects.unshift(memory);

  const relationship = createRelationship(input.store, input.householdId, {
    fromType: "capture",
    fromId: input.capture.id,
    toType: "memory",
    toId: memory.id,
    relationshipType: "derived_from",
    confidence: 0.2,
    reason: "Capture was safely received but interpretation was deferred by prototype usage limits."
  });

  input.store.revisions.unshift({
    id: createId("rev"),
    householdId: input.householdId,
    memoryObjectId: memory.id,
    revisionType: "reprocess",
    actor: "system",
    reason: "Capture was queued for later interpretation because a prototype usage limit was reached.",
    diff: {
      usageLimitReason: input.reason,
      nextAction: "interpret_later"
    },
    createdAt: nowIso()
  });

  await recordAiTelemetryAsync({
    householdId: input.householdId,
    phase: "queued_without_ai",
    model: "none",
    provider: "system",
    sourceType: input.capture.sourceType,
    memoryObjectId: memory.id,
    captureId: input.capture.id,
    status: "limited",
    confidence: memory.confidence,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
    durationMs: 0,
    metadata: {
      reason: input.reason,
      inboxBehavior: "capture_saved_interpretation_deferred"
    }
  }, { commit: false });

  await saveStoreAsync(input.householdId);

  return {
    ...envelope({
      memory,
      confidence: 0.2,
      sourceRefs,
      currentState: "queued_for_later_interpretation",
      needsUserInput: false,
      data: {
        capture: input.capture,
        memory,
        relationship,
        usageLimitReason: input.reason,
        usage: input.usage,
        limits: input.limits
      }
    }),
    data: {
      capture: input.capture,
      memory,
      relationship,
      usageLimitReason: input.reason
    }
  };
}

function findMergeCandidate(store: MemoryStoreState, householdId: string, fact: MemoryFact): MemoryObject | undefined {
  const payload = fact.payload;
  if (!payload.money) return undefined;
  const targetMoney = payload.money;
  const eventTime = new Date(payload.eventDate).getTime();

  const matchedFact = store.facts.find((existing) => {
    if (existing.householdId !== householdId || existing.id === fact.id || !existing.payload.money) return false;
    const amountDelta = Math.abs(existing.payload.money.amount - targetMoney.amount);
    const sameDay = Math.abs(new Date(existing.payload.eventDate).getTime() - eventTime) < 36 * 60 * 60 * 1000;
    const sameMerchant =
      existing.payload.merchant &&
      payload.merchant &&
      existing.payload.merchant.toLowerCase() === payload.merchant.toLowerCase();
    const sameCategory = existing.payload.category === payload.category;
    return sameDay && amountDelta <= 5 && Boolean(sameMerchant || sameCategory);
  });

  return matchedFact ? store.memoryObjects.find((memory) => memory.id === matchedFact.memoryObjectId) : undefined;
}

function addContextConflictInsight(store: MemoryStoreState, householdId: string, fact: MemoryFact): Insight | undefined {
  const merchant = fact.payload.merchant;
  if (!merchant) return undefined;

  const cancelled = store.contexts.find(
    (context) =>
      context.householdId === householdId &&
      context.currentState === "active" &&
      context.state === "cancelled" &&
      context.subject.toLowerCase().includes(merchant.toLowerCase())
  );

  if (!cancelled) return undefined;

  const insight: Insight = {
    id: createId("insight"),
    householdId,
    severity: "attention",
    title: `${merchant} 又出現了`,
    explanation: `${merchant} 在家庭狀態中被記住為已取消，但新的 capture 似乎顯示它仍然出現。這值得確認。`,
    sourceRefs: [
      { type: "fact", id: fact.id, label: merchant, strength: "strong" },
      { type: "context", id: cancelled.id, label: cancelled.state, strength: "strong" }
    ],
    dismissed: false,
    createdAt: nowIso()
  };
  store.insights.unshift(insight);
  createRelationship(store, householdId, {
    fromType: "fact",
    fromId: fact.id,
    toType: "context",
    toId: cancelled.id,
    relationshipType: "contradicts_context",
    confidence: 0.9,
    reason: "A financial fact appeared after the household context said the subject was cancelled."
  });
  return insight;
}

async function captureMemoryOnce(input: CaptureInput, prepared: PreparedCaptureAttempt = {}): Promise<CaptureResult> {
  const householdId = input.householdId ?? DEFAULT_HOUSEHOLD_ID;
  const store = await getStoreAsync(householdId);
  const capture: Capture =
    prepared.capture ??
    {
      id: createId("cap"),
      householdId,
      sourceType: input.sourceType,
      rawText: input.text,
      transcript: input.transcript,
      fileRefs: input.fileRefs ?? [],
      createdBy: input.actorUserId,
      metadata: {
        ...(input.metadata ?? {}),
        actorUserId: input.actorUserId
      },
      createdAt: nowIso()
    };
  prepared.capture = capture;
  store.captures.unshift(capture);
  recordCaptureUsage(store, householdId, capture.sourceType);

  const usageDecision = canRunCaptureInterpretation(store, householdId, capture.sourceType);
  if (!usageDecision.allowed) {
    return await queueCaptureForLater({
      store,
      householdId,
      capture,
      reason: usageDecision.reason ?? "prototype_usage_limit_reached",
      usage: usageDecision.usage,
      limits: usageDecision.limits
    });
  }

  if (!prepared.draft) {
    const provider = createAiProvider();
    const householdCategories = (await listActiveCategoriesAsync(householdId)).map((category) => category.name);
    prepared.draft = await provider.interpret({
      text: textFromCapture(capture),
      sourceType: capture.sourceType,
      householdContext: store.contexts
        .filter((context) => context.householdId === householdId && context.currentState === "active")
        .map((context) => ({ subject: context.subject, state: context.state })),
      householdCategories
    });
  }
  const draft = prepared.draft;
  const draftTelemetry = draft.telemetry;

  const status = statusForConfidence(draft.confidence, draft.intent === "context_update", draft.intent);
  const shouldAskNow = shouldInterruptCapture(draft.confidence, draft.intent === "context_update");
  const sourceRefs = [sourceForCapture(capture, capture.sourceType === "receipt" ? "strong" : "medium")];
  const memory: MemoryObject = {
    id: createId("mem"),
    householdId,
    domain: "financial",
    title: draft.title,
    currentState: status === "needs_user_input" ? "needs_user_input" : status === "review_later" ? "needs_review" : "active",
    confidence: draft.confidence,
    status,
    sourceRefs,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  store.memoryObjects.unshift(memory);

  const interpretation: MemoryInterpretation = {
    id: createId("interp"),
    memoryObjectId: memory.id,
    model: aiModels.capture,
    promptVersion: PROMPT_VERSION,
    intent: draft.intent,
    structuredOutput: draft as unknown as Record<string, unknown>,
    confidence: draft.confidence,
    confidenceBand: confidenceBand(draft.confidence),
    reasoningSummary: draft.reasoningSummary,
    sourceRefs,
    createdAt: nowIso()
  };
  store.interpretations.unshift(interpretation);

  await recordAiTelemetryAsync({
    householdId,
    phase: "capture_interpretation",
    model: draftTelemetry?.model ?? aiModels.capture,
    provider: draftTelemetry?.provider ?? "heuristic",
    sourceType: capture.sourceType,
    memoryObjectId: memory.id,
    captureId: capture.id,
    status: draftTelemetry?.status ?? "fallback",
    confidence: draft.confidence,
    promptTokens: draftTelemetry?.promptTokens,
    completionTokens: draftTelemetry?.completionTokens,
    totalTokens: draftTelemetry?.totalTokens,
    estimatedCostUsd: draftTelemetry?.estimatedCostUsd,
    durationMs: draftTelemetry?.durationMs,
    metadata: {
      intent: draft.intent,
      confidenceBand: confidenceBand(draft.confidence),
      memoryStatus: status,
      decision: status,
      needsUserInput: shouldAskNow,
      outputBudgetTokens: aiModels.captureMaxOutputTokens
    }
  }, { commit: false });

  store.revisions.unshift({
    id: createId("rev"),
    householdId,
    memoryObjectId: memory.id,
    revisionType: "ai_interpretation",
    actor: "ai",
    reason: draft.reasoningSummary,
    diff: { interpretationId: interpretation.id, status },
    createdAt: nowIso()
  });

  let fact: MemoryFact | undefined;
  let context: HouseholdContext | undefined;
  let relationship: MemoryRelationship | undefined;
  let mergedInto: MemoryObject | undefined;

  if (draft.intent === "financial_event" && draft.financial?.amount) {
    fact = {
      id: createId("fact"),
      householdId,
      memoryObjectId: memory.id,
      domain: "financial",
      payload: {
        eventDate: draft.financial.eventDate,
        merchant: draft.financial.merchant,
        money: { amount: draft.financial.amount, currency: draft.financial.currency },
        category: draft.financial.category,
        direction: draft.financial.direction,
        recurringHint: draft.financial.recurringHint,
        participants: [],
        ownershipScope: draft.financial.ownershipScope ?? "shared",
        assignedMember: draft.financial.assignedMember,
        ownershipReason:
          draft.financial.ownershipReason ?? "No personal owner was specified, so Sayve treats the fact as shared household memory.",
        note: draft.financial.note
      },
      sourceRefs,
      immutable: true,
      createdAt: nowIso()
    };
    store.facts.unshift(fact);
    relationship = createRelationship(store, householdId, {
      fromType: "capture",
      fromId: capture.id,
      toType: "fact",
      toId: fact.id,
      relationshipType: "derived_from",
      confidence: draft.confidence,
      reason: "The fact was interpreted from the original capture."
    });

    mergedInto = findMergeCandidate(store, householdId, fact);
    if (mergedInto) {
      memory.currentState = "merged";
      memory.status = "auto_confirmed";
      relationship = createRelationship(store, householdId, {
        fromType: "capture",
        fromId: capture.id,
        toType: "memory",
        toId: mergedInto.id,
        relationshipType: "supports_same_memory",
        confidence: 0.84,
        reason: "Time, amount, merchant/category similarity suggest this capture supports an existing memory."
      });
      store.revisions.unshift({
        id: createId("rev"),
        householdId,
        memoryObjectId: mergedInto.id,
        revisionType: "merge",
        actor: "ai",
        reason: "New capture appears to support an existing memory.",
        diff: { mergedMemoryObjectId: memory.id, captureId: capture.id },
        createdAt: nowIso()
      });
    }

    addContextConflictInsight(store, householdId, fact);
  }

  if (draft.intent === "context_update" && draft.context) {
    context = {
      id: createId("ctx"),
      householdId,
      domain: "financial",
      subject: draft.context.subject,
      state: draft.context.state,
      currentState: "active",
      confidence: draft.confidence,
      sourceRefs,
      effectiveFrom: draft.context.effectiveFrom,
      updatedAt: nowIso()
    };
    store.contexts
      .filter((existing) => existing.householdId === householdId && existing.subject === context!.subject)
      .forEach((existing) => {
        existing.currentState = "superseded";
      });
    store.contexts.unshift(context);
    relationship = createRelationship(store, householdId, {
      fromType: "capture",
      fromId: capture.id,
      toType: "context",
      toId: context.id,
      relationshipType: "updates_context",
      confidence: draft.confidence,
      reason: "The capture changed household state instead of historical facts."
    });
  }

  await saveStoreAsync(householdId);

  return {
    ...envelope({
      memory: mergedInto ?? memory,
      confidence: draft.confidence,
      sourceRefs,
      needsUserInput: shouldAskNow,
      nextQuestion: nextBestQuestion(draft.confidence, draft.intent, draft.intent === "context_update"),
      data: { capture, memory, interpretation, fact, context, relationship, mergedInto, usage: usageDecision.usage, limits: usageDecision.limits }
    }),
    data: { capture, memory, interpretation, fact, context, relationship, mergedInto }
  };
}

export async function captureMemory(input: CaptureInput): Promise<CaptureResult> {
  const householdId = input.householdId ?? DEFAULT_HOUSEHOLD_ID;
  const prepared: PreparedCaptureAttempt = {};
  return withMemoryRepositoryRetry(householdId, () => captureMemoryOnce(input, prepared));
}

export async function getTimeline(householdId = DEFAULT_HOUSEHOLD_ID) {
  const store = await getStoreAsync(householdId);
  return store.memoryObjects
    .filter((memory) => memory.householdId === householdId)
    .map((memory) => ({
      memory,
      facts: store.facts.filter((fact) => fact.memoryObjectId === memory.id),
      contexts: store.contexts.filter((context) => context.sourceRefs.some((ref) => ref.id === memory.id)),
      relationships: store.relationships.filter((rel) => rel.fromId === memory.id || rel.toId === memory.id)
    }));
}

function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

function monthDayKeys(month: string): string[] {
  const [yearRaw, monthRaw] = month.split("-");
  const year = Number(yearRaw);
  const monthIndex = Number(monthRaw);
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || monthIndex < 1 || monthIndex > 12) return [];

  const days = new Date(year, monthIndex, 0).getDate();
  return Array.from({ length: days }, (_item, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
}

function shiftMonth(month: string, offset: number): string {
  const [yearRaw, monthRaw] = month.split("-");
  const year = Number(yearRaw);
  const monthIndex = Number(monthRaw) - 1;
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex)) return currentMonthKey();

  const shifted = new Date(Date.UTC(year, monthIndex + offset, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

function trendMonthKeys(anchorMonth: string, count = 12): string[] {
  return Array.from({ length: count }, (_item, index) => shiftMonth(anchorMonth, index - count + 1));
}

type QuestionIntent = "spending_total" | "income_total" | "explain_change" | "context_lookup" | "general_memory";

type EvidencePack = {
  intent: QuestionIntent;
  retrievalType: "sql_exact" | "sql_compare" | "context_lookup" | "memory_summary";
  period: {
    label: string;
    month?: string;
    comparisonMonths?: string[];
  };
  filters: {
    category?: string;
    merchant?: string;
    direction?: "expense" | "income";
  };
  totals: {
    expense: number;
    income: number;
    net: number;
    count: number;
  };
  comparison?: {
    baselineExpense: number;
    delta: number;
    deltaPercent: number;
    topCategories: Array<{ category: string; amount: number; delta: number }>;
    topFacts: Array<{ label: string; amount: number; date: string; category: string }>;
  };
  contexts: Array<{ subject: string; state: string; confidence: number }>;
  facts: Array<{
    id: string;
    date: string;
    merchant?: string;
    category?: string;
    direction: string;
    amount: number;
    currency: string;
    note?: string;
  }>;
};

function includesAny(text: string, terms: string[]): boolean {
  const lower = text.toLowerCase();
  return terms.some((term) => lower.includes(term.toLowerCase()));
}

function detectQuestionIntent(question: string): QuestionIntent {
  if (includesAny(question, ["點解", "為什麼", "why", "多咗", "少咗", "不同", "擔心"])) return "explain_change";
  if (includesAny(question, ["取消", "cut", "仲有冇", "係咪", "狀態", "context"])) return "context_lookup";
  if (includesAny(question, ["收入", "income", "入息", "利息", "人工"])) return "income_total";
  if (includesAny(question, ["幾多", "多少", "用了", "用咗", "洗咗", "支出", "花", "total", "spent"])) return "spending_total";
  return "general_memory";
}

function periodFromQuestion(question: string) {
  if (includesAny(question, ["上個月", "上月", "last month"])) {
    const month = shiftMonth(currentMonthKey(), -1);
    return { label: "上個月", month };
  }
  if (includesAny(question, ["今年", "this year"])) {
    return { label: "今年", month: currentMonthKey().slice(0, 4) };
  }
  if (includesAny(question, ["今個月", "今月", "this month"])) {
    return { label: "今個月", month: currentMonthKey() };
  }
  return { label: "目前", month: currentMonthKey() };
}

function categoryFromQuestion(question: string, facts: MemoryFact[]): string | undefined {
  const knownCategories = Array.from(new Set(facts.map((fact) => fact.payload.category).filter(Boolean))) as string[];
  const explicit = knownCategories.find((category) => question.toLowerCase().includes(category.toLowerCase()));
  if (explicit) return explicit;
  if (includesAny(question, ["食飯", "食", "飯", "dining", "餐廳", "咖啡", "coffee"])) return "Dining";
  if (includesAny(question, ["買餸", "超市", "百佳", "惠康", "groceries"])) return "Groceries";
  if (includesAny(question, ["車", "入油", "泊車", "uber", "taxi", "mtr", "交通"])) return "Transport";
  if (includesAny(question, ["netflix", "subscription", "訂閱", "月費"])) return "Subscriptions";
  if (includesAny(question, ["bb", "奶粉", "尿片", "小朋友"])) return "Baby";
  return undefined;
}

function merchantFromQuestion(question: string, facts: MemoryFact[]): string | undefined {
  const merchants = Array.from(new Set(facts.map((fact) => fact.payload.merchant).filter(Boolean))) as string[];
  return merchants.find((merchant) => question.toLowerCase().includes(merchant.toLowerCase()));
}

function factInPeriod(fact: MemoryFact, monthOrYear?: string): boolean {
  if (!monthOrYear) return true;
  return fact.payload.eventDate.startsWith(monthOrYear);
}

function factMatchesFilters(
  fact: MemoryFact,
  filters: { category?: string; merchant?: string; direction?: "expense" | "income" },
  monthOrYear?: string
): boolean {
  if (!fact.payload.money) return false;
  if (!factInPeriod(fact, monthOrYear)) return false;
  if (filters.direction === "income" && fact.payload.direction !== "income") return false;
  if (filters.direction === "expense" && fact.payload.direction === "income") return false;
  if (filters.category && (fact.payload.category ?? "Unsorted Memory") !== filters.category) return false;
  if (filters.merchant && fact.payload.merchant !== filters.merchant) return false;
  return true;
}

function summarizeTotals(facts: MemoryFact[]) {
  const income = facts
    .filter((fact) => fact.payload.direction === "income")
    .reduce((sum, fact) => sum + (fact.payload.money?.amount ?? 0), 0);
  const expense = facts
    .filter((fact) => fact.payload.direction !== "income")
    .reduce((sum, fact) => sum + (fact.payload.money?.amount ?? 0), 0);
  return { expense, income, net: income - expense, count: facts.length };
}

function topCategoryRows(facts: MemoryFact[]): Array<{ category: string; amount: number }> {
  const amounts = new Map<string, number>();
  for (const fact of facts) {
    if (fact.payload.direction === "income") continue;
    const category = fact.payload.category ?? "Unsorted Memory";
    amounts.set(category, (amounts.get(category) ?? 0) + (fact.payload.money?.amount ?? 0));
  }
  return [...amounts.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
}

function buildEvidencePack(store: MemoryStoreState, question: string, householdId: string): EvidencePack {
  const allFacts = store.facts.filter((fact) => fact.householdId === householdId && fact.payload.money);
  const activeContexts = store.contexts.filter((context) => context.householdId === householdId && context.currentState === "active");
  const intent = detectQuestionIntent(question);
  const period = periodFromQuestion(question);
  const category = categoryFromQuestion(question, allFacts);
  const merchant = merchantFromQuestion(question, allFacts);
  const direction: "expense" | "income" | undefined =
    intent === "income_total" ? "income" : intent === "spending_total" || intent === "explain_change" ? "expense" : undefined;
  const filters: EvidencePack["filters"] = { category, merchant, direction };
  const relevantFacts = allFacts.filter((fact) => factMatchesFilters(fact, filters, period.month));
  const totals = summarizeTotals(relevantFacts);
  const sourceFacts = relevantFacts
    .slice()
    .sort((a, b) => b.payload.eventDate.localeCompare(a.payload.eventDate))
    .slice(0, 12);

  let comparison: EvidencePack["comparison"];
  let comparisonMonths: string[] | undefined;
  if (intent === "explain_change") {
    comparisonMonths = [1, 2, 3].map((offset) => shiftMonth(period.month ?? currentMonthKey(), -offset));
    const baselineFacts = allFacts.filter((fact) => comparisonMonths!.some((month) => factMatchesFilters(fact, filters, month)));
    const baselineExpense = comparisonMonths.length === 0 ? 0 : summarizeTotals(baselineFacts).expense / comparisonMonths.length;
    const currentCategoryRows = topCategoryRows(relevantFacts);
    const baselineCategoryRows = topCategoryRows(baselineFacts);
    const baselineByCategory = new Map(baselineCategoryRows.map((row) => [row.category, row.amount / Math.max(1, comparisonMonths!.length)]));
    const topCategories = currentCategoryRows.slice(0, 5).map((row) => ({
      category: row.category,
      amount: row.amount,
      delta: row.amount - (baselineByCategory.get(row.category) ?? 0)
    }));
    comparison = {
      baselineExpense,
      delta: totals.expense - baselineExpense,
      deltaPercent: baselineExpense === 0 ? 0 : Number((((totals.expense - baselineExpense) / baselineExpense) * 100).toFixed(1)),
      topCategories,
      topFacts: relevantFacts
        .slice()
        .sort((a, b) => (b.payload.money?.amount ?? 0) - (a.payload.money?.amount ?? 0))
        .slice(0, 5)
        .map((fact) => ({
          label: fact.payload.merchant ?? fact.payload.note ?? fact.payload.category ?? "Memory",
          amount: fact.payload.money?.amount ?? 0,
          date: fact.payload.eventDate,
          category: fact.payload.category ?? "Unsorted Memory"
        }))
    };
  }

  return {
    intent,
    retrievalType:
      intent === "explain_change"
        ? "sql_compare"
        : intent === "context_lookup"
          ? "context_lookup"
          : intent === "general_memory"
            ? "memory_summary"
            : "sql_exact",
    period: { ...period, comparisonMonths },
    filters,
    totals,
    comparison,
    contexts: activeContexts.map((context) => ({
      subject: context.subject,
      state: context.state,
      confidence: context.confidence
    })),
    facts: sourceFacts.map((fact) => ({
      id: fact.id,
      date: fact.payload.eventDate,
      merchant: fact.payload.merchant,
      category: fact.payload.category,
      direction: fact.payload.direction,
      amount: fact.payload.money?.amount ?? 0,
      currency: fact.payload.money?.currency ?? "HKD",
      note: fact.payload.note
    }))
  };
}

function sourceRefsFromEvidence(store: MemoryStoreState, evidence: EvidencePack): SourceRef[] {
  const factRefs = evidence.facts.slice(0, 5).map<SourceRef>((fact) => ({
    type: "fact",
    id: fact.id,
    label: fact.merchant ?? fact.category ?? "memory fact",
    strength: "strong"
  }));
  const contextRefs = store.contexts
    .filter((context) => evidence.contexts.some((item) => item.subject === context.subject && item.state === context.state))
    .slice(0, 3)
    .map<SourceRef>((context) => ({
      type: "context",
      id: context.id,
      label: context.subject,
      strength: "medium"
    }));
  return [...factRefs, ...contextRefs];
}

function moneyText(value: number): string {
  return `HK$${value.toFixed(1)}`;
}

function answerFromEvidence(evidence: EvidencePack): string {
  if (evidence.intent === "context_lookup") {
    if (evidence.contexts.length === 0) return "暫時未有相關家庭狀態記憶。";
    return `記住咗：${evidence.contexts
      .map((context) => `${context.subject} ${context.state}`)
      .join("、")}。`;
  }

  if (evidence.intent === "spending_total" || evidence.intent === "income_total") {
    const amount = evidence.intent === "income_total" ? evidence.totals.income : evidence.totals.expense;
    const scope = [evidence.period.label, evidence.filters.category, evidence.filters.merchant].filter(Boolean).join(" / ");
    if (evidence.totals.count === 0) return `${scope || evidence.period.label} 暫時未有相關記憶。`;
    return `${scope || evidence.period.label}：${moneyText(amount)}。`;
  }

  if (evidence.intent === "explain_change") {
    if (!evidence.comparison || evidence.totals.count === 0) return "暫時未有足夠資料比較。";
    const direction = evidence.comparison.delta >= 0 ? "多咗" : "少咗";
    const categoryText = evidence.comparison.topCategories.length
      ? `主要係 ${evidence.comparison.topCategories[0].category}。`
      : "";
    return `${evidence.period.label} 支出 ${moneyText(evidence.totals.expense)}，比近 3 個月平均${direction} ${moneyText(
      Math.abs(evidence.comparison.delta)
    )}。${categoryText}`;
  }

  if (evidence.totals.count === 0 && evidence.contexts.length === 0) {
    return "暫時未有足夠記憶回答。";
  }

  return `找到 ${evidence.totals.count} 個 facts：支出 ${moneyText(evidence.totals.expense)}，收入 ${moneyText(evidence.totals.income)}。`;
}

async function answerConversationWithModel(input: {
  question: string;
  evidence: EvidencePack;
  fallbackAnswer: string;
  startedAt: number;
}): Promise<{
  answer: string;
  provider: "openai" | "system";
  model: string;
  status: "success" | "error";
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  durationMs: number;
  metadata: Record<string, unknown>;
}> {
  const compactEvidence = {
    intent: input.evidence.intent,
    retrievalType: input.evidence.retrievalType,
    period: input.evidence.period,
    filters: input.evidence.filters,
    totals: input.evidence.totals,
    comparison: input.evidence.comparison
      ? {
          baselineExpense: input.evidence.comparison.baselineExpense,
          delta: input.evidence.comparison.delta,
          deltaPercent: input.evidence.comparison.deltaPercent,
          topCategories: input.evidence.comparison.topCategories.slice(0, 3),
          topFacts: input.evidence.comparison.topFacts.slice(0, 3)
        }
      : undefined,
    contexts: input.evidence.contexts.slice(0, 5),
    facts: input.evidence.facts.slice(0, 8)
  };
  const prompt = JSON.stringify({
    question: input.question,
    evidence: compactEvidence,
    instructions:
      "Answer in concise zh-Hant/Cantonese. Max 80 Chinese characters. Use only supplied evidence. Mention uncertainty if evidence is thin. Return JSON: {\"answer\":\"...\"}."
  });

  if (!process.env.OPENAI_API_KEY) {
    const promptTokens = estimateTokensFromText(input.question);
    const completionTokens = estimateTokensFromText(input.fallbackAnswer);
    return {
      answer: input.fallbackAnswer,
      provider: "system",
      model: aiModels.conversation,
      status: "success",
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      estimatedCostUsd: estimateCostUsd({ phase: "conversation_answer", promptTokens, completionTokens }),
      durationMs: Date.now() - input.startedAt,
      metadata: {
        usedDeterministicPrototypeAnswer: true
      }
    };
  }

  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create({
      model: aiModels.conversation,
      max_completion_tokens: aiModels.conversationMaxOutputTokens,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are Sayve, a concise Financial Memory Companion. You answer from retrieved Memory evidence, not from guesses. Keep answers short to save tokens."
        },
        {
          role: "user",
          content: prompt
        }
      ]
    });
    const raw = completion.choices[0]?.message.content;
    const parsed = raw ? (JSON.parse(raw) as { answer?: unknown }) : {};
    const answer = typeof parsed.answer === "string" && parsed.answer.trim() ? parsed.answer.trim().slice(0, 120) : input.fallbackAnswer;
    const promptTokens = completion.usage?.prompt_tokens ?? estimateTokensFromText(prompt);
    const completionTokens = completion.usage?.completion_tokens ?? estimateTokensFromText(answer);
    return {
      answer,
      provider: "openai",
      model: aiModels.conversation,
      status: "success",
      promptTokens,
      completionTokens,
      totalTokens: completion.usage?.total_tokens ?? promptTokens + completionTokens,
      estimatedCostUsd: estimateCostUsd({ phase: "conversation_answer", promptTokens, completionTokens }),
      durationMs: Date.now() - input.startedAt,
      metadata: {
        usedOpenAiConversationModel: true,
        fallbackAnswer: answer === input.fallbackAnswer,
        outputBudgetTokens: aiModels.conversationMaxOutputTokens,
        answerCharacters: answer.length
      }
    };
  } catch (error) {
    const promptTokens = estimateTokensFromText(prompt);
    const completionTokens = estimateTokensFromText(input.fallbackAnswer);
    return {
      answer: input.fallbackAnswer,
      provider: "openai",
      model: aiModels.conversation,
      status: "error",
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      estimatedCostUsd: estimateCostUsd({ phase: "conversation_answer", promptTokens, completionTokens }),
      durationMs: Date.now() - input.startedAt,
      metadata: {
        usedDeterministicPrototypeAnswer: true,
        conversationProviderError: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

export async function getDashboard(householdId = DEFAULT_HOUSEHOLD_ID, month = currentMonthKey()) {
  const store = await getStoreAsync(householdId);
  const allFacts = store.facts.filter((fact) => fact.householdId === householdId && fact.payload.money);
  const facts = allFacts.filter((fact) => fact.payload.eventDate.startsWith(month));
  const factMemoryIds = new Set(facts.map((fact) => fact.memoryObjectId));
  const memoryCount = store.memoryObjects.filter(
    (memory) => memory.householdId === householdId && (memory.createdAt.startsWith(month) || factMemoryIds.has(memory.id))
  ).length;
  const expenseFacts = facts.filter((fact) => fact.payload.direction !== "income");
  const incomeFacts = facts.filter((fact) => fact.payload.direction === "income");
  const expenses = expenseFacts.reduce((sum, fact) => sum + (fact.payload.money?.amount ?? 0), 0);
  const income = incomeFacts.reduce((sum, fact) => sum + (fact.payload.money?.amount ?? 0), 0);
  const byCategory = expenseFacts.reduce<Record<string, { amount: number; count: number }>>((acc, fact) => {
    const category = fact.payload.category ?? "Unsorted Memory";
    acc[category] = acc[category] ?? { amount: 0, count: 0 };
    acc[category].amount += fact.payload.money?.amount ?? 0;
    acc[category].count += 1;
    return acc;
  }, {});
  const byDay = monthDayKeys(month).reduce<Record<string, { income: number; expense: number; count: number }>>((acc, day) => {
    acc[day] = { income: 0, expense: 0, count: 0 };
    return acc;
  }, {});
  facts.reduce<Record<string, { income: number; expense: number; count: number }>>((acc, fact) => {
    const day = fact.payload.eventDate;
    acc[day] = acc[day] ?? { income: 0, expense: 0, count: 0 };
    const amount = fact.payload.money?.amount ?? 0;
    if (fact.payload.direction === "income") acc[day].income += amount;
    else acc[day].expense += amount;
    acc[day].count += 1;
    return acc;
  }, byDay);

  const topCategoryAmount = Math.max(1, ...Object.values(byCategory).map((row) => row.amount));
  const categoryRows = Object.entries(byCategory)
    .map(([category, row]) => ({
      category,
      amount: row.amount,
      count: row.count,
      percent: Number(((row.amount / Math.max(1, expenses)) * 100).toFixed(1)),
      barPercent: Number(((row.amount / topCategoryAmount) * 100).toFixed(1))
    }))
    .sort((a, b) => b.amount - a.amount);

  const dailyRows = Object.entries(byDay)
    .map(([date, row]) => ({
      date,
      income: row.income,
      expense: row.expense,
      net: row.income - row.expense,
      count: row.count
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const monthlyFacts = facts
    .map((fact) => {
      const captureRef = fact.sourceRefs.find((ref) => ref.type === "capture");
      const sourceCapture = captureRef ? store.captures.find((capture) => capture.id === captureRef.id && capture.householdId === householdId) : undefined;
      return {
        id: fact.id,
        date: fact.payload.eventDate,
        title: fact.payload.merchant ?? fact.payload.note ?? fact.payload.category ?? "Memory",
        category: fact.payload.category ?? "Unsorted Memory",
        amount: fact.payload.money?.amount ?? 0,
        direction: fact.payload.direction,
        note: fact.payload.note,
        ownershipScope: fact.payload.ownershipScope ?? "shared",
        assignedMember: fact.payload.assignedMember,
        createdBy: sourceCapture?.createdBy
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  const availableMonths = Array.from(new Set([month, currentMonthKey(), ...allFacts.map((fact) => fact.payload.eventDate.slice(0, 7))])).sort(
    (a, b) => b.localeCompare(a)
  );
  const trendCategories = categoryRows.map((row) => row.category);
  const trendBaseRows = trendMonthKeys(month).map((trendMonth) => {
    const monthFacts = allFacts.filter((fact) => fact.payload.eventDate.startsWith(trendMonth));
    const monthExpenses = monthFacts
      .filter((fact) => fact.payload.direction !== "income")
      .reduce((sum, fact) => sum + (fact.payload.money?.amount ?? 0), 0);
    const monthIncome = monthFacts
      .filter((fact) => fact.payload.direction === "income")
      .reduce((sum, fact) => sum + (fact.payload.money?.amount ?? 0), 0);

    return {
      month: trendMonth,
      expense: monthExpenses,
      income: monthIncome,
      net: monthIncome - monthExpenses,
      count: monthFacts.length
    };
  });
  const trendMaxAmount = Math.max(1, ...trendBaseRows.flatMap((row) => [row.expense, row.income]));
  const monthlyTrend = trendBaseRows.map((row) => ({
    ...row,
    expenseBarPercent: Number(((row.expense / trendMaxAmount) * 100).toFixed(1)),
    incomeBarPercent: Number(((row.income / trendMaxAmount) * 100).toFixed(1)),
    selected: row.month === month
  }));
  const categoryTrends = trendCategories.map((category) => {
    const rows = trendMonthKeys(month).map((trendMonth) => {
      const monthFacts = allFacts.filter((fact) => fact.payload.eventDate.startsWith(trendMonth) && (fact.payload.category ?? "Unsorted Memory") === category);
      const monthExpenses = monthFacts
        .filter((fact) => fact.payload.direction !== "income")
        .reduce((sum, fact) => sum + (fact.payload.money?.amount ?? 0), 0);
      const monthIncome = monthFacts
        .filter((fact) => fact.payload.direction === "income")
        .reduce((sum, fact) => sum + (fact.payload.money?.amount ?? 0), 0);

      return {
        month: trendMonth,
        expense: monthExpenses,
        income: monthIncome,
        net: monthIncome - monthExpenses,
        count: monthFacts.length
      };
    });
    const maxAmount = Math.max(1, ...rows.flatMap((row) => [row.expense, row.income]));
    return {
      category,
      rows: rows.map((row) => ({
        ...row,
        expenseBarPercent: Number(((row.expense / maxAmount) * 100).toFixed(1)),
        incomeBarPercent: Number(((row.income / maxAmount) * 100).toFixed(1)),
        selected: row.month === month
      }))
    };
  });
  const reviewQueue = store.memoryObjects
    .filter(
      (memory) =>
        memory.householdId === householdId &&
        (memory.status !== "auto_confirmed" || memory.currentState === "needs_review" || memory.confidence < 0.7)
    )
    .map((memory) => {
      const sourceCapture = store.captures.find((capture) => memory.sourceRefs.some((ref) => ref.type === "capture" && ref.id === capture.id));
      const fact = store.facts.find((item) => item.memoryObjectId === memory.id);
      const interpretation = store.interpretations.find((item) => item.memoryObjectId === memory.id);
      return {
        memoryObjectId: memory.id,
        title: memory.title,
        status: memory.status,
        currentState: memory.currentState,
        confidence: memory.confidence,
        intent: interpretation?.intent ?? "unknown",
        originalDump: sourceCapture ? textFromCapture(sourceCapture) : "",
        fact: fact
          ? {
              date: fact.payload.eventDate,
              merchant: fact.payload.merchant ?? "",
              category: fact.payload.category ?? "",
              amount: fact.payload.money?.amount ?? 0,
              direction: fact.payload.direction
            }
          : undefined,
        reason: interpretation?.reasoningSummary ?? ""
      };
    })
    .slice(0, 12);

  return {
    month,
    availableMonths,
    total: expenses,
    income,
    expenses,
    net: income - expenses,
    currency: "HKD",
    memoryCount,
    factCount: facts.length,
    contextCount: store.contexts.filter((context) => context.householdId === householdId && context.currentState === "active").length,
    byCategory: categoryRows,
    daily: dailyRows,
    recurring: facts.filter((fact) => fact.payload.recurringHint),
    categoryOptions: (await listActiveCategoriesAsync(householdId)).map((category) => category.name),
    reviewQueue,
    monthlyTrend,
    categoryTrends,
    recentFacts: monthlyFacts.slice(0, 12),
    monthlyFacts
  };
}

export async function listInsights(householdId = DEFAULT_HOUSEHOLD_ID): Promise<Insight[]> {
  const store = await getStoreAsync(householdId);
  return store.insights.filter((insight) => insight.householdId === householdId && !insight.dismissed);
}

async function dismissInsightOnce(id: string, householdId = DEFAULT_HOUSEHOLD_ID): Promise<Insight | undefined> {
  const store = await getStoreAsync(householdId);
  const insight = store.insights.find((item) => item.id === id && item.householdId === householdId);
  if (insight) {
    insight.dismissed = true;
    await saveStoreAsync(householdId);
  }
  return insight;
}

export async function dismissInsight(id: string, householdId = DEFAULT_HOUSEHOLD_ID): Promise<Insight | undefined> {
  return withMemoryRepositoryRetry(householdId, () => dismissInsightOnce(id, householdId));
}

export async function listContext(householdId = DEFAULT_HOUSEHOLD_ID): Promise<HouseholdContext[]> {
  const store = await getStoreAsync(householdId);
  return store.contexts.filter((context) => context.householdId === householdId && context.currentState === "active");
}

export async function updateContext(input: {
  householdId?: string;
  actorUserId?: string;
  subject: string;
  state: string;
  evidence?: string;
}): Promise<ApiEnvelope> {
  const capture = await captureMemory({
    householdId: input.householdId,
    actorUserId: input.actorUserId,
    sourceType: "text",
    text: `${input.subject} ${input.state}`,
    metadata: { evidence: input.evidence, contextUpdate: true }
  });
  return capture;
}

async function confirmContextOnce(input: { householdId?: string; contextId?: string; actorUserId?: string }): Promise<ApiEnvelope> {
  const householdId = input.householdId ?? DEFAULT_HOUSEHOLD_ID;
  const store = await getStoreAsync(householdId);
  const context = store.contexts.find((item) => item.id === input.contextId && item.householdId === householdId);
  if (!context) {
    return envelope({
      memory: null,
      confidence: 0.2,
      sourceRefs: [],
      currentState: "context_confirm_missing",
      needsUserInput: true,
      nextQuestion: "你想確認邊一個家庭狀態？",
      data: { contextId: input.contextId }
    });
  }

  context.currentState = "active";
  context.confidence = Math.max(context.confidence, 0.92);
  context.updatedAt = nowIso();

  const relatedMemory = store.memoryObjects.find((memory) =>
    store.relationships.some(
      (relationship) =>
        relationship.householdId === householdId &&
        relationship.relationshipType === "updates_context" &&
        relationship.toType === "context" &&
        relationship.toId === context.id &&
        relationship.fromType === "capture" &&
        memory.sourceRefs.some((ref) => ref.type === "capture" && ref.id === relationship.fromId)
    )
  );

  if (relatedMemory) {
    store.revisions.unshift({
      id: createId("rev"),
      householdId,
      memoryObjectId: relatedMemory.id,
      revisionType: "context_update",
      actor: "user",
      actorUserId: input.actorUserId,
      reason: "User confirmed household context.",
      diff: {
        contextId: context.id,
        subject: context.subject,
        state: context.state,
        confidence: context.confidence,
        actorUserId: input.actorUserId
      },
      createdAt: nowIso()
    });
  }

  await saveStoreAsync(householdId);

  return envelope({
    memory: relatedMemory ?? null,
    confidence: context.confidence,
    sourceRefs: [{ type: "context", id: context.id, label: "confirmed", strength: "strong" }],
    currentState: "context_confirmed",
    needsUserInput: false,
    data: { context }
  });
}

export async function confirmContext(input: { householdId?: string; contextId?: string; actorUserId?: string }): Promise<ApiEnvelope> {
  const householdId = input.householdId ?? DEFAULT_HOUSEHOLD_ID;
  return withMemoryRepositoryRetry(householdId, () => confirmContextOnce(input));
}

export async function getMemory(id: string, householdId = DEFAULT_HOUSEHOLD_ID): Promise<ApiEnvelope> {
  const store = await getStoreAsync(householdId);
  const memory = store.memoryObjects.find((item) => item.id === id && item.householdId === householdId);
  if (!memory) return envelope({ memory: null, confidence: null, needsUserInput: false, data: null });
  return envelope({
    memory,
    data: {
      memory,
      captures: store.captures.filter((capture) => memory.sourceRefs.some((ref) => ref.id === capture.id)),
      interpretations: store.interpretations.filter((interpretation) => interpretation.memoryObjectId === memory.id),
      facts: store.facts.filter((fact) => fact.memoryObjectId === memory.id),
      relationships: store.relationships.filter((rel) => rel.fromId === memory.id || rel.toId === memory.id),
      revisions: store.revisions.filter((revision) => revision.memoryObjectId === memory.id)
    }
  });
}

async function correctMemoryOnce(input: {
  householdId?: string;
  actorUserId?: string;
  memoryObjectId?: string;
  correction?: string;
  action?: "confirm" | "category" | "merchant" | "amount" | "note";
  value?: string | number;
}): Promise<ApiEnvelope> {
  const householdId = input.householdId ?? DEFAULT_HOUSEHOLD_ID;
  const store = await getStoreAsync(householdId);
  const memory = store.memoryObjects.find((item) => item.id === input.memoryObjectId && item.householdId === householdId);
  if (!memory) return envelope({ memory: null, confidence: null, needsUserInput: false, currentState: "correction_missing_memory" });

  const facts = store.facts.filter((fact) => fact.memoryObjectId === memory.id);
  const before = {
    status: memory.status,
    currentState: memory.currentState,
    confidence: memory.confidence,
    facts: facts.map((fact) => fact.payload)
  };

  if (input.action === "confirm" || !input.action) {
    memory.status = "auto_confirmed";
    memory.currentState = "active";
    memory.confidence = Math.max(memory.confidence, 0.9);
    memory.updatedAt = nowIso();
  }

  if (input.action === "category" && typeof input.value === "string") {
    for (const fact of facts) fact.payload.category = input.value;
    memory.status = "auto_confirmed";
    memory.currentState = "active";
    memory.confidence = Math.max(memory.confidence, 0.88);
    memory.updatedAt = nowIso();
  }

  if (input.action === "merchant" && typeof input.value === "string") {
    for (const fact of facts) fact.payload.merchant = input.value;
    memory.status = "auto_confirmed";
    memory.currentState = "active";
    memory.confidence = Math.max(memory.confidence, 0.88);
    memory.updatedAt = nowIso();
  }

  if (input.action === "amount" && typeof input.value === "number") {
    for (const fact of facts) {
      if (fact.payload.money) fact.payload.money.amount = input.value;
    }
    memory.status = "auto_confirmed";
    memory.currentState = "active";
    memory.confidence = Math.max(memory.confidence, 0.88);
    memory.updatedAt = nowIso();
  }

  if (input.action === "note" && typeof input.value === "string") {
    for (const fact of facts) fact.payload.note = input.value;
    memory.updatedAt = nowIso();
  }

  const revision = {
    id: createId("rev"),
    householdId: memory.householdId,
    memoryObjectId: memory.id,
    revisionType: "user_correction" as const,
    actor: "user" as const,
    actorUserId: input.actorUserId,
    reason: input.correction ?? `User taught AI via ${input.action ?? "confirm"}.`,
    diff: {
      action: input.action ?? "confirm",
      value: input.value,
      actorUserId: input.actorUserId,
      before,
      after: {
        status: memory.status,
        currentState: memory.currentState,
        confidence: memory.confidence,
        facts: facts.map((fact) => fact.payload)
      }
    },
    createdAt: nowIso()
  };
  store.revisions.unshift(revision);
  await saveStoreAsync(householdId);

  return envelope({
    memory,
    confidence: memory.confidence,
    sourceRefs: [{ type: "memory", id: memory.id, label: "user correction", strength: "strong" }],
    currentState: "correction_recorded",
    needsUserInput: false,
    data: { memory, facts, revision }
  });
}

export async function correctMemory(input: {
  householdId?: string;
  actorUserId?: string;
  memoryObjectId?: string;
  correction?: string;
  action?: "confirm" | "category" | "merchant" | "amount" | "note";
  value?: string | number;
}): Promise<ApiEnvelope> {
  const householdId = input.householdId ?? DEFAULT_HOUSEHOLD_ID;
  return withMemoryRepositoryRetry(householdId, () => correctMemoryOnce(input));
}

async function redactMemoryForPrivacyOnce(input: {
  householdId?: string;
  memoryObjectId?: string;
  reason?: string;
  actorUserId?: string;
}): Promise<ApiEnvelope> {
  const householdId = input.householdId ?? DEFAULT_HOUSEHOLD_ID;
  const store = await getStoreAsync(householdId);
  const memory = store.memoryObjects.find((item) => item.id === input.memoryObjectId && item.householdId === householdId);
  if (!memory) return envelope({ memory: null, confidence: null, needsUserInput: false, currentState: "privacy_redaction_missing_memory" });

  const redactedAt = nowIso();
  const facts = store.facts.filter((fact) => fact.householdId === householdId && fact.memoryObjectId === memory.id);
  const interpretations = store.interpretations.filter((interpretation) => interpretation.memoryObjectId === memory.id);
  const directIds = new Set<string>([memory.id, ...facts.map((fact) => fact.id), ...memory.sourceRefs.map((ref) => ref.id)]);
  for (const fact of facts) for (const ref of fact.sourceRefs) directIds.add(ref.id);

  const captures = store.captures.filter((capture) => capture.householdId === householdId && directIds.has(capture.id));
  for (const capture of captures) directIds.add(capture.id);

  const contexts = store.contexts.filter(
    (context) => context.householdId === householdId && context.sourceRefs.some((ref) => directIds.has(ref.id))
  );
  for (const context of contexts) directIds.add(context.id);

  const relationships = store.relationships.filter(
    (relationship) =>
      relationship.householdId === householdId && (directIds.has(relationship.fromId) || directIds.has(relationship.toId))
  );
  const insights = store.insights.filter(
    (insight) => insight.householdId === householdId && insight.sourceRefs.some((ref) => directIds.has(ref.id))
  );
  const sourceMatchedConversations = store.conversationMessages.filter(
    (message) => message.householdId === householdId && message.sourceRefs.some((ref) => directIds.has(ref.id))
  );
  const conversationIdsToRedact = new Set(sourceMatchedConversations.map((message) => message.id));
  for (const message of sourceMatchedConversations) {
    const index = store.conversationMessages.findIndex((item) => item.id === message.id);
    const previous = index > 0 ? store.conversationMessages[index - 1] : undefined;
    const next = index >= 0 ? store.conversationMessages[index + 1] : undefined;
    if (message.role === "assistant" && previous?.householdId === householdId && previous.role === "user") {
      conversationIdsToRedact.add(previous.id);
    }
    if (message.role === "user" && next?.householdId === householdId && next.role === "assistant") {
      conversationIdsToRedact.add(next.id);
    }
  }
  const conversations = store.conversationMessages.filter((message) => message.householdId === householdId && conversationIdsToRedact.has(message.id));
  const conversationIds = new Set(conversations.map((message) => message.id));
  const telemetry = store.aiTelemetry.filter(
    (event) =>
      event.householdId === householdId &&
      ((event.memoryObjectId && directIds.has(event.memoryObjectId)) ||
        (event.captureId && directIds.has(event.captureId)) ||
        (event.conversationMessageId && conversationIds.has(event.conversationMessageId)))
  );

  const summary = {
    captureIds: captures.map((capture) => capture.id),
    factIds: facts.map((fact) => fact.id),
    interpretationIds: interpretations.map((interpretation) => interpretation.id),
    contextIds: contexts.map((context) => context.id),
    relationshipIds: relationships.map((relationship) => relationship.id),
    insightIds: insights.map((insight) => insight.id),
    conversationMessageIds: conversations.map((message) => message.id),
    telemetryIds: telemetry.map((event) => event.id)
  };

  for (const capture of captures) {
    capture.rawText = undefined;
    capture.transcript = undefined;
    capture.fileRefs = [];
    capture.metadata = {
      redacted: true,
      redactedAt,
      redactionReason: input.reason ?? "privacy_request"
    };
  }

  for (const fact of facts) {
    fact.payload = {
      eventDate: "redacted",
      direction: "unknown",
      recurringHint: false,
      participants: [],
      ownershipScope: "shared",
      note: "Redacted for privacy."
    };
    fact.sourceRefs = fact.sourceRefs.map((ref) => ({ ...ref, label: "redacted" }));
  }

  for (const interpretation of interpretations) {
    interpretation.structuredOutput = { redacted: true, redactedAt };
    interpretation.reasoningSummary = "Redacted for privacy.";
    interpretation.confidence = 0;
    interpretation.confidenceBand = "low";
    interpretation.sourceRefs = interpretation.sourceRefs.map((ref) => ({ ...ref, label: "redacted" }));
  }

  for (const context of contexts) {
    context.subject = "Redacted";
    context.state = "redacted";
    context.currentState = "superseded";
    context.confidence = 0;
    context.sourceRefs = context.sourceRefs.map((ref) => ({ ...ref, label: "redacted" }));
    context.updatedAt = redactedAt;
  }

  for (const relationship of relationships) {
    relationship.reason = "Redacted for privacy.";
    relationship.confidence = 0;
  }

  for (const insight of insights) {
    insight.title = "Redacted";
    insight.explanation = "Redacted for privacy.";
    insight.dismissed = true;
    insight.sourceRefs = insight.sourceRefs.map((ref) => ({ ...ref, label: "redacted" }));
  }

  for (const message of conversations) {
    message.content = "Redacted for privacy.";
    message.confidence = 0;
    message.sourceRefs = message.sourceRefs.map((ref) => ({ ...ref, label: "redacted" }));
  }

  for (const event of telemetry) {
    event.confidence = 0;
    event.metadata = {
      redacted: true,
      redactedAt,
      originalPhase: event.phase
    };
  }

  memory.title = "Redacted memory";
  memory.currentState = "archived";
  memory.status = "archived";
  memory.confidence = 1;
  memory.sourceRefs = memory.sourceRefs.map((ref) => ({ ...ref, label: "redacted" }));
  memory.updatedAt = redactedAt;

  const revision = {
    id: createId("rev"),
    householdId,
    memoryObjectId: memory.id,
    revisionType: "privacy_redaction" as const,
    actor: "user" as const,
    actorUserId: input.actorUserId,
    reason: input.reason ?? "Privacy redaction requested.",
    diff: {
      redactedAt,
      actorUserId: input.actorUserId,
      counts: {
        captures: captures.length,
        facts: facts.length,
        interpretations: interpretations.length,
        contexts: contexts.length,
        relationships: relationships.length,
        insights: insights.length,
        conversationMessages: conversations.length,
        telemetry: telemetry.length
      },
      ids: summary
    },
    createdAt: redactedAt
  };
  store.revisions.unshift(revision);
  await saveStoreAsync(householdId);

  return envelope({
    memory,
    confidence: 1,
    sourceRefs: [{ type: "memory", id: memory.id, label: "privacy redacted", strength: "strong" }],
    currentState: "privacy_redacted",
    needsUserInput: false,
    data: { memory, revision, redacted: summary }
  });
}

export async function redactMemoryForPrivacy(input: {
  householdId?: string;
  memoryObjectId?: string;
  reason?: string;
  actorUserId?: string;
}): Promise<ApiEnvelope> {
  const householdId = input.householdId ?? DEFAULT_HOUSEHOLD_ID;
  return withMemoryRepositoryRetry(householdId, () => redactMemoryForPrivacyOnce(input));
}

async function requestMemorySplitOnce(input: {
  householdId?: string;
  actorUserId?: string;
  memoryObjectId?: string;
  reason?: string;
}): Promise<ApiEnvelope> {
  const householdId = input.householdId ?? DEFAULT_HOUSEHOLD_ID;
  const store = await getStoreAsync(householdId);
  const memory = store.memoryObjects.find((item) => item.id === input.memoryObjectId && item.householdId === householdId);
  if (!memory) {
    return envelope({
      memory: null,
      confidence: 0.3,
      sourceRefs: [],
      currentState: "split_missing_memory",
      needsUserInput: true,
      nextQuestion: "你想拆開邊一件 memory？",
      data: { memoryObjectId: input.memoryObjectId }
    });
  }

  memory.status = "review_later";
  memory.currentState = "needs_review";
  memory.updatedAt = nowIso();
  const revision = {
    id: createId("rev"),
    householdId,
    memoryObjectId: memory.id,
    revisionType: "split" as const,
    actor: "user" as const,
    actorUserId: input.actorUserId,
    reason: input.reason ?? "User requested split review.",
    diff: {
      requestedAction: "split_memory",
      note: "Facts are not modified until a reviewed split is applied."
    },
    createdAt: nowIso()
  };
  store.revisions.unshift(revision);
  await saveStoreAsync(householdId);

  return envelope({
    memory,
    confidence: 0.72,
    sourceRefs: [{ type: "memory", id: memory.id, label: "split requested", strength: "strong" }],
    currentState: "split_requested",
    needsUserInput: false,
    data: { memory, revision }
  });
}

export async function requestMemorySplit(input: {
  householdId?: string;
  actorUserId?: string;
  memoryObjectId?: string;
  reason?: string;
}): Promise<ApiEnvelope> {
  const householdId = input.householdId ?? DEFAULT_HOUSEHOLD_ID;
  return withMemoryRepositoryRetry(householdId, () => requestMemorySplitOnce(input));
}

export async function getConversationSources(id: string, householdId = DEFAULT_HOUSEHOLD_ID): Promise<ApiEnvelope> {
  const store = await getStoreAsync(householdId);
  const message = store.conversationMessages.find((item) => item.id === id && item.householdId === householdId);
  if (!message) return envelope({ memory: null, confidence: null, needsUserInput: false, data: null });

  const sourceRefs = message.sourceRefs;
  const factIds = new Set(sourceRefs.filter((ref) => ref.type === "fact").map((ref) => ref.id));
  const contextIds = new Set(sourceRefs.filter((ref) => ref.type === "context").map((ref) => ref.id));
  const memoryIds = new Set(sourceRefs.filter((ref) => ref.type === "memory").map((ref) => ref.id));
  const captureIds = new Set(sourceRefs.filter((ref) => ref.type === "capture").map((ref) => ref.id));
  for (const fact of store.facts.filter((item) => factIds.has(item.id))) {
    for (const ref of fact.sourceRefs) {
      if (ref.type === "capture") captureIds.add(ref.id);
      if (ref.type === "memory") memoryIds.add(ref.id);
    }
  }
  for (const context of store.contexts.filter((item) => contextIds.has(item.id))) {
    for (const ref of context.sourceRefs) {
      if (ref.type === "capture") captureIds.add(ref.id);
      if (ref.type === "memory") memoryIds.add(ref.id);
    }
  }

  return envelope({
    memory: null,
    confidence: message.confidence ?? null,
    sourceRefs,
    currentState: "conversation_sources",
    needsUserInput: false,
    data: {
      message,
      sourceRefs,
      facts: store.facts.filter((fact) => factIds.has(fact.id)),
      contexts: store.contexts.filter((context) => contextIds.has(context.id)),
      memories: store.memoryObjects.filter((memory) => memoryIds.has(memory.id)),
      captures: store.captures.filter((capture) => captureIds.has(capture.id))
    }
  });
}

async function askConversationOnce(question: string, householdId = DEFAULT_HOUSEHOLD_ID, actorUserId?: string): Promise<ApiEnvelope> {
  const startedAt = Date.now();
  const store = await getStoreAsync(householdId);
  const now = nowIso();
  const userMessage: ConversationMessage = {
    id: createId("msg"),
    householdId,
    role: "user",
    content: question,
    createdBy: actorUserId,
    sourceRefs: [],
    createdAt: now
  };
  store.conversationMessages.push(userMessage);
  const usageDecision = recordConversationUsage(store, householdId);

  if (!usageDecision.allowed) {
    const assistantMessage: ConversationMessage = {
      id: createId("msg"),
      householdId,
      role: "assistant",
      content:
        "我已收到你呢條問題，但今個月 prototype chat quota 已用完。Memory 仍然保留；你可以繼續 capture，或者下個月 quota reset 後再問。",
      confidence: 0.95,
      sourceRefs: [],
      createdAt: nowIso()
    };
    store.conversationMessages.push(assistantMessage);
    await recordAiTelemetryAsync({
      householdId,
      phase: "queued_without_ai",
      model: "none",
      provider: "system",
      conversationMessageId: assistantMessage.id,
      status: "limited",
      confidence: assistantMessage.confidence,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      durationMs: 0,
      metadata: {
        reason: usageDecision.reason,
        inboxBehavior: "question_saved_answer_deferred"
      }
    }, { commit: false });
    await saveStoreAsync(householdId);

    return envelope({
      memory: null,
      confidence: assistantMessage.confidence,
      sourceRefs: [],
      currentState: "usage_limited",
      needsUserInput: false,
      data: {
        message: assistantMessage,
        question: userMessage,
        usageLimitReason: usageDecision.reason,
        usage: usageDecision.usage,
        limits: usageDecision.limits
      }
    });
  }

  const evidencePack = buildEvidencePack(store, question, householdId);
  const sourceRefs = sourceRefsFromEvidence(store, evidencePack);
  const fallbackAnswer = answerFromEvidence(evidencePack);
  const conversationDraft = await answerConversationWithModel({
    question,
    evidence: evidencePack,
    fallbackAnswer,
    startedAt
  });

  const assistantMessage: ConversationMessage = {
    id: createId("msg"),
    householdId,
    role: "assistant",
    content: conversationDraft.answer,
    confidence: evidencePack.totals.count || evidencePack.contexts.length ? 0.82 : 0.35,
    sourceRefs,
    createdAt: nowIso()
  };
  store.conversationMessages.push(assistantMessage);
  await recordAiTelemetryAsync({
    householdId,
    phase: "conversation_answer",
    model: aiModels.conversation,
    provider: conversationDraft.provider,
    conversationMessageId: assistantMessage.id,
    status: conversationDraft.status,
    confidence: assistantMessage.confidence,
    promptTokens: conversationDraft.promptTokens,
    completionTokens: conversationDraft.completionTokens,
    totalTokens: conversationDraft.totalTokens,
    estimatedCostUsd: conversationDraft.estimatedCostUsd,
    durationMs: conversationDraft.durationMs,
    metadata: {
      questionIntent: evidencePack.intent,
      retrievalType: evidencePack.retrievalType,
      period: evidencePack.period,
      filters: evidencePack.filters,
      sourceRefCount: sourceRefs.length,
      retrievedFactCount: evidencePack.facts.length,
      contextCount: evidencePack.contexts.length,
      evidenceTotals: evidencePack.totals,
      usedEvidencePack: true,
      ...conversationDraft.metadata
    }
  }, { commit: false });
  await saveStoreAsync(householdId);

  return envelope({
    memory: null,
    confidence: assistantMessage.confidence,
    sourceRefs,
    currentState: "conversation_answer",
    needsUserInput: false,
    data: { message: assistantMessage, question: userMessage, evidencePack, usage: usageDecision.usage, limits: usageDecision.limits }
  });
}

export async function askConversation(question: string, householdId = DEFAULT_HOUSEHOLD_ID, actorUserId?: string): Promise<ApiEnvelope> {
  return withMemoryRepositoryRetry(householdId, () => askConversationOnce(question, householdId, actorUserId));
}

async function runMemoryEvolutionOnce(householdId = DEFAULT_HOUSEHOLD_ID): Promise<ApiEnvelope> {
  const store = await getStoreAsync(householdId);
  const facts = store.facts.filter((fact) => fact.householdId === householdId);
  const aliases = new Map<string, string>();
  for (const fact of facts) {
    const merchant = fact.payload.merchant;
    if (!merchant) continue;
    if (["ParknShop", "PNS", "百佳"].includes(merchant)) aliases.set(merchant, "百佳 / ParknShop");
  }

  const insight: Insight = {
    id: createId("insight"),
    householdId,
    severity: "info",
    title: "Memory evolution 完成",
    explanation: `我重新整理了 ${facts.length} 個 facts，找到 ${aliases.size} 個 merchant alias 線索。`,
    sourceRefs: facts.slice(0, 3).map((fact) => ({ type: "fact", id: fact.id, label: fact.payload.merchant, strength: "medium" })),
    dismissed: false,
    createdAt: nowIso()
  };
  store.insights.unshift(insight);
  await recordAiTelemetryAsync({
    householdId,
    phase: "memory_evolution",
    model: "deterministic-evolution-v1",
    provider: "system",
    status: "success",
    confidence: 0.76,
    totalTokens: 0,
    estimatedCostUsd: 0,
    durationMs: 0,
    metadata: {
      factCount: facts.length,
      aliasCount: aliases.size
    }
  }, { commit: false });
  await saveStoreAsync(householdId);

  return envelope({
    memory: null,
    confidence: 0.76,
    sourceRefs: insight.sourceRefs,
    currentState: "memory_evolved",
    needsUserInput: false,
    data: { insight, aliases: Object.fromEntries(aliases) }
  });
}

export async function runMemoryEvolution(householdId = DEFAULT_HOUSEHOLD_ID): Promise<ApiEnvelope> {
  return withMemoryRepositoryRetry(householdId, () => runMemoryEvolutionOnce(householdId));
}
