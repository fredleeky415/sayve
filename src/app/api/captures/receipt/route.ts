import { extractReceiptWithVision, receiptVisionUnavailableReason } from "@/server/ai/receipt";
import { aiModels } from "@/server/ai/models";
import { captureMemory } from "@/server/memory/engine";
import { recordAiTelemetryAsync } from "@/server/memory/telemetry";
import { invalidJsonResponse, readJsonObject, unexpectedApiErrorResponse } from "@/server/api/json";
import { isSupabaseAuthRequired, resolveRequestAuthContext } from "@/server/auth/request-context";
import { CaptureMediaStorageError, storeCaptureFile } from "@/server/media/storage";
import { noStoreJson } from "@/server/api/http";

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
    const authBeforeUpload = isSupabaseAuthRequired() ? await resolveRequestAuthContext(request) : undefined;
    if (authBeforeUpload && !authBeforeUpload.ok) return authBeforeUpload.response;

    const form = await request.formData();
    const file = form.get("file");
    const auth = authBeforeUpload ?? (await resolveRequestAuthContext(request, String(form.get("householdId") ?? "") || undefined));
    if (!auth.ok) return auth.response;
    const householdId = auth.context.householdId;
    const note = String(form.get("note") ?? "").trim();
    const storedFile = file instanceof File ? await storeCaptureFile({ householdId, sourceType: "receipt", file }) : undefined;
    const explicitNote = file instanceof File && note && note !== file.name ? note : "";
    const visionStartedAt = file instanceof File && !explicitNote && !receiptVisionUnavailableReason(file) ? Date.now() : undefined;
    const vision = file instanceof File && !explicitNote ? await extractReceiptWithVision(file) : undefined;
    let mediaTelemetry: Parameters<typeof recordAiTelemetryAsync>[0] | undefined;
    if (vision && file instanceof File) {
      mediaTelemetry = {
        householdId,
        phase: "receipt_vision",
        model: vision.model,
        provider: "openai",
        sourceType: "receipt",
        status: "success",
        confidence: vision.confidence,
        promptTokens: vision.promptTokens,
        completionTokens: vision.completionTokens,
        totalTokens: vision.totalTokens,
        estimatedCostUsd: vision.estimatedCostUsd,
        durationMs: vision.durationMs,
        metadata: {
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
          structured: vision.structured
        }
      };
    }
    if (!vision && file instanceof File && !explicitNote) {
      const unavailableReason = receiptVisionUnavailableReason(file);
      mediaTelemetry = {
        householdId,
        phase: "receipt_vision",
        model: aiModels.receiptVision,
        provider: process.env.OPENAI_API_KEY ? "openai" : "system",
        sourceType: "receipt",
        status: unavailableReason ? "fallback" : "error",
        confidence: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        durationMs: visionStartedAt ? Math.max(1, Date.now() - visionStartedAt) : 0,
        metadata: {
          reason: "receipt_vision_unavailable",
          unavailableReason: unavailableReason ?? "receipt_vision_provider_error",
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
          openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
          visionDisabled: process.env.OPENAI_RECEIPT_VISION_DISABLED === "1"
        }
      };
    }

    const result = await captureMemory({
      householdId,
      actorUserId: auth.context.userId,
      sourceType: "receipt",
      text: explicitNote || vision?.text || note || "Receipt uploaded",
      fileRefs: storedFile ? [storedFile.ref] : [],
      metadata: {
        fileName: file instanceof File ? file.name : undefined,
        mediaStorageRef: storedFile?.ref,
        mediaStorageBucket: storedFile?.bucket,
        mediaStoragePath: storedFile?.path,
        mediaStored: storedFile?.stored,
        mediaStorageReason: storedFile?.reason,
        receiptVisionModel: vision?.model,
        receiptVisionStatus: vision ? "extracted" : explicitNote ? "provided_note" : "not_available",
        receiptVisionConfidence: vision?.confidence,
        authSource: auth.context.source
      }
    });
    if (mediaTelemetry) {
      await recordAiTelemetryAsync({
        ...mediaTelemetry,
        captureId: result.data.capture?.id,
        memoryObjectId: result.memory_object_id ?? undefined
      });
    }
      return noStoreJson(result);
    }

    const authBeforeBody = isSupabaseAuthRequired() ? await resolveRequestAuthContext(request) : undefined;
    if (authBeforeBody && !authBeforeBody.ok) return authBeforeBody.response;

    let body: Record<string, unknown>;
    try {
      body = await readJsonObject(request);
    } catch {
      return invalidJsonResponse();
    }
    const fileRefs = Array.isArray(body.fileRefs) ? body.fileRefs.filter((item): item is string => typeof item === "string") : [];
    const auth = authBeforeBody ?? (await resolveRequestAuthContext(request, typeof body.householdId === "string" ? body.householdId : undefined));
    if (!auth.ok) return auth.response;
    const result = await captureMemory({
      householdId: auth.context.householdId,
      actorUserId: auth.context.userId,
      sourceType: "receipt",
      text: typeof body.text === "string" ? body.text : "Receipt uploaded",
      fileRefs,
      metadata: {
        authSource: auth.context.source
      }
    });
    return noStoreJson(result);
  } catch (error) {
    if (error instanceof CaptureMediaStorageError) {
      return noStoreJson(
        {
          memory_object_id: null,
          confidence: 0,
          source_refs: [],
          current_state: error.code,
          needs_user_input: true,
          next_best_question:
            error.status === 413
              ? "張收據相太大，請用細一點的相片再試一次。"
              : "暫時未儲到收據相，稍後再試一次。",
          data: {
            error: error.code
          }
        },
        { status: error.status }
      );
    }
    console.error("[api/captures/receipt] unexpected failure", error);
    return unexpectedApiErrorResponse();
  }
}
