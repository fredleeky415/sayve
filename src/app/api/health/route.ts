import { noStoreJson } from "@/server/api/http";

export async function GET() {
  return noStoreJson({
    ok: true,
    app: "sayve",
    timestamp: new Date().toISOString(),
    repositoryMode: process.env.MEMORY_REPOSITORY === "supabase" ? "supabase" : "local_file"
  });
}
