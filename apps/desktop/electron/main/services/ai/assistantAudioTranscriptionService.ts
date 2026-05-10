import type { DatabaseSync } from "node:sqlite";

import type {
  AssistantAudioTranscriptionResult,
  TranscribeAssistantAudioCommand,
} from "@contracts";
import { DEFAULT_WORKSPACE_ID } from "@contracts";

import type { AISecretStore } from "./aiSecretStore";
import type { OpenAIProviderService } from "./openaiProviderService";

const maxAudioBytes = 25 * 1024 * 1024;
const defaultTranscriptionModel = "gpt-4o-mini-transcribe";

const parseDataUrl = (dataUrl: string) => {
  const match = /^data:([^;,]+)(?:;[^,]*)?;base64,(.+)$/u.exec(dataUrl);
  if (!match) {
    throw new Error("The audio recording could not be read. Try recording it again.");
  }

  return {
    mimeType: match[1],
    data: Buffer.from(match[2], "base64"),
  };
};

const normalizeAudioFileName = (value: string, mimeType: string) => {
  const safeName = value
    .trim()
    .replace(/[\\/:*?"<>|]+/gu, "-")
    .replace(/\s+/gu, "-");

  if (safeName.includes(".")) {
    return safeName;
  }

  const extension = mimeType.includes("webm")
    ? "webm"
    : mimeType.includes("ogg")
      ? "ogg"
      : mimeType.includes("mpeg") || mimeType.includes("mp3")
        ? "mp3"
        : mimeType.includes("wav")
          ? "wav"
          : "m4a";

  return `${safeName || "voice-note"}.${extension}`;
};

const normalizeAudioMimeType = (value: string) => value.split(";")[0]?.trim() || "audio/webm";

const formatTranscriptionFailure = (summary: string) => {
  const normalized = summary.toLowerCase();

  if (normalized.includes("sin créditos") || normalized.includes("billing") || normalized.includes("credit") || normalized.includes("quota")) {
    return "Voice transcription is paused because the OpenAI account appears to be out of credits or blocked by billing limits. Add credits in OpenAI Billing and try again.";
  }

  if (normalized.includes("rate limit") || normalized.includes("limitando temporalmente")) {
    return "Voice transcription is temporarily rate-limited. Wait a few seconds and try again.";
  }

  return summary;
};

export const createAssistantAudioTranscriptionService = (
  db: DatabaseSync,
  options: {
    secretStore: Pick<AISecretStore, "getProviderSecret">;
    openaiProviderService: Pick<OpenAIProviderService, "transcribeAudio">;
  },
) => {
  const loadOpenAIConfig = (workspaceId: string) => {
    const row = db
      .prepare(
        `
          SELECT enabled, base_url, timeout_ms
          FROM ai_provider_configs
          WHERE workspace_id = ?
            AND provider_key = 'openai'
          LIMIT 1
        `,
      )
      .get(workspaceId) as { enabled: number; base_url: string | null; timeout_ms: number | null } | undefined;

    const apiKey =
      options.secretStore.getProviderSecret(workspaceId, "openai") ??
      (workspaceId === DEFAULT_WORKSPACE_ID ? null : options.secretStore.getProviderSecret(DEFAULT_WORKSPACE_ID, "openai"));
    if (!apiKey) {
      throw new Error("Voice transcription needs an OpenAI API key in Automation > AI Models.");
    }

    return {
      apiKey,
      baseUrl: row?.base_url ?? undefined,
      defaultModelKey: defaultTranscriptionModel,
      timeoutMs: Math.max(20_000, row?.timeout_ms ?? 45_000),
    };
  };

  const transcribeBuffer = async (input: {
    workspaceId?: string | null;
    data: Buffer;
    fileName: string;
    mimeType: string;
  }): Promise<AssistantAudioTranscriptionResult> => {
    const workspaceId = input.workspaceId?.trim() || DEFAULT_WORKSPACE_ID;
    if (!input.data.length) {
      throw new Error("The audio recording is empty. Try recording it again.");
    }

    if (input.data.byteLength > maxAudioBytes) {
      throw new Error("That voice note is too large to transcribe. Keep recordings under 25 MB.");
    }

    const config = loadOpenAIConfig(workspaceId);
    const result = await options.openaiProviderService.transcribeAudio(config, {
      data: input.data,
      fileName: normalizeAudioFileName(input.fileName, input.mimeType),
      mimeType: normalizeAudioMimeType(input.mimeType),
      model: defaultTranscriptionModel,
    });

    if (!result.ok) {
      throw new Error(formatTranscriptionFailure(result.summary));
    }

    return {
      text: result.text,
      model: result.model,
      byteSize: input.data.byteLength,
    };
  };

  return {
    transcribeBuffer,

    transcribeDataUrl(input: TranscribeAssistantAudioCommand): Promise<AssistantAudioTranscriptionResult> {
      const parsed = parseDataUrl(input.dataUrl);
      return transcribeBuffer({
        workspaceId: input.workspaceId,
        data: parsed.data,
        fileName: input.fileName,
        mimeType: input.mimeType || parsed.mimeType,
      });
    },
  };
};

export type AssistantAudioTranscriptionService = ReturnType<typeof createAssistantAudioTranscriptionService>;
