import { afterEach, describe, expect, it } from "vitest";
import { audioTranscriptionUnavailableReason } from "./audio";
import { receiptVisionUnavailableReason } from "./receipt";

describe("media AI availability reasons", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("distinguishes expected fallback from provider-attemptable receipt vision", () => {
    delete process.env.OPENAI_API_KEY;
    expect(receiptVisionUnavailableReason(new File(["image"], "receipt.png", { type: "image/png" }))).toBe("openai_not_configured");

    process.env.OPENAI_API_KEY = "test-key";
    expect(receiptVisionUnavailableReason(new File(["image"], "receipt.png", { type: "image/png" }))).toBeUndefined();
    expect(receiptVisionUnavailableReason(new File(["pdf"], "receipt.pdf", { type: "application/pdf" }))).toBe("unsupported_file_type");
  });

  it("distinguishes expected fallback from provider-attemptable speech-to-text", () => {
    delete process.env.OPENAI_API_KEY;
    expect(audioTranscriptionUnavailableReason()).toBe("openai_not_configured");

    process.env.OPENAI_API_KEY = "test-key";
    expect(audioTranscriptionUnavailableReason()).toBeUndefined();
    expect(audioTranscriptionUnavailableReason(new File(["audio"], "note.m4a", { type: "audio/mp4" }))).toBeUndefined();
    expect(audioTranscriptionUnavailableReason(new File(["text"], "note.txt", { type: "text/plain" }))).toBe("unsupported_file_type");

    process.env.AUDIO_TRANSCRIPTION_MAX_BYTES = "3";
    expect(audioTranscriptionUnavailableReason(new File(["audio"], "large.wav", { type: "audio/wav" }))).toBe("file_too_large");
  });
});
