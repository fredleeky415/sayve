"use client";

export type BrowserSession = { accessToken: string; userId: string; email?: string };

type SupabaseSessionLike = { access_token: string; user: { id: string; email?: string } };

type SupabaseBrowserClient = {
  auth: {
    getSession(): Promise<{ data: { session: SupabaseSessionLike | null } }>;
    onAuthStateChange(callback: (event: string, session: SupabaseSessionLike | null) => void): {
      data: { subscription: { unsubscribe(): void } };
    };
    signInWithOtp(input: { email: string; options?: { emailRedirectTo?: string } }): Promise<{ error?: { message: string } | null }>;
    signInWithOAuth(input: { provider: "google"; options?: { redirectTo?: string } }): Promise<{ error?: { message: string } | null }>;
    signOut(): Promise<{ error?: { message: string } | null }>;
  };
};

export const authStorageKeys = {
  token: "sayve_access_token",
  userId: "sayve_user_id",
  userEmail: "sayve_user_email",
  householdId: "sayve_household_id",
  prototypeUserId: "sayve_prototype_user_id"
};

let browserSupabasePromise: Promise<SupabaseBrowserClient | null> | null = null;

export function supabaseBrowserConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

function normalizeAppUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    return new URL(trimmed).origin;
  } catch {
    return "";
  }
}

export function browserAuthRedirectOrigin(): string {
  const configured = normalizeAppUrl(process.env.NEXT_PUBLIC_APP_URL ?? "");
  if (configured) return configured;
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

export function browserInviteRedirectUrl(inviteToken: string): string {
  const origin = browserAuthRedirectOrigin();
  if (!origin) return `/invite?token=${encodeURIComponent(inviteToken)}`;
  return `${origin}/invite?token=${encodeURIComponent(inviteToken)}`;
}

export async function getBrowserSupabaseClient(): Promise<SupabaseBrowserClient | null> {
  if (!supabaseBrowserConfigured()) return null;
  if (!browserSupabasePromise) {
    browserSupabasePromise = import("@supabase/supabase-js").then(({ createClient }) =>
      createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "")
    ) as Promise<SupabaseBrowserClient>;
  }
  return browserSupabasePromise;
}

export function storeBrowserSession(nextSession: SupabaseSessionLike | null): BrowserSession | null {
  if (typeof window === "undefined") return null;
  if (!nextSession) {
    window.localStorage.removeItem(authStorageKeys.token);
    window.localStorage.removeItem(authStorageKeys.userId);
    window.localStorage.removeItem(authStorageKeys.userEmail);
    window.localStorage.removeItem(authStorageKeys.householdId);
    return null;
  }

  const previousUserId = window.localStorage.getItem(authStorageKeys.userId);
  const session = {
    accessToken: nextSession.access_token,
    userId: nextSession.user.id,
    email: nextSession.user.email
  };
  if (previousUserId && previousUserId !== session.userId) {
    window.localStorage.removeItem(authStorageKeys.householdId);
  }
  window.localStorage.setItem(authStorageKeys.token, session.accessToken);
  window.localStorage.setItem(authStorageKeys.userId, session.userId);
  if (session.email) window.localStorage.setItem(authStorageKeys.userEmail, session.email);
  else window.localStorage.removeItem(authStorageKeys.userEmail);
  return session;
}

export function clearStoredBrowserAuth(options: { household?: boolean } = {}) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(authStorageKeys.token);
  window.localStorage.removeItem(authStorageKeys.userId);
  window.localStorage.removeItem(authStorageKeys.userEmail);
  if (options.household) window.localStorage.removeItem(authStorageKeys.householdId);
}

export function storedAuthHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const headers: Record<string, string> = {};
  const token = window.localStorage.getItem(authStorageKeys.token);
  const userId = token ? undefined : window.localStorage.getItem(authStorageKeys.prototypeUserId) ?? window.localStorage.getItem(authStorageKeys.userId);
  const householdId = window.localStorage.getItem(authStorageKeys.householdId);
  if (token) headers.authorization = `Bearer ${token}`;
  if (userId) headers["x-user-id"] = userId;
  if (householdId) headers["x-household-id"] = householdId;
  return headers;
}
