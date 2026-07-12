import { invalidJsonResponse, readJsonObject } from "@/server/api/json";
import { ADMIN_NO_STORE_HEADERS, adminJson, adminTokenFromRequest, unexpectedAdminErrorResponse } from "@/server/admin/http";
import { canAccessFounderConsole } from "@/server/admin/founder-console";
import { createFounderHousehold } from "@/server/households/onboarding";

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

    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "Family Household";
    const ownerUserId = typeof body.ownerUserId === "string" ? body.ownerUserId : "";
    if (!ownerUserId) {
      return adminJson({ configured: true, ok: false, error: "ownerUserId is required." }, { status: 400 });
    }

    const result = await createFounderHousehold({
      name,
      ownerUserId,
      defaultCurrency: typeof body.defaultCurrency === "string" ? body.defaultCurrency : undefined,
      locale: typeof body.locale === "string" ? body.locale : undefined
    });
    return adminJson(result, { status: result.ok || !result.configured ? 200 : 500 });
  } catch (error) {
    return unexpectedAdminErrorResponse(error);
  }
}
