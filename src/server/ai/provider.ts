import type { CaptureSource } from "@/shared/memory/types";
import { looksLikeQuestion } from "@/shared/memory/intent";
import { aiModels } from "./models";
import { estimateCostUsd, estimateTokensFromText } from "@/server/memory/telemetry";

export type AiIntent = "financial_event" | "context_update" | "question" | "correction" | "unknown";

export type AiInterpretationDraft = {
  intent: AiIntent;
  confidence: number;
  title: string;
  reasoningSummary: string;
  financial?: {
    eventDate: string;
    merchant?: string;
    amount?: number;
    currency: string;
    category?: string;
    direction: "expense" | "income" | "transfer" | "unknown";
    recurringHint: boolean;
    ownershipScope?: "shared" | "member";
    assignedMember?: string;
    ownershipReason?: string;
    note?: string;
  };
  context?: {
    subject: string;
    state: string;
    effectiveFrom?: string;
    evidence?: string;
  };
  telemetry?: {
    provider: "openai" | "heuristic";
    model: string;
    status: "success" | "fallback" | "error";
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    estimatedCostUsd?: number;
    durationMs?: number;
  };
};

export type AiProviderInput = {
  text: string;
  sourceType: CaptureSource;
  householdContext: Array<{ subject: string; state: string }>;
  householdCategories?: string[];
};

export interface AiProvider {
  interpret(input: AiProviderInput): Promise<AiInterpretationDraft>;
}

const cancelWords = ["cut", "取消", "cancel", "停咗", "停左", "唔再", "不再"];
const moneyPattern = /(?:HK\$|\$|港幣)?\s*(\d+(?:\.\d+)?)/i;
const chineseMoneyPattern = /([零一二兩三四五六七八九十百千萬\d]+(?:點[零一二三四五六七八九]+)?)/;
const englishNumberWords: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function chineseDigitValue(char: string): number {
  return {
    零: 0,
    一: 1,
    二: 2,
    兩: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9
  }[char] ?? Number.NaN;
}

function parseChineseInteger(raw: string): number {
  if (!raw) return Number.NaN;
  if (/^\d+$/.test(raw)) return Number(raw);

  let total = 0;
  let section = 0;
  let number = 0;

  for (const char of raw) {
    const digit = chineseDigitValue(char);
    if (!Number.isNaN(digit)) {
      number = digit;
      continue;
    }

    if (char === "十") {
      section += (number || 1) * 10;
      number = 0;
      continue;
    }
    if (char === "百") {
      section += (number || 1) * 100;
      number = 0;
      continue;
    }
    if (char === "千") {
      section += (number || 1) * 1000;
      number = 0;
      continue;
    }
    if (char === "萬") {
      total += (section + number || 1) * 10000;
      section = 0;
      number = 0;
      continue;
    }
    return Number.NaN;
  }

  return total + section + number;
}

function parseChineseMoney(text: string): number | undefined {
  const match = text.match(chineseMoneyPattern)?.[1];
  if (!match) return undefined;
  const normalized = match.replace(/蚊|蚊雞|銀|蚊紙|蚊呀|蚊左右|蚊到?/g, "");
  const [integerPart, decimalPart] = normalized.split("點");
  const integerValue = parseChineseInteger(integerPart);
  if (Number.isNaN(integerValue)) return undefined;
  if (!decimalPart) return integerValue;
  const decimals = Array.from(decimalPart)
    .map((char) => chineseDigitValue(char))
    .filter((digit) => !Number.isNaN(digit))
    .join("");
  if (!decimals) return integerValue;
  return Number(`${integerValue}.${decimals}`);
}

function parseEnglishMoney(text: string): number | undefined {
  const matches = Array.from(
    text.toLowerCase().matchAll(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)\b/g)
  ).map((match) => match[1]);
  if (matches.length === 0) return undefined;

  let total = 0;
  let current = 0;
  for (const token of matches) {
    const value = englishNumberWords[token];
    if (value === 100) {
      current = Math.max(1, current) * 100;
      continue;
    }
    if (value >= 20 && value % 10 === 0) {
      current += value;
      continue;
    }
    current += value;
  }
  total += current;
  return total > 0 ? total : undefined;
}

function inferAmount(text: string): number {
  const numeric = Number(text.match(moneyPattern)?.[1]);
  if (!Number.isNaN(numeric) && numeric > 0) return numeric;
  const chinese = parseChineseMoney(text);
  if (typeof chinese === "number" && chinese > 0) return chinese;
  const english = parseEnglishMoney(text);
  return typeof english === "number" && english > 0 ? english : Number.NaN;
}

