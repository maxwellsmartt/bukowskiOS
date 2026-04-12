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
  toolChoice?: "auto" | "none";
  maxOutputTokens?: number;
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

const resolveBaseUrl = (baseUrl?: string) => {
  const value = baseUrl?.trim();
  const normalized = value ? value.replace(/\/+$/, "") : "https://api.openai.com";
  return normalized.endsWith("/v1") ? normalized.slice(0, -3) : normalized;
};

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

export const createOpenAIProviderService = () => ({
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
          parallel_tool_calls: false,
          text: input.textFormat ? { format: input.textFormat } : undefined,
        }),
      });

      if (!response.ok) {
        const summary = await mapErrorSummary(response);
        return {
          ok: false,
          status: response.status === 401 || response.status === 403 ? "invalid_key" : "unavailable",
          summary,
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
