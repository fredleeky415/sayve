import { describe, expect, it } from "vitest";
import { conversationRequestBody, householdCanWrite, shouldPreserveHouseholdsOnRefreshFailure, shouldRetryApiResult } from "./family-memory-app";

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

  it("keeps the current household state during transient household refresh failures", () => {
    const households = [{ id: "household_lee", name: "LeeFam", role: "owner" }];

    expect(shouldPreserveHouseholdsOnRefreshFailure(households, "temporary_unavailable", 503)).toBe(true);
    expect(shouldPreserveHouseholdsOnRefreshFailure(households, "login_required", 401)).toBe(true);
    expect(shouldPreserveHouseholdsOnRefreshFailure(households, "household_access_denied", 403)).toBe(false);
    expect(shouldPreserveHouseholdsOnRefreshFailure([], "temporary_unavailable", 503)).toBe(false);
  });

  it("treats owner and member as writable but blocks viewer", () => {
    expect(householdCanWrite("owner")).toBe(true);
    expect(householdCanWrite("member")).toBe(true);
    expect(householdCanWrite("viewer")).toBe(false);
    expect(householdCanWrite(undefined)).toBe(false);
  });
});