function inferMerchant(text: string): string | undefined {
  const normalized = text.trim();
  if (
    /^(?:ok|o\.k\.|okay|我記|我既|我機|我期)(?:便利店)?[\s,，。：:;；-]*(買|買咗|買左|買野飲|買嘢飲|飲|飲咗|飲左|食|咖啡|茶|水|零食|coffee|tea|water|snack)/i.test(normalized) ||
    /^(?:ok|o\.k\.|我記|我既)[\s,，。：:;；-]*\d+/i.test(normalized)
  ) {
    return "OK便利店";
  }

  const known = ["Netflix", "大家樂", "百佳", "ParknShop", "PNS", "Starbucks", "Uber", "MTR", "惠康", "OK便利店", "OK"];
  const hit = known.find((merchant) => normalized.toLowerCase().includes(merchant.toLowerCase()));
  if (hit) return hit === "OK" ? "OK便利店" : hit;

  const atMatch = normalized.match(/(?:喺|係|at|from)\s*([\p{Script=Han}A-Za-z0-9&'\-\s]{2,24})/iu);
  return atMatch?.[1]?.trim();
}

function pickKnownCategory(target: string, categories: string[] | undefined, fallback: string): string {
  return categories?.find((category) => category.toLowerCase() === target.toLowerCase()) ?? fallback;
}

function inferCategory(text: string, merchant?: string, categories?: string[]): string {
  const lower = text.toLowerCase();
  const categoryMention = categories?.find((category) => lower.includes(category.toLowerCase()));
  if (categoryMention) return categoryMention;
  if (merchant?.toLowerCase().includes("netflix") || lower.includes("subscription")) return pickKnownCategory("Subscriptions", categories, "Subscriptions");
  if (
    merchant === "OK便利店" &&
    /(買野飲|買嘢飲|飲|咖啡|茶|水|零食|snack|coffee|tea|water)/i.test(text)
  ) {
    return pickKnownCategory("Dining", categories, "Dining");
  }
  if (
    lower.includes("食") ||
    lower.includes("dining") ||
    lower.includes("飯") ||
    lower.includes("飲") ||
    lower.includes("咖啡") ||
    lower.includes("奶茶") ||
    lower.includes("珍珠奶茶") ||
    lower.includes("早餐") ||
    lower.includes("午餐") ||
    lower.includes("晚餐") ||
    lower.includes("lunch") ||
    lower.includes("dinner") ||
    lower.includes("breakfast") ||
    lower.includes("coffee") ||
    lower.includes("tea") ||
    merchant === "大家樂"
  ) {
    return pickKnownCategory("Dining", categories, "Dining");
  }
  if (lower.includes("買餸") || lower.includes("超市") || lower.includes("日用品") || lower.includes("雜貨") || lower.includes("grocer")) {
    return pickKnownCategory("Groceries", categories, "Groceries");
  }
  if (lower.includes("奶粉") || lower.includes("bb") || lower.includes("尿片")) return pickKnownCategory("Baby", categories, "Baby");
  if (lower.includes("mtr") || lower.includes("uber") || lower.includes("taxi")) return pickKnownCategory("Transport", categories, "Transport");
  if (merchant === "百佳" || merchant === "ParknShop" || merchant === "PNS" || merchant === "惠康" || merchant === "OK便利店") {
    return pickKnownCategory("Groceries", categories, "Groceries");
  }
  return pickKnownCategory("Family Living", categories, "Family Living");
}

function buildFinancialTitle(text: string, merchant: string | undefined, category: string | undefined, amount: number): string {
  if (merchant) return `${merchant} HK$${amount}`;
  const compact = text
    .replace(/(?:HK\$|\$|港幣)?\s*\d+(?:\.\d+)?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (compact) return `${compact} HK$${amount}`;
  if (category && category !== "Family Living") return `${category} HK$${amount}`;
  return `Financial memory HK$${amount}`;
}

function looksLikeDiningEvent(text: string, merchant?: string): boolean {
  const lower = text.toLowerCase();
  return (
    Boolean(merchant && merchant === "大家樂") ||
    Boolean(merchant && merchant === "OK便利店" && /(買野飲|飲|咖啡|茶|水|snack|coffee|tea|water)/i.test(text)) ||
    lower.includes("食") ||
    lower.includes("飯") ||
    lower.includes("飲") ||
    lower.includes("咖啡") ||
    lower.includes("奶茶") ||
    lower.includes("早餐") ||
    lower.includes("午餐") ||
    lower.includes("晚餐") ||
    lower.includes("食晏") ||
    lower.includes("lunch") ||
    lower.includes("dinner") ||
    lower.includes("breakfast") ||
    lower.includes("coffee") ||
    lower.includes("tea")
  );
}

function inferDirection(text: string): "expense" | "income" {
  const lower = text.toLowerCase();
  if (lower.includes("income") || lower.includes("收入") || lower.includes("利息") || lower.includes("薪水") || lower.includes("人工")) {
    return "income";
  }
  return "expense";
}

function inferOwnership(text: string): { ownershipScope: "shared" | "member"; assignedMember?: string; ownershipReason: string } {
  const lower = text.toLowerCase();
  if (/(公家|屋企|家庭|共同|shared|joint)/i.test(text)) {
    return { ownershipScope: "shared", ownershipReason: "Capture explicitly describes a shared household item." };
  }
  if (/(我自己|我個人|自己用|我私人|personal|my own|自己食|自己食晏|自己食飯|自己買|自己搭車|自己用)/i.test(text)) {
    return { ownershipScope: "member", assignedMember: "actor", ownershipReason: "Capture explicitly says this is the acting member's own item." };
  }
  if (/(太太自己|老婆自己|佢自己|partner own|wife own)/i.test(lower)) {
    return { ownershipScope: "member", assignedMember: "partner", ownershipReason: "Capture explicitly says this belongs to the partner." };
  }
  return { ownershipScope: "shared", ownershipReason: "No personal owner was specified, so Sayve treats the fact as shared household memory." };
}

function applyOwnershipGuard(draft: AiInterpretationDraft, text: string): AiInterpretationDraft {
  if (!draft.financial) return draft;
  const ownership = inferOwnership(text);
  return {
    ...draft,
    financial: {
      ...draft.financial,
      ...ownership,
      assignedMember: ownership.assignedMember
    }
  };
}

export class HeuristicAiProvider implements AiProvider {
  async interpret(input: AiProviderInput): Promise<AiInterpretationDraft> {
    const startedAt = Date.now();
    const text = input.text.trim();
    const lower = text.toLowerCase();
    const merchant = inferMerchant(text);
    const amount = inferAmount(text);

    if (looksLikeQuestion(text)) {
      return {
        intent: "question",
        confidence: 0.86,
        title: "Conversation question",
        reasoningSummary: "Input reads like a question about household financial memory.",
        telemetry: {
          provider: "heuristic",
          model: "heuristic-capture-v1",
          status: "fallback",
          promptTokens: estimateTokensFromText(text),
          completionTokens: 0,
          totalTokens: estimateTokensFromText(text),
          estimatedCostUsd: 0,
          durationMs: Date.now() - startedAt
        }
      };
    }

    if (cancelWords.some((word) => lower.includes(word.toLowerCase()))) {
      const inferredSubject = merchant ?? text.replace(/cut|取消|cancel|停咗|停左/gi, "").trim();
      const subject = inferredSubject || "Household context";
      return {
        intent: "context_update",
        confidence: merchant ? 0.88 : 0.67,
        title: `${subject} context updated`,
        reasoningSummary: "Input describes a change in household state rather than a new expense fact.",
        context: {
          subject,
          state: "cancelled",
          effectiveFrom: today(),
          evidence: text
        },
        telemetry: {
          provider: "heuristic",
          model: "heuristic-capture-v1",
          status: "fallback",
          promptTokens: estimateTokensFromText(text),
          completionTokens: 0,
          totalTokens: estimateTokensFromText(text),
          estimatedCostUsd: 0,
          durationMs: Date.now() - startedAt
        }
      };
    }

    if (!Number.isNaN(amount) && amount > 0) {
      const ownership = inferOwnership(text);
      const inferredCategory = inferCategory(text, merchant, input.householdCategories);
      const frictionlessEverydayEvent =
        looksLikeDiningEvent(text, merchant) ||
        inferredCategory === "Groceries" ||
        inferredCategory === "Transport" ||
        merchant === "OK便利店";
      const categoryDrivenConfidence =
        frictionlessEverydayEvent || inferredCategory !== "Family Living"
          ? 0.88
          : ownership.ownershipScope === "member"
            ? 0.8
            : 0.72;
      return applyOwnershipGuard({
        intent: "financial_event",
        confidence: merchant === "OK便利店" ? 0.92 : merchant ? 0.9 : categoryDrivenConfidence,
        title: buildFinancialTitle(text, merchant, inferredCategory, amount),
        reasoningSummary: "Input contains an amount and reads like a family financial event.",
        financial: {
          eventDate: today(),
          merchant,
          amount,
          currency: "HKD",
          category: inferredCategory,
          direction: inferDirection(text),
          recurringHint: lower.includes("monthly") || lower.includes("每月") || merchant === "Netflix",
          ...ownership,
          note: text
        },
        telemetry: {
          provider: "heuristic",
          model: "heuristic-capture-v1",
          status: "fallback",
          promptTokens: estimateTokensFromText(text),
          completionTokens: 0,
          totalTokens: estimateTokensFromText(text),
          estimatedCostUsd: 0,
          durationMs: Date.now() - startedAt
        }
      }, text);
    }

    return {
      intent: "unknown",
      confidence: input.sourceType === "receipt" ? 0.5 : 0.42,
      title: "Memory needs help",
      reasoningSummary: "The input is worth preserving but needs the user to clarify what should be remembered.",
      telemetry: {
        provider: "heuristic",
        model: "heuristic-capture-v1",
        status: "fallback",
        promptTokens: estimateTokensFromText(text),
        completionTokens: 0,
        totalTokens: estimateTokensFromText(text),
        estimatedCostUsd: 0,
        durationMs: Date.now() - startedAt
      }
    };
  }
}

class OpenAiMemoryProvider implements AiProvider {
  private fallback = new HeuristicAiProvider();

  async interpret(input: AiProviderInput): Promise<AiInterpretationDraft> {
    if (!process.env.OPENAI_API_KEY) return this.fallback.interpret(input);

    const startedAt = Date.now();
    const fallbackDraft = await this.fallback.interpret(input);
    const openAiErrorFallback = (): AiInterpretationDraft => {
      const promptTokens = estimateTokensFromText(input.text);
      return {
        ...fallbackDraft,
        telemetry: {
          provider: "openai",
          model: aiModels.capture,
          status: "error",
          promptTokens,
          completionTokens: 0,
          totalTokens: promptTokens,
          estimatedCostUsd: estimateCostUsd({
            phase: "capture_interpretation",
            promptTokens,
            completionTokens: 0
          }),
          durationMs: Date.now() - startedAt
        }
      };
    };

    try {
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const model = aiModels.capture;
      const completion = await client.chat.completions.create({
        model,
        max_completion_tokens: aiModels.captureMaxOutputTokens,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are Sayve, a Financial Memory Companion. Interpret captures as memory, not bookkeeping. Return only JSON matching this shape: { intent, confidence, title, reasoningSummary, financial?, context? }. Separate immutable facts from evolving household context. Use HKD and zh-Hant-HK assumptions by default. For financial.category, prefer one of the householdCategories exactly when it reasonably fits; only create a new category when none fits. For financial ownership, default to ownershipScope='shared' when the user does not clearly say the cost belongs to themselves or their partner personally. Keep createdBy/audit separate from ownership. Only use ownershipScope='member' when words like '我自己', '我個人', '太太自己', '老婆自己', or equivalent explicit personal ownership appear; set assignedMember to 'actor' or 'partner' when inferable."
          },
          {
            role: "user",
            content: JSON.stringify({
              capture: input.text,
              sourceType: input.sourceType,
              householdContext: input.householdContext,
              householdCategories: input.householdCategories,
              fallbackDraft
            })
          }
        ]
      });
      const content = completion.choices[0]?.message.content;
      if (!content) return openAiErrorFallback();

      const parsed = JSON.parse(content) as Partial<AiInterpretationDraft>;
      const promptTokens = completion.usage?.prompt_tokens;
      const completionTokens = completion.usage?.completion_tokens;
      return applyOwnershipGuard({
        ...fallbackDraft,
        ...parsed,
        intent: parsed.intent ?? fallbackDraft.intent,
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : fallbackDraft.confidence,
        title: parsed.title ?? fallbackDraft.title,
        reasoningSummary: parsed.reasoningSummary ?? fallbackDraft.reasoningSummary,
        telemetry: {
          provider: "openai",
          model,
          status: "success",
          promptTokens,
          completionTokens,
          totalTokens: completion.usage?.total_tokens,
          estimatedCostUsd: estimateCostUsd({
            phase: "capture_interpretation",
            promptTokens,
            completionTokens
          }),
          durationMs: Date.now() - startedAt
        }
      }, input.text);
    } catch {
      return openAiErrorFallback();
    }
  }
}

export function createAiProvider(): AiProvider {
  return new OpenAiMemoryProvider();
}
