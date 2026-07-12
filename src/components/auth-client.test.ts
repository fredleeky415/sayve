import { afterEach, describe, expect, it } from "vitest";
import { authStorageKeys, browserAuthRedirectOrigin, browserInviteRedirectUrl, storeBrowserSession } from "./auth-client";

function createLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    },
    clear() {
      store.clear();
    }
  };
}

describe("auth client storage handoff", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  it("clears the stored household when the signed-in user changes", () => {
    const localStorage = createLocalStorage();
    Object.defineProperty(globalThis, "window", {
      value: { localStorage },
      configurable: true
    });

    localStorage.setItem(authStorageKeys.userId, "fred");
    localStorage.setItem(authStorageKeys.householdId, "household_fred");

    storeBrowserSession({
      access_token: "token_partner",
      user: { id: "partner", email: "partner@example.com" }
    });

    expect(localStorage.getItem(authStorageKeys.householdId)).toBeNull();
    expect(localStorage.getItem(authStorageKeys.userId)).toBe("partner");
  });

  it("clears the stored household when the browser session is removed", () => {
    const localStorage = createLocalStorage();
    Object.defineProperty(globalThis, "window", {
      value: { localStorage },
      configurable: true
    });

    localStorage.setItem(authStorageKeys.token, "token_fred");
    localStorage.setItem(authStorageKeys.userId, "fred");
    localStorage.setItem(authStorageKeys.userEmail, "fred@example.com");
    localStorage.setItem(authStorageKeys.householdId, "household_fred");

    storeBrowserSession(null);

    expect(localStorage.getItem(authStorageKeys.token)).toBeNull();
    expect(localStorage.getItem(authStorageKeys.userId)).toBeNull();
    expect(localStorage.getItem(authStorageKeys.userEmail)).toBeNull();
    expect(localStorage.getItem(authStorageKeys.householdId)).toBeNull();
  });

  it("prefers NEXT_PUBLIC_APP_URL for auth redirects when configured", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://sayve.app/welcome";

    expect(browserAuthRedirectOrigin()).toBe("https://sayve.app");
    expect(browserInviteRedirectUrl("invite token")).toBe("https://sayve.app/invite?token=invite%20token");
  });

  it("falls back to window origin for auth redirects when app url is unset", () => {
    const localStorage = createLocalStorage();
    Object.defineProperty(globalThis, "window", {
      value: { localStorage, location: { origin: "http://127.0.0.1:3000" } },
      configurable: true
    });

    expect(browserAuthRedirectOrigin()).toBe("http://127.0.0.1:3000");
    expect(browserInviteRedirectUrl("abc")).toBe("http://127.0.0.1:3000/invite?token=abc");
  });
});
