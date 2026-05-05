/**
 * Shells for non-Telegram channel providers. These declare the contract that any
 * future provider service (WhatsApp Business API, SMTP/Email, SMS gateway,
 * Webhook fan-out) needs to implement so the UI in AgentConnectorsPage and the
 * `agentMutationService.saveConnectorConfig` / `testConnectorConnection` flows
 * can stay generic.
 *
 * The Telegram provider already implements `ChannelProviderService` in
 * `telegramConnectorService.ts`. The shells below mirror that surface so a
 * future contributor can drop in a real provider with the same wiring.
 *
 * Today these stubs are NOT registered into the runtime; they exist as
 * documentation + a typed boundary so the UI knows what fields to render and
 * the IPC layer knows what error to return when the provider is missing.
 */

export type ChannelProviderKey = "telegram" | "whatsapp" | "email" | "sms" | "webhook";

export type ChannelProviderConfigInput = {
  enabled: boolean;
  /** Provider-specific secret (bot token / API key / SMTP password / etc). */
  secret?: string;
  /** Per-provider extra fields, e.g. WhatsApp business number, SMTP host, SMS sender id. */
  extras?: Record<string, string | number | boolean | null>;
  clearStoredSecret?: boolean;
};

export type ChannelProviderTestResult = {
  ok: boolean;
  summary: string;
  detectedIdentifier?: string | null;
};

export type ChannelLinkTokenInput = {
  workspaceId: string;
  workspaceUserId: string;
};

export type ChannelLinkTokenResult = {
  token: string;
  expiresAt: string;
  /** Deep link / shareable URL that the linkable user opens on the provider side. */
  shareableUrl?: string;
  /** Provider-specific instructions to surface in the UI. */
  instructions: string;
};

/**
 * Each provider implements this surface. Telegram already provides it.
 * WhatsApp / Email / SMS / Webhook will provide it in future iterations.
 */
export type ChannelProviderService = {
  readonly providerKey: ChannelProviderKey;
  saveConfig: (input: ChannelProviderConfigInput) => Promise<{ summary: string }>;
  testConnection: () => Promise<ChannelProviderTestResult>;
  generateLinkToken?: (input: ChannelLinkTokenInput) => Promise<ChannelLinkTokenResult>;
  start?: () => Promise<void>;
};

export type ChannelProviderShellMeta = {
  key: ChannelProviderKey;
  label: string;
  shortDescription: string;
  expectedSecretLabel: string;
  expectedExtras: Array<{ key: string; label: string; placeholder: string; required: boolean }>;
  linkInstructions: string;
  shipStatus: "live" | "staged-ui" | "planned";
};

export const channelProviderShells: ChannelProviderShellMeta[] = [
  {
    key: "telegram",
    label: "Telegram",
    shortDescription: "Fast operator messaging via a Telegram Bot API token.",
    expectedSecretLabel: "Bot token",
    expectedExtras: [],
    linkInstructions:
      "Click 'Generate link' next to a teammate, copy the /start command, and paste it inside Telegram.",
    shipStatus: "live",
  },
  {
    key: "whatsapp",
    label: "WhatsApp",
    shortDescription: "Inbound and outbound messaging through the WhatsApp Business Cloud API.",
    expectedSecretLabel: "Access token",
    expectedExtras: [
      { key: "businessPhoneNumberId", label: "Business phone number ID", placeholder: "123456789", required: true },
      { key: "verifyToken", label: "Webhook verify token", placeholder: "secret-string", required: true },
    ],
    linkInstructions:
      "After the workspace is wired, each teammate scans a QR or sends a single keyword to the business number to claim their seat.",
    shipStatus: "staged-ui",
  },
  {
    key: "email",
    label: "Email / Notifications",
    shortDescription: "Drafts, support outreach and internal notices via SMTP or transactional provider.",
    expectedSecretLabel: "API key or SMTP password",
    expectedExtras: [
      { key: "fromAddress", label: "From address", placeholder: "ops@studio.com", required: true },
      { key: "smtpHost", label: "SMTP host (optional if using API)", placeholder: "smtp.postmark.app", required: false },
    ],
    linkInstructions:
      "Email links work as soon as a teammate has an email on their profile. No claim flow needed.",
    shipStatus: "staged-ui",
  },
  {
    key: "sms",
    label: "SMS",
    shortDescription: "Operator alerts via Twilio or compatible SMS gateway.",
    expectedSecretLabel: "Auth token",
    expectedExtras: [
      { key: "accountSid", label: "Account SID", placeholder: "ACxxxxxxxxxxxxxxxxxxxxxxxx", required: true },
      { key: "fromNumber", label: "From number", placeholder: "+15551234567", required: true },
    ],
    linkInstructions:
      "Each teammate confirms the link with a one-time code we text to the phone on their profile.",
    shipStatus: "planned",
  },
  {
    key: "webhook",
    label: "Webhook / Future",
    shortDescription: "Fan-out delivery to custom HTTPS endpoints for future integrations.",
    expectedSecretLabel: "Signing secret",
    expectedExtras: [{ key: "endpointUrl", label: "Endpoint URL", placeholder: "https://hooks.example.com/bukowski", required: true }],
    linkInstructions: "Linking is per-endpoint configuration, not per-user.",
    shipStatus: "planned",
  },
];

export const findChannelShell = (key: string): ChannelProviderShellMeta | null =>
  channelProviderShells.find((shell) => shell.key === key) ?? null;
