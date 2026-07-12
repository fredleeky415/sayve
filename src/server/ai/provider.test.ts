import { afterEach, describe, expect, it, vi } from "vitest";

const openAiCreateMock = vi.hoisted(() => vi.fn());

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: openAiCreateMock
      }
    }
  }))
}));

import { createAiProvider } from "./provider";

describe("AI provider telemetry", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    openAiCreateMock.mockReset();
  });

  it("records OpenAI capture failures as provider errors while preserving frictionless fallback interpretation", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    openAiCreateMock.mockRejectedValue(new Error("provider unavailable"));

    const provider = createAiProvider();
    const draft = await provider.interpret({
      text: "今日大家樂 HK$42",
      sourceType: "text",
      householdContext: [],
      householdCategories: ["Dining"]
    });

    expect(draft.intent).toBe("financial_event");
    expect(draft.financial?.amount).toBe(42);
    expect(draft.telemetry).toEqual(
      expect.objectContaining({
        provider: "openai",
        status: "error"
      })
    );
    expect(draft.telemetry?.durationMs).toEqual(expect.any(Number));
  });

  it("keeps dining captures high confidence even when merchant is missing", async () => {
    delete process.env.OPENAI_API_KEY;

    const provider = createAiProvider();
    const draft = await provider.interpret({
      text: "自己食晏 128",
      sourceType: "text",
      householdContext: [],
      householdCategories: ["Dining", "Groceries"]
    });

    expect(draft.intent).toBe("financial_event");
    expect(draft.confidence).toBeGreaterThanOrEqual(0.86);
    expect(draft.title).toBe("自己食晏 HK$128");
    expect(draft.financial).toEqual(
      expect.objectContaining({
        amount: 128,
        category: "Dining",
        ownershipScope: "member",
        assignedMember: "actor"
      })
    );
  });

  it("treats colloquial self-owned captures as personal instead of shared", async () => {
    delete process.env.OPENAI_API_KEY;

    const provider = createAiProvider();
    const draft = await provider.interpret({
      text: "自己買咖啡 42",
      sourceType: "text",
      householdContext: [],
      householdCategories: ["Dining"]
    });

    expect(draft.financial).toEqual(
      expect.objectContaining({
        ownershipScope: "member",
        assignedMember: "actor"
      })
    );
  });

  it("treats OK at the start of a spending phrase as the convenience-store merchant", async () => {
    delete process.env.OPENAI_API_KEY;

    const provider = createAiProvider();
    const draft = await provider.interpret({
      text: "OK 買野飲 7",
      sourceType: "voice",
      householdContext: [],
      householdCategories: ["Groceries", "Dining"]
    });

    expect(draft.intent).toBe("financial_event");
    expect(draft.financial).toEqual(
      expect.objectContaining({
        merchant: "OK便利店",
        amount: 7,
        category: "Dining"
      })
    );
  });

  it("rescues common Cantonese STT OK-store mishearing without asking the user again", async () => {
    delete process.env.OPENAI_API_KEY;

    const provider = createAiProvider();
    const draft = await provider.interpret({
      text: "OK 買野飲 7",
      sourceType: "voice",
      householdContext: [],
      householdCategories: ["Groceries", "Dining"]
    });

    expect(draft.intent).toBe("financial_event");
    expect(draft.confidence).toBeGreaterThanOrEqual(0.9);
    expect(draft.financial).toEqual(
      expect.objectContaining({
        merchant: "OK便利店",
        amount: 7,
        category: "Dining"
      })
    );
  });

  it("rescues the common voice mishearing where OK becomes 我記", async () => {
    delete process.env.OPENAI_API_KEY;

    const provider = createAiProvider();
    const draft = await provider.interpret({
      text: "我記買野飲 7",
      sourceType: "voice",
      householdContext: [],
      householdCategories: ["Groceries", "Dining"]
    });

    expect(draft.intent).toBe("financial_event");
    expect(draft.confidence).toBeGreaterThanOrEqual(0.9);
    expect(draft.financial).toEqual(
      expect.objectContaining({
        merchant: "OK便利店",
        amount: 7,
        category: "Dining"
      })
    );
  });

  it("rescues additional Cantonese OK-store mishearing variants", async () => {
    delete process.env.OPENAI_API_KEY;

    const provider = createAiProvider();
    const draft = await provider.interpret({
      text: "我機買嘢飲 seven",
      sourceType: "voice",
      householdContext: [],
      householdCategories: ["Groceries", "Dining"]
    });

    expect(draft.intent).toBe("financial_event");
    expect(draft.confidence).toBeGreaterThanOrEqual(0.9);
    expect(draft.title).toBe("OK便利店 HK$7");
    expect(draft.financial).toEqual(
      expect.objectContaining({
        merchant: "OK便利店",
        amount: 7,
        category: "Dining"
      })
    );
  });

  it("understands Cantonese spoken money amounts written in Chinese numerals", async () => {
    delete process.env.OPENAI_API_KEY;

    const provider = createAiProvider();
    const draft = await provider.interpret({
      text: "自己食晏一百二十八",
      sourceType: "voice",
      householdContext: [],
      householdCategories: ["Dining"]
    });

    expect(draft.intent).toBe("financial_event");
    expect(draft.confidence).toBeGreaterThanOrEqual(0.86);
    expect(draft.financial).toEqual(
      expect.objectContaining({
        amount: 128,
        category: "Dining",
        ownershipScope: "member",
        assignedMember: "actor"
      })
    );
  });

  it("understands short English spoken amounts in mixed Cantonese capture text", async () => {
    delete process.env.OPENAI_API_KEY;

    const provider = createAiProvider();
    const draft = await provider.interpret({
      text: "自己食晏 seven",
      sourceType: "voice",
      householdContext: [],
      householdCategories: ["Dining"]
    });

    expect(draft.intent).toBe("financial_event");
    expect(draft.financial).toEqual(
      expect.objectContaining({
        amount: 7,
        category: "Dining",
        ownershipScope: "member",
        assignedMember: "actor"
      })
    );
  });

  it("keeps drink-only short captures frictionless even without a merchant", async () => {
    delete process.env.OPENAI_API_KEY;

    const provider = createAiProvider();
    const draft = await provider.interpret({
      text: "買野飲 7",
      sourceType: "voice",
      householdContext: [],
      householdCategories: ["Dining", "Groceries"]
    });

    expect(draft.intent).toBe("financial_event");
    expect(draft.confidence).toBeGreaterThanOrEqual(0.86);
    expect(draft.financial).toEqual(
      expect.objectContaining({
        amount: 7,
        category: "Dining",
        ownershipScope: "shared"
      })
    );
  });

  it("keeps groceries-only short captures frictionless even without a merchant", async () => {
    delete process.env.OPENAI_API_KEY;

    const provider = createAiProvider();
    const draft = await provider.interpret({
      text: "買餸 128",
      sourceType: "text",
      householdContext: [],
      householdCategories: ["Dining", "Groceries"]
    });

    expect(draft.intent).toBe("financial_event");
    expect(draft.confidence).toBeGreaterThanOrEqual(0.86);
    expect(draft.financial).toEqual(
      expect.objectContaining({
        amount: 128,
        category: "Groceries",
        ownershipScope: "shared"
      })
    );
  });

  it("normalizes OpenAI ownership so unspecified captures stay shared household spending", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    openAiCreateMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              intent: "financial_event",
              confidence: 0.91,
              title: "大家樂 HK$42",
              reasoningSummary: "Model incorrectly treated the acting user as the owner.",
              financial: {
                eventDate: "2026-07-07",
                merchant: "大家樂",
                amount: 42,
                currency: "HKD",
                category: "Dining",
                direction: "expense",
                recurringHint: false,
                ownershipScope: "member",
                assignedMember: "actor",
                ownershipReason: "Incorrectly inferred from createdBy.",
                note: "今日大家樂 HK$42"
              }
            })
          }
        }
      ],
      usage: {
        prompt_tokens: 120,
        completion_tokens: 80,
        total_tokens: 200
      }
    });

    const provider = createAiProvider();
    const draft = await provider.interpret({
      text: "今日大家樂 HK$42",
      sourceType: "text",
      householdContext: [],
      householdCategories: ["Dining"]
    });

    expect(draft.telemetry).toEqual(expect.objectContaining({ provider: "openai", status: "success" }));
    expect(draft.financial).toEqual(
      expect.objectContaining({
        amount: 42,
        ownershipScope: "shared",
        assignedMember: undefined,
        ownershipReason: "No personal owner was specified, so Sayve treats the fact as shared household memory."
      })
    );
    expect(openAiCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.any(String),
        max_completion_tokens: 220,
        response_format: { type: "json_object" }
      })
    );
  });

  it("keeps explicit personal ownership after OpenAI interpretation", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    openAiCreateMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              intent: "financial_event",
              confidence: 0.91,
              title: "午餐 HK$58",
              reasoningSummary: "Model missed explicit personal ownership.",
              financial: {
                eventDate: "2026-07-07",
                amount: 58,
                currency: "HKD",
                category: "Dining",
                direction: "expense",
                recurringHint: false,
                ownershipScope: "shared",
                note: "我自己午餐 HK$58"
              }
            })
          }
        }
      ],
      usage: {
        prompt_tokens: 120,
        completion_tokens: 80,
        total_tokens: 200
      }
    });

    const provider = createAiProvider();
    const draft = await provider.interpret({
      text: "我自己午餐 HK$58",
      sourceType: "text",
      householdContext: [],
      householdCategories: ["Dining"]
    });

    expect(draft.financial).toEqual(
      expect.objectContaining({
        amount: 58,
        ownershipScope: "member",
        assignedMember: "actor",
        ownershipReason: "Capture explicitly says this is the acting member's own item."
      })
    );
  });
});
