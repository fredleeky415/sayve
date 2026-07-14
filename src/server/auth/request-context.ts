import { createSupabaseAnonClient, createSupabaseServiceClient } from "@/server/supabase/service-client";
import { noStoreJson } from "@/server/api/http";

export const DEFAULT_HOUSEHOLD_ID = "household_demo";

export type HouseholdRole = "owner" | "member" | "viewer";

export type RequestAuthContext = {
  householdId: string;
  userId?: string;
  role?: HouseholdRole;
  source: "supabase_auth" | "prototype_header" | "request_body" | "default";
};

export type RequestAuthOptions = {
  access?: "read" | "write";
};

export type RequestAuthResult =
  | {
      ok: true;
      context: RequestAuthContext;
    }
  | {
      ok: false;
      response: Response;
    };

export function isSupabaseAuthRequired(): boolean {
  return process.env.SUPABASE_AUTH_REQUIRED === "1";
}

function bearerToken(request: Request): string | undefined {
  const header = request.headers.get("authorization");
  if (!header) return undefined;
  const match = /^bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim();
}

export function requestHouseholdHeaderId(request: Request): string | undefined {
  const householdId = request.headers.get("x-household-id")?.trim();
  return householdId ? householdId : undefined;
}

export function requestHasSupabaseBearerToken(request: Request): boolean {
  return Boolean(bearerToken(request));
}

function authError(status: number, currentState: string, question: string): RequestAuthResult {
  return {
    ok: false,
    response: noStoreJson(
      {
        memory_object_id: null,
        confidence: 0,
        source_refs: [],
        current_state: currentState,
        needs_user_input: true,
        next_best_question: question,
        data: {}
      },
      { status }
    )
  };
}

type SupabaseBearerUser = {
  id: string;
  email?: string;
};

async function bearerUserFromRequest(request: Request): Promise<SupabaseBearerUser | undefined> {
  const token = bearerToken(request);
  if (!token) return undefined;

  const supabase = createSupabaseAnonClient();
  if (!supabase) return undefined;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return undefined;
  return {
    id: data.user.id,
    email: typeof data.user.email === "string" ? data.user.email : undefined
  };
}

async function userIdFromBearerToken(request: Request): Promise<string | undefined> {
  return (await bearerUserFromRequest(request))?.id;
}

export async function resolveRequestUserId(request: Request): Promise<string | undefined> {
  return (await userIdFromBearerToken(request)) ?? request.headers.get("x-user-id") ?? undefined;
}

export async function resolveSupabaseBearerUserId(request: Request): Promise<string | undefined> {
  return userIdFromBearerToken(request);
}

export async function resolveSupabaseBearerUser(request: Request): Promise<SupabaseBearerUser | undefined> {
  return bearerUserFromRequest(request);
}

async function householdMembershipRole(householdId: string, userId: string): Promise<HouseholdRole | undefined> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) return isSupabaseAuthRequired() ? undefined : "owner";

  const { data, error } = await supabase
    .from("household_members")
    .select("role")
    .eq("household_id", householdId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return undefined;
  return data.role === "owner" || data.role === "member" || data.role === "viewer" ? data.role : undefined;
}

function canWrite(role: HouseholdRole | undefined): boolean {
  return role === "owner" || role === "member";
}

export async function resolveRequestAuthContext(
  request: Request,
  bodyHouseholdId?: string,
  options: RequestAuthOptions = {}
): Promise<RequestAuthResult> {
  const access = options.access ?? "write";
  const headerHouseholdId = request.headers.get("x-household-id") ?? undefined;
  const explicitHouseholdId = headerHouseholdId ?? bodyHouseholdId;
  const bearerUserId = await resolveSupabaseBearerUserId(request);
  const userId = isSupabaseAuthRequired() ? bearerUserId : bearerUserId ?? request.headers.get("x-user-id") ?? undefined;
  const householdId = explicitHouseholdId ?? process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID ?? DEFAULT_HOUSEHOLD_ID;
  const source: RequestAuthContext["source"] = userId
    ? bearerUserId
      ? "supabase_auth"
      : "prototype_header"
    : headerHouseholdId
      ? "prototype_header"
      : bodyHouseholdId
        ? "request_body"
        : "default";

  if (isSupabaseAuthRequired() && !userId) {
    return authError(401, "auth_required", "請先登入 Sayve。");
  }

  if (isSupabaseAuthRequired() && userId && !explicitHouseholdId) {
    return authError(400, "household_required", "請先選擇家庭。");
  }

  if (isSupabaseAuthRequired() && householdId === DEFAULT_HOUSEHOLD_ID) {
    return authError(400, "household_required", "請選擇家庭。");
  }

  const role = userId ? await householdMembershipRole(householdId, userId) : undefined;

  if (isSupabaseAuthRequired() && userId && !role) {
    return authError(403, "household_access_denied", "你未加入呢個家庭。");
  }

  if (isSupabaseAuthRequired() && userId && access === "write" && !canWrite(role)) {
    return authError(403, "household_write_denied", "你可以查看呢個家庭，但唔可以更新記憶。");
  }

  return {
    ok: true,
    context: {
      householdId,
      userId,
      role,
      source
    }
  };
}
