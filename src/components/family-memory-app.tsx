"use client";

import dynamic from "next/dynamic";
import { Camera, CheckCircle2, CircleHelp, LoaderCircle, LogOut, Mail, Mic, Send, Square, Users, X } from "lucide-react";
import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import {
  authStorageKeys,
  browserAuthRedirectOrigin,
  clearStoredBrowserAuth,
  getBrowserSupabaseClient,
  storedAuthHeaders,
  storeBrowserSession,
  supabaseBrowserConfigured,
  type BrowserSession
} from "./auth-client";
import { looksLikeQuestion } from "@/shared/memory/intent";

const DashboardView = dynamic(() => import("./dashboard-view").then((module) => module.DashboardView), {
  ssr: false,
  loading: () => <section className="dashboardView"><p className="emptyState">準備總覽...</p></section>
});

type ApiResult = {
  memory_object_id: string | null;
  confidence: number | null;
  source_refs: Array<{ type: string; id: string; label?: string; strength: string }>;
  current_state: string | null;
  needs_user_input: boolean;
  next_best_question?: string;
  data?: unknown;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  evidence?: {
    intent: string;
    retrievalType: string;
    period: string;
    factCount: number;
    contextCount: number;
    sourceCount: number;
  };
};

type Tab = "home" | "chat" | "dashboard";
type CaptureMode = "text" | "photo" | "voice";
type VoiceStatus = "idle" | "recording" | "ready";
type HouseholdOption = { id: string; name: string; role: string };
type HouseholdStatus = {
  householdId: string;
  householdName: string;
  role: string;
  memberCount: number;
  ownerCount: number;
  memberRoleCount: number;
  viewerCount: number;
  currentUserId: string;
  members: Array<{ label: string; role: string; isCurrentUser: boolean }>;
  pendingInvites: Array<{ email: string; role: string; expiresAt: string }>;
  pendingInviteCount: number;
  acceptedInviteCount: number;
  expiredInviteCount: number;
};
type InitStep = 0 | 1 | 2;
type RecordedVoice = { blob: Blob; fileName: string; mimeType: string };
type InitialInviteState = { email: string; link: string; householdName: string };
const tabOrder: Tab[] = ["chat", "home", "dashboard"];
const transientApiStates = new Set(["temporary_unavailable"]);

const capturePlaceholders = [
  "例如：家庭聚餐 HK$3000",
  "例如：BB 睇醫生 HK$680",
  "例如：今個月開始唔使再畀 Netflix",
  "例如：搬屋買咗窗簾 HK$1200",
  "例如：車保續保 HK$6200",
  "例如：姐姐人工 HK$4,990",
  "例如：阿仔報興趣班 HK$1800",
  "例如：屋企冷氣維修 HK$900",
  "例如：收到銀行利息 HK$1,056",
  "例如：今個月多咗幾次打車",
  "例如：百佳買餸 HK$428.5",
  "例如：今日喺大家樂食飯 HK$300"
];

function randomPlaceholder(current?: string) {
  const options = capturePlaceholders.filter((placeholder) => placeholder !== current);
  const pool = options.length > 0 ? options : capturePlaceholders;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function conversationRequestBody(question: string, householdId: string) {
  return { question, householdId };
}

export function shouldRetryApiResult(result: Partial<ApiResult> | null | undefined, status?: number) {
  return status === 503 || Boolean(result?.current_state && transientApiStates.has(result.current_state));
}

export function shouldPreserveHouseholdsOnRefreshFailure(existingHouseholds: HouseholdOption[], error?: string, status?: number) {
  if (existingHouseholds.length === 0) return false;
  return status === 503 || error === "temporary_unavailable" || error === "login_required";
}

export function householdCanWrite(role?: string) {
  return role === "owner" || role === "member";
}

export function swipeDirection(deltaX: number, deltaY: number, viewportWidth: number): -1 | 1 | null {
  if (viewportWidth > 720) return null;
  if (Math.abs(deltaX) < 32 || Math.abs(deltaY) > Math.abs(deltaX) * 1.15) return null;
  return deltaX > 0 ? -1 : 1;
}

async function pause(ms: number) {
  await new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function parseApiResult(response: Response) {
  const payload = (await response.json()) as Partial<ApiResult> & { error?: string; protection?: { vercel_auth_enabled?: boolean } };
  if (
    typeof payload.current_state === "string" &&
    typeof payload.needs_user_input === "boolean" &&
    "confidence" in payload &&
    "source_refs" in payload
  ) {
    return { payload: payload as ApiResult, status: response.status };
  }
  if (payload.error === "private_beta_access_required" || payload.protection?.vercel_auth_enabled) {
    return { payload: captureFailedResult("私測登入好似過期咗，重新開一次 Sayve 入口再試。"), status: response.status };
  }
  return { payload: captureFailedResult(), status: response.status };
}

async function postJson(path: string, body: Record<string, unknown>) {
  let lastResult: ApiResult | null = null;
  let lastStatus: number | undefined;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", ...storedAuthHeaders() },
      body: JSON.stringify(body)
    });
    const { payload, status } = await parseApiResult(response);
    lastResult = payload;
    lastStatus = status;
    if (!shouldRetryApiResult(payload, status) || attempt === 1) return payload;
    await pause(240);
  }

  return lastResult ?? captureFailedResult(lastStatus === 503 ? "暫時未儲到，稍後再試一次。" : undefined);
}

function confidenceText(result: ApiResult) {
  if (result.current_state === "capture_received") return "Sayved.";
  if (result.current_state === "capture_failed") return result.next_best_question ?? "未送出，再試一次。";
  if (result.needs_user_input) return result.next_best_question ?? "我需要你補充少少資料。";
  if ((result.confidence ?? 0) >= 0.82) return "Sayved.";
  return "Sayved. 我會之後再整理。";
}

function captureReceivedResult(label: string): ApiResult {
  return {
    memory_object_id: null,
    confidence: null,
    source_refs: [],
    current_state: "capture_received",
    needs_user_input: false,
    data: { label }
  };
}

function captureFailedResult(question = "未送出，再試一次。"): ApiResult {
  return {
    memory_object_id: null,
    confidence: null,
    source_refs: [],
    current_state: "capture_failed",
    needs_user_input: true,
    next_best_question: question
  };
}

function memoryAccessIssue(session: BrowserSession | null, householdId: string) {
  if (!supabaseBrowserConfigured()) return "";
  if (!session?.accessToken) return "請先登入 Sayve。";
  if (!householdId) return "請先選擇家庭。";
  return "";
}

