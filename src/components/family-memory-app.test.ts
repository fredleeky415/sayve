import { describe, expect, it } from "vitest";
import { conversationRequestBody, shouldRetryApiResult } from "./family-memory-app";

describe("family memory app conversation routing", () => {
  it("always carries the selected household into ask requests", () => {
    expect(conversationRequestBody("上個月食飯用咗幾多？", "household_lee")).toEqual({
      question: "上個月食飯用咗幾多？",
      householdId: "household_lee"
    });
  });

  it("retries only transient capture failures", () => {
    expect(shouldRetryApiResult({ current_state: "temporary_unavailable" }, 503)).toBe(true);
    expect(shouldRetryApiResult({ current_state: "temporary_unavailable" }, 200)).toBe(true);
    expect(shouldRetryApiResult({ current_state: "household_access_denied" }, 403)).toBe(false);
    expect(shouldRetryApiResult({ current_state: "active" }, 200)).toBe(false);
  });
});
