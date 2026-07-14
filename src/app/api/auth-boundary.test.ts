import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetStore } from "@/server/memory/store";
import { ApiEnvelopeSchema } from "@/shared/memory/types";

const membershipRoles = vi.hoisted(() => new Map<string, string>());
const createdInvites = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const serviceClientAvailable = vi.hoisted(() => ({ current: true }));
const snapshotRows = vi.hoisted(() => new Map<string, { state: unknown; revision: number }>());

vi.mock("@/server/supabase/service-client", () => ({
  createSupabaseAnonClient: () => ({
    auth: {
      async getUser(token: string) {
        return token.startsWith("user:")
          ? { data: { user: { id: token.replace("user:", "") } }, error: null }
          : { data: { user: null }, error: { message: "invalid token" } };
      }
    }
  }),
  getSupabaseServiceConfig: () =>
    serviceClientAvailable.current
      ? {
          url: "https://sayve.test.supabase.co",
          serviceRoleKey: "service-role"
        }
      : undefined,
  createSupabaseServiceClient: () => {
    if (!serviceClientAvailable.current) return undefined;
    return {
    from(table?: string) {
      if (table === "memory_store_snapshots") {
        const filters = new Map<string, unknown>();
        let operation: "select" | "insert" | "update" = "select";
        let insertRow: { household_id: string; state: unknown; revision?: number } | undefined;
        let updatePatch: { state: unknown; revision: number } | undefined;
        const query = {
          select() {
            return query;
          },
          insert(row: { household_id: string; state: unknown; revision?: number }) {
            operation = "insert";
            insertRow = row;
            return query;
          },
          update(patch: { state: unknown; revision: number }) {
            operation = "update";
            updatePatch = patch;
            return query;
          },
          eq(field: string, value: unknown) {
            filters.set(field, value);
            return query;
          },
          async maybeSingle() {
            const householdId = String(filters.get("household_id") ?? "");
            if (operation === "select") {
              return { data: snapshotRows.get(householdId) ?? null, error: null };
            }

            if (operation === "update") {
              const current = snapshotRows.get(householdId);
              if (!current || current.revision !== filters.get("revision")) return { data: null, error: null };
              snapshotRows.set(householdId, { state: updatePatch?.state, revision: updatePatch?.revision ?? current.revision });
              return { data: { revision: updatePatch?.revision ?? current.revision }, error: null };
            }

            return { data: null, error: null };
          },
          async single() {
            if (!insertRow) return { data: null, error: { message: "missing insert row" } };
            if (snapshotRows.has(insertRow.household_id)) {
              return { data: null, error: { code: "23505", message: "duplicate snapshot" } };
            }
            const revision = insertRow.revision ?? 1;
            snapshotRows.set(insertRow.household_id, { state: insertRow.state, revision });
            return { data: { revision }, error: null };
          }
        };
        return query;
      }

      if (table === "invites") {
        return {
          insert(row: Record<string, unknown>) {
            createdInvites.push(row);
            const data = { id: `invite_${createdInvites.length}`, ...row };
            return {
              select() {
                return {
                  async single() {
                    return { data, error: null };
                  }
                };
              }
            };
          }
        };
      }

      const filters = new Map<string, unknown>();
      const query = {
        select() {
          return query;
        },
        eq(field: string, value: unknown) {
          filters.set(field, value);
          return query;
        },
        async maybeSingle() {
          const householdId = String(filters.get("household_id") ?? "");
          const userId = String(filters.get("user_id") ?? "");
          const role = membershipRoles.get(`${householdId}:${userId}`);
          return { data: role ? { role } : null, error: null };
        }
      };
      return query;
    }
  };
  }
}));

