import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

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

import {
  askConversation,
  captureMemory,
  correctMemory,
  getConversationSources,
  getDashboard,
  listContext,
  listInsights,
  redactMemoryForPrivacy,
  resetStore,
  runMemoryEvolution
} from "./test-helpers";
import { addHouseholdCategory } from "./categories";
import { getMemoryRepository } from "./store";

describe("AI Native Memory Engine", () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    delete process.env.PROTOTYPE_MONTHLY_CAPTURE_LIMIT;
    delete process.env.PROTOTYPE_MONTHLY_CHAT_LIMIT;
    delete process.env.PROTOTYPE_MONTHLY_AI_INTERPRETATION_LIMIT;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_CONVERSATION_MODEL;
    openAiCreateMock.mockReset();
  });

  it("creates a financial memory from one sentence without a form flow", async () => {
    const result = await captureMemory({ sourceType: "text", text: "今日喺大家樂食飯 HK$300" });

    expect(result.needs_user_input).toBe(false);
    expect(result.memory_object_id).toBeTruthy();
    expect(result.data.fact?.payload.money?.amount).toBe(300);
    expect(result.data.fact?.immutable).toBe(true);
  });

  it("defaults unspecified member ownership to shared household spending while preserving actor audit", async () => {
    const shared = await captureMemory({ householdId: "household_lee", actorUserId: "fred", sourceType: "text", text: "今日喺大家樂食飯 HK$300" });
    const personal = await captureMemory({
      householdId: "household_lee",
      actorUserId: "fred",
      sourceType: "text",
      text: "我自己午餐 HK$58"
    });

    expect(shared.data.capture?.createdBy).toBe("fred");
    expect(shared.data.fact?.payload.ownershipScope).toBe("shared");
    expect(shared.data.fact?.payload.assignedMember).toBeUndefined();
    expect(personal.data.capture?.createdBy).toBe("fred");
    expect(personal.data.fact?.payload.ownershipScope).toBe("member");
    expect(personal.data.fact?.payload.assignedMember).toBe("actor");

    const dashboard = await getDashboard("household_lee");
    const sharedRow = dashboard.monthlyFacts.find((fact) => fact.id === shared.data.fact?.id);
    const personalRow = dashboard.monthlyFacts.find((fact) => fact.id === personal.data.fact?.id);
    expect(sharedRow).toMatchObject({ createdBy: "fred", ownershipScope: "shared" });
    expect(personalRow).toMatchObject({ createdBy: "fred", ownershipScope: "member", assignedMember: "actor" });
  });

  it("separates household context from immutable facts", async () => {
    await captureMemory({ sourceType: "text", text: "Netflix HK$88" });
    await captureMemory({ sourceType: "text", text: "Cut 咗 Netflix" });

    const contexts = await listContext();
    const dashboard = await getDashboard();

    expect(contexts[0]?.subject).toContain("Netflix");
    expect(contexts[0]?.state).toBe("cancelled");
    expect(dashboard.factCount).toBe(1);
  });

  it("creates an insight when a cancelled context is contradicted by a new fact", async () => {
    await captureMemory({ sourceType: "text", text: "Cut 咗 Netflix" });
    await captureMemory({ sourceType: "receipt", text: "Netflix HK$88" });

    const insights = await listInsights();
    expect(insights[0]?.title).toContain("Netflix");
    expect(insights[0]?.severity).toBe("attention");
  });

  it("merges voice and receipt captures that support the same memory", async () => {
    await captureMemory({ sourceType: "voice", transcript: "今日食飯300" });
    const receipt = await captureMemory({ sourceType: "receipt", text: "大家樂 HK$298.5" });

    expect(receipt.data.mergedInto?.id).toBeTruthy();
    expect(receipt.data.relationship?.relationshipType).toBe("supports_same_memory");
  });

  it("answers conversation with cited memory sources instead of only a SQL total", async () => {
    await captureMemory({ sourceType: "text", text: "百佳買餸 $428.5" });
    const answer = await askConversation("點解今個月多咗？我需要擔心嗎？");
    const answerData = answer.data as { message?: { content?: string }; evidencePack?: { retrievalType?: string } };

    expect(answer.current_state).toBe("conversation_answer");
    expect(answer.source_refs.length).toBeGreaterThan(0);
    expect(String(answerData.message?.content)).toContain("近 3 個月平均");
    expect(String(answerData.message?.content).length).toBeLessThan(120);
    expect(answerData.evidencePack?.retrievalType).toBe("sql_compare");

    const telemetry = getMemoryRepository().read().aiTelemetry;
    expect(telemetry).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: "conversation_answer",
          status: "success",
          totalTokens: expect.any(Number),
          estimatedCostUsd: expect.any(Number),
          durationMs: expect.any(Number),
          metadata: expect.objectContaining({
            usedEvidencePack: true,
            retrievalType: "sql_compare"
          })
        })
      ])
    );
  });

  it("routes conversation answers through OpenAI when configured while keeping concise memory-grounded telemetry", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_CONVERSATION_MODEL = "gpt-test-conversation";
    openAiCreateMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              answer: "今個月食飯 HK$300，暫時只有一筆。"
            })
          }
        }
      ],
      usage: {
        prompt_tokens: 42,
        completion_tokens: 12,
        total_tokens: 54
      }
    });

    await captureMemory({ sourceType: "text", text: "今日喺大家樂食飯 HK$300" });
    openAiCreateMock.mockClear();

    const answer = await askConversation("今個月食飯用咗幾多？");
    const answerData = answer.data as { message?: { content?: string } };
    const telemetry = getMemoryRepository().read().aiTelemetry.find((event) => event.phase === "conversation_answer");

    expect(answer.current_state).toBe("conversation_answer");
    expect(answerData.message?.content).toBe("今個月食飯 HK$300，暫時只有一筆。");
    expect(openAiCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-test-conversation",
        max_completion_tokens: 120,
        response_format: { type: "json_object" }
      })
    );
    expect(telemetry).toEqual(
      expect.objectContaining({
        provider: "openai",
        model: "gpt-test-conversation",
        status: "success",
        promptTokens: 42,
        completionTokens: 12,
        totalTokens: 54,
        metadata: expect.objectContaining({
          usedOpenAiConversationModel: true,
          usedEvidencePack: true,
          outputBudgetTokens: 120,
          answerCharacters: "今個月食飯 HK$300，暫時只有一筆。".length
        })
      })
    );
  });

  it("answers exact spending questions from a scoped evidence pack", async () => {
    await captureMemory({ sourceType: "text", text: "今日喺大家樂食飯 HK$300" });
    await captureMemory({ sourceType: "text", text: "百佳買餸 $428.5" });

    const answer = await askConversation("今個月食飯用咗幾多？");
    const answerData = answer.data as {
      message?: { content?: string };
      evidencePack?: { retrievalType?: string; filters?: { category?: string }; totals?: { expense?: number; count?: number } };
    };

    expect(answerData.evidencePack?.retrievalType).toBe("sql_exact");
    expect(answerData.evidencePack?.filters?.category).toBe("Dining");
    expect(answerData.evidencePack?.totals?.expense).toBe(300);
    expect(answerData.evidencePack?.totals?.count).toBe(1);
    expect(String(answerData.message?.content)).toContain("HK$300.0");
  });

  it("keeps conversation sources inspectable after a short answer", async () => {
    await captureMemory({ sourceType: "text", text: "今日喺大家樂食飯 HK$300" });

    const answer = await askConversation("今個月食飯用咗幾多？");
    const answerData = answer.data as { message?: { id?: string } };
    const sources = await getConversationSources(String(answerData.message?.id));
    const sourceData = sources.data as { facts?: unknown[]; captures?: unknown[] };

    expect(sources.current_state).toBe("conversation_sources");
    expect(sourceData.facts?.length).toBeGreaterThan(0);
    expect(sourceData.captures?.length).toBeGreaterThan(0);
  });

  it("answers context lookup questions from household context", async () => {
    await captureMemory({ sourceType: "text", text: "Cut 咗 Netflix" });

    const answer = await askConversation("Netflix 係咪取消咗？");
    const answerData = answer.data as { message?: { content?: string }; evidencePack?: { retrievalType?: string; contexts?: unknown[] } };

    expect(answerData.evidencePack?.retrievalType).toBe("context_lookup");
    expect(answerData.evidencePack?.contexts?.length).toBeGreaterThan(0);
    expect(String(answerData.message?.content)).toContain("Netflix");
  });

  it("treats Cantonese follow-up questions as questions rather than financial facts", async () => {
    const question = await captureMemory({ sourceType: "text", text: "2026 咩數嚟" });

    expect(question.data.interpretation?.intent).toBe("question");
    expect(question.data.fact).toBeUndefined();
  });

  it("does not interrupt low-impact ambiguous capture", async () => {
    const result = await captureMemory({ sourceType: "text", text: "同屋企講低呢件事先" });

    expect(result.needs_user_input).toBe(false);
    expect(result.next_best_question).toBeUndefined();
    expect(result.data.memory?.status).toBe("review_later");
  });

  it("auto-confirms medium-confidence financial events to keep capture friction low", async () => {
    const result = await captureMemory({ sourceType: "text", text: "自己食晏128" });

    expect(result.needs_user_input).toBe(false);
    expect(result.data.memory?.status).toBe("auto_confirmed");
    expect(result.data.fact?.payload.money?.amount).toBe(128);
  });

  it("auto-confirms short drink captures without forcing a review queue", async () => {
    const result = await captureMemory({ sourceType: "voice", transcript: "買野飲 7" });

    expect(result.needs_user_input).toBe(false);
    expect(result.data.memory?.status).toBe("auto_confirmed");
    expect(result.data.fact?.payload.category).toBe("Dining");
    expect(result.data.fact?.payload.money?.amount).toBe(7);
  });

  it("auto-confirms short grocery captures without forcing a review queue", async () => {
    const result = await captureMemory({ sourceType: "text", text: "買餸 128" });

    expect(result.needs_user_input).toBe(false);
    expect(result.data.memory?.status).toBe("auto_confirmed");
    expect(result.data.fact?.payload.category).toBe("Groceries");
    expect(result.data.fact?.payload.money?.amount).toBe(128);
  });

  it("lets the user teach AI through review corrections", async () => {
    const result = await captureMemory({ sourceType: "text", text: "同屋企講低屋企雜費 HK$99" });
    const memoryId = String(result.memory_object_id);
    const before = await getDashboard();

    const correction = await correctMemory({
      memoryObjectId: memoryId,
      actorUserId: "lan",
      action: "category",
      value: "Utilities",
      correction: "應該係 Utilities"
    });
    const after = await getDashboard();
    const correctionData = correction.data as { revision?: { actorUserId?: string; diff?: { actorUserId?: string } } };

    expect(before.monthlyFacts.some((fact) => fact.id === result.data.fact?.id)).toBe(true);
    expect(correction.current_state).toBe("correction_recorded");
    expect(correctionData.revision?.actorUserId).toBe("lan");
    expect(correctionData.revision?.diff?.actorUserId).toBe("lan");
    expect(after.reviewQueue.some((item) => item.memoryObjectId === memoryId)).toBe(false);
    expect(after.monthlyFacts.find((fact) => fact.id === result.data.fact?.id)?.category).toBe("Utilities");
  });

  it("supports privacy redaction without using normal correction flow", async () => {
    const result = await captureMemory({ sourceType: "text", text: "私隱測試商戶 HK$888" });
    const memoryId = String(result.memory_object_id);
    await askConversation("私隱測試商戶用了幾多？");

    const redaction = await redactMemoryForPrivacy({
      memoryObjectId: memoryId,
      reason: "User requested privacy deletion.",
      actorUserId: "fred"
    });
    const store = getMemoryRepository().read();
    const memory = store.memoryObjects.find((item) => item.id === memoryId);
    const capture = store.captures.find((item) => item.id === result.data.capture.id);
    const fact = store.facts.find((item) => item.memoryObjectId === memoryId);
    const interpretation = store.interpretations.find((item) => item.memoryObjectId === memoryId);
    const telemetry = store.aiTelemetry.find((item) => item.memoryObjectId === memoryId);
    const redactedConversationMessages = store.conversationMessages.filter((message) => message.content === "Redacted for privacy.");
    const revision = store.revisions.find((item) => item.memoryObjectId === memoryId && item.revisionType === "privacy_redaction");

    expect(redaction.current_state).toBe("privacy_redacted");
    expect(memory).toEqual(expect.objectContaining({ title: "Redacted memory", currentState: "archived", status: "archived" }));
    expect(capture?.rawText).toBeUndefined();
    expect(capture?.transcript).toBeUndefined();
    expect(capture?.fileRefs).toEqual([]);
    expect(capture?.metadata).toEqual(expect.objectContaining({ redacted: true }));
    expect(fact?.payload).toEqual(expect.objectContaining({ eventDate: "redacted", direction: "unknown", note: "Redacted for privacy." }));
    expect(fact?.payload.money).toBeUndefined();
    expect(interpretation?.structuredOutput).toEqual(expect.objectContaining({ redacted: true }));
    expect(interpretation?.reasoningSummary).toBe("Redacted for privacy.");
    expect(telemetry?.metadata).toEqual(expect.objectContaining({ redacted: true, originalPhase: "capture_interpretation" }));
    expect(redactedConversationMessages).toHaveLength(2);
    expect(revision?.diff).toEqual(
      expect.objectContaining({
        actorUserId: "fred",
        counts: expect.objectContaining({ captures: 1, facts: 1, interpretations: 1, conversationMessages: 2, telemetry: 2 })
      })
    );
    expect(JSON.stringify(revision?.diff)).not.toContain("私隱測試商戶");
    expect(JSON.stringify(store)).not.toContain("HK$888");
  });

  it("keeps capture frictionless when interpretation quota is reached", async () => {
    process.env.PROTOTYPE_MONTHLY_AI_INTERPRETATION_LIMIT = "0";

    const result = await captureMemory({ sourceType: "text", text: "今日大家樂 HK$42" });
    const dashboard = await getDashboard();

    expect(result.current_state).toBe("queued_for_later_interpretation");
    expect(result.needs_user_input).toBe(false);
    expect(result.data.capture.rawText).toContain("大家樂");
    expect(result.data.usageLimitReason).toBe("monthly_ai_interpretation_limit_reached");
    expect(dashboard.memoryCount).toBe(1);
    expect(dashboard.factCount).toBe(0);
    expect(getMemoryRepository().read().aiTelemetry).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: "queued_without_ai",
          status: "limited",
          metadata: expect.objectContaining({
            reason: "monthly_ai_interpretation_limit_reached",
            inboxBehavior: "capture_saved_interpretation_deferred"
          })
        })
      ])
    );
  });

  it("lets household custom categories guide future AI categorisation", async () => {
    addHouseholdCategory({ name: "BB 學費" });

    const dashboardBefore = await getDashboard();
    const result = await captureMemory({ sourceType: "text", text: "今日 BB 學費 HK$1200" });
    const dashboardAfter = await getDashboard();

    expect(dashboardBefore.categoryOptions).toContain("BB 學費");
    expect(result.data.fact?.payload.category).toBe("BB 學費");
    expect(dashboardAfter.byCategory[0]?.category).toBe("BB 學費");
  });

  it("projects a one-year income and expense trend with category drilldown", async () => {
    await captureMemory({ sourceType: "text", text: "今日喺大家樂食飯 HK$300" });
    await captureMemory({ sourceType: "text", text: "銀行利息 HK$80 income" });

    const dashboard = await getDashboard();

    expect(dashboard.monthlyTrend).toHaveLength(12);
    expect(dashboard.monthlyTrend.at(-1)?.expense).toBeGreaterThan(0);
    expect(dashboard.monthlyTrend.at(-1)?.income).toBeGreaterThan(0);
    expect(dashboard.categoryTrends.find((trend) => trend.category === "Dining")?.rows).toHaveLength(12);
  });

  it("records chat limit without losing the user question", async () => {
    process.env.PROTOTYPE_MONTHLY_CHAT_LIMIT = "0";

    const answer = await askConversation("上個月食飯用咗幾多？");
    const answerData = answer.data as { question?: { content?: string }; message?: { content?: string } };

    expect(answer.current_state).toBe("usage_limited");
    expect(answer.needs_user_input).toBe(false);
    expect(String(answerData.question?.content)).toContain("食飯");
    expect(String(answerData.message?.content)).toContain("quota");
    expect(getMemoryRepository().read().aiTelemetry).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: "queued_without_ai",
          status: "limited",
          metadata: expect.objectContaining({
            reason: "monthly_chat_limit_reached",
            inboxBehavior: "question_saved_answer_deferred"
          })
        })
      ])
    );
  });

  it("records memory evolution telemetry for Founder Console monitoring", async () => {
    await captureMemory({ sourceType: "text", text: "百佳買餸 HK$428.5" });

    const result = await runMemoryEvolution();

    expect(result.current_state).toBe("memory_evolved");
    expect(getMemoryRepository().read().aiTelemetry).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: "memory_evolution",
          model: "deterministic-evolution-v1",
          status: "success",
          metadata: expect.objectContaining({
            factCount: 1
          })
        })
      ])
    );
  });
});
