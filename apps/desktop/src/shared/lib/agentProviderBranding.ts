import anthropicLogo from "@shared/assets/logos/anthropic-claude.svg";
import openaiLogo from "@shared/assets/logos/openai.svg";
import openclawLogo from "@shared/assets/logos/openclaw-color.png";

type ProviderBrand = {
  key: string | null;
  label: string | null;
  logoSrc: string | null;
  logoAlt: string | null;
  logoClassName: string | null;
};

const normalizeProviderKey = (value: string | null | undefined) => {
  const normalized = value?.trim().toLowerCase() ?? "";

  if (!normalized) {
    return null;
  }

  if (normalized.includes(":")) {
    return normalized.split(":")[0] ?? null;
  }

  if (normalized.includes("claude") || normalized.includes("anthropic")) {
    return "anthropic";
  }

  if (normalized.includes("openclaw")) {
    return "openclaw";
  }

  if (normalized.includes("gpt") || normalized.includes("openai")) {
    return "openai";
  }

  return normalized;
};

export const getAgentProviderBrand = (value: string | null | undefined): ProviderBrand => {
  const providerKey = normalizeProviderKey(value);

  switch (providerKey) {
    case "openai":
      return {
        key: providerKey,
        label: "OpenAI",
        logoSrc: openaiLogo,
        logoAlt: "OpenAI",
        logoClassName: "is-openai",
      };
    case "anthropic":
      return {
        key: providerKey,
        label: "Anthropic",
        logoSrc: anthropicLogo,
        logoAlt: "Anthropic",
        logoClassName: null,
      };
    case "openclaw":
      return {
        key: providerKey,
        label: "OpenClaw",
        logoSrc: openclawLogo,
        logoAlt: "OpenClaw",
        logoClassName: null,
      };
    default:
      return {
        key: providerKey,
        label: null,
        logoSrc: null,
        logoAlt: null,
        logoClassName: null,
      };
  }
};
