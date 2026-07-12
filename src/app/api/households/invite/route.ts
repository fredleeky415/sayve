import { invalidJsonResponse, readJsonObject } from "@/server/api/json";
import { ADMIN_NO_STORE_HEADERS, adminJson, adminTokenFromRequest, unexpectedAdminErrorResponse } from "@/server/admin/http";
import { canAccessFounderConsole } from "@/server/admin/founder-console";
import { inviteLinksForRequest } from "@/server/households/invite-links";
import { createHouseholdInvite } from "@/server/households/onboarding";

export async function POST(request: Request) {
  try {
    if (!canAccessFounderConsole(adminTokenFromRequest(request))) {
      return adminJson({ error: "Founder Console is not available." }, { status: 403 });
    }

    let body: Record<string, unknown>;
    try {
      body = await readJsonObject(request);
    } catch {
      return invalidJsonResponse({ headers: ADMIN_NO_STORE_HEADERS });
    }

    const householdId = typeof body.householdId === "string" ? body.householdId.trim() : "";
    if (!householdId) {
      return adminJson({ configured: true, ok: false, error: "householdId is required." }, { status: 400 });
    }

    const requestedRole = typeof body.role === "string" ? body.role : undefined;
    const role = requestedRole === "viewer" ? "viewer" : "member";
    const expiresInDays = typeof body.expiresInDays === "number" && body.expiresInDays > 0 ? body.expiresInDays : undefined;

    const result = await createHouseholdInvite({
      householdId,
      email: typeof body.email === "string" ? body.email.trim() || undefined : undefined,
      role,
      expiresInDays
    });

    if (result.ok && typeof result.data?.token === "string") {
      result.data = {
        ...result.data,
        ...inviteLinksForRequest(request, result.data.token)
      };
    }

    return adminJson(result, { status: result.ok || !result.configured ? 200 : 500 });
  } catch (error) {
    return unexpectedAdminErrorResponse(error);
  }
}
