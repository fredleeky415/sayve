import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiEnvelopeSchema } from "@/shared/memory/types";
import { getMemoryRepository, resetStore } from "@/server/memory/store";
import { POST as postTextCapture } from "./captures/text/route";
import { POST as postReceiptCapture } from "./captures/receipt/route";
import { POST as postVoiceCapture } from "./captures/voice/route";
import { POST as postConversationAsk } from "./conversation/ask/route";
import { GET as getConversationSources } from "./conversation/[id]/sources/route";
import { GET as getDashboardView } from "./views/dashboard/route";
import { GET as getTimelineView } from "./views/timeline/route";
import { GET as getCategories, POST as postCategory } from "./categories/route";
import { GET as getContext } from "./context/route";
import { GET as getInsights } from "./insights/route";
import { GET as getHealth } from "./health/route";
import { GET as getAdminExport } from "./admin/export/route";
import { GET as getFounderSetupBundle } from "./admin/founder/setup-bundle/route";
import { GET as getLaunchReadiness } from "./admin/launch-readiness/route";
import { POST as postRepositorySmokeTest } from "./admin/repository/smoke-test/route";
import { POST as postSupabaseImportLoad } from "./admin/import/supabase/load/route";
import { POST as postCreateHousehold } from "./households/create/route";
import { GET as getHouseholds } from "./households/route";
import { POST as postCreateInvite } from "./households/invite/route";
import { POST as postAcceptInvite } from "./households/invite/accept/route";
import { GET as getInviteStatus } from "./households/invite/status/route";
import { inviteAcceptanceStatus, invitePreviewStatus } from "@/server/households/http";
import { GET as getMemoryById } from "./memory/[id]/route";
import { POST as postSplitMemory } from "./memory/split/route";
import { POST as postConfirmContext } from "./context/confirm/route";

vi.mock("openai", () => {
  class MockOpenAI {
    chat = {
      completions: {
        create: async (input: { messages?: Array<{ content?: unknown }> }) => {
          const content = input.messages?.[0]?.content;
          if (
            Array.isArray(content) &&
            content.some((part) => typeof part === "object" && part !== null && "type" in part && part.type === "image_url")
          ) {
            throw new Error("mock receipt vision provider failure");
          }

          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    intent: "financial_event",
                    confidence: 0.86,
                    title: "Mock capture HK$42",
                    reasoningSummary: "Mocked capture interpretation.",
                    financial: {
                      amount: 42,
                      currency: "HKD",
                      merchant: "Mock",
                      category: "Dining",
                      direction: "expense",
                      eventDate: "2026-07-07"
                    }
                  })
                }
              }
            ],
            usage: { prompt_tokens: 10, completion_tokens: 12, total_tokens: 22 }
          };
        }
      }
    };

    audio = {
      transcriptions: {
        create: async () => {
          throw new Error("mock speech provider failure");
        }
      }
    };
  }

  return { default: MockOpenAI };
});

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

function householdJsonRequest(url: string, body: unknown, householdId: string, userId: string): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-household-id": householdId,
      "x-user-id": userId
    },
    body: JSON.stringify(body)
  });
}

function rawJsonRequest(url: string, body: string): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body
  });
}

function adminJsonRequest(url: string, body: unknown, token = "secret"): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-admin-token": token
    },
    body: JSON.stringify(body)
  });
}

function multipartRequest(url: string, body: FormData, householdId = "household_lee", userId = "fred"): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "x-household-id": householdId,
      "x-user-id": userId
    },
    body
  });
}

async function responseJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

function expectApiEnvelope(value: unknown) {
  const parsed = ApiEnvelopeSchema.safeParse(value);
  expect(parsed.success).toBe(true);
}

function expectNoStore(response: Response) {
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("x-robots-tag")).toBe("noindex");
}

