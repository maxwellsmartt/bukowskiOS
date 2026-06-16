import { getDesktopLogger } from "../logger";

const logger = getDesktopLogger("openai-provider");
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com";

export type OpenAIProviderConfig = {
  apiKey: string;
  baseUrl?: string;
  defaultModelKey: string;
  timeoutMs: number;
};

export type OpenAIConnectionResult =
  | {
      ok: true;
      status: "healthy";
      summary: string;
    }
  | {
      ok: false;
      status: "invalid_key" | "unavailable";
      summary: string;
    };

export type AIProviderModelOption = {
  key: string;
  label: string;
  raw?: Record<string, unknown>;
};

export type OpenAIResponseFunctionTool = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type OpenAIResponseCreateInput = {
  model: string;
  instructions?: string;
  input: string | Array<Record<string, unknown>>;
  previousResponseId?: string | null;
  tools?: OpenAIResponseFunctionTool[];
  toolChoice?: "auto" | "none" | "required";
  maxOutputTokens?: number;
  /** Sampling temperature. 0 = deterministic (used for data extraction). */
  temperature?: number;
  textFormat?: Record<string, unknown>;
};

export type OpenAIResponseFunctionCall = {
  id: string;
  call_id: string;
  name: string;
  arguments: string;
  type: "function_call";
};

export type OpenAIResponseCreateResult =
  | {
      ok: true;
      responseId: string;
      status: string;
      outputText: string;
      functionCalls: OpenAIResponseFunctionCall[];
    }
  | {
      ok: false;
      status: "invalid_key" | "unavailable";
      summary: string;
    };

export type OpenAIAudioTranscriptionInput = {
  data: Buffer;
  fileName: string;
  mimeType: string;
  model?: string;
};

export type OpenAIAudioTranscriptionResult =
  | {
      ok: true;
      text: string;
      model: string;
    }
  | {
      ok: false;
      status: "invalid_key" | "unavailable";
      summary: string;
    };

const stripVersionSuffix = (value: string) => (value.endsWith("/v1") ? value.slice(0, -3) : value);

const looksLikeOpenAIDashboardUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();

    if (host !== "platform.openai.com") {
      return false;
    }

    return (
      path === "/api-keys" ||
      path.startsWith("/api-keys/") ||
      path.includes("/settings/organization/api-keys") ||
      path.includes("/settings/project/api-keys")
    );
  } catch {
    return false;
  }
};

export const normalizeOpenAIBaseUrl = (baseUrl?: string) => {
  const value = baseUrl?.trim() ?? "";
  if (!value) {
    return DEFAULT_OPENAI_BASE_URL;
  }

  const trimmed = stripVersionSuffix(value.replace(/\/+$/, ""));

  if (looksLikeOpenAIDashboardUrl(trimmed)) {
    return DEFAULT_OPENAI_BASE_URL;
  }

  return trimmed;
};

const resolveBaseUrl = (baseUrl?: string) => normalizeOpenAIBaseUrl(baseUrl);

const resolveModel = (model: string) => {
  const normalized = model.trim();
  const separatorIndex = normalized.indexOf(":");
  return separatorIndex > 0 ? normalized.slice(separatorIndex + 1) : normalized;
};

const extractOutputText = (payload: Record<string, unknown>) => {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }

  const output = Array.isArray(payload.output) ? payload.output : [];

  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const content = Array.isArray((item as { content?: unknown[] }).content) ? (item as { content: unknown[] }).content : [];

    for (const part of content) {
      if (!part || typeof part !== "object") {
        continue;
      }

      const textValue = (part as { text?: unknown }).text;
      if (typeof textValue === "string" && textValue.trim()) {
        return textValue;
      }
    }
  }

  return "";
};

const extractFunctionCalls = (payload: Record<string, unknown>) => {
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output.filter((item): item is OpenAIResponseFunctionCall => {
    if (!item || typeof item !== "object") {
      return false;
    }

    const candidate = item as Partial<OpenAIResponseFunctionCall>;
    return (
      candidate.type === "function_call" &&
      typeof candidate.id === "string" &&
      typeof candidate.call_id === "string" &&
      typeof candidate.name === "string" &&
      typeof candidate.arguments === "string"
    );
  });
};

