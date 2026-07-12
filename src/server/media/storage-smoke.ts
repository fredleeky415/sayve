import { randomUUID } from "node:crypto";
import { captureMediaBucket } from "@/server/media/storage";
import { createSupabaseServiceClient } from "@/server/supabase/service-client";
import type { SupabaseClient } from "@supabase/supabase-js";

export type CaptureMediaStorageSmokeResult = {
  configured: boolean;
  ok: boolean;
  bucket: string;
  detail: string;
  uploadPath?: string;
};

type StorageLikeClient = Pick<SupabaseClient, "storage">;

export async function runCaptureMediaStorageSmokeTest(
  client: StorageLikeClient | undefined = createSupabaseServiceClient()
): Promise<CaptureMediaStorageSmokeResult> {
  const bucket = captureMediaBucket();
  if (!bucket) {
    return {
      configured: false,
      ok: false,
      bucket: "",
      detail: "SUPABASE_MEDIA_BUCKET is not configured."
    };
  }

  if (!client) {
    return {
      configured: false,
      ok: false,
      bucket,
      detail: "Supabase service client is not configured."
    };
  }

  const uploadPath = `_healthchecks/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.txt`;
  const payload = new TextEncoder().encode(`sayve storage smoke ${new Date().toISOString()}`);
  const bucketClient = client.storage.from(bucket);
  const upload = await bucketClient.upload(uploadPath, payload, {
    contentType: "text/plain",
    upsert: false
  });

  if (upload.error) {
    return {
      configured: true,
      ok: false,
      bucket,
      uploadPath,
      detail: `Upload failed: ${upload.error.message}`
    };
  }

  const remove = await bucketClient.remove([uploadPath]);
  if (remove.error) {
    return {
      configured: true,
      ok: false,
      bucket,
      uploadPath,
      detail: `Upload succeeded but cleanup failed: ${remove.error.message}`
    };
  }

  return {
    configured: true,
    ok: true,
    bucket,
    uploadPath,
    detail: `Server write/delete smoke passed for bucket ${bucket}.`
  };
}
