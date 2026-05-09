const remoteErrorPattern = /^(?:Error:\s*)?Error invoking remote method '[^']+': Error:\s*/;

export const getUserFacingErrorMessage = (error: unknown, fallbackMessage: string) => {
  if (!(error instanceof Error)) {
    if (error && typeof error === "object") {
      const record = error as { code?: unknown; details?: unknown; hint?: unknown; message?: unknown };
      const parts = [record.message, record.details, record.hint].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
      const code = typeof record.code === "string" && record.code.trim() ? ` (${record.code.trim()})` : "";
      if (parts.length) {
        return `${parts.join(" ")}${code}`.trim();
      }
    }
    return fallbackMessage;
  }

  let message = error.message.trim();
  while (remoteErrorPattern.test(message)) {
    message = message.replace(remoteErrorPattern, "").trim();
  }

  return message || fallbackMessage;
};