const mapErrorSummary = async (response: Response) => {
  let errorSummary = `OpenAI returned ${response.status}.`;

  try {
    const payload = (await response.json()) as { error?: { message?: string } };
    if (payload.error?.message) {
      errorSummary = payload.error.message;
    }
  } catch {
    // Keep generic summary if the payload is not JSON.
  }

  return errorSummary;
};

const looksLikeInvalidKeyFailure = (summary: string, statusCode?: number) => {
  const normalized = summary.toLowerCase();
  return (
    statusCode === 401 ||
    normalized.includes("invalid_api_key") ||
    normalized.includes("incorrect api key") ||
    normalized.includes("invalid api key") ||
    normalized.includes("unauthorized")
  );
};

const classifyOpenAIFailureStatus = (summary: string, statusCode?: number): "invalid_key" | "unavailable" =>
  looksLikeInvalidKeyFailure(summary, statusCode) ? "invalid_key" : "unavailable";

const toOpenAIUserFacingFailure = (summary: string, statusCode?: number, baseUrl?: string) => {
  const normalized = summary.toLowerCase();
  const resolvedBaseUrl = resolveBaseUrl(baseUrl);

  if (looksLikeOpenAIDashboardUrl(baseUrl?.trim() ?? "")) {
    return "La Base URL de OpenAI apunta al dashboard y no al API. Usa https://api.openai.com o deja ese campo vacío para usar la ruta oficial.";
  }

  if (
    normalized.includes("insufficient_quota") ||
    normalized.includes("exceeded your current quota") ||
    normalized.includes("billing") ||
    normalized.includes("credit")
  ) {
    return "OpenAI no pudo responder porque la cuenta parece estar sin créditos o con un límite de billing activo. Revisa Billing en OpenAI, recarga créditos y vuelve a intentarlo.";
  }

  if (statusCode === 429 || normalized.includes("rate limit")) {
    return "OpenAI está limitando temporalmente las solicitudes. Espera unos segundos y vuelve a intentarlo.";
  }

  if (statusCode === 403) {
    return `OpenAI rechazó la solicitud (403). Revisa que la Base URL sea ${resolvedBaseUrl}, que la key pertenezca al proyecto correcto y que la cuenta tenga permisos y billing activos.`;
  }

  return summary;
};

