import type { HeadersReceivedResponse, IpcMainInvokeEvent, OnHeadersReceivedListenerDetails } from "electron";

const trustedDevHosts = new Set(["localhost", "127.0.0.1"]);
const blockedExternalProtocols = new Set(["file:", "javascript:", "data:", "smb:", "ftp:", "blob:", "ws:", "wss:"]);
const trustedRemoteImageOrigins = [
  "https://lh3.googleusercontent.com",
  "https://avatars.githubusercontent.com",
  "https://secure.gravatar.com",
];

const createSanitizedError = (message: string) => {
  const error = new Error(message);
  error.stack = `${error.name}: ${message}`;
  return error;
};

export const isTrustedRendererUrl = (value: string) => {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);

    if (url.protocol === "file:") {
      return true;
    }

    if ((url.protocol === "http:" || url.protocol === "https:") && trustedDevHosts.has(url.hostname)) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
};

export const assertTrustedIpcSender = (event: IpcMainInvokeEvent) => {
  const senderUrl = event.senderFrame?.url || event.sender.getURL();

  if (!isTrustedRendererUrl(senderUrl)) {
    throw createSanitizedError("Blocked request from an untrusted renderer.");
  }
};

export const isAllowedExternalUrl = (value: string) => {
  try {
    const url = new URL(value);

    if (blockedExternalProtocols.has(url.protocol)) {
      return false;
    }

    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

export const assertAllowedExternalUrl = (value: string) => {
  if (!isAllowedExternalUrl(value)) {
    throw createSanitizedError("Only http and https links can be opened from the desktop app.");
  }
};

const toAllowedConnectOrigin = (value: string | undefined) => {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
};

export const buildContentSecurityPolicy = (
  devServerUrl?: string,
  remoteConnectUrls: Array<string | undefined> = [],
) => {
  const connectSources = ["'self'", "https://api.openai.com"];
  const scriptSources = ["'self'"];
  const styleSources = ["'self'", "'unsafe-inline'"];
  const imageSources = ["'self'", "data:", "blob:"];

  for (const imageOrigin of trustedRemoteImageOrigins) {
    imageSources.push(imageOrigin);
  }

  for (const remoteConnectUrl of remoteConnectUrls) {
    const origin = toAllowedConnectOrigin(remoteConnectUrl);
    if (origin && !connectSources.includes(origin)) {
      connectSources.push(origin);
    }
    if (origin) {
      const realtimeOrigin = origin.replace(/^https:/, "wss:");
      if (!connectSources.includes(realtimeOrigin)) {
        connectSources.push(realtimeOrigin);
      }
    }
    // Same origins also serve user-uploaded images (avatars, workspace
    // branding, attachments) via Supabase Storage public buckets.
    if (origin && !imageSources.includes(origin)) {
      imageSources.push(origin);
    }
  }

  if (devServerUrl) {
    try {
      const devUrl = new URL(devServerUrl);
      const hostOrigin = `${devUrl.protocol}//${devUrl.host}`;
      connectSources.push(hostOrigin);
      scriptSources.push(hostOrigin, "'unsafe-inline'", "'unsafe-eval'");

      const socketProtocol = devUrl.protocol === "https:" ? "wss:" : "ws:";
      connectSources.push(`${socketProtocol}//${devUrl.host}`);
    } catch {
      // Ignore malformed dev server URLs and keep a locked-down production policy.
    }
  }

  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    `style-src ${styleSources.join(" ")}`,
    `img-src ${imageSources.join(" ")}`,
    "font-src 'self' data:",
    `connect-src ${connectSources.join(" ")}`,
    "worker-src 'self' blob:",
    "frame-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
};

export const applyCspHeaders = (
  details: OnHeadersReceivedListenerDetails,
  callback: (response: HeadersReceivedResponse) => void,
  devServerUrl?: string,
) => {
  const policy = buildContentSecurityPolicy(devServerUrl);
  const responseHeaders = {
    ...(details.responseHeaders ?? {}),
    "Content-Security-Policy": [policy],
  };

  callback({
    cancel: false,
    responseHeaders,
  });
};

export const sanitizeIpcError = (error: unknown, fallbackMessage = "The desktop app could not complete that request.") => {
  if (error instanceof Error) {
    return createSanitizedError(error.message || fallbackMessage);
  }

  if (typeof error === "string" && error.trim()) {
    return createSanitizedError(error.trim());
  }

  return createSanitizedError(fallbackMessage);
};
