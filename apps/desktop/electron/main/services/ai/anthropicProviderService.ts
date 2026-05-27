import { getDesktopLogger } from "../logger";
import type {
  OpenAIConnectionResult,
  OpenAIProviderConfig,
  OpenAIResponseCreateInput,
  OpenAIResponseCreateResult,
  OpenAIResponseFunctionCall,
  AIProviderModelOption,
} from "./openaiProviderService";

const logger = getDesktopLogger("anthropic-provider");
const anthropicVersion = "2023-06-01";

type AnthropicContentBlock =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image";
      source: {
        type: "base64";
        media_type: string;
        data: string;
      };
    }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: unknown;
    }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: string;
    };

type AnthropicMessage = {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
};

type AnthropicMessageResponse = {
  id?: string;
  type?: string;
  role?: string;
  content?: AnthropicContentBlock[];
  stop_reason?: string | null;
};

const conversationSnapshots = new Map<string, AnthropicMessage[]>();

const resolveBaseUrl = (baseUrl?: string) => {
  const value = baseUrl?.trim();
  const normalized = value ? value.replace(/\/+$/, "") : "https://api.anthropic.com";
  return normalized.endsWith("/v1") ? normalized.slice(0, -3) : normalized;
};

const resolveModel = (model: string) => {
  const normalized = model.trim();
  const separatorIndex = normalized.indexOf(":");
  const modelKey = separatorIndex > 0 ? normalized.slice(separatorIndex + 1) : normalized;

  const aliases: Record<string, string> = {
    "sonnet-4": "claude-sonnet-4-20250514",
    "claude-sonnet-4": "claude-sonnet-4-20250514",
    "opus-4.1": "claude-opus-4-1-20250805",
    "claude-opus-4.1": "claude-opus-4-1-20250805",
  };

  return aliases[modelKey] ?? modelKey;
};

const dataUrlToImageBlock = (dataUrl: string): AnthropicContentBlock | null => {
  const match = /^data:([^;]+);base64,(.+)$/u.exec(dataUrl);
  if (!match) {
    return null;
  }

  return {
    type: "image",
    source: {
      type: "base64",
      media_type: match[1] ?? "image/png",
      data: match[2] ?? "",
    },
  };
};

const appendInputMessages = (messages: AnthropicMessage[], input: OpenAIResponseCreateInput["input"]) => {
  if (typeof input === "string") {
    messages.push({ role: "user", content: input });
    return;
  }

  const items = Array.isArray(input) ? input : [];
  const functionOutputs = items.filter((item) => item?.type === "function_call_output") as Array<{
    call_id?: unknown;
    output?: unknown;
  }>;

  if (functionOutputs.length) {
    messages.push({
      role: "user",
      content: functionOutputs.map((item) => ({
        type: "tool_result",
        tool_use_id: typeof item.call_id === "string" ? item.call_id : "",
        content: typeof item.output === "string" ? item.output : JSON.stringify(item.output ?? {}),
      })),
    });
    return;
  }

  for (const item of items) {
    const role = item.role === "assistant" ? "assistant" : "user";
    const content = Array.isArray(item.content) ? item.content : [];
    const blocks: AnthropicContentBlock[] = [];

    for (const part of content) {
      if (!part || typeof part !== "object") {
        continue;
      }

      if (part.type === "input_text" && typeof part.text === "string") {
        blocks.push({ type: "text", text: part.text });
        continue;
      }

      if (part.type === "input_image" && typeof part.image_url === "string") {
        const imageBlock = dataUrlToImageBlock(part.image_url);
        if (imageBlock) {
          blocks.push(imageBlock);
        }
      }
    }

    if (blocks.length) {
      messages.push({ role, content: blocks });
    } else {
      messages.push({ role, content: JSON.stringify(item) });
    }
  }
};

const buildSystemPrompt = (instructions?: string, textFormat?: Record<string, unknown>) => {
  const base = instructions?.trim() ?? "";
  if (!textFormat) {
    return base || undefined;
  }

  return [
    base,
    "Return only valid JSON. Do not wrap it in Markdown. The JSON must match this response format:",
    JSON.stringify(textFormat),
  ]
    .filter(Boolean)
    .join("\n\n");
};

const mapTools = (tools: OpenAIResponseCreateInput["tools"]) =>
  tools?.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }));

