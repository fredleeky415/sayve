import { describe, expect, it } from "vitest";
import { publicApiErrorFromUnknown, unexpectedApiErrorResponse } from "./json";

async function responseJson(response: Response) {
  return (await response.json()) as {
    current_state: string;
    next_best_question: string;
    data: { error: string };
  };
}

describe("public api error mapping", () => {
  it("maps repository failures to a clearer memory repository unavailable state", async () => {
    const response = unexpectedApiErrorResponse(new Error("supabase_memory_repository_commit_failed:permission denied"));
    const json = await responseJson(response);

    expect(response.status).toBe(503);
    expect(json.current_state).toBe("memory_repository_unavailable");
    expect(json.next_best_question).toBe("家庭記憶暫時未連上，稍後再試一次。");
    expect(json.data.error).toBe("memory_repository_unavailable");
  });

  it("keeps media-specific fallback wording for generic receipt and voice failures", async () => {
    const receipt = await responseJson(unexpectedApiErrorResponse(new Error("boom"), {}, { captureLabel: "receipt" }));
    const voice = await responseJson(unexpectedApiErrorResponse(new Error("boom"), {}, { captureLabel: "voice" }));

    expect(receipt.next_best_question).toBe("暫時未儲到收據相，稍後再試一次。");
    expect(voice.next_best_question).toBe("暫時未儲到錄音，稍後再試一次。");
  });

  it("exposes a stable generic mapping helper for non-error inputs", () => {
    expect(publicApiErrorFromUnknown(undefined)).toEqual({
      status: 503,
      currentState: "temporary_unavailable",
      nextBestQuestion: "暫時未儲到，稍後再試一次。",
      errorCode: "unexpected_server_error"
    });
  });
});
