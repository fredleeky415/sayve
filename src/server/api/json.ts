import { noStoreJson } from "@/server/api/http";

type UnexpectedApiErrorOptions = {
  captureLabel?: "text" | "receipt" | "voice" | "conversation";
};

function fallbackQuestionForCaptureLabel(label?: UnexpectedApiErrorOptions["captureLabel"]) {
  if (label === "receipt") return "暫時未儲到收據相，稍後再試一次。";
  if (label === "voice") return "暫時未儲到錄音，稍後再試一次。";
  if (label === "conversation") return "暫時未答到，稍後再試一次。";
  return "暫時未儲到，稍後再試一次。";
}

export function publicApiErrorFromUnknown(error: unknown, options: UnexpectedApiErrorOptions = {}) {
  const message = error instanceof Error ? error.message : "";

  if (
    message === "production_storage_boundary_violation" ||
    message === "supabase_memory_repository_not_configured" ||
    message.startsWith("supabase_memory_repository_read_failed:") ||
    message.startsWith("supabase_memory_repository_commit_failed:")
  ) {
    return {
      status: 503,
      currentState: "memory_repository_unavailable",
      nextBestQuestion: "家庭記憶暫時未連上，稍後再試一次。",
      errorCode: "memory_repository_unavailable"
    };
  }

  return {
    status: 503,
    currentState: "temporary_unavailable",
    nextBestQuestion: fallbackQuestionForCaptureLabel(options.captureLabel),
    errorCode: "unexpected_server_error"
  };
}

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

export function unexpectedApiErrorResponse(error?: unknown, init: ResponseInit = {}, options: UnexpectedApiErrorOptions = {}) {
  const mapped = publicApiErrorFromUnknown(error, options);
  return noStoreJson(
    {
      memory_object_id: null,
      confidence: 0,
      source_refs: [],
      current_state: mapped.currentState,
      needs_user_input: true,
      next_best_question: mapped.nextBestQuestion,
      data: {
        error: mapped.errorCode
      }
    },
    {
      ...init,
      status: init.status ?? mapped.status
    }
  );
}
