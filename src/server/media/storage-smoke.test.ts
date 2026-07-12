import { afterEach, describe, expect, it, vi } from "vitest";
import { runCaptureMediaStorageSmokeTest } from "./storage-smoke";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

function smokeClientMock(options: {
  uploadError?: { message: string } | null;
  removeError?: { message: string } | null;
} = {}) {
  const upload = vi.fn(async () => ({ error: options.uploadError ?? null }));
  const remove = vi.fn(async () => ({ error: options.removeError ?? null }));
  return {
    upload,
    remove,
    client: {
      storage: {
        from: vi.fn(() => ({ upload, remove }))
      }
    }
  };
}

describe("capture media storage smoke", () => {
  it("reports missing bucket configuration", async () => {
    delete process.env.SUPABASE_MEDIA_BUCKET;

    await expect(runCaptureMediaStorageSmokeTest()).resolves.toEqual({
      configured: false,
      ok: false,
      bucket: "",
      detail: "SUPABASE_MEDIA_BUCKET is not configured."
    });
  });

  it("reports missing service client when the bucket exists", async () => {
    process.env.SUPABASE_MEDIA_BUCKET = "sayve-capture-media";

    await expect(runCaptureMediaStorageSmokeTest(undefined)).resolves.toEqual({
      configured: false,
      ok: false,
      bucket: "sayve-capture-media",
      detail: "Supabase service client is not configured."
    });
  });

  it("passes when the server can upload and delete inside the bucket", async () => {
    process.env.SUPABASE_MEDIA_BUCKET = "sayve-capture-media";
    const mock = smokeClientMock();

    const result = await runCaptureMediaStorageSmokeTest(mock.client as never);

    expect(mock.client.storage.from).toHaveBeenCalledWith("sayve-capture-media");
    expect(mock.upload).toHaveBeenCalledWith(
      expect.stringMatching(/^_healthchecks\/\d{4}-\d{2}-\d{2}\//),
      expect.any(Uint8Array),
      expect.objectContaining({ contentType: "text/plain", upsert: false })
    );
    expect(mock.remove).toHaveBeenCalledWith([expect.stringMatching(/^_healthchecks\/\d{4}-\d{2}-\d{2}\//)]);
    expect(result.ok).toBe(true);
    expect(result.bucket).toBe("sayve-capture-media");
    expect(result.detail).toContain("Server write/delete smoke passed");
  });

  it("fails when upload cannot write into the bucket", async () => {
    process.env.SUPABASE_MEDIA_BUCKET = "sayve-capture-media";
    const mock = smokeClientMock({ uploadError: { message: "permission denied" } });

    const result = await runCaptureMediaStorageSmokeTest(mock.client as never);

    expect(mock.remove).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      configured: true,
      ok: false,
      bucket: "sayve-capture-media",
      detail: "Upload failed: permission denied"
    });
  });

  it("fails when cleanup cannot remove the healthcheck object", async () => {
    process.env.SUPABASE_MEDIA_BUCKET = "sayve-capture-media";
    const mock = smokeClientMock({ removeError: { message: "cleanup denied" } });

    const result = await runCaptureMediaStorageSmokeTest(mock.client as never);

    expect(result).toMatchObject({
      configured: true,
      ok: false,
      bucket: "sayve-capture-media",
      detail: "Upload succeeded but cleanup failed: cleanup denied"
    });
  });
});
