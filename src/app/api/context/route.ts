import { listContext } from "@/server/memory/engine";
import { resolveRequestAuthContext } from "@/server/auth/request-context";
import { noStoreJson } from "@/server/api/http";

export async function GET(request: Request) {
  const auth = await resolveRequestAuthContext(request, new URL(request.url).searchParams.get("householdId") ?? undefined, { access: "read" });
  if (!auth.ok) return auth.response;
  return noStoreJson({
    memory_object_id: null,
    confidence: 0.8,
    source_refs: [],
    current_state: "context_review",
    needs_user_input: false,
    data: await listContext(auth.context.householdId)
  });
}
