import { audioTranscriptionUnavailableReason, normalizeVoiceTranscript, transcribeAudio } from "@/server/ai/audio";
import { aiModels } from "@/server/ai/models";
import { captureMemory } from "@/server/memory/engine";
import { recordAiTelemetryAsync } from "@/server/memory/telemetry";
import { invalidJsonResponse, readJsonObject, unexpectedApiErrorResponse } from "@/server/api/json";
import { isSupabaseAuthRequired, requestHasSupabaseBearerToken, requestHouseholdHeaderId, resolveRequestAuthContext } from "@/server/auth/request-context";
import { CaptureMediaStorageError, storeCaptureFile } from "@/server/media/storage";
import { noStoreJson } from "@/server/api/http";

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const authBeforeUpload =
        isSupabaseAuthRequired() && (!requestHasSupabaseBearerToken(request) || requestHouseholdHeaderId(request))
          ? await resolveRequestAuthContext(request)
          : undefined;
      if (authBeforeUpload && !authBeforeUpload.ok) return authBeforeUpload.response;

      const form = await request.formData();
      const file = form.get("file");
      const auth = authBeforeUpload ?? (await resolveRequestAuthContext(request, String(form.get("householdId") ?? "") || undefined));
      if (!auth.ok) return auth.response;
      const householdId = auth.context.householdId;
      const suppliedTranscriptRaw = String(form.get("transcript") ?? "").trim();
      const suppliedTranscript = suppliedTranscriptRaw ? normalizeVoiceTranscript(suppliedTranscriptRaw) : "";
      const transcriptionStartedAt = !suppliedTranscript && file instanceof File && !audioTranscriptionUnavailableReason(file) ? Date.now() : undefined;
      const transcription = !suppliedTranscript && file instanceof File ? await transcribeAudio(file) : undefined;
      const transcript = suppliedTranscript || transcription?.transcript || "Voice captured";

      let storedFile: Awaited<ReturnType<typeof storeCaptureFile>> | undefined;
      let mediaStorageReason: string | undefined;
      if (file instanceof File) {
        try {
          storedFile = await storeCaptureFile({ householdId, sourceType: "voice", file });
          mediaStorageReason = storedFile.reason;
        } catch (error) {
          if (error instanceof CaptureMediaStorageError) {
            if (error.status === 413) throw error;
            mediaStorageReason = error.code;
          } else {
            throw error;
          }
        }
      }

      let mediaTelemetry: Parameters<typeof recordAiTelemetryAsync>[0] | undefined;
      if (transcription && file instanceof File) {
        mediaTelemetry = {
          householdId,
          phase: "speech_to_text",
          model: transcription.model,
          provider: "openai",
          sourceType: "voice",
          status: "success",
          promptTokens: transcription.promptTokens,
          completionTokens: transcription.completionTokens,
          totalTokens: transcription.totalTokens,
          estimatedCostUsd: transcription.estimatedCostUsd,
          durationMs: transcription.durationMs,
          metadata: {
            fileName: file.name,
            fileSize: file.size,
            fileType: file.type,
            rawTranscript: transcription.rawTranscript,
            cleanedTranscript: transcription.transcript
          }
        };
      }
      if (!transcription && file instanceof File && !suppliedTranscript) {
        const unavailableReason = audioTranscriptionUnavailableReason(file);
        mediaTelemetry = {
          householdId,
          phase: "speech_to_text",
          model: aiModels.speechToText,
          provider: process.env.OPENAI_API_KEY ? "openai" : "system",
          sourceType: "voice",
          status: unavailableReason ? "fallback" : "error",
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          estimatedCostUsd: 0,
          durationMs: transcriptionStartedAt ? Math.max(1, Date.now() - transcriptionStartedAt) : 0,
          metadata: {
            reason: "speech_to_text_unavailable",
            unavailableReason: unavailableReason ?? "speech_to_text_provider_error",
            fileName: file.name,
            fileSize: file.size,
            fileType: file.type,
            openaiConfigured: Boolean(process.env.OPENAI_API_KEY)
          }
        };
      }
      const result = await captureMemory({
        householdId,
        actorUserId: auth.context.userId,
        sourceType: "voice",
        transcript,
        fileRefs: file instanceof File ? [storedFile?.ref ?? file.name] : [],
        metadata: {
          fileName: file instanceof File ? file.name : undefined,
          mediaStorageRef: storedFile?.ref,
          mediaStorageBucket: storedFile?.bucket,
          mediaStoragePath: storedFile?.path,
          mediaStored: storedFile?.stored ?? false,
          mediaStorageReason,
          speechToTextModel: transcription?.model,
          speechToTextStatus: transcription ? "transcribed" : suppliedTranscript ? "provided" : "not_available",
          rawTranscript: transcription?.rawTranscript ?? (suppliedTranscriptRaw || undefined),
          cleanedTranscript: transcription?.transcript ?? (suppliedTranscript || undefined),
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

    const authBeforeBody =
      isSupabaseAuthRequired() && (!requestHasSupabaseBearerToken(request) || requestHouseholdHeaderId(request))
        ? await resolveRequestAuthContext(request)
        : undefined;
    if (authBeforeBody && !authBeforeBody.ok) return authBeforeBody.response;

    let body: Record<string, unknown>;
    try {
      body = await readJsonObject(request);
    } catch {
      return invalidJsonResponse();
    }
    const auth = authBeforeBody ?? (await resolveRequestAuthContext(request, typeof body.householdId === "string" ? body.householdId : undefined));
    if (!auth.ok) return auth.response;
    const result = await captureMemory({
      householdId: auth.context.householdId,
      actorUserId: auth.context.userId,
      sourceType: "voice",
      transcript: typeof body.transcript === "string" ? normalizeVoiceTranscript(body.transcript) : "",
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
              ? "錄音太大，請縮短錄音再試一次。"
              : "暫時未儲到錄音，稍後再試一次。",
          data: {
            error: error.code
          }
        },
        { status: error.status }
      );
    }
    console.error("[api/captures/voice] unexpected failure", error);
    return unexpectedApiErrorResponse(error, {}, { captureLabel: "voice" });
  }
}