describe("API contract", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns the shared envelope for text capture, conversation, dashboard, and categories", async () => {
    const capture = await responseJson(await postTextCapture(jsonRequest("http://sayve.test/api/captures/text", { text: "今日大家樂 HK$42" })));
    expectApiEnvelope(capture);
    expect(capture.current_state).toBe("active");
    expect(capture.needs_user_input).toBe(false);

    const answer = await responseJson(
      await postConversationAsk(jsonRequest("http://sayve.test/api/conversation/ask", { question: "今個月食飯用咗幾多？" }))
    );
    expectApiEnvelope(answer);
    expect(answer.current_state).toBe("conversation_answer");

    const dashboard = await responseJson(await getDashboardView(new Request("http://sayve.test/api/views/dashboard")));
    expectApiEnvelope(dashboard);
    expect(dashboard.current_state).toBe("dashboard_view");
    expect((dashboard.data as { factCount?: number }).factCount).toBe(1);

    const categories = await responseJson(await getCategories(new Request("http://sayve.test/api/categories")));
    expectApiEnvelope(categories);
    expect(categories.current_state).toBe("category_taxonomy");
  });

  it("returns stable JSON envelopes when production memory storage is unavailable", async () => {
    process.env.MEMORY_REPOSITORY = "supabase";
    delete process.env.SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const formData = new FormData();
    formData.set("file", new File(["receipt"], "receipt.jpg", { type: "image/jpeg" }));

    const responses = await Promise.all([
      postTextCapture(jsonRequest("http://sayve.test/api/captures/text", { text: "今日大家樂 HK$42" })),
      postReceiptCapture(jsonRequest("http://sayve.test/api/captures/receipt", { text: "百佳 HK$80" })),
      postVoiceCapture(jsonRequest("http://sayve.test/api/captures/voice", { transcript: "午餐 HK$58" })),
      postReceiptCapture(multipartRequest("http://sayve.test/api/captures/receipt", formData)),
      postConversationAsk(jsonRequest("http://sayve.test/api/conversation/ask", { question: "今個月用咗幾多？" })),
      getCategories(new Request("http://sayve.test/api/categories")),
      postCategory(jsonRequest("http://sayve.test/api/categories", { name: "Tax" }))
    ]);

    for (const response of responses) {
      const json = await responseJson(response);
      expect(response.status).toBe(503);
      expectNoStore(response);
      expectApiEnvelope(json);
      expect(json.current_state).toBe("temporary_unavailable");
      expect((json.data as { error?: string }).error).toBe("unexpected_server_error");
    }
  });

  it("marks private household memory API responses as no-store/noindex", async () => {
    const captureResponse = await postTextCapture(jsonRequest("http://sayve.test/api/captures/text", { text: "今日大家樂 HK$42" }));
    expectNoStore(captureResponse);
    const capture = await responseJson(captureResponse);
    const memoryObjectId = String(capture.memory_object_id);

    const askResponse = await postConversationAsk(jsonRequest("http://sayve.test/api/conversation/ask", { question: "今個月用了幾多？" }));
    expectNoStore(askResponse);
    const answer = await responseJson(askResponse);
    const messageId = String((answer.data as { message?: { id?: string } }).message?.id);

    const dashboardResponse = await getDashboardView(new Request("http://sayve.test/api/views/dashboard"));
    const timelineResponse = await getTimelineView(new Request("http://sayve.test/api/views/timeline"));
    const categoriesResponse = await getCategories(new Request("http://sayve.test/api/categories"));
    const contextResponse = await getContext(new Request("http://sayve.test/api/context"));
    const insightsResponse = await getInsights(new Request("http://sayve.test/api/insights"));
    const memoryResponse = await getMemoryById(new Request("http://sayve.test/api/memory/mem"), {
      params: Promise.resolve({ id: memoryObjectId })
    });
    const sourcesResponse = await getConversationSources(new Request("http://sayve.test/api/conversation/msg/sources"), {
      params: Promise.resolve({ id: messageId })
    });
    const invalidResponse = await postTextCapture(rawJsonRequest("http://sayve.test/api/captures/text", "{bad json"));

    for (const response of [
      dashboardResponse,
      timelineResponse,
      categoriesResponse,
      contextResponse,
      insightsResponse,
      memoryResponse,
      sourcesResponse,
      invalidResponse
    ]) {
      expectNoStore(response);
    }
  });

  it("keeps custom category API deterministic and envelope-shaped", async () => {
    const created = await responseJson(
      await postCategory(jsonRequest("http://sayve.test/api/categories", { name: "School Fees", color: "#8fb3ff" }))
    );
    expectApiEnvelope(created);
    expect(created.current_state).toBe("category_created");
    expect((created.data as { category?: { name?: string } }).category?.name).toBe("School Fees");

    const invalid = await postCategory(jsonRequest("http://sayve.test/api/categories", { name: "" }));
    const invalidJson = await responseJson(invalid);
    expect(invalid.status).toBe(400);
    expectApiEnvelope(invalidJson);
    expect(invalidJson.needs_user_input).toBe(true);
  });

  it("preserves the acting member when creating household categories", async () => {
    const actorUserId = "00000000-0000-4000-8000-000000000456";
    const created = await responseJson(
      await postCategory(
        householdJsonRequest("http://sayve.test/api/categories", { name: "BB 學費", color: "#8fb3ff" }, "household_lee", actorUserId)
      )
    );

    expectApiEnvelope(created);
    expect((created.data as { category?: { createdByUserId?: string } }).category?.createdByUserId).toBe(actorUserId);
    expect(getMemoryRepository("household_lee").read().categories[0]?.createdByUserId).toBe(actorUserId);
  });

  it("returns stable envelope errors for invalid JSON instead of throwing", async () => {
    const invalid = await postTextCapture(rawJsonRequest("http://sayve.test/api/captures/text", "{bad json"));
    const invalidJson = await responseJson(invalid);

    expect(invalid.status).toBe(400);
    expectApiEnvelope(invalidJson);
    expect(invalidJson.current_state).toBe("invalid_json_body");
    expect(invalidJson.needs_user_input).toBe(true);
  });

  it("treats empty JSON bodies as safe defaults for low-friction capture", async () => {
    const capture = await responseJson(await postTextCapture(rawJsonRequest("http://sayve.test/api/captures/text", "")));

    expectApiEnvelope(capture);
    expect(capture.needs_user_input).toBe(false);
    expect((capture.data as { capture?: { rawText?: string } }).capture?.rawText).toBe("");
  });

  it("records fallback telemetry when receipt vision or speech-to-text is unavailable", async () => {
    delete process.env.OPENAI_API_KEY;
    const receiptForm = new FormData();
    receiptForm.set("file", new File(["fake image"], "receipt.png", { type: "image/png" }));
    const receipt = await responseJson(await postReceiptCapture(multipartRequest("http://sayve.test/api/captures/receipt", receiptForm)));
    expectApiEnvelope(receipt);
    expect((receipt.data as { capture?: { fileRefs?: string[]; metadata?: { mediaStored?: boolean; mediaStorageReason?: string } } }).capture).toMatchObject({
      fileRefs: ["receipt.png"],
      metadata: expect.objectContaining({ mediaStored: false, mediaStorageReason: "media_bucket_not_configured" })
    });

    const voiceForm = new FormData();
    voiceForm.set("file", new File(["fake audio"], "voice.webm", { type: "audio/webm" }));
    const voice = await responseJson(await postVoiceCapture(multipartRequest("http://sayve.test/api/captures/voice", voiceForm)));
    expectApiEnvelope(voice);
    expect((voice.data as { capture?: { fileRefs?: string[]; metadata?: { mediaStored?: boolean; mediaStorageReason?: string } } }).capture).toMatchObject({
      fileRefs: ["voice.webm"],
      metadata: expect.objectContaining({ mediaStored: false, mediaStorageReason: "media_bucket_not_configured" })
    });

    const telemetry = getMemoryRepository("household_lee").read().aiTelemetry;
    expect(telemetry).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: "receipt_vision",
          status: "fallback",
          metadata: expect.objectContaining({ reason: "receipt_vision_unavailable", unavailableReason: "openai_not_configured" })
        }),
        expect.objectContaining({
          phase: "speech_to_text",
          status: "fallback",
          metadata: expect.objectContaining({ reason: "speech_to_text_unavailable", unavailableReason: "openai_not_configured" })
        })
      ])
    );
  });

  it("returns stable 413 envelopes for oversized required receipt and voice uploads", async () => {
    process.env.SAYVE_REQUIRE_MEDIA_STORAGE = "1";
    process.env.SUPABASE_MEDIA_BUCKET = "sayve-capture-media";
    process.env.RECEIPT_UPLOAD_MAX_BYTES = "4";
    process.env.VOICE_UPLOAD_MAX_BYTES = "4";

    const receiptForm = new FormData();
    receiptForm.set("file", new File(["large"], "receipt.png", { type: "image/png" }));
    const receiptResponse = await postReceiptCapture(multipartRequest("http://sayve.test/api/captures/receipt", receiptForm));
    const receipt = await responseJson(receiptResponse);

    expect(receiptResponse.status).toBe(413);
    expectApiEnvelope(receipt);
    expect(receipt.current_state).toBe("capture_media_file_too_large");

    const voiceForm = new FormData();
    voiceForm.set("file", new File(["large"], "voice.webm", { type: "audio/webm" }));
    const voiceResponse = await postVoiceCapture(multipartRequest("http://sayve.test/api/captures/voice", voiceForm));
    const voice = await responseJson(voiceResponse);

    expect(voiceResponse.status).toBe(413);
    expectApiEnvelope(voice);
    expect(voice.current_state).toBe("capture_media_file_too_large");
  });

  it("records provider-error latency for receipt vision and speech-to-text attempts", async () => {
    process.env.OPENAI_API_KEY = "test-openai-key";

    const receiptForm = new FormData();
    receiptForm.set("file", new File(["fake image"], "receipt.png", { type: "image/png" }));
    const receipt = await responseJson(await postReceiptCapture(multipartRequest("http://sayve.test/api/captures/receipt", receiptForm)));
    expectApiEnvelope(receipt);

    const voiceForm = new FormData();
    voiceForm.set("file", new File(["fake audio"], "voice.webm", { type: "audio/webm" }));
    const voice = await responseJson(await postVoiceCapture(multipartRequest("http://sayve.test/api/captures/voice", voiceForm)));
    expectApiEnvelope(voice);

    const telemetry = getMemoryRepository("household_lee").read().aiTelemetry;
    expect(telemetry).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: "receipt_vision",
          status: "error",
          captureId: expect.any(String),
          memoryObjectId: expect.any(String),
          durationMs: expect.any(Number),
          metadata: expect.objectContaining({ unavailableReason: "receipt_vision_provider_error" })
        }),
        expect.objectContaining({
          phase: "speech_to_text",
          status: "error",
          captureId: expect.any(String),
          memoryObjectId: expect.any(String),
          durationMs: expect.any(Number),
          metadata: expect.objectContaining({ unavailableReason: "speech_to_text_provider_error" })
        })
      ])
    );
    expect(telemetry.find((event) => event.phase === "receipt_vision")?.durationMs).toBeGreaterThan(0);
    expect(telemetry.find((event) => event.phase === "speech_to_text")?.durationMs).toBeGreaterThan(0);
  });

  it("lets two household members capture into the same family memory", async () => {
    const householdId = "household_lee";
    const fred = await responseJson(
      await postTextCapture(householdJsonRequest("http://sayve.test/api/captures/text", { text: "今日大家樂 HK$42" }, householdId, "fred"))
    );
    const partner = await responseJson(
      await postTextCapture(householdJsonRequest("http://sayve.test/api/captures/text", { text: "百佳買餸 HK$120" }, householdId, "partner"))
    );

    expectApiEnvelope(fred);
    expectApiEnvelope(partner);
    expect((fred.data as { capture?: { householdId?: string; createdBy?: string; metadata?: { actorUserId?: string } } }).capture?.householdId).toBe(
      householdId
    );
    expect((fred.data as { capture?: { createdBy?: string } }).capture?.createdBy).toBe("fred");
    expect((partner.data as { capture?: { createdBy?: string; metadata?: { actorUserId?: string } } }).capture?.createdBy).toBe("partner");
    expect((partner.data as { capture?: { metadata?: { actorUserId?: string } } }).capture?.metadata?.actorUserId).toBe("partner");

    const answer = await responseJson(
      await postConversationAsk(
        householdJsonRequest("http://sayve.test/api/conversation/ask", { question: "今個月屋企用咗幾多？" }, householdId, "partner")
      )
    );
    expectApiEnvelope(answer);
    expect((answer.data as { question?: { createdBy?: string } }).question?.createdBy).toBe("partner");

    const dashboard = await responseJson(
      await getDashboardView(new Request("http://sayve.test/api/views/dashboard", { headers: { "x-household-id": householdId, "x-user-id": "fred" } }))
    );
    expectApiEnvelope(dashboard);
    expect((dashboard.data as { factCount?: number }).factCount).toBe(2);
    const monthlyFacts = (dashboard.data as { monthlyFacts?: Array<{ createdBy?: string; ownershipScope?: string }> }).monthlyFacts ?? [];
    expect(monthlyFacts.map((fact) => fact.createdBy).sort()).toEqual(["fred", "partner"]);
    expect(monthlyFacts.map((fact) => fact.ownershipScope).sort()).toEqual(["shared", "shared"]);
  });

  it("keeps simultaneous household member captures in one shared memory", async () => {
    const householdId = "household_lee";
    const [fred, partner] = await Promise.all([
      postTextCapture(householdJsonRequest("http://sayve.test/api/captures/text", { text: "午餐 HK$58" }, householdId, "fred")),
      postTextCapture(householdJsonRequest("http://sayve.test/api/captures/text", { text: "超市 HK$260" }, householdId, "partner"))
    ]).then((responses) => Promise.all(responses.map(responseJson)));

    expectApiEnvelope(fred);
    expectApiEnvelope(partner);
    expect((fred.data as { capture?: { createdBy?: string } }).capture?.createdBy).toBe("fred");
    expect((partner.data as { capture?: { createdBy?: string } }).capture?.createdBy).toBe("partner");

    const dashboard = await responseJson(
      await getDashboardView(new Request("http://sayve.test/api/views/dashboard", { headers: { "x-household-id": householdId, "x-user-id": "fred" } }))
    );
    expectApiEnvelope(dashboard);
    expect((dashboard.data as { factCount?: number }).factCount).toBe(2);
  });

  it("does not expose memory objects across households", async () => {
    const householdA = await responseJson(
      await postTextCapture(householdJsonRequest("http://sayve.test/api/captures/text", { text: "A 家庭食飯 HK$42" }, "household_a", "fred"))
    );
    const householdB = await responseJson(
      await postTextCapture(householdJsonRequest("http://sayve.test/api/captures/text", { text: "B 家庭買餸 HK$120" }, "household_b", "lan"))
    );

    expectApiEnvelope(householdA);
    expectApiEnvelope(householdB);
    const memoryAId = householdA.memory_object_id;
    expect(typeof memoryAId).toBe("string");

    const sameHousehold = await responseJson(
      await getMemoryById(new Request("http://sayve.test/api/memory/mem", { headers: { "x-household-id": "household_a", "x-user-id": "fred" } }), {
        params: Promise.resolve({ id: String(memoryAId) })
      })
    );
    expect(sameHousehold.memory_object_id).toBe(memoryAId);

    const otherHousehold = await responseJson(
      await getMemoryById(new Request("http://sayve.test/api/memory/mem", { headers: { "x-household-id": "household_b", "x-user-id": "lan" } }), {
        params: Promise.resolve({ id: String(memoryAId) })
      })
    );
    expect(otherHousehold.memory_object_id).toBeNull();
    expect(otherHousehold.data).toBeNull();
  });

  it("keeps context confirmation and split requests household-scoped and envelope-shaped", async () => {
    const householdId = "household_lee";
    const capture = await responseJson(
      await postTextCapture(householdJsonRequest("http://sayve.test/api/captures/text", { text: "今日大家樂 HK$42" }, householdId, "fred"))
    );
    const memoryObjectId = capture.memory_object_id;

    const split = await responseJson(
      await postSplitMemory(
        householdJsonRequest(
          "http://sayve.test/api/memory/split",
          { memoryObjectId, reason: "This should be two events." },
          householdId,
          "fred"
        )
      )
    );
    expectApiEnvelope(split);
    expect(split.current_state).toBe("split_requested");
    expect(split.memory_object_id).toBe(memoryObjectId);

    const missingContext = await responseJson(
      await postConfirmContext(householdJsonRequest("http://sayve.test/api/context/confirm", { contextId: "ctx_missing" }, householdId, "fred"))
    );
    expectApiEnvelope(missingContext);
    expect(missingContext.current_state).toBe("context_confirm_missing");
    expect(missingContext.needs_user_input).toBe(true);
  });

  it("keeps health public-safe and launch readiness admin-gated", async () => {
    process.env.ADMIN_CONSOLE_TOKEN = "secret";

    const healthResponse = await getHealth();
    expectNoStore(healthResponse);
    const health = await responseJson(healthResponse);
    expect(health.ok).toBe(true);
    expect(health.app).toBe("sayve");
    expect(health).not.toHaveProperty("SUPABASE_SERVICE_ROLE_KEY");

    const unauthorized = await getLaunchReadiness(new Request("http://sayve.test/api/admin/launch-readiness"));
    expect(unauthorized.status).toBe(401);

    const queryToken = await getLaunchReadiness(new Request("http://sayve.test/api/admin/launch-readiness?token=secret"));
    expect(queryToken.status).toBe(401);

    const readiness = await responseJson(
      await getLaunchReadiness(new Request("http://sayve.test/api/admin/launch-readiness", { headers: { "x-admin-token": "secret" } }))
    );
    expect(readiness).toHaveProperty("readyForPublicLaunch");
    expect(Array.isArray(readiness.checks)).toBe(true);
    expect(
      (readiness.checks as Array<{ id?: string; detail?: unknown }>).find((check) => check.id === "supabase_schema_security")?.detail
    ).toEqual(expect.any(String));
  });

  it("marks founder/admin data responses as no-store", async () => {
    process.env.ADMIN_CONSOLE_TOKEN = "secret";

    const readiness = await getLaunchReadiness(new Request("http://sayve.test/api/admin/launch-readiness", { headers: { cookie: "sayve_admin=secret" } }));
    expect(readiness.headers.get("cache-control")).toContain("no-store");
    expect(readiness.headers.get("x-robots-tag")).toBe("noindex");

    const exportResponse = await getAdminExport(new Request("http://sayve.test/api/admin/export?table=facts", { headers: { cookie: "sayve_admin=secret" } }));
    expect(exportResponse.headers.get("cache-control")).toContain("no-store");
    expect(exportResponse.headers.get("content-type")).toContain("text/csv");
  });

  it("can export founder raw tables and readable views as JSON", async () => {
    process.env.ADMIN_CONSOLE_TOKEN = "secret";

    const rawResponse = await getAdminExport(
      new Request("http://sayve.test/api/admin/export?scope=raw&name=facts&format=json", { headers: { cookie: "sayve_admin=secret" } })
    );
    expect(rawResponse.headers.get("cache-control")).toContain("no-store");
    expect(rawResponse.headers.get("content-type")).toContain("application/json");
    const rawJson = await responseJson(rawResponse);
    expect(rawJson.scope).toBe("raw");
    expect(rawJson.name).toBe("facts");
    expect(Array.isArray(rawJson.rows)).toBe(true);

    const viewResponse = await getAdminExport(
      new Request("http://sayve.test/api/admin/export?scope=view&name=schemaDictionary&format=json", { headers: { cookie: "sayve_admin=secret" } })
    );
    expect(viewResponse.headers.get("cache-control")).toContain("no-store");
    expect(viewResponse.headers.get("content-type")).toContain("application/json");
    const viewJson = await responseJson(viewResponse);
    expect(viewJson.scope).toBe("view");
    expect(viewJson.name).toBe("schemaDictionary");
    expect(Array.isArray(viewJson.rows)).toBe(true);

    const bundleResponse = await getAdminExport(
      new Request("http://sayve.test/api/admin/export?scope=bundle&name=setup&format=json", { headers: { cookie: "sayve_admin=secret" } })
    );
    expect(bundleResponse.headers.get("cache-control")).toContain("no-store");
    expect(bundleResponse.headers.get("content-type")).toContain("application/json");
    const bundleJson = (await responseJson(bundleResponse)) as {
      scope: string;
      name: string;
      bundle: {
        generatedAt: string;
        signature: string;
        launchReadinessChecks: Array<{ id: string; status: string }>;
        nextActions: unknown[];
        views: Record<string, unknown>;
      };
    };
    expect(bundleJson.scope).toBe("bundle");
    expect(bundleJson.name).toBe("setup");
    expect(bundleJson.bundle).toHaveProperty("generatedAt");
    expect(bundleJson.bundle).toHaveProperty("signature");
    expect(Array.isArray(bundleJson.bundle.launchReadinessChecks)).toBe(true);
    expect(bundleJson.bundle).toHaveProperty("nextActions");
    expect(bundleJson.bundle.views).toHaveProperty("launchCompletionAudit");
    expect(bundleJson.bundle.views).toHaveProperty("launchBlockers");
    expect(bundleJson.bundle.views).toHaveProperty("liveProofGaps");
    expect(bundleJson.bundle.views).toHaveProperty("deployEnvTemplate");
    expect(bundleJson.bundle.views).toHaveProperty("deploySmokeEnvTemplate");
    expect(bundleJson.bundle.views).toHaveProperty("repositorySmokeGuide");
    expect(bundleJson.bundle.views).toHaveProperty("publicLaunchChecks");
    expect(bundleJson.bundle.views).toHaveProperty("migrationInventory");
    expect(bundleJson.bundle.views).toHaveProperty("schemaMigrationProof");
    expect(bundleJson.bundle.views).toHaveProperty("privateBetaSetupGate");
    expect(bundleJson.bundle.views).toHaveProperty("executionChecklist");
    expect(bundleJson.bundle.views).toHaveProperty("onboardingProofSteps");
    expect(bundleJson.bundle.views).toHaveProperty("integrationReadiness");
    expect(bundleJson.bundle.views).toHaveProperty("integrationPackage");
    expect(bundleJson.bundle.views).toHaveProperty("providerSetup");
    expect(
      (bundleJson.bundle.views.schemaMigrationProof as Array<Record<string, unknown>>).some((row) => row.view === "applied_migration")
    ).toBe(true);

    const integrationBundleResponse = await getAdminExport(
      new Request("http://sayve.test/api/admin/export?scope=bundle&name=integration&format=json", { headers: { cookie: "sayve_admin=secret" } })
    );
    expect(integrationBundleResponse.headers.get("cache-control")).toContain("no-store");
    const integrationBundleJson = (await responseJson(integrationBundleResponse)) as {
      scope: string;
      name: string;
      bundle: {
        generatedAt: string;
        signature: string;
        views: Record<string, unknown>;
      };
    };
    expect(integrationBundleJson.scope).toBe("bundle");
    expect(integrationBundleJson.name).toBe("integration");
    expect(integrationBundleJson.bundle).toHaveProperty("generatedAt");
    expect(integrationBundleJson.bundle).toHaveProperty("signature");
    expect(integrationBundleJson.bundle.views).toHaveProperty("integrationReadiness");
    expect(integrationBundleJson.bundle.views).toHaveProperty("integrationPackage");
    expect(integrationBundleJson.bundle.views).toHaveProperty("liveProofGaps");
    expect(integrationBundleJson.bundle.views).toHaveProperty("onboardingProofSteps");
    expect(integrationBundleJson.bundle.views).toHaveProperty("oauthChecklist");
    expect(integrationBundleJson.bundle.views).toHaveProperty("providerSetup");
    expect(integrationBundleJson.bundle.views).toHaveProperty("migrationInventory");
    expect(integrationBundleJson.bundle.views).toHaveProperty("schemaMigrationProof");
    expect(
      ((integrationBundleJson.bundle.views.schemaMigrationProof as Array<Record<string, unknown>>) ?? []).some(
        (row) => row.view === "applied_migration"
      )
    ).toBe(true);

    const liveProofBundleResponse = await getAdminExport(
      new Request("http://sayve.test/api/admin/export?scope=bundle&name=live-proof&format=json", { headers: { cookie: "sayve_admin=secret" } })
    );
    expect(liveProofBundleResponse.headers.get("cache-control")).toContain("no-store");
    const liveProofBundleJson = (await responseJson(liveProofBundleResponse)) as {
      scope: string;
      name: string;
      bundle: {
        generatedAt: string;
        signature: string;
        commands: Record<string, string>;
        views: Record<string, unknown>;
      };
    };
    expect(liveProofBundleJson.scope).toBe("bundle");
    expect(liveProofBundleJson.name).toBe("live-proof");
    expect(liveProofBundleJson.bundle).toHaveProperty("generatedAt");
    expect(liveProofBundleJson.bundle).toHaveProperty("signature");
    expect(liveProofBundleJson.bundle.commands.strictPrivateBeta).toContain("pnpm run verify:deploy:strict-private-beta");
    expect(liveProofBundleJson.bundle.commands.strictPrivateBetaProof).toContain("pnpm run verify:deploy:strict-private-beta:proof");
    expect(liveProofBundleJson.bundle.views).toHaveProperty("liveProofGaps");
    expect(liveProofBundleJson.bundle.views).toHaveProperty("onboardingProofSteps");
    expect(liveProofBundleJson.bundle.views).toHaveProperty("publicLaunchChecks");
    expect(liveProofBundleJson.bundle.views).toHaveProperty("migrationInventory");
    expect(liveProofBundleJson.bundle.views).toHaveProperty("schemaMigrationProof");
    expect(liveProofBundleJson.bundle.views).toHaveProperty("deployEnvTemplate");
    expect(liveProofBundleJson.bundle.views).toHaveProperty("deploySmokeEnvTemplate");
    expect(liveProofBundleJson.bundle.views).toHaveProperty("smokeTokenGuide");
    expect(
      ((liveProofBundleJson.bundle.views.schemaMigrationProof as Array<Record<string, unknown>>) ?? []).some(
        (row) => row.view === "applied_migration"
      )
    ).toBe(true);
  });

  it("can return a founder setup bundle as no-store JSON", async () => {
    process.env.ADMIN_CONSOLE_TOKEN = "secret";

    const response = await getFounderSetupBundle(
      new Request("http://sayve.test/api/admin/founder/setup-bundle", { headers: { cookie: "sayve_admin=secret" } })
    );

    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-type")).toContain("application/json");
    const json = await responseJson(response);
    const bundle = json as {
      launchReadinessChecks: Array<{ id: string; status: string }>;
      commands: { privateBeta: string; strictPrivateBeta: string; strictPrivateBetaProof: string; publicLaunch: string };
      views: Record<string, unknown>;
    };
    expect(json).toHaveProperty("generatedAt");
    expect(json).toHaveProperty("signature");
    expect(json).toHaveProperty("launchReadiness");
    expect(Array.isArray(bundle.launchReadinessChecks)).toBe(true);
    expect(json).toHaveProperty("defaultHouseholdBinding");
    expect(json).toHaveProperty("onboardingHealth");
    expect(Array.isArray((json as { nextActions?: unknown }).nextActions)).toBe(true);
    expect(bundle.commands.privateBeta).toContain("pnpm run verify:deploy:private-beta");
    expect(bundle.commands.strictPrivateBeta).toContain("pnpm run verify:deploy:strict-private-beta");
    expect(bundle.commands.strictPrivateBetaProof).toContain("pnpm run verify:deploy:strict-private-beta:proof");
    expect(bundle.commands.publicLaunch).toContain("pnpm run verify:deploy:public-launch");
    expect(bundle.views).toHaveProperty("envTemplate");
    expect(bundle.views).toHaveProperty("deployEnvTemplate");
    expect(bundle.views).toHaveProperty("deploySmokeEnvTemplate");
    expect(bundle.views).toHaveProperty("repositorySmokeGuide");
    expect(bundle.views).toHaveProperty("publicLaunchChecks");
    expect(bundle.views).toHaveProperty("migrationInventory");
    expect(bundle.views).toHaveProperty("privateBetaSetupGate");
    expect(bundle.views).toHaveProperty("executionChecklist");
    expect(bundle.views).toHaveProperty("integrationReadiness");
    expect(bundle.views).toHaveProperty("integrationPackage");
    expect(bundle.views).toHaveProperty("providerSetup");
    expect(bundle.views).toHaveProperty("oauthChecklist");
    expect(bundle.views).toHaveProperty("smokeTokenGuide");
    expect(bundle.views).toHaveProperty("launchCompletionAudit");
    expect(bundle.views).toHaveProperty("launchBlockers");
    expect(
      ((bundle.views.schemaMigrationProof as Array<Record<string, unknown>>) ?? []).some((row) => row.view === "applied_migration")
    ).toBe(true);
    expect((json as { signature?: string }).signature).toMatch(/^[a-f0-9]{64}$/);
  });

  it("requires explicit founder confirmation before normalized Supabase import load writes", async () => {
    process.env.ADMIN_CONSOLE_TOKEN = "secret";

    const blocked = await postSupabaseImportLoad(
      new Request("http://sayve.test/api/admin/import/supabase/load", {
        method: "POST",
        headers: { cookie: "sayve_admin=secret", "content-type": "application/json" },
        body: JSON.stringify({})
      })
    );

    expect(blocked.status).toBe(409);
    expect(blocked.headers.get("cache-control")).toContain("no-store");
    const blockedJson = await responseJson(blocked);
    expect(blockedJson.loaded).toBe(false);
    expect(blockedJson.requiresConfirmation).toBe(true);
    expect(typeof blockedJson.planSignature).toBe("string");
  });

  it("keeps repository smoke test accepting optional target household input with stable invalid-json handling", async () => {
    process.env.ADMIN_CONSOLE_TOKEN = "secret";

    const invalid = await postRepositorySmokeTest(
      new Request("http://sayve.test/api/admin/repository/smoke-test", {
        method: "POST",
        headers: { cookie: "sayve_admin=secret", "content-type": "application/json" },
        body: "[1,2,3]"
      })
    );
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get("cache-control")).toContain("no-store");
    const invalidJson = await responseJson(invalid);
    expect(invalidJson.error).toBe("invalid_json_body");

    const targeted = await postRepositorySmokeTest(
      new Request("http://sayve.test/api/admin/repository/smoke-test", {
        method: "POST",
        headers: { cookie: "sayve_admin=secret", "content-type": "application/json" },
        body: JSON.stringify({ householdId: "household_target" })
      })
    );
    expect(targeted.headers.get("cache-control")).toContain("no-store");
    const targetedJson = await responseJson(targeted);
    expect(targetedJson.targetHouseholdId).toBe("household_target");
    expect(targetedJson).toHaveProperty("householdExists");
    expect(targetedJson).toHaveProperty("memberCount");
    expect(targetedJson).toHaveProperty("ownerCount");
    expect(targetedJson).toHaveProperty("viewerCount");
    expect(targetedJson).toHaveProperty("onboarding");
  });

  it("marks household onboarding responses as no-store because they can contain invite tokens", async () => {
    process.env.ADMIN_CONSOLE_TOKEN = "secret";

    const create = await postCreateHousehold(adminJsonRequest("http://sayve.test/api/households/create", { name: "Lee Home" }));
    expect(create.status).toBe(400);
    expect(create.headers.get("cache-control")).toContain("no-store");
    expect(create.headers.get("x-robots-tag")).toBe("noindex");

    const invite = await postCreateInvite(adminJsonRequest("http://sayve.test/api/households/invite", { email: "partner@example.com" }));
    expect(invite.status).toBe(400);
    expect(invite.headers.get("cache-control")).toContain("no-store");
    expect(invite.headers.get("x-robots-tag")).toBe("noindex");

    const accept = await postAcceptInvite(jsonRequest("http://sayve.test/api/households/invite/accept", {}));
    expect(accept.status).toBe(400);
    expect(accept.headers.get("cache-control")).toContain("no-store");
    expect(accept.headers.get("x-robots-tag")).toBe("noindex");
  });

  it("can require login before accepting household writes", async () => {
    process.env.SUPABASE_AUTH_REQUIRED = "1";

    const response = await postTextCapture(jsonRequest("http://sayve.test/api/captures/text", { text: "今日大家樂 HK$42" }));
    const json = await responseJson(response);

    expect(response.status).toBe(401);
    expectApiEnvelope(json);
    expect(json.current_state).toBe("auth_required");
  });

  it("lets two family members write one shared household memory while preserving attribution", async () => {
    const householdId = "household_lee";

    await postTextCapture(householdJsonRequest("http://sayve.test/api/captures/text", { text: "今日大家樂 HK$42" }, householdId, "fred"));
    await postTextCapture(householdJsonRequest("http://sayve.test/api/captures/text", { text: "今日百佳 HK$80" }, householdId, "lan"));
    await postConversationAsk(householdJsonRequest("http://sayve.test/api/conversation/ask", { question: "今個月用了幾多？" }, householdId, "lan"));

    const dashboard = await responseJson(
      await getDashboardView(
        new Request("http://sayve.test/api/views/dashboard", {
          headers: {
            "x-household-id": householdId,
            "x-user-id": "fred"
          }
        })
      )
    );
    expect((dashboard.data as { factCount?: number }).factCount).toBe(2);

    const otherDashboard = await responseJson(
      await getDashboardView(
        new Request("http://sayve.test/api/views/dashboard", {
          headers: {
            "x-household-id": "household_other",
            "x-user-id": "outsider"
          }
        })
      )
    );
    expect((otherDashboard.data as { factCount?: number }).factCount).toBe(0);

    const store = getMemoryRepository().read();
    const memberCaptures = store.captures.filter((capture) => capture.householdId === householdId);
    expect(memberCaptures.map((capture) => capture.createdBy).sort()).toEqual(["fred", "lan"]);
    expect(memberCaptures.every((capture) => capture.metadata.actorUserId === capture.createdBy)).toBe(true);

    const userQuestions = store.conversationMessages.filter((message) => message.householdId === householdId && message.role === "user");
    expect(userQuestions).toHaveLength(1);
    expect(userQuestions[0]?.createdBy).toBe("lan");
  });

  it("requires login for context confirmation and memory split when auth is enabled", async () => {
    process.env.SUPABASE_AUTH_REQUIRED = "1";

    const split = await postSplitMemory(jsonRequest("http://sayve.test/api/memory/split", { memoryObjectId: "mem_1" }));
    const splitJson = await responseJson(split);
    expect(split.status).toBe(401);
    expectApiEnvelope(splitJson);

    const confirm = await postConfirmContext(jsonRequest("http://sayve.test/api/context/confirm", { contextId: "ctx_1" }));
    const confirmJson = await responseJson(confirm);
    expect(confirm.status).toBe(401);
    expectApiEnvelope(confirmJson);
  });

  it("exposes household onboarding contracts for shared family login", async () => {
    process.env.ADMIN_CONSOLE_TOKEN = "secret";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const created = await responseJson(
      await postCreateHousehold(adminJsonRequest("http://sayve.test/api/households/create", { name: "Lee Home", ownerUserId: "00000000-0000-0000-0000-000000000001" }))
    );
    expect(created.configured).toBe(false);
    expect(created.ok).toBe(false);
    expect(created.error).toBe("Supabase service env is not configured.");

    const invite = await responseJson(
      await postCreateInvite(
        adminJsonRequest("http://sayve.test/api/households/invite", {
          householdId: "00000000-0000-0000-0000-000000000010",
          email: "partner@example.com",
          role: "member"
        })
      )
    );
    expect(invite.configured).toBe(false);
    expect(invite.ok).toBe(false);

    const accepted = await responseJson(
      await postAcceptInvite(
        new Request("http://sayve.test/api/households/invite/accept", {
          method: "POST",
          headers: { "content-type": "application/json", "x-user-id": "00000000-0000-0000-0000-000000000002" },
          body: JSON.stringify({ token: "invite-token" })
        })
      )
    );
    expect(accepted.configured).toBe(false);
    expect(accepted.ok).toBe(false);
  });

  it("validates household onboarding inputs", async () => {
    process.env.ADMIN_CONSOLE_TOKEN = "secret";

    const missingOwner = await postCreateHousehold(adminJsonRequest("http://sayve.test/api/households/create", { name: "Lee Home" }));
    expect(missingOwner.status).toBe(400);

    const missingHousehold = await postCreateInvite(adminJsonRequest("http://sayve.test/api/households/invite", { email: "partner@example.com" }));
    expect(missingHousehold.status).toBe(400);

    const missingAcceptFields = await postAcceptInvite(jsonRequest("http://sayve.test/api/households/invite/accept", {}));
    expect(missingAcceptFields.status).toBe(400);

    const missingToken = await getInviteStatus(new Request("http://sayve.test/api/households/invite/status"));
    expect(missingToken.status).toBe(400);
  });

  it("does not trust body userId for invite acceptance when real auth is required", async () => {
    process.env.SUPABASE_AUTH_REQUIRED = "1";
    process.env.ADMIN_CONSOLE_TOKEN = "secret";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const malformed = await postAcceptInvite(rawJsonRequest("http://sayve.test/api/households/invite/accept", "{bad json"));
    const malformedJson = await responseJson(malformed);
    expect(malformed.status).toBe(401);
    expect(malformedJson.error).toBe("login bearer token is required unless Founder Console override is used.");

    const spoofed = await postAcceptInvite(
      jsonRequest("http://sayve.test/api/households/invite/accept", {
        token: "invite-token",
        userId: "00000000-0000-0000-0000-000000000002"
      })
    );
    const spoofedJson = await responseJson(spoofed);
    expect(spoofed.status).toBe(401);
    expect(spoofedJson.error).toBe("login bearer token is required unless Founder Console override is used.");

    const founderOverride = await postAcceptInvite(
      adminJsonRequest("http://sayve.test/api/households/invite/accept", {
        token: "invite-token",
        userId: "00000000-0000-0000-0000-000000000002"
      })
    );
    const founderOverrideJson = await responseJson(founderOverride);
    expect(founderOverride.status).toBe(200);
    expect(founderOverrideJson.configured).toBe(false);
    expect(founderOverrideJson.ok).toBe(false);
  });

  it("requires a configured admin token before allowing invite acceptance userId override", async () => {
    process.env.SUPABASE_AUTH_REQUIRED = "1";
    delete process.env.ADMIN_CONSOLE_TOKEN;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const response = await postAcceptInvite(
      jsonRequest("http://sayve.test/api/households/invite/accept", {
        token: "invite-token",
        userId: "00000000-0000-0000-0000-000000000002"
      })
    );
    const json = await responseJson(response);

    expect(response.status).toBe(401);
    expect(json.error).toBe("login bearer token is required unless Founder Console override is used.");
  });

  it("maps invite acceptance errors to stable user-facing status codes", () => {
    expect(inviteAcceptanceStatus({ configured: false, ok: false, error: "missing", errorCode: "supabase_not_configured" })).toBe(200);
    expect(inviteAcceptanceStatus({ configured: true, ok: true, data: { householdId: "household_1" } })).toBe(200);
    expect(inviteAcceptanceStatus({ configured: true, ok: false, error: "not found", errorCode: "invite_not_found" })).toBe(404);
    expect(inviteAcceptanceStatus({ configured: true, ok: false, error: "already", errorCode: "invite_already_accepted" })).toBe(409);
    expect(inviteAcceptanceStatus({ configured: true, ok: false, error: "expired", errorCode: "invite_expired" })).toBe(410);
    expect(inviteAcceptanceStatus({ configured: true, ok: false, error: "invalid", errorCode: "invite_invalid_role" })).toBe(400);
    expect(inviteAcceptanceStatus({ configured: true, ok: false, error: "email missing", errorCode: "invite_email_required" })).toBe(403);
    expect(inviteAcceptanceStatus({ configured: true, ok: false, error: "wrong email", errorCode: "invite_email_mismatch" })).toBe(403);
    expect(inviteAcceptanceStatus({ configured: true, ok: false, error: "db", errorCode: "invite_member_upsert_failed" })).toBe(500);
  });

  it("exposes invite preview contracts before login", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const preview = await getInviteStatus(new Request("http://sayve.test/api/households/invite/status?token=invite-token"));
    const previewJson = await responseJson(preview);
    expect(preview.status).toBe(200);
    expect(previewJson.configured).toBe(false);
    expect(previewJson.ok).toBe(false);
    expectNoStore(preview);
  });

  it("maps invite preview errors to stable user-facing status codes", () => {
    expect(invitePreviewStatus({ configured: false, ok: false, error: "missing", status: "supabase_not_configured" })).toBe(200);
    expect(
      invitePreviewStatus({
        configured: true,
        ok: true,
        status: "pending",
        data: {
          householdId: "household_1",
          householdName: "Lee Home",
          role: "member",
          invitedEmailMasked: "w***@example.com",
          expiresAt: "2026-07-20T00:00:00.000Z"
        }
      })
    ).toBe(200);
    expect(invitePreviewStatus({ configured: true, ok: false, error: "token is required.", status: "missing_token" })).toBe(400);
    expect(invitePreviewStatus({ configured: true, ok: false, error: "missing", status: "invite_not_found" })).toBe(404);
    expect(invitePreviewStatus({ configured: true, ok: false, error: "already", status: "invite_already_accepted" })).toBe(409);
    expect(invitePreviewStatus({ configured: true, ok: false, error: "expired", status: "invite_expired" })).toBe(410);
  });

  it("lists household choices for the current family member", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const missingLogin = await getHouseholds(new Request("http://sayve.test/api/households"));
    expect(missingLogin.status).toBe(401);
    expect(missingLogin.headers.get("cache-control")).toContain("no-store");
    expect(missingLogin.headers.get("x-robots-tag")).toBe("noindex");

    const listedResponse = await getHouseholds(
      new Request("http://sayve.test/api/households", {
        headers: {
          "x-user-id": "fred",
          "x-household-id": "household_lee"
        }
      })
    );
    const listed = await responseJson(listedResponse);
    expect(listed.configured).toBe(false);
    expect((listed.households as Array<{ id: string }>)[0].id).toBe("household_lee");
    expect(listedResponse.headers.get("cache-control")).toContain("no-store");
    expect(listedResponse.headers.get("x-robots-tag")).toBe("noindex");
  });

  it("requires real bearer auth for household listing when Supabase auth is required", async () => {
    process.env.SUPABASE_AUTH_REQUIRED = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const response = await getHouseholds(
      new Request("http://sayve.test/api/households", {
        headers: {
          "x-user-id": "fred",
          "x-household-id": "household_lee"
        }
      })
    );
    const json = await responseJson(response);

    expect(response.status).toBe(401);
    expect(json.error).toBe("login_required");
  });

});
