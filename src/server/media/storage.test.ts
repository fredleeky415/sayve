import { afterEach, describe, expect, it, vi } from "vitest";
import { captureMediaUploadMaxBytes, storeCaptureFile, type CaptureMediaStorageError } from "./storage";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

function storageClientMock(error?: { message: string }) {
  const upload = vi.fn(async () => ({ error: error ?? null }));
  return {
    upload,
    client: {
      storage: {
        from: vi.fn(() => ({ upload }))
      }
    }
  };
}

describe("capture media storage", () => {
  it("uses default upload guardrails unless explicit env limits are configured", () => {
    delete process.env.RECEIPT_UPLOAD_MAX_BYTES;
    process.env.VOICE_UPLOAD_MAX_BYTES = "42";

    expect(captureMediaUploadMaxBytes("receipt")).toBe(10_000_000);
    expect(captureMediaUploadMaxBytes("voice")).toBe(42);
  });

  it("falls back to the original file name when no media bucket is configured", async () => {
    delete process.env.SUPABASE_MEDIA_BUCKET;

    const stored = await storeCaptureFile({
      householdId: "household_lee",
      sourceType: "receipt",
      file: new File(["receipt"], "receipt.png", { type: "image/png" })
    });

    expect(stored).toEqual({
      ref: "receipt.png",
      stored: false,
      reason: "media_bucket_not_configured"
    });
  });

  it("does not upload files above the media upload size limit in prototype mode", async () => {
    process.env.SUPABASE_MEDIA_BUCKET = "sayve-capture-media";
    process.env.RECEIPT_UPLOAD_MAX_BYTES = "5";
    const mock = storageClientMock();

    const stored = await storeCaptureFile(
      {
        householdId: "household_lee",
        sourceType: "receipt",
        file: new File(["too-large"], "receipt.png", { type: "image/png" })
      },
      mock.client as never
    );

    expect(mock.upload).not.toHaveBeenCalled();
    expect(stored).toEqual({
      ref: "receipt.png",
      stored: false,
      reason: "media_file_too_large",
      maxBytes: 5,
      fileSize: 9
    });
  });

  it("uploads capture files to the configured Supabase media bucket", async () => {
    process.env.SUPABASE_MEDIA_BUCKET = "sayve-capture-media";
    const mock = storageClientMock();

    const stored = await storeCaptureFile(
      {
        householdId: "household_lee",
        sourceType: "voice",
        file: new File(["voice"], "my voice.webm", { type: "audio/webm" }),
        captureIdHint: "capture_123"
      },
      mock.client as never
    );

    expect(mock.client.storage.from).toHaveBeenCalledWith("sayve-capture-media");
    expect(mock.upload).toHaveBeenCalledWith(
      "households/household_lee/captures/voice/capture_123-my-voice.webm",
      expect.any(ArrayBuffer),
      expect.objectContaining({ contentType: "audio/webm", upsert: false })
    );
    expect(stored).toEqual({
      ref: "supabase://sayve-capture-media/households/household_lee/captures/voice/capture_123-my-voice.webm",
      bucket: "sayve-capture-media",
      path: "households/household_lee/captures/voice/capture_123-my-voice.webm",
      stored: true
    });
  });

  it("fails closed when media storage is required and the bucket is not configured", async () => {
    delete process.env.SUPABASE_MEDIA_BUCKET;
    process.env.SAYVE_REQUIRE_MEDIA_STORAGE = "1";

    await expect(
      storeCaptureFile({
        householdId: "household_lee",
        sourceType: "receipt",
        file: new File(["receipt"], "receipt.png", { type: "image/png" })
      })
    ).rejects.toMatchObject({
      name: "CaptureMediaStorageError",
      code: "capture_media_bucket_not_configured",
      status: 503
    });
  });

  it("fails closed when media storage is required and the file is too large", async () => {
    process.env.SUPABASE_MEDIA_BUCKET = "sayve-capture-media";
    process.env.SAYVE_REQUIRE_MEDIA_STORAGE = "1";
    process.env.VOICE_UPLOAD_MAX_BYTES = "5";
    const mock = storageClientMock();

    await expect(
      storeCaptureFile(
        {
          householdId: "household_lee",
          sourceType: "voice",
          file: new File(["too-large"], "voice.webm", { type: "audio/webm" })
        },
        mock.client as never
      )
    ).rejects.toMatchObject({
      name: "CaptureMediaStorageError",
      code: "capture_media_file_too_large",
      status: 413
    } satisfies Partial<CaptureMediaStorageError>);
    expect(mock.upload).not.toHaveBeenCalled();
  });

  it("fails closed on upload errors when production media storage is required", async () => {
    process.env.SUPABASE_MEDIA_BUCKET = "sayve-capture-media";
    process.env.SAYVE_REQUIRE_MEDIA_STORAGE = "1";
    const mock = storageClientMock({ message: "bucket missing" });

    await expect(
      storeCaptureFile(
        {
          householdId: "household_lee",
          sourceType: "receipt",
          file: new File(["receipt"], "receipt.png", { type: "image/png" })
        },
        mock.client as never
      )
    ).rejects.toThrow("capture_media_storage_failed:bucket missing");
  });
});
