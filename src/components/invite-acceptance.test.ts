import { describe, expect, it } from "vitest";
import { inviteAcceptanceMessage } from "./invite-acceptance";

describe("invite acceptance messages", () => {
  it("maps stable invite acceptance codes into human messages", () => {
    expect(inviteAcceptanceMessage("invite_not_found")).toBe("搵唔到呢條 invite。");
    expect(inviteAcceptanceMessage("invite_already_accepted")).toBe("呢條 invite 已經用過。");
    expect(inviteAcceptanceMessage("invite_expired")).toBe("呢條 invite 已過期，請叫 founder 重發。");
    expect(inviteAcceptanceMessage("invite_email_required")).toBe("呢條 invite 綁咗指定 email，請用受邀嗰個 Google / email 登入。");
    expect(inviteAcceptanceMessage("invite_email_mismatch")).toBe("你而家登入嘅 email 同 invite 唔一致，請轉返受邀嗰個帳戶。");
  });

  it("falls back gracefully for unexpected errors", () => {
    expect(inviteAcceptanceMessage("unknown_code", "raw backend error")).toBe("raw backend error");
    expect(inviteAcceptanceMessage(undefined, "")).toBe("暫時加入唔到家庭。");
  });
});
