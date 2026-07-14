import { correctMemory } from "@/server/memory/engine";
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
  return noStoreJson(
    await correctMemory({
      householdId: auth.context.householdId,
      actorUserId: auth.context.userId,
      memoryObjectId: typeof body.memoryObjectId === "string" ? body.memoryObjectId : undefined,
      correction: typeof body.correction === "string" ? body.correction : undefined,
      action:
        body.action === "confirm" ||
        body.action === "category" ||
        body.action === "merchant" ||
        body.action === "amount" ||
        body.action === "note"
          ? body.action
          : undefined,
      value: typeof body.value === "string" || typeof body.value === "number" ? body.value : undefined
    })
  );
}
