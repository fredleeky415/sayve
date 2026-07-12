import { runMemoryEvolution } from "@/server/memory/engine";
import { resolveRequestAuthContext } from "@/server/auth/request-context";
import { noStoreJson } from "@/server/api/http";

export async function POST(request: Request) {
  const auth = await resolveRequestAuthContext(request, new URL(request.url).searchParams.get("householdId") ?? undefined);
  if (!auth.ok) return auth.response;
  return noStoreJson(await runMemoryEvolution(auth.context.householdId));
}
