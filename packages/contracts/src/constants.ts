/** Local-only workspace used when the desktop app runs without a remote session. */
export const LOCAL_FALLBACK_WORKSPACE_ID = "workspace-metadata";

/**
 * Placeholder the workspace provider exposes between boot and the moment the
 * membership list confirms which workspace the user actually belongs to.
 *
 * The stored selection is read from local preferences before that list arrives,
 * and it can point at a workspace that was deleted or that this machine never
 * had — so it is never handed to a query. Callers must treat this value as
 * "not known yet" and skip the read; it is not a workspace and no handler can
 * resolve it.
 */
export const PENDING_WORKSPACE_ID = "__pending-workspace__";

/** True when the id names a real workspace a query can be scoped to. */
export const isResolvedWorkspaceId = (workspaceId: string | null | undefined): workspaceId is string =>
  Boolean(workspaceId) && workspaceId !== PENDING_WORKSPACE_ID;
