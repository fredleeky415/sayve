import {
  captureUsageField,
  emptyUsageBucket,
  type MemoryStoreState,
  type PrototypeUsageBucket
} from "@/server/memory/store";
import type { CaptureSource } from "@/shared/memory/types";

export type PrototypeUsageLimits = {
  captures: number;
  receiptCaptures: number;
  voiceCaptures: number;
  conversationTurns: number;
  aiInterpretations: number;
};

export type UsageDecision = {
  allowed: boolean;
  reason?: string;
  usage: PrototypeUsageBucket;
  limits: PrototypeUsageLimits;
};

function readLimit(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function usageLimits(): PrototypeUsageLimits {
  return {
    captures: readLimit("PROTOTYPE_MONTHLY_CAPTURE_LIMIT", 300),
    receiptCaptures: readLimit("PROTOTYPE_MONTHLY_RECEIPT_LIMIT", 80),
    voiceCaptures: readLimit("PROTOTYPE_MONTHLY_VOICE_LIMIT", 120),
    conversationTurns: readLimit("PROTOTYPE_MONTHLY_CHAT_LIMIT", 300),
    aiInterpretations: readLimit("PROTOTYPE_MONTHLY_AI_INTERPRETATION_LIMIT", 500)
  };
}

export function usageLimitsDisabled(): boolean {
  return process.env.PROTOTYPE_USAGE_LIMITS_DISABLED === "1";
}

export function currentUsageMonth(date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

export function getUsageBucket(
  store: MemoryStoreState,
  householdId: string,
  month = currentUsageMonth()
): PrototypeUsageBucket {
  let usage = store.usage.find((bucket) => bucket.householdId === householdId && bucket.month === month);
  if (!usage) {
    usage = emptyUsageBucket(householdId, month);
    store.usage.unshift(usage);
  }
  return usage;
}

function recordLimitEvent(usage: PrototypeUsageBucket, reason: string): void {
  usage.limitEvents.unshift({
    reason,
    createdAt: new Date().toISOString()
  });
}

export function recordCaptureUsage(
  store: MemoryStoreState,
  householdId: string,
  sourceType: CaptureSource
): PrototypeUsageBucket {
  const usage = getUsageBucket(store, householdId);
  usage.captures += 1;
  const modalityField = captureUsageField(sourceType);
  if (modalityField) usage[modalityField] += 1;
  return usage;
}

export function canRunCaptureInterpretation(
  store: MemoryStoreState,
  householdId: string,
  sourceType: CaptureSource
): UsageDecision {
  const usage = getUsageBucket(store, householdId);
  const limits = usageLimits();

  if (usageLimitsDisabled()) return { allowed: true, usage, limits };

  if (usage.captures > limits.captures) {
    const reason = "monthly_capture_limit_reached";
    recordLimitEvent(usage, reason);
    return { allowed: false, reason, usage, limits };
  }

  const modalityField = captureUsageField(sourceType);
  if (modalityField && usage[modalityField] > limits[modalityField]) {
    const reason = `monthly_${sourceType}_limit_reached`;
    recordLimitEvent(usage, reason);
    return { allowed: false, reason, usage, limits };
  }

  if (usage.aiInterpretations >= limits.aiInterpretations) {
    const reason = "monthly_ai_interpretation_limit_reached";
    recordLimitEvent(usage, reason);
    return { allowed: false, reason, usage, limits };
  }

  usage.aiInterpretations += 1;
  return { allowed: true, usage, limits };
}

export function recordConversationUsage(store: MemoryStoreState, householdId: string): UsageDecision {
  const usage = getUsageBucket(store, householdId);
  const limits = usageLimits();
  usage.conversationTurns += 1;

  if (usageLimitsDisabled()) return { allowed: true, usage, limits };

  if (usage.conversationTurns > limits.conversationTurns) {
    const reason = "monthly_chat_limit_reached";
    recordLimitEvent(usage, reason);
    return { allowed: false, reason, usage, limits };
  }

  return { allowed: true, usage, limits };
}

export function recordDashboardView(store: MemoryStoreState, householdId: string): PrototypeUsageBucket {
  const usage = getUsageBucket(store, householdId);
  usage.dashboardViews += 1;
  return usage;
}
