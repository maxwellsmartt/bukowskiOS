/**
 * Centralized user-facing labels for internal enum/status values.
 *
 * Rule: never render raw enum values (e.g. `needs_approval`, `routing`, `idle`)
 * in UI. Always map them through one of these helpers so end users read a
 * human phrase, not a developer token.
 */

import type { AgentApprovalMode, AgentRunStatus } from "@contracts";

type SyncOutboxStatus = "pending" | "processing" | "failed" | "sent";
type LastSyncStatus = "idle" | "running" | "success" | "failed";

const agentRunStatusLabels: Record<AgentRunStatus, string> = {
  queued: "Queued",
  routing: "Assigning",
  running: "In progress",
  needs_approval: "Awaiting approval",
  approved: "Approved",
  denied: "Denied",
  done: "Complete",
  failed: "Failed",
  paused: "Paused",
};

const agentApprovalDecisionLabels: Record<string, string> = {
  pending: "Awaiting approval",
  approved: "Approved",
  approve_for_session: "Approved for session",
  denied: "Denied",
};

const agentApprovalModeLabels: Record<AgentApprovalMode, string> = {
  auto: "Automatic",
  supervised: "Supervised",
  needs_approval: "Needs approval",
};

const syncOutboxStatusLabels: Record<SyncOutboxStatus, string> = {
  pending: "Queued",
  processing: "Syncing",
  failed: "Failed",
  sent: "Synced",
};

const lastSyncStatusLabels: Record<LastSyncStatus, string> = {
  idle: "Up to date",
  running: "Syncing…",
  success: "Up to date",
  failed: "Needs attention",
};

/**
 * Fallback for status enums we haven't explicitly mapped yet. Converts
 * `needs_approval` → `Needs approval`. Prefer a dedicated map when possible.
 */
export const titleCaseEnum = (value: string) =>
  value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part, index) =>
      index === 0 ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : part.toLowerCase(),
    )
    .join(" ");

const titleCase = titleCaseEnum;

export const getAgentRunStatusLabel = (status: AgentRunStatus | string) =>
  agentRunStatusLabels[status as AgentRunStatus] ?? titleCase(status);

export const getAgentApprovalDecisionLabel = (decision: string) =>
  agentApprovalDecisionLabels[decision] ?? titleCase(decision);

export const getAgentApprovalModeLabel = (mode: AgentApprovalMode | string) =>
  agentApprovalModeLabels[mode as AgentApprovalMode] ?? titleCase(mode);

export const getSyncOutboxStatusLabel = (status: SyncOutboxStatus | string) =>
  syncOutboxStatusLabels[status as SyncOutboxStatus] ?? titleCase(status);

export const getLastSyncStatusLabel = (status: LastSyncStatus | string) =>
  lastSyncStatusLabels[status as LastSyncStatus] ?? titleCase(status);
