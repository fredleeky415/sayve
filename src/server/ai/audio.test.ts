import { describe, expect, it } from "vitest";

import { normalizeVoiceTranscript } from "./audio";

describe("normalizeVoiceTranscript", () => {
  it("drops leading ok filler from mixed-language utterances", () => {
    expect(normalizeVoiceTranscript("OK 買野飲")).toBe("OK 買野飲");
    expect(normalizeVoiceTranscript("okay, 自己食晏 128")).toBe("自己食晏 128");
  });

  it("cleans common misheard ok prefixes", () => {
    expect(normalizeVoiceTranscript("我記買野飲")).toBe("OK 買野飲");
    expect(normalizeVoiceTranscript("我記買野飲 seven")).toBe("OK 買野飲 7");
    expect(normalizeVoiceTranscript("我機買嘢飲 seven")).toBe("OK 買嘢飲 7");
    expect(normalizeVoiceTranscript("ok記 lunch seven")).toBe("lunch 7");
  });

  it("keeps actual content when no cleanup is needed", () => {
    expect(normalizeVoiceTranscript("百佳買餸 428.5")).toBe("百佳買餸 428.5");
    expect(normalizeVoiceTranscript("OK 買野飲")).toBe("OK 買野飲");
  });
});
