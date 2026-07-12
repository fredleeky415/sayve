import { createSupabaseServiceClient } from "@/server/supabase/service-client";
import type { CaptureSource } from "@/shared/memory/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export type StoredCaptureFile = {
  ref: string;
  bucket?: string;
  path?: string;
  stored: boolean;
  reason?: string;
  maxBytes?: number;
  fileSize?: number;
};

type StoreCaptureFileInput = {
  householdId: string;
  sourceType: Extract<CaptureSource, "receipt" | "voice">;
  file: File;
  captureIdHint?: string;
};

const defaultUploadMaxBytes: Record<StoreCaptureFileInput["sourceType"], number> = {
  receipt: 10_000_000,
  voice: 25_000_000
};

const uploadMaxBytesEnv: Record<StoreCaptureFileInput["sourceType"], string> = {
  receipt: "RECEIPT_UPLOAD_MAX_BYTES",
  voice: "VOICE_UPLOAD_MAX_BYTES"
};

export class CaptureMediaStorageError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "CaptureMediaStorageError";
  }
}

function safeFileName(name: string): string {
  return (
    name
      .trim()
      .replace(/[/\\]/g, "-")
      .replace(/[^a-zA-Z0-9._-]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 120) || "capture-file"
  );
}

export function captureMediaBucket(): string {
  return process.env.SUPABASE_MEDIA_BUCKET?.trim() ?? "";
}

export function captureMediaStorageRequired(): boolean {
  return process.env.SAYVE_REQUIRE_MEDIA_STORAGE === "1" || process.env.SAYVE_ENV_TARGET === "public-launch";
}

export function captureMediaUploadMaxBytes(sourceType: StoreCaptureFileInput["sourceType"]): number {
  const parsed = Number(process.env[uploadMaxBytesEnv[sourceType]]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : defaultUploadMaxBytes[sourceType];
}

export async function storeCaptureFile(input: StoreCaptureFileInput, client: SupabaseClient | undefined = createSupabaseServiceClient()): Promise<StoredCaptureFile> {
  const maxBytes = captureMediaUploadMaxBytes(input.sourceType);
  if (input.file.size > maxBytes) {
    if (captureMediaStorageRequired()) {
      throw new CaptureMediaStorageError(
        "capture_media_file_too_large",
        413,
        `capture_media_file_too_large:${input.file.size}>${maxBytes}`
      );
    }
    return { ref: input.file.name, stored: false, reason: "media_file_too_large", maxBytes, fileSize: input.file.size };
  }

  const bucket = captureMediaBucket();
  if (!bucket) {
    if (captureMediaStorageRequired()) {
      throw new CaptureMediaStorageError("capture_media_bucket_not_configured", 503, "capture_media_bucket_not_configured");
    }
    return { ref: input.file.name, stored: false, reason: "media_bucket_not_configured" };
  }
  if (!client) {
    if (captureMediaStorageRequired()) {
      throw new CaptureMediaStorageError("supabase_service_not_configured", 503, "supabase_service_not_configured");
    }
    return { ref: input.file.name, stored: false, reason: "supabase_service_not_configured" };
  }

  const safeName = safeFileName(input.file.name);
  const path = `households/${input.householdId}/captures/${input.sourceType}/${input.captureIdHint ?? crypto.randomUUID()}-${safeName}`;
  const body = await input.file.arrayBuffer();
  const { error } = await client.storage.from(bucket).upload(path, body, {
    contentType: input.file.type || "application/octet-stream",
    upsert: false
  });

  if (error) {
    if (captureMediaStorageRequired()) {
      throw new CaptureMediaStorageError("capture_media_storage_failed", 503, `capture_media_storage_failed:${error.message}`);
    }
    return { ref: input.file.name, bucket, path, stored: false, reason: "storage_upload_failed" };
  }

  return {
    ref: `supabase://${bucket}/${path}`,
    bucket,
    path,
    stored: true
  };
}
