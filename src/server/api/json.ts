import { noStoreJson } from "@/server/api/http";

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (!text.trim()) return {};

  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("json_body_must_be_object");
  }

  return parsed as Record<string, unknown>;
}

export function invalidJsonResponse(init: ResponseInit = {}) {
  return noStoreJson(
    {
      memory_object_id: null,
      confidence: 0,
      source_refs: [],
      current_state: "invalid_json_body",
      needs_user_input: true,
      next_best_question: "請重新送出一次。",
      data: {}
    },
    {
      ...init,
      status: init.status ?? 400
    }
  );
}

export function unexpectedApiErrorResponse(init: ResponseInit = {}) {
  return noStoreJson(
    {
      memory_object_id: null,
      confidence: 0,
      source_refs: [],
      current_state: "temporary_unavailable",
      needs_user_input: true,
      next_best_question: "暫時未儲到，稍後再試一次。",
      data: {
        error: "unexpected_server_error"
      }
    },
    {
      ...init,
      status: init.status ?? 503
    }
  );
}