function bearerRequest(method: "GET" | "POST", url: string, userId: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: {
      authorization: `Bearer user:${userId}`,
      "x-household-id": "household_lee",
      ...(body ? { "content-type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

function bearerRequestWithoutHousehold(method: "GET" | "POST", url: string, userId: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: {
      authorization: `Bearer user:${userId}`,
      ...(body ? { "content-type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

function invalidMultipartRequest(url: string): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "multipart/form-data; boundary=sayve"
    },
    body: "this is intentionally not valid multipart data"
  });
}

function invalidJsonRequest(url: string): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: "{bad json"
  });
}

async function responseJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

function expectApiEnvelope(value: unknown) {
  const parsed = ApiEnvelopeSchema.safeParse(value);
  expect(parsed.success).toBe(true);
}

describe("route auth boundary", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetStore();
    membershipRoles.clear();
    createdInvites.length = 0;
    snapshotRows.clear();
    serviceClientAvailable.current = true;
    process.env.SUPABASE_AUTH_REQUIRED = "1";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("lets household members write memory through actual capture routes", async () => {
    membershipRoles.set("household_lee:partner", "member");
    const { POST: postTextCapture } = await import("./captures/text/route");

    const response = await postTextCapture(
      bearerRequest("POST", "http://sayve.test/api/captures/text", "partner", {
        text: "百佳買餸 HK$120"
      })
    );
    const json = await responseJson(response);

    expect(response.status).toBe(200);
    expectApiEnvelope(json);
    expect(json.current_state).toBe("active");
    expect((json.data as { capture?: { createdBy?: string } }).capture?.createdBy).toBe("partner");
  });

  it("accepts householdId from request body when the browser has not synced the household header yet", async () => {
    membershipRoles.set("household_lee:partner", "member");
    const { POST: postTextCapture } = await import("./captures/text/route");

    const response = await postTextCapture(
      bearerRequestWithoutHousehold("POST", "http://sayve.test/api/captures/text", "partner", {
        householdId: "household_lee",
        text: "自己食晏 128"
      })
    );
    const json = await responseJson(response);

    expect(response.status).toBe(200);
    expectApiEnvelope(json);
    expect(json.current_state).toBe("active");
    expect((json.data as { capture?: { householdId?: string; createdBy?: string } }).capture?.householdId).toBe("household_lee");
    expect((json.data as { capture?: { householdId?: string; createdBy?: string } }).capture?.createdBy).toBe("partner");
  });

  it("lets two logged-in household members capture at the same time into one shared memory", async () => {
    membershipRoles.set("household_lee:fred", "owner");
    membershipRoles.set("household_lee:partner", "member");
    const [{ POST: postTextCapture }, { GET: getDashboardView }] = await Promise.all([
      import("./captures/text/route"),
      import("./views/dashboard/route")
    ]);

    const [fred, partner] = await Promise.all([
      postTextCapture(
        bearerRequest("POST", "http://sayve.test/api/captures/text", "fred", {
          text: "午餐 HK$58"
        })
      ),
      postTextCapture(
        bearerRequest("POST", "http://sayve.test/api/captures/text", "partner", {
          text: "超市 HK$260"
        })
      )
    ]).then((responses) => Promise.all(responses.map(responseJson)));

    expectApiEnvelope(fred);
    expectApiEnvelope(partner);
    expect(fred.current_state).toBe("active");
    expect(partner.current_state).toBe("active");

    const dashboard = await getDashboardView(bearerRequest("GET", "http://sayve.test/api/views/dashboard", "fred"));
    const dashboardJson = await responseJson(dashboard);
    expect(dashboard.status).toBe(200);
    expectApiEnvelope(dashboardJson);
    expect((dashboardJson.data as { factCount?: number }).factCount).toBe(2);
  });

  it("lets viewers read dashboard but blocks capture writes", async () => {
    membershipRoles.set("household_lee:viewer", "viewer");
    const [{ GET: getDashboardView }, { POST: postTextCapture }] = await Promise.all([
      import("./views/dashboard/route"),
      import("./captures/text/route")
    ]);

    const dashboard = await getDashboardView(bearerRequest("GET", "http://sayve.test/api/views/dashboard", "viewer"));
    const dashboardJson = await responseJson(dashboard);
    expect(dashboard.status).toBe(200);
    expectApiEnvelope(dashboardJson);
    expect(dashboardJson.current_state).toBe("dashboard_view");

    const write = await postTextCapture(
      bearerRequest("POST", "http://sayve.test/api/captures/text", "viewer", {
        text: "午餐 HK$58"
      })
    );
    const writeJson = await responseJson(write);
    expect(write.status).toBe(403);
    expectApiEnvelope(writeJson);
    expect(writeJson.current_state).toBe("household_write_denied");
  });

  it("rejects authenticated reads without an explicit household id", async () => {
    membershipRoles.set("household_lee:fred", "owner");
    process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID = "household_lee";
    const { GET: getDashboardView } = await import("./views/dashboard/route");

    const response = await getDashboardView(bearerRequestWithoutHousehold("GET", "http://sayve.test/api/views/dashboard", "fred"));
    const json = await responseJson(response);

    expect(response.status).toBe(400);
    expectApiEnvelope(json);
    expect(json.current_state).toBe("household_required");
  });

  it("does not fall back to a prototype household list when service storage is unavailable in real auth mode", async () => {
    serviceClientAvailable.current = false;
    const { GET: getHouseholds } = await import("./households/route");

    const response = await getHouseholds(
      new Request("http://sayve.test/api/households", {
        headers: {
          authorization: "Bearer user:fred"
        }
      })
    );
    const json = await responseJson(response);

    expect(response.status).toBe(503);
    expect(json).toEqual({
      configured: false,
      ok: false,
      error: "temporary_unavailable",
      households: []
    });
  });

  it("returns temporary_unavailable when real auth mode is enabled but storage is still local", async () => {
    membershipRoles.set("household_lee:partner", "member");
    serviceClientAvailable.current = false;
    process.env.SAYVE_ENFORCE_STORAGE_BOUNDARY_IN_TEST = "1";
    delete process.env.MEMORY_REPOSITORY;
    const { POST: postTextCapture } = await import("./captures/text/route");

    const response = await postTextCapture(
      bearerRequest("POST", "http://sayve.test/api/captures/text", "partner", {
        text: "百佳買餸 HK$120"
      })
    );
    const json = await responseJson(response);

    expect(response.status).toBe(503);
    expectApiEnvelope(json);
    expect(json.current_state).toBe("temporary_unavailable");

    process.env.MEMORY_REPOSITORY = "supabase";
    delete process.env.SAYVE_ENFORCE_STORAGE_BOUNDARY_IN_TEST;
  });

  it("rejects unauthenticated receipt and voice uploads before parsing multipart bodies", async () => {
    const [{ POST: postReceiptCapture }, { POST: postVoiceCapture }] = await Promise.all([
      import("./captures/receipt/route"),
      import("./captures/voice/route")
    ]);

    const [receipt, voice] = await Promise.all([
      postReceiptCapture(invalidMultipartRequest("http://sayve.test/api/captures/receipt")),
      postVoiceCapture(invalidMultipartRequest("http://sayve.test/api/captures/voice"))
    ]);
    const [receiptJson, voiceJson] = await Promise.all([responseJson(receipt), responseJson(voice)]);

    expect(receipt.status).toBe(401);
    expect(voice.status).toBe(401);
    expectApiEnvelope(receiptJson);
    expectApiEnvelope(voiceJson);
    expect(receiptJson.current_state).toBe("auth_required");
    expect(voiceJson.current_state).toBe("auth_required");
  });

  it("rejects unauthenticated capture and conversation JSON before parsing malformed bodies", async () => {
    const [{ POST: postTextCapture }, { POST: postConversationAsk }] = await Promise.all([
      import("./captures/text/route"),
      import("./conversation/ask/route")
    ]);

    const [capture, ask] = await Promise.all([
      postTextCapture(invalidJsonRequest("http://sayve.test/api/captures/text")),
      postConversationAsk(invalidJsonRequest("http://sayve.test/api/conversation/ask"))
    ]);
    const [captureJson, askJson] = await Promise.all([responseJson(capture), responseJson(ask)]);

    expect(capture.status).toBe(401);
    expect(ask.status).toBe(401);
    expectApiEnvelope(captureJson);
    expectApiEnvelope(askJson);
    expect(captureJson.current_state).toBe("auth_required");
    expect(askJson.current_state).toBe("auth_required");
  });

  it("rejects unauthenticated private JSON writes before parsing malformed bodies", async () => {
    const [
      receipt,
      voice,
      categories,
      contextUpdate,
      contextConfirm,
      memoryInterpret,
      memoryCorrect,
      memorySplit,
      memoryRedact
    ] = await Promise.all([
      import("./captures/receipt/route"),
      import("./captures/voice/route"),
      import("./categories/route"),
      import("./context/update/route"),
      import("./context/confirm/route"),
      import("./memory/interpret/route"),
      import("./memory/correct/route"),
      import("./memory/split/route"),
      import("./memory/redact/route")
    ]);
    const routes: Array<{ label: string; url: string; post: (request: Request) => Promise<Response> }> = [
      { label: "receipt", url: "http://sayve.test/api/captures/receipt", post: receipt.POST },
      { label: "voice", url: "http://sayve.test/api/captures/voice", post: voice.POST },
      { label: "categories", url: "http://sayve.test/api/categories", post: categories.POST },
      { label: "context update", url: "http://sayve.test/api/context/update", post: contextUpdate.POST },
      { label: "context confirm", url: "http://sayve.test/api/context/confirm", post: contextConfirm.POST },
      { label: "memory interpret", url: "http://sayve.test/api/memory/interpret", post: memoryInterpret.POST },
      { label: "memory correct", url: "http://sayve.test/api/memory/correct", post: memoryCorrect.POST },
      { label: "memory split", url: "http://sayve.test/api/memory/split", post: memorySplit.POST },
      { label: "memory redact", url: "http://sayve.test/api/memory/redact", post: memoryRedact.POST }
    ];

    for (const route of routes) {
      const response = await route.post(invalidJsonRequest(route.url));
      const json = await responseJson(response);

      expect(response.status, route.label).toBe(401);
      expectApiEnvelope(json);
      expect(json.current_state, route.label).toBe("auth_required");
    }
  });

  it("lets a household owner create a partner invite link while blocking non-owners", async () => {
    membershipRoles.set("household_lee:fred", "owner");
    membershipRoles.set("household_lee:partner", "member");
    const { POST: postInviteMember } = await import("./households/members/invite/route");

    const member = await postInviteMember(
      bearerRequest("POST", "http://sayve.test/api/households/members/invite", "partner", {
        email: "wife@example.com"
      })
    );
    const memberJson = await responseJson(member);
    expect(member.status).toBe(403);
    expect(memberJson.error).toContain("Only household owners");

    const owner = await postInviteMember(
      bearerRequest("POST", "http://sayve.test/api/households/members/invite", "fred", {
        email: "wife@example.com"
      })
    );
    const ownerJson = await responseJson(owner);

    expect(owner.status).toBe(200);
    expect(ownerJson.ok).toBe(true);
    expect((ownerJson.data as { inviteUrl?: string }).inviteUrl).toContain("/invite?token=");
    expect(createdInvites[0]).toEqual(expect.objectContaining({ household_id: "household_lee", email: "wife@example.com", role: "member" }));
  });

  it("allows privacy redaction for household writers while blocking viewers", async () => {
    membershipRoles.set("household_lee:fred", "owner");
    membershipRoles.set("household_lee:viewer", "viewer");
    const [{ POST: postTextCapture }, { POST: postPrivacyRedaction }] = await Promise.all([
      import("./captures/text/route"),
      import("./memory/redact/route")
    ]);

    const capture = await postTextCapture(
      bearerRequest("POST", "http://sayve.test/api/captures/text", "fred", {
        text: "私隱測試 HK$88"
      })
    );
    const captureJson = await responseJson(capture);
    const memoryObjectId = String(captureJson.memory_object_id);

    const viewer = await postPrivacyRedaction(
      bearerRequest("POST", "http://sayve.test/api/memory/redact", "viewer", {
        memoryObjectId,
        reason: "privacy request"
      })
    );
    const viewerJson = await responseJson(viewer);
    expect(viewer.status).toBe(403);
    expectApiEnvelope(viewerJson);
    expect(viewerJson.current_state).toBe("household_write_denied");

    const owner = await postPrivacyRedaction(
      bearerRequest("POST", "http://sayve.test/api/memory/redact", "fred", {
        memoryObjectId,
        reason: "privacy request"
      })
    );
    const ownerJson = await responseJson(owner);
    expect(owner.status).toBe(200);
    expectApiEnvelope(ownerJson);
    expect(ownerJson.current_state).toBe("privacy_redacted");
  });
});
