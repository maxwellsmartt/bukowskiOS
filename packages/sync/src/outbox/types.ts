export type SyncOutboxItem = {
  id: string;
  workspaceId: string;
  entityType: string;
  entityId: string;
  operationType: string;
  payloadJson: string;
  status: "pending" | "processing" | "failed" | "sent";
  attemptCount: number;
  lastError?: string;
  nextRetryAt?: string;
};