const mapToolChoice = (toolChoice: OpenAIResponseCreateInput["toolChoice"]) => {
  if (toolChoice === "required") {
    return { type: "any" };
  }

  if (toolChoice === "auto") {
    return { type: "auto" };
  }

  return undefined;
};

const extractOutputText = (payload: AnthropicMessageResponse) =>
  (payload.content ?? [])
    .filter((block): block is Extract<AnthropicContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

const extractFunctionCalls = (payload: AnthropicMessageResponse): OpenAIResponseFunctionCall[] =>
  (payload.content ?? [])
    .filter((block): block is Extract<AnthropicContentBlock, { type: "tool_use" }> => block.type === "tool_use")
    .map((block) => ({
      id: block.id,
      call_id: block.id,
      name: block.name,
      arguments: JSON.stringify(block.input ?? {}),
      type: "function_call",
    }));

const mapErrorSummary = async (response: Response) => {
  let errorSummary = `Anthropic returned ${response.status}.`;

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

export const createAnthropicProviderService = () => ({
  async listModels(config: OpenAIProviderConfig): Promise<AIProviderModelOption[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(3_000, config.timeoutMs));

    try {
      const response = await fetch(`${resolveBaseUrl(config.baseUrl)}/v1/models`, {
        method: "GET",
        signal: controller.signal,
        headers: {
          "x-api-key": config.apiKey,
          "anthropic-version": anthropicVersion,
        },
      });

      if (!response.ok) {
        const summary = await mapErrorSummary(response);
        throw new Error(summary);
      }

      const payload = (await response.json()) as { data?: Array<Record<string, unknown>> };
      return (payload.data ?? [])
        .map((model) => {
          const id = typeof model.id === "string" ? model.id : "";
          const displayName = typeof model.display_name === "string" ? model.display_name : id;
          return {
            key: `anthropic:${id}`,
            label: displayName,
            raw: model,
          };
        })
        .filter((model) => Boolean(model.key.split(":")[1]))
        .sort((left, right) => left.label.localeCompare(right.label));
    } finally {
      clearTimeout(timeout);
    }
  },

  async createResponse(config: OpenAIProviderConfig, input: OpenAIResponseCreateInput): Promise<OpenAIResponseCreateResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(3_000, config.timeoutMs));
    const messages = input.previousResponseId
      ? [...(conversationSnapshots.get(input.previousResponseId) ?? [])]
      : [];
    appendInputMessages(messages, input.input);

    try {
      const response = await fetch(`${resolveBaseUrl(config.baseUrl)}/v1/messages`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": anthropicVersion,
        },
        body: JSON.stringify({
          model: resolveModel(input.model),
          system: buildSystemPrompt(input.instructions, input.textFormat),
          messages,
          tools: input.toolChoice === "none" ? undefined : mapTools(input.tools),
          tool_choice: input.toolChoice === "none" ? undefined : mapToolChoice(input.toolChoice),
          max_tokens: input.maxOutputTokens ?? 800,
          temperature: input.temperature,
        }),
      });

      if (!response.ok) {
        const summary = await mapErrorSummary(response);
        logger.warn("Anthropic request failed.", {
          status: response.status,
          baseUrl: resolveBaseUrl(config.baseUrl),
          model: resolveModel(input.model),
          summary,
        });
        return {
          ok: false,
          status: response.status === 401 || response.status === 403 ? "invalid_key" : "unavailable",
          summary,
        };
      }

      const payload = (await response.json()) as AnthropicMessageResponse;
      const responseId = typeof payload.id === "string" ? payload.id : `anthropic-${Date.now().toString(36)}`;
      conversationSnapshots.set(responseId, [
        ...messages,
        {
          role: "assistant",
          content: payload.content ?? [],
        },
      ]);

      return {
        ok: true,
        responseId,
        status: payload.stop_reason ?? "completed",
        outputText: extractOutputText(payload),
        functionCalls: extractFunctionCalls(payload),
      };
    } catch (error) {
      const summary = error instanceof Error ? error.message : "Anthropic request failed.";
      logger.error("Anthropic request threw before completion.", {
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
      summary: "Anthropic responded successfully.",
    };
  },
});

export type AnthropicProviderService = ReturnType<typeof createAnthropicProviderService>;
