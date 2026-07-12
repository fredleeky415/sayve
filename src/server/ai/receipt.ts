import { estimateCostUsd, estimateTokensFromText } from "@/server/memory/telemetry";
import { aiModels } from "./models";

export type ReceiptVisionResult = {
  text: string;
  model: string;
  confidence: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  durationMs: number;
  structured: Record<string, unknown>;
};

function maxReceiptVisionBytes(): number {
  const parsed = Number(process.env.RECEIPT_VISION_MAX_BYTES);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 8_000_000;
}

function receiptVisionEnabled(file: File): boolean {
  return !receiptVisionUnavailableReason(file);
}

export function receiptVisionUnavailableReason(file: File): string | undefined {
  if (!process.env.OPENAI_API_KEY) return "openai_not_configured";
  if (process.env.OPENAI_RECEIPT_VISION_DISABLED === "1") return "vision_disabled";
  if (!file.type.startsWith("image/")) return "unsupported_file_type";
  if (file.size > maxReceiptVisionBytes()) return "file_too_large";
  return undefined;
}

function composeReceiptMemoryText(parsed: {
  rawText?: string;
  merchant?: string;
  totalAmount?: number;
  currency?: string;
  transactionDate?: string;
  category?: string;
}) {
  const parts = [
    parsed.transactionDate,
    parsed.merchant,
    typeof parsed.totalAmount === "number" ? `${parsed.currency ?? "HKD"} ${parsed.totalAmount}` : undefined,
    parsed.category,
    parsed.rawText
  ];
  return parts.filter(Boolean).join(" / ");
}

export async function extractReceiptWithVision(file: File): Promise<ReceiptVisionResult | undefined> {
  if (!receiptVisionEnabled(file)) return undefined;

  const startedAt = Date.now();
  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = aiModels.receiptVision;
    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const imageUrl = `data:${file.type};base64,${base64}`;
    const prompt =
      "Read this receipt for Sayve. Return JSON only: { rawText, merchant, totalAmount, currency, transactionDate, category, confidence }. Use HKD if currency is unclear. If unsure, preserve rawText and lower confidence.";
    const completion = await client.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: imageUrl } }
          ]
        }
      ] as never
    });
    const content = completion.choices[0]?.message.content;
    if (!content) return undefined;

    const parsed = JSON.parse(content) as {
      rawText?: string;
      merchant?: string;
      totalAmount?: number;
      currency?: string;
      transactionDate?: string;
      category?: string;
      confidence?: number;
    };
    const text = composeReceiptMemoryText(parsed);
    if (!text) return undefined;

    const promptTokens = completion.usage?.prompt_tokens ?? estimateTokensFromText(prompt);
    const completionTokens = completion.usage?.completion_tokens ?? estimateTokensFromText(content);
    return {
      text,
      model,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.6,
      promptTokens,
      completionTokens,
      totalTokens: completion.usage?.total_tokens ?? promptTokens + completionTokens,
      estimatedCostUsd: estimateCostUsd({
        phase: "receipt_vision",
        promptTokens,
        completionTokens
      }),
      durationMs: Date.now() - startedAt,
      structured: parsed
    };
  } catch {
    return undefined;
  }
}
