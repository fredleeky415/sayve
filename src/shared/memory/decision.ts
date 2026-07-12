import type { ConfidenceBand, MemoryStatus } from "./types";

export function confidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= 0.82) return "high";
  if (confidence >= 0.56) return "medium";
  return "low";
}

export function statusForConfidence(
  confidence: number,
  highImpact = false,
  intent: "financial_event" | "context_update" | "question" | "correction" | "unknown" = "unknown"
): MemoryStatus {
  if (highImpact) return "review_later";
  const band = confidenceBand(confidence);
  if (band === "high") return "auto_confirmed";
  if (band === "medium" && intent === "financial_event") return "auto_confirmed";
  return "review_later";
}

export function shouldInterruptCapture(confidence: number, highImpact = false): boolean {
  return highImpact && confidence < 0.56;
}

export function nextBestQuestion(confidence: number, intent: string, highImpact = false): string | undefined {
  if (!shouldInterruptCapture(confidence, highImpact)) return undefined;
  if (intent === "financial_event") return "我應該記住幾多錢、邊間商戶，定係只係一段備註？";
  if (intent === "context_update") return "呢個家庭狀態由幾時開始生效？";
  return "你想我將呢句記成一件事、家庭狀態，定係想問我問題？";
}
