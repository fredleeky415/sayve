import { updateContext } from "@/server/memory/engine";
import { invalidJsonResponse, readJsonObject } from "@/server/api/json";
import { isSupabaseAuthRequired, requestHasSupabaseBearerToken, requestHouseholdHeaderId, resolveRequestAuthContext } from "@/server/auth/request-context";
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
  const result = await updateContext({
    householdId: auth.context.householdId,
    actorUserId: auth.context.userId,
    subject: typeof body.subject === "string" ? body.subject : "Household context",
    state: typeof body.state === "string" ? body.state : "updated",
    evidence: typeof body.evidence === "string" ? body.evidence : undefined
  });
  return noStoreJson(result);
}
