import { createId, nowIso } from "@/server/memory/id";
import { getMemoryRepository, withMemoryRepositoryRetry, type AiTelemetryEvent } from "@/server/memory/store";

type TokenPricing = {
  inputUsdPer1M: number;
  outputUsdPer1M: number;
};

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function estimateTokensFromText(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function pricingForPhase(phase: AiTelemetryEvent["phase"]): TokenPricing {
  if (phase === "conversation_answer") {
    return {
      inputUsdPer1M: readNumber("OPENAI_CONVERSATION_INPUT_USD_PER_1M", 0),
      outputUsdPer1M: readNumber("OPENAI_CONVERSATION_OUTPUT_USD_PER_1M", 0)
    };
  }

  if (phase === "speech_to_text") {
    return {
      inputUsdPer1M: readNumber("OPENAI_STT_INPUT_USD_PER_1M", 0),
      outputUsdPer1M: readNumber("OPENAI_STT_OUTPUT_USD_PER_1M", 0)
    };
  }

  if (phase === "receipt_vision") {
    return {
      inputUsdPer1M: readNumber("OPENAI_RECEIPT_VISION_INPUT_USD_PER_1M", 0),
      outputUsdPer1M: readNumber("OPENAI_RECEIPT_VISION_OUTPUT_USD_PER_1M", 0)
    };
  }

  return {
    inputUsdPer1M: readNumber("OPENAI_CAPTURE_INPUT_USD_PER_1M", 0),
    outputUsdPer1M: readNumber("OPENAI_CAPTURE_OUTPUT_USD_PER_1M", 0)
  };
}

export function estimateCostUsd(input: {
  phase: AiTelemetryEvent["phase"];
  promptTokens?: number;
  completionTokens?: number;
}): number {
  const pricing = pricingForPhase(input.phase);
  const promptCost = ((input.promptTokens ?? 0) / 1_000_000) * pricing.inputUsdPer1M;
  const completionCost = ((input.completionTokens ?? 0) / 1_000_000) * pricing.outputUsdPer1M;
  return Number((promptCost + completionCost).toFixed(8));
}

type TelemetryWriteOptions = {
  commit?: boolean;
};

export function recordAiTelemetry(event: Omit<AiTelemetryEvent, "id" | "createdAt">, options: TelemetryWriteOptions = {}): AiTelemetryEvent {
  const next: AiTelemetryEvent = {
    id: createId("ai"),
    createdAt: nowIso(),
    ...event
  };

  const repository = getMemoryRepository(event.householdId);
  repository.read().aiTelemetry.unshift(next);
  if (options.commit !== false) repository.commit();
  return next;
}

export async function recordAiTelemetryAsync(
  event: Omit<AiTelemetryEvent, "id" | "createdAt">,
  options: TelemetryWriteOptions = {}
): Promise<AiTelemetryEvent> {
  const write = async () => {
    const next: AiTelemetryEvent = {
      id: createId("ai"),
      createdAt: nowIso(),
      ...event
    };

    const repository = getMemoryRepository(event.householdId);
    const store = await repository.readAsync();
    store.aiTelemetry.unshift(next);
    if (options.commit !== false) await repository.commitAsync();
    return next;
  };

  if (options.commit === false) return write();
  return withMemoryRepositoryRetry(event.householdId, write);
}
