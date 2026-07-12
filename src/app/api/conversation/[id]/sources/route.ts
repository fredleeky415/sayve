import { getConversationSources } from "@/server/memory/engine";
import { resolveRequestAuthContext } from "@/server/auth/request-context";
import { noStoreJson } from "@/server/api/http";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await resolveRequestAuthContext(request, new URL(request.url).searchParams.get("householdId") ?? undefined, { access: "read" });
  if (!auth.ok) return auth.response;
  return noStoreJson(await getConversationSources(id, auth.context.householdId));
}
