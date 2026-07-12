import { aiModels } from "./models";
import { estimateCostUsd, estimateTokensFromText } from "@/server/memory/telemetry";

const leadingSpokenCleanupRules: Array<{ pattern: RegExp; replace: string }> = [
  { pattern: /^(?:okay|ok|o\.k\.)[\s,，。：:;；-]*(?=(?:我想|想問|問下|記低|記住|幫我|請|可以|可唔可以|自己|今日|頭先))/i, replace: "" },
  { pattern: /^(?:我記|okay記|ok記|記)[\s,，。：:;；-]*/i, replace: "" },
  { pattern: /^(?:好啦|好喇|係咁先|咁呀|咁就|嗯|啊|喂)[\s,，。：:;；-]*/i, replace: "" }
];

const okMerchantRescueRules: Array<{ pattern: RegExp; replace: string }> = [
  { pattern: /^(?:我記|我既|我機|我期|ok記|okay記)[\s,，。：:;；-]*(?=(?:買|買咗|買左|飲|飲咗|飲左|咖啡|茶|水|零食|買野飲|買嘢飲|coffee|tea|water|snack))/i, replace: "OK " },
  { pattern: /^(?:我記|我既)[\s,，。：:;；-]*(7|七)\b/i, replace: "OK $1" }
];

const spokenNumberMap: Record<string, string> = {
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  eleven: "11",
  twelve: "12",
  thirteen: "13",
  fourteen: "14",
  fifteen: "15",
  sixteen: "16",
  seventeen: "17",
  eighteen: "18",
  nineteen: "19",
  twenty: "20",
  thirty: "30",
  forty: "40",
  fifty: "50",
  sixty: "60",
  seventy: "70",
  eighty: "80",
  ninety: "90"
};

function normalizeSpokenEnglishNumbers(text: string): string {
  return text.replace(
    /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/gi,
    (match) => spokenNumberMap[match.toLowerCase()] ?? match
  );
}

function maxAudioTranscriptionBytes(): number {
  const parsed = Number(process.env.AUDIO_TRANSCRIPTION_MAX_BYTES);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 25_000_000;
}

function isSupportedAudioFile(file: File): boolean {
  if (file.type.startsWith("audio/")) return true;
  return /\.(m4a|mp3|mp4|mpeg|mpga|wav|webm)$/i.test(file.name);
}

export function audioTranscriptionUnavailableReason(file?: File): string | undefined {
  if (!process.env.OPENAI_API_KEY) return "openai_not_configured";
  if (file && !isSupportedAudioFile(file)) return "unsupported_file_type";
  if (file && file.size > maxAudioTranscriptionBytes()) return "file_too_large";
  return undefined;
}

export function normalizeVoiceTranscript(text: string): string {
  let normalized = text.trim();
  for (const rule of okMerchantRescueRules) {
    normalized = normalized.replace(rule.pattern, rule.replace);
  }
  for (const rule of leadingSpokenCleanupRules) {
    normalized = normalized.replace(rule.pattern, "");
  }
  normalized = normalizeSpokenEnglishNumbers(normalized);
  normalized = normalized.replace(/\s{2,}/g, " ").trim();
  return normalized || text.trim();
}

export async function transcribeAudio(
  file: File
): Promise<
  | {
      rawTranscript: string;
      transcript: string;
      model: string;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      estimatedCostUsd: number;
      durationMs: number;
    }
  | undefined
> {
  if (audioTranscriptionUnavailableReason(file)) return undefined;

  const startedAt = Date.now();
  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const result = await client.audio.transcriptions.create({
      file,
      model: aiModels.speechToText,
      prompt:
        "This is Cantonese household finance speech and may mix Cantonese, zh-Hant, and English. Preserve merchant names and English words when spoken. Normalize clearly spoken amounts into Arabic numerals. Examples: 一百二十八 -> 128, seven -> 7, seventy -> 70."
    });

    const rawTranscript = result.text.trim();
    const transcript = normalizeVoiceTranscript(rawTranscript);
    return {
      rawTranscript,
      transcript,
      model: aiModels.speechToText,
      promptTokens: 0,
      completionTokens: estimateTokensFromText(transcript),
      totalTokens: estimateTokensFromText(transcript),
      estimatedCostUsd: estimateCostUsd({
        phase: "speech_to_text",
        promptTokens: 0,
        completionTokens: estimateTokensFromText(transcript)
      }),
      durationMs: Date.now() - startedAt
    };
  } catch {
    return undefined;
  }
}
