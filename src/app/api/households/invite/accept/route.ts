import { invalidJsonResponse, readJsonObject } from "@/server/api/json";
import { ADMIN_NO_STORE_HEADERS, adminJson, adminTokenFromRequest, unexpectedAdminErrorResponse } from "@/server/admin/http";
import { canAccessFounderConsole, founderTokenRequired } from "@/server/admin/founder-console";
import { isSupabaseAuthRequired, resolveRequestUserId, resolveSupabaseBearerUser, resolveSupabaseBearerUserId } from "@/server/auth/request-context";
import { inviteAcceptanceStatus } from "@/server/households/http";
import { acceptHouseholdInvite } from "@/server/households/onboarding";

export async function POST(request: Request) {
  try {
    const canUseFounderOverride = founderTokenRequired() && canAccessFounderConsole(adminTokenFromRequest(request));
    const authRequired = isSupabaseAuthRequired();
    const bearerUser = authRequired ? await resolveSupabaseBearerUser(request) : undefined;
    const bearerUserId = authRequired ? await resolveSupabaseBearerUserId(request) : undefined;
    if (authRequired && !bearerUserId && !canUseFounderOverride) {
      return adminJson(
        {
          configured: true,
          ok: false,
          error: "login bearer token is required unless Founder Console override is used."
        },
        { status: 401 }
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await readJsonObject(request);
    } catch {
      return invalidJsonResponse({ headers: ADMIN_NO_STORE_HEADERS });
    }

    const token = typeof body.token === "string" ? body.token.trim() : "";
    const bodyUserId = typeof body.userId === "string" ? body.userId.trim() : "";
    const userId = authRequired ? bearerUserId || (canUseFounderOverride ? bodyUserId : "") : bodyUserId || (await resolveRequestUserId(request));

    if (!token) {
      return adminJson({ configured: true, ok: false, error: "token is required." }, { status: 400 });
    }

    if (!userId) {
      return adminJson(
        {
          configured: true,
          ok: false,
          error: authRequired ? "login bearer token is required unless Founder Console override is used." : "userId or login bearer token is required."
        },
        { status: authRequired ? 401 : 400 }
      );
    }

    const result = await acceptHouseholdInvite({ token, userId, userEmail: authRequired ? bearerUser?.email : undefined });
    return adminJson(result, { status: inviteAcceptanceStatus(result) });
  } catch (error) {
    return unexpectedAdminErrorResponse(error);
  }
}