export const createOpenAIProviderService = () => ({
  async listModels(config: OpenAIProviderConfig): Promise<AIProviderModelOption[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(3_000, config.timeoutMs));

    try {
      const response = await fetch(`${resolveBaseUrl(config.baseUrl)}/v1/models`, {
        method: "GET",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
        },
      });

      if (!response.ok) {
        const summary = await mapErrorSummary(response);
        throw new Error(toOpenAIUserFacingFailure(summary, response.status, config.baseUrl));
      }

      const payload = (await response.json()) as { data?: Array<Record<string, unknown>> };
      return (payload.data ?? [])
        .map((model) => {
          const id = typeof model.id === "string" ? model.id : "";
          return {
            key: `openai:${id}`,
            label: id,
            raw: model,
          };
        })
        .filter((model) => {
          const id = model.label.toLowerCase();
          if (!id) {
            return false;
          }

          return (
            /^(gpt|o\d|chatgpt)/u.test(id) &&
            !/(image|embedding|audio|tts|whisper|dall-e|moderation|transcribe|realtime)/u.test(id)
          );
        })
        .sort((left, right) => left.label.localeCompare(right.label));
    } finally {
      clearTimeout(timeout);
    }
  },

  async createResponse(config: OpenAIProviderConfig, input: OpenAIResponseCreateInput): Promise<OpenAIResponseCreateResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(3_000, config.timeoutMs));

    try {
      const response = await fetch(`${resolveBaseUrl(config.baseUrl)}/v1/responses`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: resolveModel(input.model),
          instructions: input.instructions,
          input: input.input,
          previous_response_id: input.previousResponseId ?? undefined,
          tools: input.tools,
          tool_choice: input.toolChoice,
          max_output_tokens: input.maxOutputTokens ?? 800,
          temperature: input.temperature,
          parallel_tool_calls: false,
          text: input.textFormat ? { format: input.textFormat } : undefined,
        }),
      });

      if (!response.ok) {
        const summary = await mapErrorSummary(response);
        const userFacingSummary = toOpenAIUserFacingFailure(summary, response.status, config.baseUrl);
        logger.warn("OpenAI request failed.", {
          status: response.status,
          baseUrl: resolveBaseUrl(config.baseUrl),
          model: resolveModel(input.model),
          summary,
        });
        return {
          ok: false,
          status: classifyOpenAIFailureStatus(summary, response.status),
          summary: userFacingSummary,
        };
      }

      const payload = (await response.json()) as Record<string, unknown>;
      return {
        ok: true,
        responseId: typeof payload.id === "string" ? payload.id : "",
        status: typeof payload.status === "string" ? payload.status : "completed",
        outputText: extractOutputText(payload),
        functionCalls: extractFunctionCalls(payload),
      };
    } catch (error) {
      const summary = error instanceof Error ? error.message : "OpenAI request failed.";
      logger.error("OpenAI request threw before completion.", {
        baseUrl: resolveBaseUrl(config.baseUrl),
        model: resolveModel(input.model),
        summary,
      });

      return {
        ok: false,
        status: "unavailable",
        summary,
      };
    } finally {
      clearTimeout(timeout);
    }
  },

  async transcribeAudio(
    config: OpenAIProviderConfig,
    input: OpenAIAudioTranscriptionInput,
  ): Promise<OpenAIAudioTranscriptionResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(15_000, config.timeoutMs));
    const model = resolveModel(input.model ?? "gpt-4o-mini-transcribe");

    try {
      const formData = new FormData();
      const fileData = input.data.buffer.slice(
        input.data.byteOffset,
        input.data.byteOffset + input.data.byteLength,
      ) as ArrayBuffer;
      const fileBlob = new Blob([fileData], { type: input.mimeType });
      formData.append("file", fileBlob, input.fileName);
      formData.append("model", model);

      const response = await fetch(`${resolveBaseUrl(config.baseUrl)}/v1/audio/transcriptions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const summary = await mapErrorSummary(response);
        const userFacingSummary = toOpenAIUserFacingFailure(summary, response.status, config.baseUrl);
        logger.warn("OpenAI transcription failed.", {
          status: response.status,
          baseUrl: resolveBaseUrl(config.baseUrl),
          model,
          summary,
        });
        return {
          ok: false,
          status: classifyOpenAIFailureStatus(summary, response.status),
          summary: userFacingSummary,
        };
      }

      const payload = (await response.json()) as { text?: unknown };
      const text = typeof payload.text === "string" ? payload.text.trim() : "";

      if (!text) {
        return {
          ok: false,
          status: "unavailable",
          summary: "No speech was detected in that audio.",
        };
      }

      return {
        ok: true,
        text,
        model,
      };
    } catch (error) {
      const summary = error instanceof Error ? error.message : "OpenAI transcription failed.";
      logger.error("OpenAI transcription threw before completion.", {
        baseUrl: resolveBaseUrl(config.baseUrl),
        model,
        summary,
      });

      return {
        ok: false,
        status: "unavailable",
        summary,
      };
    } finally {
      clearTimeout(timeout);
    }
  },

  async testConnection(config: OpenAIProviderConfig): Promise<OpenAIConnectionResult> {
    const result = await this.createResponse(config, {
      model: config.defaultModelKey,
      input: "Reply with the single word OK.",
      maxOutputTokens: 16,
      toolChoice: "none",
    });

    if (!result.ok) {
      return result;
    }

    return {
      ok: true,
      status: "healthy",
      summary: "OpenAI responded successfully.",
    };
  },
});

export type OpenAIProviderService = ReturnType<typeof createOpenAIProviderService>;
