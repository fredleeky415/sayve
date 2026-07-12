import { invalidJsonResponse, readJsonObject, unexpectedApiErrorResponse } from "@/server/api/json";
import { NO_STORE_HEADERS, noStoreJson } from "@/server/api/http";
import { resolveRequestAuthContext } from "@/server/auth/request-context";
import { inviteLinksForRequest } from "@/server/households/invite-links";
import { createHouseholdInvite } from "@/server/households/onboarding";

export async function POST(request: Request) {
  try {
    const auth = await resolveRequestAuthContext(request);
    if (!auth.ok) return auth.response;

    if (auth.context.role && auth.context.role !== "owner") {
      return noStoreJson({ configured: true, ok: false, error: "Only household owners can invite members." }, { status: 403 });
    }

    let body: Record<string, unknown>;
    try {
      body = await readJsonObject(request);
    } catch {
      return invalidJsonResponse({ headers: NO_STORE_HEADERS });
    }

    const requestedRole = typeof body.role === "string" ? body.role : undefined;
    const role = requestedRole === "viewer" ? "viewer" : "member";
    const expiresInDays = typeof body.expiresInDays === "number" && body.expiresInDays > 0 ? body.expiresInDays : undefined;
    const result = await createHouseholdInvite({
      householdId: auth.context.householdId,
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

    return noStoreJson(result, { status: result.ok || !result.configured ? 200 : 500 });
  } catch {
    return unexpectedApiErrorResponse();
  }
}
