import { invalidJsonResponse, readJsonObject } from "@/server/api/json";
import { isSupabaseAuthRequired, requestHasSupabaseBearerToken, requestHouseholdHeaderId, resolveRequestAuthContext } from "@/server/auth/request-context";
import { confirmContext } from "@/server/memory/engine";
import { noStoreJson } from "@/server/api/http";

export async function POST(request: Request) {
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
  const contextId = typeof body.contextId === "string" ? body.contextId : undefined;
  return noStoreJson(await confirmContext({ householdId: auth.context.householdId, contextId, actorUserId: auth.context.userId }));
}
