import { dismissInsight } from "@/server/memory/engine";
import { resolveRequestAuthContext } from "@/server/auth/request-context";
import { noStoreJson } from "@/server/api/http";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await resolveRequestAuthContext(request, new URL(request.url).searchParams.get("householdId") ?? undefined);
  if (!auth.ok) return auth.response;
  return noStoreJson({
    memory_object_id: null,
    confidence: 0.9,
    source_refs: [{ type: "insight", id, label: "dismissed", strength: "strong" }],
    current_state: "insight_dismissed",
    needs_user_input: false,
    data: await dismissInsight(id, auth.context.householdId)
  });
}
