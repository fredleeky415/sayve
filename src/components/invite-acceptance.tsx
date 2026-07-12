"use client";

import { CheckCircle2, LoaderCircle, Mail, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { authStorageKeys, browserInviteRedirectUrl, getBrowserSupabaseClient, storeBrowserSession, type BrowserSession } from "./auth-client";

export function InviteAcceptance({ inviteToken }: { inviteToken: string }) {
  const [invitePreview, setInvitePreview] = useState<{
    loading: boolean;
    status: "idle" | "pending" | "invite_not_found" | "invite_expired" | "invite_already_accepted" | "supabase_not_configured";
    message: string;
    householdName: string;
    role: string;
    invitedEmailMasked: string;
    expiresAt: string;
  }>({
    loading: Boolean(inviteToken),
    status: "idle",
    message: "",
    householdName: "",
    role: "",
    invitedEmailMasked: "",
    expiresAt: ""
  });
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [session, setSession] = useState<BrowserSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [acceptedHouseholdId, setAcceptedHouseholdId] = useState("");
  const previousUserIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!inviteToken) {
      setInvitePreview({
        loading: false,
        status: "idle",
        message: "呢條 invite link 無 token。",
        householdName: "",
        role: "",
        invitedEmailMasked: "",
        expiresAt: ""
      });
      return;
    }

    let cancelled = false;
    setInvitePreview((current) => ({ ...current, loading: true, message: "" }));
    void fetch(`/api/households/invite/status?token=${encodeURIComponent(inviteToken)}`)
      .then(async (response) => {
        const result = (await response.json()) as
          | {
              ok?: true;
              status?: "pending";
              data?: {
                householdName?: string;
                role?: string;
                invitedEmailMasked?: string;
                expiresAt?: string;
              };
            }
          | {
              ok?: false;
              status?: "invite_not_found" | "invite_expired" | "invite_already_accepted" | "supabase_not_configured";
              error?: string;
            };

        if (cancelled) return;
        if (result.ok && result.status === "pending") {
          setInvitePreview({
            loading: false,
            status: "pending",
            message: "",
            householdName: result.data?.householdName ?? "Family Memory",
            role: result.data?.role ?? "member",
            invitedEmailMasked: result.data?.invitedEmailMasked ?? "",
            expiresAt: result.data?.expiresAt ?? ""
          });
          return;
        }

        const status = result.status ?? "invite_not_found";
        const message =
          status === "invite_expired"
            ? "呢條 invite 已過期，請叫 founder 重發。"
            : status === "invite_already_accepted"
              ? "呢條 invite 已經用過。"
              : status === "supabase_not_configured"
                ? "Supabase Auth 未設定，暫時未可以接受邀請。"
                : "搵唔到呢條 invite。";

        setInvitePreview({
          loading: false,
          status,
          message,
          householdName: "",
          role: "",
          invitedEmailMasked: "",
          expiresAt: ""
        });
      })
      .catch(() => {
        if (cancelled) return;
        setInvitePreview({
          loading: false,
          status: "invite_not_found",
          message: "暫時讀唔到 invite。",
          householdName: "",
          role: "",
          invitedEmailMasked: "",
          expiresAt: ""
        });
      });

    return () => {
      cancelled = true;
    };
  }, [inviteToken]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    let mounted = true;
    let unsubscribe: (() => void) | undefined;
    void getBrowserSupabaseClient().then(async (client) => {
      if (!mounted || !client) return;
      const { data } = await client.auth.getSession();
      const next = storeBrowserSession(data.session);
      if (mounted) setSession(next);
      const subscription = client.auth.onAuthStateChange((_event, nextSession) => {
        const synced = storeBrowserSession(nextSession);
        setSession(synced);
      });
      unsubscribe = () => subscription.data.subscription.unsubscribe();
    });
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    const previousUserId = previousUserIdRef.current;
    const currentUserId = session?.userId;

    if (!currentUserId) {
      setAcceptedHouseholdId("");
    } else if (previousUserId && previousUserId !== currentUserId) {
      setAcceptedHouseholdId("");
      setMessage("");
    }

    previousUserIdRef.current = currentUserId;
  }, [session?.userId]);

  async function sendMagicLink() {
    setMessage("");
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setMessage("輸入 email 先可以登入。");
      return;
    }
    const client = await getBrowserSupabaseClient();
    if (!client) {
      setMessage("Supabase Auth 未設定，暫時未可以接受邀請。");
      return;
    }
    const redirectTo = browserInviteRedirectUrl(inviteToken);
    const { error } = await client.auth.signInWithOtp({
      email: trimmedEmail,
      options: { emailRedirectTo: redirectTo }
    });
    setMessage(error ? error.message : "Magic link 已寄出，登入後會返到呢頁。");
  }

  async function signInWithGoogle() {
    setMessage("");
    const client = await getBrowserSupabaseClient();
    if (!client) {
      setMessage("Supabase Auth 未設定，暫時未可以接受邀請。");
      return;
    }
    const redirectTo = browserInviteRedirectUrl(inviteToken);
    const { error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo }
    });
    if (error) setMessage(error.message);
  }

  async function acceptInvite() {
    if (!inviteToken) {
      setMessage("Invite link 無 token。");
      return;
    }
    if (!session?.accessToken) {
      setMessage("請先登入，然後再加入家庭。");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/households/invite/accept", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.accessToken}`
        },
        body: JSON.stringify({ token: inviteToken })
      });
      const result = (await response.json()) as { ok?: boolean; error?: string; data?: { householdId?: string; role?: string } };
      if (!response.ok || !result.ok) {
        setMessage(result.error ?? "暫時加入唔到家庭。");
        return;
      }
      const householdId = result.data?.householdId ?? "";
      if (householdId) window.localStorage.setItem(authStorageKeys.householdId, householdId);
      setAcceptedHouseholdId(householdId);
      setMessage(result.data?.role === "viewer" ? "已加入，只讀權限。" : "已加入家庭記憶。");
    } catch {
      setMessage("暫時連唔到 Sayve。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="inviteShell">
      <section className="inviteCard">
        <div className="inviteIcon">
          <Users size={22} />
        </div>
        <p>Sayve Family Invite</p>
        <h1>加入家庭記憶</h1>
        <span>你會用自己 login，但同屋企人寫入同一份 Sayve Memory。</span>

        {invitePreview.loading ? (
          <div className="inviteNotice">檢查 invite 中...</div>
        ) : invitePreview.householdName ? (
          <div className="inviteMeta">
            <strong>{invitePreview.householdName}</strong>
            <span>
              {invitePreview.role}
              {invitePreview.invitedEmailMasked ? ` · ${invitePreview.invitedEmailMasked}` : ""}
            </span>
          </div>
        ) : null}

        {invitePreview.message && <div className="inviteNotice">{invitePreview.message}</div>}

        {session ? (
          <div className="inviteSignedIn">
            <CheckCircle2 size={18} />
            <span>{session.email ?? "已登入"}</span>
          </div>
        ) : (
          <div className="inviteLoginStack">
            <button type="button" className="inviteOAuthButton" onClick={signInWithGoogle}>
              用 Google 登入
            </button>
            <div className="inviteLoginRow">
              <label className="inviteInputWrap">
                <Mail size={16} />
                <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="email" />
              </label>
              <button type="button" onClick={sendMagicLink}>
                Link
              </button>
            </div>
          </div>
        )}

        <button
          className="invitePrimary"
          type="button"
          onClick={acceptInvite}
          disabled={busy || !inviteToken || !session?.accessToken || Boolean(acceptedHouseholdId) || invitePreview.status !== "pending"}
        >
          {busy ? <LoaderCircle size={17} className="spin" /> : <CheckCircle2 size={17} />}
          {acceptedHouseholdId ? "已加入" : "加入家庭"}
        </button>

        {message && <div className="inviteNotice">{message}</div>}

        {acceptedHouseholdId && (
          <Link className="inviteContinue" href="/">
            開始用 Sayve
          </Link>
        )}
      </section>
    </main>
  );
}
