import { describe, expect, it } from "vitest";
import { conversationRequestBody } from "./family-memory-app";

describe("family memory app conversation routing", () => {
  it("always carries the selected household into ask requests", () => {
    expect(conversationRequestBody("上個月食飯用咗幾多？", "household_lee")).toEqual({
      question: "上個月食飯用咗幾多？",
      householdId: "household_lee"
    });
  });
});
