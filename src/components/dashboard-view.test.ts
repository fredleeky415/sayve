import { describe, expect, it } from "vitest";
import { looksLikeUuid, ownershipLabel, readableMemberLabel } from "./dashboard-view";

describe("dashboard ownership labels", () => {
  it("treats raw auth uuids as implementation detail instead of user-facing labels", () => {
    expect(looksLikeUuid("cb1b7bac-380f-4a5f-9753-40d515fc4ff1")).toBe(true);
    expect(readableMemberLabel("cb1b7bac-380f-4a5f-9753-40d515fc4ff1")).toBe("");
    expect(
      ownershipLabel({
        id: "fact_1",
        date: "2026-07-14",
        title: "自己食晏 128",
        category: "Dining",
        amount: 128,
        direction: "expense",
        ownershipScope: "member",
        assignedMember: "actor",
        createdBy: "cb1b7bac-380f-4a5f-9753-40d515fc4ff1"
      })
    ).toBe("自己");
  });

  it("still shows shared and readable partner labels", () => {
    expect(
      ownershipLabel({
        id: "fact_2",
        date: "2026-07-14",
        title: "OK便利店",
        category: "Groceries",
        amount: 20,
        direction: "expense",
        ownershipScope: "shared",
        createdBy: "partner"
      })
    ).toBe("公家");

    expect(
      ownershipLabel({
        id: "fact_3",
        date: "2026-07-14",
        title: "太太買咖啡",
        category: "Dining",
        amount: 42,
        direction: "expense",
        ownershipScope: "member",
        assignedMember: "partner"
      })
    ).toBe("另一位成員 自己");
  });
});
