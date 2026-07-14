import { describe, expect, it } from "vitest";
import { conversationRequestBody, householdCanWrite, householdReadyForInteraction, shouldPreserveHouseholdsOnRefreshFailure, shouldRefreshViewsAfterResult, shouldRetryApiResult, shouldShowInitialization, swipeDirection } from "./family-memory-app";

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

  it("only changes tabs when the mobile swipe is clearly horizontal", () => {
    expect(swipeDirection(-48, 6, 390)).toBe(1);
    expect(swipeDirection(52, 10, 390)).toBe(-1);
    expect(swipeDirection(20, 1, 390)).toBeNull();
    expect(swipeDirection(-42, 70, 390)).toBeNull();
    expect(swipeDirection(-70, 8, 1024)).toBeNull();
  });

  it("only opens initialization after household loading has truly resolved empty", () => {
    expect(shouldShowInitialization("token", false, 0, "呢個帳戶未加入任何家庭。")).toBe(false);
    expect(shouldShowInitialization("token", true, 1, "呢個帳戶未加入任何家庭。")).toBe(false);
    expect(shouldShowInitialization("token", true, 0, "家庭資料暫時未連上，Sayve 先保留你而家個家庭。")).toBe(false);
    expect(shouldShowInitialization("token", true, 0, "呢個帳戶未加入任何家庭。")).toBe(true);
  });

  it("waits for household resolution before allowing logged-in interactions", () => {
    expect(householdReadyForInteraction("token", false, "")).toBe(false);
    expect(householdReadyForInteraction("token", true, "")).toBe(false);
    expect(householdReadyForInteraction("token", true, "household_lee")).toBe(true);
    expect(householdReadyForInteraction(undefined, false, "")).toBe(true);
  });

  it("refreshes dashboard-facing views only after a successful non-review capture result", () => {
    expect(shouldRefreshViewsAfterResult(null)).toBe(false);
    expect(shouldRefreshViewsAfterResult({ current_state: "capture_received", needs_user_input: false } as never)).toBe(false);
    expect(shouldRefreshViewsAfterResult({ current_state: "capture_failed", needs_user_input: true } as never)).toBe(false);
    expect(shouldRefreshViewsAfterResult({ current_state: "active", needs_user_input: true } as never)).toBe(false);
    expect(shouldRefreshViewsAfterResult({ current_state: "active", needs_user_input: false } as never)).toBe(true);
  });
});
