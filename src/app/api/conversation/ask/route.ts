import { askConversation } from "@/server/memory/engine";
import { invalidJsonResponse, readJsonObject, unexpectedApiErrorResponse } from "@/server/api/json";
import { isSupabaseAuthRequired, requestHasSupabaseBearerToken, requestHouseholdHeaderId, resolveRequestAuthContext } from "@/server/auth/request-context";
import { noStoreJson } from "@/server/api/http";

export async function POST(request: Request) {
  try {
    const authBeforeBody =
      isSupabaseAuthRequired() && (!requestHasSupabaseBearerToken(request) || requestHouseholdHeaderId(request))
        ? await resolveRequestAuthContext(request)
        : undefined;
    if (authBeforeBody && !authBeforeBody.ok) return authBeforeBody.response;

    let body: Record<string, unknown>;
    try {
      body = await readJsonObject(request);
    } catch {
      return invalidJsonResponse();
    }
    const auth = authBeforeBody ?? (await resolveRequestAuthContext(request, typeof body.householdId === "string" ? body.householdId : undefined));
    if (!auth.ok) return auth.response;

    const result = await askConversation(typeof body.question === "string" ? body.question : "", auth.context.householdId, auth.context.userId);
    return noStoreJson(result);
  } catch (error) {
    console.error("[api/conversation/ask] unexpected failure", error);
    return unexpectedApiErrorResponse(error, {}, { captureLabel: "conversation" });
  }
}
