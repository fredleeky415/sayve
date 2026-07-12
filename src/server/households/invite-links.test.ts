import { afterEach, describe, expect, it } from "vitest";
import { inviteLinksForRequest } from "./invite-links";

const originalEnv = { ...process.env };

describe("household invite links", () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("builds a partner-facing invite link from the request origin", () => {
    delete process.env.APP_ACCESS_TOKEN;

    const links = inviteLinksForRequest(new Request("https://sayve.test/api/households/invite"), "invite token");

    expect(links).toEqual({
      invitePath: "/invite?token=invite%20token",
      inviteUrl: "https://sayve.test/invite?token=invite%20token"
    });
  });

  it("uses forwarded host/proto and includes a private beta invite URL when configured", () => {
    process.env.APP_ACCESS_TOKEN = "private beta";

    const links = inviteLinksForRequest(
      new Request("http://127.0.0.1:3000/api/households/invite", {
        headers: {
          "x-forwarded-host": "app.sayve.test",
          "x-forwarded-proto": "https"
        }
      }),
      "abc123"
    );

    expect(links.inviteUrl).toBe("https://app.sayve.test/invite?token=abc123");
    expect(links.privateBetaInviteUrl).toBe("https://app.sayve.test/invite?token=abc123&access_token=private+beta");
  });

  it("prefers NEXT_PUBLIC_APP_URL as the stable invite origin when configured", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://sayve.app";
    process.env.APP_ACCESS_TOKEN = "private beta";

    const links = inviteLinksForRequest(
      new Request("http://127.0.0.1:3000/api/households/invite", {
        headers: {
          "x-forwarded-host": "preview.sayve.vercel.app",
          "x-forwarded-proto": "https"
        }
      }),
      "abc123"
    );

    expect(links.inviteUrl).toBe("https://sayve.app/invite?token=abc123");
    expect(links.privateBetaInviteUrl).toBe("https://sayve.app/invite?token=abc123&access_token=private+beta");
  });
});
