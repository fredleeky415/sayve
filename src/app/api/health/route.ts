import { noStoreJson } from "@/server/api/http";
import { resolveMemoryRepositoryMode } from "@/server/memory/store";

export async function GET() {
  return noStoreJson({
    ok: true,
    app: "sayve",
    timestamp: new Date().toISOString(),
    repositoryMode: resolveMemoryRepositoryMode()
  });
}
