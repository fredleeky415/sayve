import { addHouseholdCategoryAsync, listActiveCategoriesAsync } from "@/server/memory/categories";
import { invalidJsonResponse, readJsonObject, unexpectedApiErrorResponse } from "@/server/api/json";
import { isSupabaseAuthRequired, requestHasSupabaseBearerToken, requestHouseholdHeaderId, resolveRequestAuthContext } from "@/server/auth/request-context";
import { noStoreJson } from "@/server/api/http";

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const auth = await resolveRequestAuthContext(request, searchParams.get("householdId") ?? undefined, { access: "read" });
    if (!auth.ok) return auth.response;
    const categories = await listActiveCategoriesAsync(auth.context.householdId);

    return noStoreJson({
      memory_object_id: null,
      confidence: 1,
      source_refs: [],
      current_state: "category_taxonomy",
      needs_user_input: false,
      data: { categories }
    });
  } catch (error) {
    return unexpectedApiErrorResponse(error);
  }
}

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

    try {
      const auth = authBeforeBody ?? (await resolveRequestAuthContext(request, typeof body.householdId === "string" ? body.householdId : undefined));
      if (!auth.ok) return auth.response;

      const category = await addHouseholdCategoryAsync({
        householdId: auth.context.householdId,
        name: typeof body.name === "string" ? body.name : "",
        color: typeof body.color === "string" ? body.color : undefined,
        actorUserId: auth.context.userId
      });

      return noStoreJson({
        memory_object_id: null,
        confidence: 1,
        source_refs: [],
        current_state: "category_created",
        needs_user_input: false,
        data: {
          category,
          categories: await listActiveCategoriesAsync(auth.context.householdId)
        }
      });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "category_name_required") {
        return unexpectedApiErrorResponse(error);
      }
      return noStoreJson(
        {
          memory_object_id: null,
          confidence: 0,
          source_refs: [],
          current_state: "category_name_required",
          needs_user_input: true,
          next_best_question: "分類名叫咩？",
          data: {}
        },
        { status: 400 }
      );
    }
  } catch (error) {
    return unexpectedApiErrorResponse(error);
  }
}
