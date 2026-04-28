const remoteErrorPattern = /^(?:Error:\s*)?Error invoking remote method '[^']+': Error:\s*/;

export const getUserFacingErrorMessage = (error: unknown, fallbackMessage: string) => {
  if (!(error instanceof Error)) {
    return fallbackMessage;
  }

  let message = error.message.trim();
  while (remoteErrorPattern.test(message)) {
    message = message.replace(remoteErrorPattern, "").trim();
  }

  return message || fallbackMessage;
};
