export const aiModels = {
  get capture() {
    return process.env.OPENAI_CAPTURE_MODEL ?? process.env.OPENAI_DEFAULT_MODEL ?? "gpt-5.4-mini";
  },
  get captureMaxOutputTokens() {
    return readPositiveInt("OPENAI_CAPTURE_MAX_OUTPUT_TOKENS", 220);
  },
  get conversation() {
    return process.env.OPENAI_CONVERSATION_MODEL ?? process.env.OPENAI_DEFAULT_MODEL ?? "gpt-5.4-mini";
  },
  get conversationMaxOutputTokens() {
    return readPositiveInt("OPENAI_CONVERSATION_MAX_OUTPUT_TOKENS", 120);
  },
  get escalation() {
    return process.env.OPENAI_ESCALATION_MODEL ?? "gpt-5.5";
  },
  get receiptVision() {
    return process.env.OPENAI_RECEIPT_VISION_MODEL ?? process.env.OPENAI_CAPTURE_MODEL ?? "gpt-5.4-mini";
  },
  get speechToText() {
    return process.env.OPENAI_SPEECH_TO_TEXT_MODEL ?? "gpt-4o-mini-transcribe";
  }
} as const;

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