function evidenceFromResult(result: ApiResult): ChatMessage["evidence"] {
  const data = result.data as
    | {
        evidencePack?: {
          intent?: string;
          retrievalType?: string;
          period?: { label?: string };
          facts?: unknown[];
          contexts?: unknown[];
        };
      }
    | undefined;
  const pack = data?.evidencePack;
  if (!pack) return undefined;
  return {
    intent: pack.intent ?? "memory",
    retrievalType: pack.retrievalType ?? "retrieval",
    period: pack.period?.label ?? "current",
    factCount: pack.facts?.length ?? 0,
    contextCount: pack.contexts?.length ?? 0,
    sourceCount: result.source_refs.length
  };
}

export function FamilyMemoryApp() {
  const showPrototypeLogin = !supabaseBrowserConfigured();
  const [activeTab, setActiveTab] = useState<Tab>("home");
  const [captureMode, setCaptureMode] = useState<CaptureMode>("text");
  const [text, setText] = useState("");
  const [capturePlaceholder, setCapturePlaceholder] = useState(capturePlaceholders[0]);
  const [pendingPhotos, setPendingPhotos] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<Array<{ file: File; url: string }>>([]);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("idle");
  const [voiceSeconds, setVoiceSeconds] = useState(0);
  const [recordedVoice, setRecordedVoice] = useState<RecordedVoice | null>(null);
  const [latest, setLatest] = useState<ApiResult | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [homeProcessingCount, setHomeProcessingCount] = useState(0);
  const [authOpen, setAuthOpen] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [session, setSession] = useState<BrowserSession | null>(null);
  const [households, setHouseholds] = useState<HouseholdOption[]>([]);
  const [selectedHouseholdId, setSelectedHouseholdId] = useState("");
  const [householdStatus, setHouseholdStatus] = useState<HouseholdStatus | null>(null);
  const [prototypeUserId, setPrototypeUserId] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [inviteCopied, setInviteCopied] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [initStep, setInitStep] = useState<InitStep>(0);
  const [initName, setInitName] = useState("Family Memory");
  const [initCurrency, setInitCurrency] = useState("HKD");
  const [initInviteMode, setInitInviteMode] = useState<"solo" | "partner">("solo");
  const [initPartnerEmail, setInitPartnerEmail] = useState("");
  const [initialInviteState, setInitialInviteState] = useState<InitialInviteState | null>(null);
  const [initBusy, setInitBusy] = useState(false);
  const swipeStartRef = useRef<{ x: number; y: number; lastX: number; lastY: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoPreviewsRef = useRef(photoPreviews);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const selectedHousehold = households.find((household) => household.id === selectedHouseholdId);
  const selectedHouseholdCanWrite = householdCanWrite(selectedHousehold?.role);

  useEffect(() => {
    setCapturePlaceholder(randomPlaceholder());
  }, []);

  function syncBrowserSession(nextSession: Parameters<typeof storeBrowserSession>[0]) {
    setSession(storeBrowserSession(nextSession));
  }

  async function refreshHouseholdStatus(householdIdOverride?: string) {
    const householdId = householdIdOverride ?? selectedHouseholdId;
    if (!householdId) {
      setHouseholdStatus(null);
      return;
    }

    try {
      const response = await fetch(`/api/households/status?householdId=${encodeURIComponent(householdId)}`, {
        credentials: "same-origin",
        headers: storedAuthHeaders()
      });
      const result = (await response.json()) as {
        ok?: boolean;
        data?: HouseholdStatus;
      };
      if (!response.ok || !result.ok || !result.data) return;
      setHouseholdStatus(result.data);
    } catch {
      // Keep the last good status visible during transient failures.
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const savedHouseholdId = window.localStorage.getItem(authStorageKeys.householdId) ?? "";
    const savedPrototypeUserId = window.localStorage.getItem(authStorageKeys.prototypeUserId) ?? "";
    const savedToken = window.localStorage.getItem(authStorageKeys.token);
    const savedUserId = window.localStorage.getItem(authStorageKeys.userId);
    const savedEmail = window.localStorage.getItem(authStorageKeys.userEmail) ?? undefined;
    setSelectedHouseholdId(savedHouseholdId);
    setPrototypeUserId(savedPrototypeUserId);
    if (savedToken && savedUserId) setSession({ accessToken: savedToken, userId: savedUserId, email: savedEmail });

    let mounted = true;
    let unsubscribe: (() => void) | undefined;
    void getBrowserSupabaseClient().then(async (client) => {
      if (!mounted || !client) return;
      const { data } = await client.auth.getSession();
      if (mounted) syncBrowserSession(data.session);
      const subscription = client.auth.onAuthStateChange((_event, nextSession) => {
        syncBrowserSession(nextSession);
      });
      unsubscribe = () => subscription.data.subscription.unsubscribe();
    });

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (selectedHouseholdId) window.localStorage.setItem(authStorageKeys.householdId, selectedHouseholdId);
  }, [selectedHouseholdId]);

  useEffect(() => {
    if (!session?.email) return;
    const local = session.email.split("@")[0]?.trim();
    if (!local) return;
    const cleaned = local.replace(/[._-]+/g, " ").trim();
    const titled = cleaned
      .split(" ")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
    if (!titled) return;
    setInitName((current) => (current === "Family Memory" ? `${titled} Family` : current));
  }, [session?.email]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (prototypeUserId) window.localStorage.setItem(authStorageKeys.prototypeUserId, prototypeUserId);
    else window.localStorage.removeItem(authStorageKeys.prototypeUserId);
  }, [prototypeUserId]);

  useEffect(() => {
    if (session?.accessToken || prototypeUserId) return;
    setHouseholds([]);
    setSelectedHouseholdId("");
    setHouseholdStatus(null);
    setInviteLink("");
    setInviteEmail("");
  }, [prototypeUserId, session?.accessToken]);

  async function refreshHouseholds() {
    if (!session?.accessToken && !prototypeUserId) return;
    let finalStatus = 0;
    let result: { households?: HouseholdOption[]; error?: string } = {};

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch("/api/households", { headers: storedAuthHeaders() });
      finalStatus = response.status;
      result = (await response.json()) as { households?: HouseholdOption[]; error?: string };
      if (response.ok || !shouldPreserveHouseholdsOnRefreshFailure(households, result.error, response.status) || attempt === 1) break;
      await pause(240);
    }

    if (finalStatus < 200 || finalStatus >= 300) {
      const nextMessage =
        result.error === "login_required"
          ? "登入狀態剛剛斷咗一下，Sayve 會保留你而家個家庭。"
          : result.error === "temporary_unavailable"
            ? "家庭資料暫時未連上，Sayve 先保留你而家個家庭。"
            : result.error ?? "暫時讀唔到家庭。";
      if (shouldPreserveHouseholdsOnRefreshFailure(households, result.error, finalStatus)) {
        setAuthMessage(nextMessage);
        return;
      }
      setHouseholds([]);
      setSelectedHouseholdId("");
      setAuthMessage(nextMessage);
      return;
    }

    const nextHouseholds = result.households ?? [];
    setHouseholds(nextHouseholds);
    if (nextHouseholds.length === 0) {
      setSelectedHouseholdId("");
      setHouseholdStatus(null);
      setAuthMessage(session?.accessToken ? "呢個帳戶未加入任何家庭。" : "");
      return;
    }

    setAuthMessage("");
    if (nextHouseholds.length > 0 && !nextHouseholds.some((household) => household.id === selectedHouseholdId)) {
      setSelectedHouseholdId(nextHouseholds[0].id);
      void refreshHouseholdStatus(nextHouseholds[0].id);
      return;
    }

    void refreshHouseholdStatus(selectedHouseholdId || nextHouseholds[0].id);
  }

  async function syncBrowserStateFromStorage() {
    if (typeof window === "undefined") return;

    const savedHouseholdId = window.localStorage.getItem(authStorageKeys.householdId) ?? "";
    const savedPrototypeUserId = window.localStorage.getItem(authStorageKeys.prototypeUserId) ?? "";
    const savedToken = window.localStorage.getItem(authStorageKeys.token);
    const savedUserId = window.localStorage.getItem(authStorageKeys.userId);
    const savedEmail = window.localStorage.getItem(authStorageKeys.userEmail) ?? undefined;

    setSelectedHouseholdId(savedHouseholdId);
    setPrototypeUserId(savedPrototypeUserId);

    if (savedToken && savedUserId) {
      setSession({
        accessToken: savedToken,
        userId: savedUserId,
        email: savedEmail
      });
    } else if (!savedPrototypeUserId) {
      setSession(null);
    }
  }

  useEffect(() => {
    void refreshHouseholds();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.accessToken, prototypeUserId]);

  useEffect(() => {
    void refreshHouseholdStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHouseholdId, session?.accessToken, prototypeUserId]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const syncAndRefresh = () => {
      void syncBrowserStateFromStorage().then(() => {
        void refreshHouseholds();
      });
    };

    const handleStorage = (event: StorageEvent) => {
      if (!event.key || Object.values(authStorageKeys).includes(event.key as (typeof authStorageKeys)[keyof typeof authStorageKeys])) {
        syncAndRefresh();
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") syncAndRefresh();
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener("focus", syncAndRefresh);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("focus", syncAndRefresh);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.accessToken, prototypeUserId]);

  async function sendMagicLink() {
    setAuthMessage("");
    const email = authEmail.trim();
    if (!email) {
      setAuthMessage("輸入 email 先可以寄登入 link。");
      return;
    }
    const client = await getBrowserSupabaseClient();
    if (!client) {
      setAuthMessage("Supabase Auth 未設定，暫時用 prototype user id 測試。");
      return;
    }
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: browserAuthRedirectOrigin() || window.location.origin }
    });
    setAuthMessage(error ? error.message : "Magic link 已寄出。");
  }

  async function signInWithGoogle() {
    setAuthMessage("");
    const client = await getBrowserSupabaseClient();
    if (!client) {
      setAuthMessage("Supabase Auth 未設定，暫時用 prototype user id 測試。");
      return;
    }
    const { error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: browserAuthRedirectOrigin() || window.location.origin }
    });
    if (error) setAuthMessage(error.message);
  }

  async function signOut() {
    const client = await getBrowserSupabaseClient();
    await client?.auth.signOut();
    setSession(null);
    setHouseholds([]);
    setSelectedHouseholdId("");
    clearStoredBrowserAuth({ household: true });
  }

  async function createHouseholdInviteLink(input?: { email?: string; householdId?: string; quiet?: boolean }) {
    const email = input?.email?.trim() ?? inviteEmail.trim();
    const householdId = input?.householdId?.trim() ?? selectedHouseholdId;
    if (!input?.quiet) {
      setAuthMessage("");
      setInviteLink("");
      setInviteCopied(false);
    }
    if (!email) {
      if (!input?.quiet) setAuthMessage("輸入太太 email 先可以建立 invite。");
      return { ok: false as const, error: "invite_email_required" };
    }
    if (!householdId) {
      if (!input?.quiet) setAuthMessage("請先選擇家庭。");
      return { ok: false as const, error: "household_required" };
    }

    try {
      const response = await fetch("/api/households/members/invite", {
        method: "POST",
        headers: { "content-type": "application/json", ...storedAuthHeaders() },
        body: JSON.stringify({ householdId, email, role: "member" })
      });
      const result = (await response.json()) as {
        ok?: boolean;
        error?: string;
        data?: { inviteUrl?: string; privateBetaInviteUrl?: string };
      };
      if (!response.ok || !result.ok) {
        if (!input?.quiet) setAuthMessage(result.error ?? "暫時建立唔到邀請。");
        return { ok: false as const, error: result.error ?? "invite_create_failed" };
      }

      const link = result.data?.privateBetaInviteUrl ?? result.data?.inviteUrl ?? "";
      if (!input?.quiet) {
        setInviteLink(link);
        setInviteCopied(false);
        setAuthMessage(link ? "Invite link 已準備好。" : "Invite 已建立。");
      }
      return { ok: true as const, link };
    } catch {
      if (!input?.quiet) setAuthMessage("暫時建立唔到邀請。");
      return { ok: false as const, error: "invite_create_failed" };
    }
  }

  async function inviteHouseholdMember() {
    setInviteBusy(true);
    try {
      const created = await createHouseholdInviteLink();
      if (!created.ok) return;
    } finally {
      setInviteBusy(false);
    }
  }

  async function copyInviteLink() {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setInviteCopied(true);
      setAuthMessage("Invite link 已複製。");
    } catch {
      setInviteCopied(false);
      setAuthMessage("暫時未複製到，先用開啟 invite link。");
    }
  }

  async function bootstrapHousehold() {
    if (!session?.accessToken) return;
    setInitBusy(true);
    setAuthMessage("");
    setInitialInviteState(null);
    try {
      const response = await fetch("/api/households/bootstrap", {
        method: "POST",
        headers: { "content-type": "application/json", ...storedAuthHeaders() },
        body: JSON.stringify({
          name: initName.trim() || "Family Memory",
          defaultCurrency: initCurrency,
          locale: "zh-Hant-HK"
        })
      });
      const result = (await response.json()) as {
        ok?: boolean;
        error?: string;
        household?: HouseholdOption;
      };
      if (!response.ok || !result.ok || !result.household?.id) {
        setAuthMessage(result.error ?? "暫時開唔到第一個家庭。");
        return;
      }
      setHouseholds([result.household]);
      setSelectedHouseholdId(result.household.id);
      if (initInviteMode === "partner" && initPartnerEmail.trim()) {
        const created = await createHouseholdInviteLink({
          email: initPartnerEmail,
          householdId: result.household.id,
          quiet: true
        });
        if (created.ok) {
          setInviteEmail(initPartnerEmail.trim());
          setInviteLink(created.link);
          setInviteCopied(false);
          setInitialInviteState({
            email: initPartnerEmail.trim(),
            link: created.link,
            householdName: result.household.name
          });
          setAuthOpen(false);
          setAuthMessage("");
          return;
        }
      }
      setAuthOpen(false);
      setInitStep(0);
      setAuthMessage(initInviteMode === "partner" ? "家庭已開好，下一步可以邀請另一位成員。" : "");
    } catch {
      setAuthMessage("暫時開唔到第一個家庭。");
    } finally {
      setInitBusy(false);
    }
  }

  function requireMemoryAccess() {
    const issue = memoryAccessIssue(session, selectedHouseholdId);
    if (!issue) return true;
    setAuthOpen(true);
    setAuthMessage(issue);
    setLatest(captureFailedResult(issue));
    return false;
  }

  useEffect(() => {
    if (voiceStatus !== "recording") return undefined;
    const timer = window.setInterval(() => setVoiceSeconds((current) => current + 1), 1000);
    return () => window.clearInterval(timer);
  }, [voiceStatus]);

  useEffect(() => {
    photoPreviewsRef.current = photoPreviews;
  }, [photoPreviews]);

  useEffect(() => {
    return () => {
      for (const preview of photoPreviewsRef.current) URL.revokeObjectURL(preview.url);
      mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function rotateCapturePlaceholder() {
    setCapturePlaceholder((current) => randomPlaceholder(current));
  }

  function addPendingPhotos(files: File[]) {
    if (files.length === 0) return;
    const previews = files.map((file) => ({ file, url: URL.createObjectURL(file) }));
    setPendingPhotos((current) => [...current, ...files]);
    setPhotoPreviews((current) => [...current, ...previews]);
    setCaptureMode("photo");
  }

  function clearPendingPhotos() {
    setPhotoPreviews((current) => {
      for (const preview of current) URL.revokeObjectURL(preview.url);
      return [];
    });
    setPendingPhotos([]);
  }

  function removePendingPhoto(index: number) {
    setPendingPhotos((current) => current.filter((_file, itemIndex) => itemIndex !== index));
    setPhotoPreviews((current) => {
      const next = current.filter((_preview, itemIndex) => itemIndex !== index);
      const removed = current[index];
      if (removed) URL.revokeObjectURL(removed.url);
      return next;
    });
  }

  function formatVoiceTime(seconds: number) {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return `${minutes}:${String(rest).padStart(2, "0")}`;
  }

  const needsInitialization = Boolean(session?.accessToken) && households.length === 0;

  async function startVoiceStub() {
    if (voiceStatus === "recording") return;
    if (typeof window === "undefined" || !window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
      setLatest(captureFailedResult("呢部裝置暫時未支援錄音。"));
      return;
    }

    try {
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";
      const recorder = preferredType ? new MediaRecorder(stream, { mimeType: preferredType }) : new MediaRecorder(stream);
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      voiceChunksRef.current = [];
      setRecordedVoice(null);
      setCaptureMode("voice");
      setVoiceSeconds(0);
      setVoiceStatus("recording");

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) voiceChunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        const chunks = voiceChunksRef.current;
        voiceChunksRef.current = [];
        const mimeType = recorder.mimeType || preferredType || "audio/webm";
        const blob = chunks.length > 0 ? new Blob(chunks, { type: mimeType }) : null;
        stream.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        setVoiceStatus("ready");
        if (blob && blob.size > 0) {
          setRecordedVoice({
            blob,
            mimeType,
            fileName: `sayve-voice-${Date.now()}.webm`
          });
        } else {
          setRecordedVoice(null);
        }
      };

      recorder.start(250);
    } catch {
      setVoiceStatus("idle");
      setLatest(captureFailedResult("未取得咪高峰權限。"));
    }
  }

  function stopVoiceStub() {
    const recorder = mediaRecorderRef.current;
    if (!recorder) {
      setVoiceStatus("ready");
      return;
    }
    if (recorder.state !== "inactive") recorder.stop();
  }

  function resetVoiceComposer() {
    mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaRecorderRef.current = null;
    mediaStreamRef.current = null;
    voiceChunksRef.current = [];
    setRecordedVoice(null);
    setCaptureMode("text");
    setVoiceStatus("idle");
    setVoiceSeconds(0);
  }

  async function uploadVoiceBlob(file: File, transcript?: string, householdId?: string) {
    const form = new FormData();
    form.append("file", file);
    if (transcript?.trim()) form.append("transcript", transcript.trim());
    if (householdId?.trim()) form.append("householdId", householdId.trim());
    let lastResult: ApiResult | null = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch("/api/captures/voice", {
        method: "POST",
        credentials: "same-origin",
        headers: storedAuthHeaders(),
        body: form
      });
      const { payload, status } = await parseApiResult(response);
      lastResult = payload;
      if (!shouldRetryApiResult(payload, status) || attempt === 1) break;
      await pause(240);
    }

    if (!lastResult) return captureFailedResult("暫時未儲到錄音，稍後再試一次。");
    if (lastResult.current_state === "capture_failed" && !lastResult.next_best_question) {
      return captureFailedResult("暫時未儲到錄音，稍後再試一次。");
    }
    return lastResult;
  }

  function voiceFileFromRecordedVoice(voice: RecordedVoice) {
    return new File([voice.blob], voice.fileName, { type: voice.mimeType || "audio/webm" });
  }

  function moveTab(direction: -1 | 1) {
    setActiveTab((current) => {
      const index = tabOrder.indexOf(current);
      return tabOrder[Math.min(tabOrder.length - 1, Math.max(0, index + direction))];
    });
  }

  function startSwipe(clientX: number, clientY: number) {
    swipeStartRef.current = { x: clientX, y: clientY, lastX: clientX, lastY: clientY };
  }

  function updateSwipe(clientX: number, clientY: number) {
    if (!swipeStartRef.current) return;
    swipeStartRef.current.lastX = clientX;
    swipeStartRef.current.lastY = clientY;
  }

  function handlePointerUp(clientX?: number, clientY?: number) {
    if (!swipeStartRef.current) return;
    const endX = clientX ?? swipeStartRef.current.lastX;
    const endY = clientY ?? swipeStartRef.current.lastY;
    const deltaX = endX - swipeStartRef.current.x;
    const deltaY = endY - swipeStartRef.current.y;
    swipeStartRef.current = null;
    const direction = swipeDirection(deltaX, deltaY, window.innerWidth);
    if (!direction) return;
    moveTab(direction);
  }

  function canStartSwipe(target: EventTarget | null) {
    return !((target as HTMLElement | null)?.closest("input, textarea, button, select, a"));
  }

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const finishSwipe = (clientX?: number, clientY?: number) => {
      if (!swipeStartRef.current) return;
      const endX = clientX ?? swipeStartRef.current.lastX;
      const endY = clientY ?? swipeStartRef.current.lastY;
      const deltaX = endX - swipeStartRef.current.x;
      const deltaY = endY - swipeStartRef.current.y;
      swipeStartRef.current = null;
      const direction = swipeDirection(deltaX, deltaY, window.innerWidth);
      if (!direction) return;
      moveTab(direction);
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (window.innerWidth > 720) return;
      if (!canStartSwipe(event.target)) return;
      const touch = event.touches[0];
      if (!touch) return;
      startSwipe(touch.clientX, touch.clientY);
    };

    const handleTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      updateSwipe(touch.clientX, touch.clientY);
    };

    const handleTouchEnd = (event: TouchEvent) => {
      const touch = event.changedTouches[0];
      finishSwipe(touch?.clientX, touch?.clientY);
    };

    const handleTouchCancel = () => {
      swipeStartRef.current = null;
    };

    document.addEventListener("touchstart", handleTouchStart, { capture: true, passive: true });
    document.addEventListener("touchmove", handleTouchMove, { capture: true, passive: true });
    document.addEventListener("touchend", handleTouchEnd, { capture: true, passive: true });
    document.addEventListener("touchcancel", handleTouchCancel, { capture: true, passive: true });

    return () => {
      document.removeEventListener("touchstart", handleTouchStart, true);
      document.removeEventListener("touchmove", handleTouchMove, true);
      document.removeEventListener("touchend", handleTouchEnd, true);
      document.removeEventListener("touchcancel", handleTouchCancel, true);
    };
  }, []);

  async function submitHomeText(event?: FormEvent) {
    event?.preventDefault();
    if (!text.trim()) return;
    if (!selectedHouseholdCanWrite) {
      setLatest(captureFailedResult("你而家係只讀成員，可以問 Sayve，但未可以記低。"));
      return;
    }
    if (!requireMemoryAccess()) return;
    const prompt = text.trim();
    setText("");
    rotateCapturePlaceholder();
    setLatest(captureReceivedResult(prompt));
    setHomeProcessingCount((count) => count + 1);
    try {
      const result = await postJson("/api/captures/text", { text: prompt, householdId: selectedHouseholdId });
      setLatest(result);
    } catch {
      setLatest(captureFailedResult());
    } finally {
      setHomeProcessingCount((count) => Math.max(0, count - 1));
    }
  }

  async function submitChatText(event?: FormEvent) {
    event?.preventDefault();
    if (!text.trim()) return;
    const prompt = text.trim();
    if (!selectedHouseholdCanWrite && !looksLikeQuestion(prompt)) {
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "user", content: prompt },
        { id: crypto.randomUUID(), role: "assistant", content: "你而家係只讀成員，可以問 Sayve，但未可以記低。" }
      ]);
      setText("");
      rotateCapturePlaceholder();
      return;
    }
    if (!requireMemoryAccess()) return;
    setBusy(true);
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", content: prompt }]);
    const result = looksLikeQuestion(prompt)
      ? await postJson("/api/conversation/ask", conversationRequestBody(prompt, selectedHouseholdId))
      : await postJson("/api/captures/text", { text: prompt, householdId: selectedHouseholdId });
    setLatest(result);
    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: "assistant",
        content: looksLikeQuestion(prompt)
          ? String((result.data as { message?: { content?: string } } | undefined)?.message?.content ?? "我暫時未有足夠記憶回答。")
          : confidenceText(result),
        evidence: looksLikeQuestion(prompt) ? evidenceFromResult(result) : undefined
      }
    ]);
    setText("");
    rotateCapturePlaceholder();
    setBusy(false);
  }

  async function submitVoice() {
    if (!selectedHouseholdCanWrite) {
      setLatest(captureFailedResult("你而家係只讀成員，可以問 Sayve，但未可以記低。"));
      resetVoiceComposer();
      return;
    }
    if (!requireMemoryAccess()) return;
    const typedText = text.trim();
    const prompt = typedText || `Voice note ${formatVoiceTime(voiceSeconds)}`;
    const shouldAsk = activeTab === "chat" && looksLikeQuestion(typedText);
    const voiceFile = recordedVoice ? voiceFileFromRecordedVoice(recordedVoice) : null;
    setText("");
    rotateCapturePlaceholder();
    if (activeTab !== "chat") {
      setLatest(captureReceivedResult(prompt));
      setHomeProcessingCount((count) => count + 1);
      try {
        const result = voiceFile
          ? await uploadVoiceBlob(voiceFile, undefined, selectedHouseholdId)
          : await postJson("/api/captures/voice", { transcript: prompt, householdId: selectedHouseholdId });
        setLatest(result);
      } catch {
        setLatest(captureFailedResult());
      } finally {
        resetVoiceComposer();
        setHomeProcessingCount((count) => Math.max(0, count - 1));
      }
      return;
    }

    setBusy(true);
    try {
      const result = shouldAsk
        ? await postJson("/api/conversation/ask", conversationRequestBody(typedText, selectedHouseholdId))
        : voiceFile
          ? await uploadVoiceBlob(voiceFile, undefined, selectedHouseholdId)
          : await postJson("/api/captures/voice", { transcript: prompt, householdId: selectedHouseholdId });
      setLatest(result);
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "user", content: prompt },
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: shouldAsk
            ? String((result.data as { message?: { content?: string } } | undefined)?.message?.content ?? "我暫時未有足夠記憶回答。")
            : confidenceText(result),
          evidence: shouldAsk ? evidenceFromResult(result) : undefined
        }
      ]);
    } catch {
      setLatest(captureFailedResult());
    } finally {
      resetVoiceComposer();
      setBusy(false);
    }
  }

  async function uploadPhoto(file: File, note?: string, householdId?: string) {
    const form = new FormData();
    form.append("file", file);
    form.append("note", note || file.name);
    if (householdId?.trim()) form.append("householdId", householdId.trim());
    let lastResult: ApiResult | null = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch("/api/captures/receipt", {
        method: "POST",
        credentials: "same-origin",
        headers: storedAuthHeaders(),
        body: form
      });
      const { payload, status } = await parseApiResult(response);
      lastResult = payload;
      if (!shouldRetryApiResult(payload, status) || attempt === 1) break;
      await pause(240);
    }

    if (!lastResult) return captureFailedResult("暫時未儲到收據相，稍後再試一次。");
    if (lastResult.current_state === "capture_failed" && !lastResult.next_best_question) {
      return captureFailedResult("暫時未儲到收據相，稍後再試一次。");
    }
    return lastResult;
  }

  async function submitPhoto(file: File) {
    if (!selectedHouseholdCanWrite) {
      setLatest(captureFailedResult("你而家係只讀成員，可以問 Sayve，但未可以記低。"));
      clearPendingPhotos();
      setCaptureMode("text");
      return;
    }
    if (!requireMemoryAccess()) return;
    setBusy(true);
    const result = await uploadPhoto(file, text.trim(), selectedHouseholdId);
    setLatest(result);
    if (activeTab === "chat") {
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "user", content: `Photo: ${file.name}` },
        { id: crypto.randomUUID(), role: "assistant", content: confidenceText(result) }
      ]);
    }
    setText("");
    clearPendingPhotos();
    setCaptureMode("text");
    rotateCapturePlaceholder();
    setBusy(false);
  }

  async function submitPendingPhotos() {
    if (pendingPhotos.length === 0) return;
    if (!selectedHouseholdCanWrite) {
      setLatest(captureFailedResult("你而家係只讀成員，可以問 Sayve，但未可以記低。"));
      clearPendingPhotos();
      setCaptureMode("text");
      return;
    }
    if (!requireMemoryAccess()) return;
    const files = [...pendingPhotos];
    const note = text.trim();
    setLatest(captureReceivedResult(`${files.length} photo${files.length > 1 ? "s" : ""}`));
    let lastResult: ApiResult | null = null;
    setText("");
    clearPendingPhotos();
    setCaptureMode("text");
    rotateCapturePlaceholder();
    setHomeProcessingCount((count) => count + 1);
    try {
      for (const file of files) {
        lastResult = await uploadPhoto(file, note, selectedHouseholdId);
      }
      if (lastResult) setLatest(lastResult);
    } catch {
      setLatest(captureFailedResult());
    } finally {
      setHomeProcessingCount((count) => Math.max(0, count - 1));
    }
  }

  return (
    <main
      className="appShell"
      onPointerDownCapture={(event) => {
        if (!canStartSwipe(event.target)) return;
        if (window.innerWidth > 720) return;
        startSwipe(event.clientX, event.clientY);
      }}
      onPointerMoveCapture={(event) => updateSwipe(event.clientX, event.clientY)}
      onPointerUpCapture={(event) => handlePointerUp(event.clientX, event.clientY)}
      onPointerCancelCapture={() => {
        swipeStartRef.current = null;
      }}
      onTouchStartCapture={(event) => {
        if (!canStartSwipe(event.target)) return;
        if (window.innerWidth > 720) return;
        const touch = event.touches[0];
        if (!touch) return;
        startSwipe(touch.clientX, touch.clientY);
      }}
      onTouchMoveCapture={(event) => {
        const touch = event.touches[0];
        if (!touch) return;
        updateSwipe(touch.clientX, touch.clientY);
      }}
      onTouchEndCapture={(event) => {
        const touch = event.changedTouches[0];
        handlePointerUp(touch?.clientX, touch?.clientY);
      }}
      onTouchCancelCapture={() => {
        swipeStartRef.current = null;
      }}
    >
      <header className="appTopbar">
        <strong>Sayve</strong>
        <nav className="simpleTabs" aria-label="Views">
          <button className={activeTab === "chat" ? "active" : ""} type="button" onClick={() => setActiveTab("chat")}>
            問 Sayve
          </button>
          <button className={activeTab === "home" ? "active" : ""} type="button" onClick={() => setActiveTab("home")}>
            記低
          </button>
          <button className={activeTab === "dashboard" ? "active" : ""} type="button" onClick={() => setActiveTab("dashboard")}>
            總覽
          </button>
        </nav>
        <div className="pageHint" aria-label="Mobile views">
          <button type="button" className={activeTab === "chat" ? "active" : ""} aria-label="問 Sayve" onClick={() => setActiveTab("chat")} />
          <button type="button" className={activeTab === "home" ? "active" : ""} aria-label="記低" onClick={() => setActiveTab("home")} />
          <button type="button" className={activeTab === "dashboard" ? "active" : ""} aria-label="總覽" onClick={() => setActiveTab("dashboard")} />
        </div>
        <button className="accountButton" type="button" onClick={() => setAuthOpen((current) => !current)} title="Family login">
          <Users size={17} />
          <span>{selectedHousehold?.name ?? session?.email ?? "Family"}</span>
        </button>
      </header>

      {authOpen && (
        <section className="authPanel" aria-label="Family login">
          <div className="authPanelHeader">
            <strong>Family Memory</strong>
            <span>{session?.email ? `已登入 ${session.email}` : "你同太太會寫入同一份家庭記憶。"}</span>
          </div>

          {session ? (
            <button type="button" className="authGhostButton" onClick={signOut}>
              <LogOut size={16} />
              登出
            </button>
          ) : (
            <div className="authLoginStack">
              <button type="button" className="authOAuthButton" onClick={signInWithGoogle}>
                Google 登入
              </button>
              <div className="authLoginRow">
                <div className="authInputWrap">
                  <Mail size={16} />
                  <input
                    value={authEmail}
                    onChange={(event) => setAuthEmail(event.target.value)}
                    type="email"
                    placeholder="email"
                    aria-label="Email"
                  />
                </div>
                <button type="button" onClick={sendMagicLink}>
                  Link
                </button>
              </div>
            </div>
          )}

          {showPrototypeLogin && (
            <div className="authLoginRow">
              <div className="authInputWrap">
                <Users size={16} />
                <input
                  value={prototypeUserId}
                  onChange={(event) => setPrototypeUserId(event.target.value)}
                  placeholder="prototype user id"
                  aria-label="Prototype user id"
                />
              </div>
              <button type="button" onClick={refreshHouseholds}>
                更新
              </button>
            </div>
          )}

          {households.length > 0 && (
            <label className="householdSelect">
              <span>Household</span>
              <select value={selectedHouseholdId} onChange={(event) => setSelectedHouseholdId(event.target.value)}>
                {households.map((household) => (
                  <option value={household.id} key={household.id}>
                    {household.name} · {household.role}
                  </option>
                ))}
              </select>
            </label>
          )}

          {householdStatus && (
            <div className="householdStatusCard">
              <div className="householdStatusStats">
                <div>
                  <strong>{householdStatus.memberCount}</strong>
                  <span>已加入</span>
                </div>
                <div>
                  <strong>{householdStatus.pendingInviteCount}</strong>
                  <span>等緊接受</span>
                </div>
                <div>
                  <strong>{householdStatus.expiredInviteCount}</strong>
                  <span>已過期</span>
                </div>
              </div>

              <div className="householdRoster">
                {householdStatus.members.map((member) => (
                  <div className="householdRosterRow" key={`${member.label}-${member.role}`}>
                    <strong>{member.label}</strong>
                    <span>{member.isCurrentUser ? "你而家登入緊" : member.role}</span>
                  </div>
                ))}
              </div>

              {householdStatus.pendingInvites.length > 0 && (
                <div className="householdPendingInvites">
                  <span>未加入成員</span>
                  {householdStatus.pendingInvites.map((invite) => (
                    <div className="householdPendingInviteRow" key={`${invite.email}-${invite.expiresAt}`}>
                      <strong>{invite.email}</strong>
                      <small>{invite.role}</small>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {session && selectedHousehold?.role === "owner" && (
            <div className="inviteMemberBox">
              <span>邀請家庭成員</span>
              <div className="authLoginRow">
                <div className="authInputWrap">
                  <Mail size={16} />
                  <input
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                    type="email"
                    placeholder="wife@example.com"
                    aria-label="Partner email"
                  />
                </div>
                <button type="button" onClick={inviteHouseholdMember} disabled={inviteBusy}>
                  邀請
                </button>
              </div>
              {inviteLink && (
                <div className="inviteMemberActions">
                  <button type="button" className="authGhostButton" onClick={copyInviteLink}>
                    {inviteCopied ? "已複製" : "複製 invite link"}
                  </button>
                  <a className="inviteMemberLink" href={inviteLink} target="_blank" rel="noreferrer">
                    開啟 invite link
                  </a>
                </div>
              )}
            </div>
          )}

          {authMessage && <p className="authMessage">{authMessage}</p>}
        </section>
      )}

      {needsInitialization && (
        <section className="initializationOverlay" aria-label="First-time setup">
          <div className="initializationShell">
            <div className="initializationAura" aria-hidden="true" />
            <div className="initializationCard">
              {initialInviteState ? (
                <div className="initializationStep">
                  <p className="initializationEyebrow">Sayve</p>
                  <h2>家庭已開好，invite 都準備埋</h2>
                  <span>{initialInviteState.householdName} 已建立。將條 link 俾另一位成員登入，就可以一齊寫入同一份家庭記憶。</span>
                  <div className="initializationInviteCard">
                    <strong>{initialInviteState.email}</strong>
                    <small>已為呢個 email 準備 member invite。</small>
                  </div>
                  <div className="initializationActions">
                    <button
                      type="button"
                      className="initializationGhost"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(initialInviteState.link);
                          setInviteCopied(true);
                          setAuthMessage("Invite link 已複製。");
                        } catch {
                          setAuthMessage("暫時未複製到，先用開啟 invite link。");
                        }
                      }}
                    >
                      {inviteCopied ? "已複製" : "複製 invite link"}
                    </button>
                    <a className="initializationPrimary" href={initialInviteState.link} target="_blank" rel="noreferrer">
                      開啟 invite
                    </a>
                  </div>
                  <button
                    type="button"
                    className="initializationDone"
                    onClick={() => {
                      setInitialInviteState(null);
                      setInitStep(0);
                      setAuthMessage("家庭已開好，之後都可以喺右上角邀請另一位成員。");
                    }}
                  >
                    我之後再處理
                  </button>
                  {authMessage && <p className="initializationMessage">{authMessage}</p>}
                </div>
              ) : (
                <>
              <div className="initializationDots" aria-hidden="true">
                <span className={initStep === 0 ? "active" : ""} />
                <span className={initStep === 1 ? "active" : ""} />
                <span className={initStep === 2 ? "active" : ""} />
              </div>
              <p className="initializationEyebrow">Sayve</p>
              {initStep === 0 ? (
                <div className="initializationStep">
                  <h2>先認識你屋企</h2>
                  <span>我會先幫你開好第一個家庭記憶，之後你同 Sayve 講一聲就得。</span>
                  <label className="initializationField">
                    <span>家庭叫咩名？</span>
                    <input value={initName} onChange={(event) => setInitName(event.target.value)} placeholder="例如：Lee Family" />
                  </label>
                </div>
              ) : initStep === 1 ? (
                <div className="initializationStep">
                  <h2>用咩貨幣開始？</h2>
                  <span>之後總覽、比較、記憶整理都會跟住呢個預設行。</span>
                  <div className="initializationChoiceRow">
                    {["HKD", "USD", "CNY"].map((currency) => (
                      <button
                        key={currency}
                        type="button"
                        className={initCurrency === currency ? "initializationChoice active" : "initializationChoice"}
                        onClick={() => setInitCurrency(currency)}
                      >
                        {currency}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="initializationStep">
                  <h2>你想點開始？</h2>
                  <span>可以自己先開始，之後再邀請另一位成員；亦可以而家就準備好雙人使用。</span>
                  <div className="initializationModeStack">
                    <button
                      type="button"
                      className={initInviteMode === "solo" ? "initializationModeCard active" : "initializationModeCard"}
                      onClick={() => setInitInviteMode("solo")}
                    >
                      <strong>我自己先開始</strong>
                      <small>先用住，之後再邀請另一位成員。</small>
                    </button>
                    <button
                      type="button"
                      className={initInviteMode === "partner" ? "initializationModeCard active" : "initializationModeCard"}
                      onClick={() => setInitInviteMode("partner")}
                    >
                      <strong>之後會兩個人一齊用</strong>
                      <small>家庭開好之後，我會引導你邀請對方加入。</small>
                    </button>
                  </div>
                  {initInviteMode === "partner" && (
                    <label className="initializationField">
                      <span>另一位成員 email</span>
                      <input value={initPartnerEmail} onChange={(event) => setInitPartnerEmail(event.target.value)} placeholder="wife@example.com" />
                    </label>
                  )}
                </div>
              )}

              <div className="initializationActions">
                <button type="button" className="initializationGhost" onClick={() => setInitStep((current) => Math.max(0, current - 1) as InitStep)} disabled={initBusy || initStep === 0}>
                  返回
                </button>
                {initStep < 2 ? (
                  <button
                    type="button"
                    className="initializationPrimary"
                    onClick={() => setInitStep((current) => Math.min(2, current + 1) as InitStep)}
                    disabled={initBusy || (initStep === 0 && !initName.trim())}
                  >
                    下一步
                  </button>
                ) : (
                  <button type="button" className="initializationPrimary" onClick={bootstrapHousehold} disabled={initBusy}>
                    {initBusy ? "準備中..." : "開始使用"}
                  </button>
                )}
              </div>

              {authMessage && <p className="initializationMessage">{authMessage}</p>}
                </>
              )}
            </div>
          </div>
        </section>
      )}

      {activeTab === "home" ? (
        <section className="captureHome">
          <div className="heroPrompt">
            <p>Sayve</p>
            <h1>跟 Sayve 說一件事</h1>
            {!selectedHouseholdCanWrite && selectedHousehold ? <span className="roleHint">你而家用緊只讀模式，可以問 Sayve，但未可以記低。</span> : null}
          </div>

          <form className="captureComposer" onSubmit={submitHomeText}>
            <div className="captureTextBar">
              <input
                className="captureInput"
                aria-label="跟 Sayve 說一件事"
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                  if (event.key === "Enter" && captureMode === "text") {
                    void submitHomeText();
                  }
                }}
                placeholder={selectedHouseholdCanWrite ? capturePlaceholder : "只讀模式：你可以問 Sayve 家庭狀況"}
                disabled={!selectedHouseholdCanWrite}
              />
              <button type="submit" className="captureInlineSend" disabled={!text.trim() || !selectedHouseholdCanWrite} title="Send">
                <Send size={18} />
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              hidden
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                addPendingPhotos(files);
                event.currentTarget.value = "";
              }}
            />
            <div className="captureModeActions">
              <button
                type="button"
                className={captureMode === "photo" ? "captureModeButton active" : "captureModeButton"}
                aria-label="影相"
                title="影相"
                onClick={() => {
                  if (!selectedHouseholdCanWrite) return;
                  setCaptureMode("photo");
                  fileInputRef.current?.click();
                }}
                disabled={!selectedHouseholdCanWrite}
              >
                <Camera size={20} />
              </button>
              <button
                type="button"
                className={captureMode === "voice" ? "captureModeButton active" : "captureModeButton"}
                aria-label="錄音"
                title="錄音"
                onClick={startVoiceStub}
                disabled={!selectedHouseholdCanWrite}
              >
                <Mic size={20} />
              </button>
            </div>

            {captureMode === "photo" && (
              <div className="capturePanel">
                <div className="capturePanelText">
                  <strong>{pendingPhotos.length > 0 ? `${pendingPhotos.length} 張相片未送出` : "影相 / 選擇收據"}</strong>
                  <span>{pendingPhotos.length > 0 ? "可以再加相，或者加一句補充再送。" : "先進入相片介面，確認後先送出。"}</span>
                  {pendingPhotos.length > 0 && (
                    <div className="capturePhotoPreviewGrid">
                      {photoPreviews.map((preview, index) => (
                        <figure key={`${preview.file.name}-${preview.file.size}-${index}`} className="capturePhotoPreview">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={preview.url} alt={preview.file.name} />
                          <figcaption>{preview.file.name}</figcaption>
                          <button type="button" onClick={() => removePendingPhoto(index)} aria-label="移除相片" disabled={busy}>
                            <X size={13} />
                          </button>
                        </figure>
                      ))}
                    </div>
                  )}
                </div>
                <button type="button" className="capturePanelGhost" onClick={() => fileInputRef.current?.click()} disabled={busy}>
                  {pendingPhotos.length > 0 ? "再加" : "選擇"}
                </button>
                <button type="button" className="capturePanelSend" onClick={submitPendingPhotos} disabled={busy || pendingPhotos.length === 0}>
                  <Send size={18} />
                </button>
              </div>
            )}

            {captureMode === "voice" && (
              <div className="capturePanel voice">
                <div className="recordingBar" aria-label="Recording">
                  <Mic size={18} />
                  <span className={voiceStatus === "recording" ? "live" : ""} />
                  <span className={voiceStatus === "recording" ? "live" : ""} />
                  <span className={voiceStatus === "recording" ? "live" : ""} />
                  <span className={voiceStatus === "recording" ? "live" : ""} />
                  <strong>
                    {voiceStatus === "recording" ? "Recording" : voiceStatus === "ready" ? "Ready" : "Voice"} · {formatVoiceTime(voiceSeconds)}
                  </strong>
                </div>
                {voiceStatus === "recording" ? (
                  <button type="button" className="capturePanelGhost iconOnly" onClick={stopVoiceStub} disabled={busy} aria-label="停止錄音">
                    <Square size={15} />
                  </button>
                ) : (
                  <button type="button" className="capturePanelGhost" onClick={startVoiceStub} disabled={busy}>
                    重錄
                  </button>
                )}
                <button type="button" className="capturePanelSend" onClick={submitVoice} disabled={busy || voiceStatus === "recording"}>
                  <Send size={18} />
                </button>
              </div>
            )}
          </form>

          {latest && (
            <div
              className={
                latest.current_state === "capture_received"
                  ? "memoryToast processing"
                  : latest.needs_user_input
                    ? "memoryToast ask"
                    : "memoryToast"
              }
            >
              {latest.current_state === "capture_received" ? (
                <LoaderCircle size={18} />
              ) : latest.needs_user_input ? (
                <CircleHelp size={18} />
              ) : (
                <CheckCircle2 size={18} />
              )}
              <span>{confidenceText(latest)}</span>
              {homeProcessingCount > 0 && <small>{homeProcessingCount}</small>}
            </div>
          )}
        </section>
      ) : activeTab === "chat" ? (
        <section className="chatCapture">
          <div className="heroPrompt">
            <p>Ask</p>
            <h1>問一問 Sayve</h1>
            <span>
              {selectedHouseholdCanWrite
                ? "可以問家庭財務狀況，也可以直接講一件新發生的事。"
                : "你而家用緊只讀模式，可以問家庭財務狀況。"}
            </span>
          </div>

          {messages.length > 0 && (
            <div className="messageList" aria-live="polite">
              {messages.map((message) => (
                <div className={`message ${message.role}`} key={message.id}>
                  <span>{message.content}</span>
                </div>
              ))}
            </div>
          )}

          <form className="composer" onSubmit={submitChatText}>
            <textarea
              aria-label="跟 Sayve 對話"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={
                selectedHouseholdCanWrite
                  ? "例如：今日喺大家樂食飯 HK$300 / 上個月食飯用左幾多錢？"
                  : "例如：上個月食飯用左幾多錢？"
              }
              rows={3}
            />
            <div className="composerActions">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void submitPhoto(file);
                  event.currentTarget.value = "";
                }}
              />
              <button type="button" className="iconButton" onClick={() => fileInputRef.current?.click()} disabled={busy || !selectedHouseholdCanWrite} title="Photo">
                <Camera size={20} />
              </button>
              <button type="button" className="iconButton" onClick={submitVoice} disabled={busy || !text.trim() || !selectedHouseholdCanWrite} title="Voice">
                <Mic size={20} />
              </button>
              <button type="submit" className="sendButton" disabled={busy || !text.trim()} title="Send">
                <Send size={20} />
              </button>
            </div>
          </form>
        </section>
      ) : (
        <DashboardView />
      )}
    </main>
  );
}
