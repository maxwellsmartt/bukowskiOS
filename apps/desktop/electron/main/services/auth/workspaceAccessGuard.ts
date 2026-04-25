import type { DatabaseSync } from "node:sqlite";

import { DEFAULT_WORKSPACE_ID } from "@contracts";

type WorkspaceAccessLevel = "read" | "write";

type StoredTokens = {
  accessToken: string | null;
};

type WorkspaceAccessGuardOptions = {
  database: DatabaseSync;
  supabaseUrl?: string;
  anonKey?: string;
  getTokens: () => Promise<StoredTokens>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  cacheTtlMs?: number;
};

type AssertWorkspaceAccessInput = {
  workspaceId: string;
  action: string;
  accessLevel?: WorkspaceAccessLevel;
  requiredPermission?: string;
};

type JwtPayload = {
  sub?: string;
  exp?: number;
};

type WorkspaceRow = {
  id: string;
  is_active: number | null;
};

const defaultCacheTtlMs = 5 * 60 * 1000;

const normalizeSupabaseUrl = (value: string | undefined) => value?.trim().replace(/\/+$/, "") ?? "";

const isConfigured = (supabaseUrl: string, anonKey: string) => Boolean(supabaseUrl && anonKey);

const decodeBase64Url = (value: string) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Buffer.from(padded, "base64").toString("utf8");
};

const decodeJwtPayload = (accessToken: string): JwtPayload | null => {
  const [, payload] = accessToken.split(".");

  if (!payload) {
    return null;
  }

  try {
    return JSON.parse(decodeBase64Url(payload)) as JwtPayload;
  } catch {
    return null;
  }
};

const buildMembershipUrl = (supabaseUrl: string, workspaceId: string, userId: string) => {
  const params = new URLSearchParams({
    workspace_id: `eq.${workspaceId}`,
    user_id: `eq.${userId}`,
    status: "eq.active",
    select: "workspace_id",
    limit: "1",
  });

  return `${supabaseUrl}/rest/v1/workspace_memberships?${params.toString()}`;
};

const buildPermissionUrl = (supabaseUrl: string) => `${supabaseUrl}/rest/v1/rpc/has_permission`;

export type WorkspaceAccessGuard = ReturnType<typeof createWorkspaceAccessGuard>;

export const createWorkspaceAccessGuard = ({
  database,
  supabaseUrl: rawSupabaseUrl,
  anonKey: rawAnonKey,
  getTokens,
  fetchImpl = fetch,
  now = Date.now,
  cacheTtlMs = defaultCacheTtlMs,
}: WorkspaceAccessGuardOptions) => {
  const supabaseUrl = normalizeSupabaseUrl(rawSupabaseUrl);
  const anonKey = rawAnonKey?.trim() ?? "";
  const membershipCache = new Map<string, number>();

  const assertLocalWorkspaceExists = (workspaceId: string) => {
    const workspace = database.prepare("SELECT id, is_active FROM workspaces WHERE id = ? LIMIT 1").get(workspaceId) as
      | WorkspaceRow
      | undefined;

    if (!workspace || workspace.is_active === 0) {
      throw new Error("That workspace is not available on this device.");
    }
  };

  const getAssetWorkspaceId = (assetId: string) => {
    const row = database.prepare("SELECT workspace_id FROM assets WHERE id = ? LIMIT 1").get(assetId) as
      | { workspace_id: string }
      | undefined;
    return row?.workspace_id ?? null;
  };

  const getAssetFileWorkspaceId = (fileId: string) => {
    const row = database
      .prepare(
        `
          SELECT assets.workspace_id
          FROM asset_files
          JOIN assets ON assets.id = asset_files.asset_id
          WHERE asset_files.id = ?
          LIMIT 1
        `,
      )
      .get(fileId) as { workspace_id: string } | undefined;
    return row?.workspace_id ?? null;
  };

  const getPackingSlipWorkspaceId = (packingSlipId: string) => {
    const row = database.prepare("SELECT workspace_id FROM packing_slips WHERE id = ? LIMIT 1").get(packingSlipId) as
      | { workspace_id: string }
      | undefined;
    return row?.workspace_id ?? null;
  };

  const getIncidentWorkspaceId = (incidentId: string) => {
    const row = database.prepare("SELECT workspace_id FROM incidents WHERE id = ? LIMIT 1").get(incidentId) as
      | { workspace_id: string }
      | undefined;
    return row?.workspace_id ?? null;
  };

  const getProjectWorkspaceId = (projectId: string) => {
    const row = database.prepare("SELECT workspace_id FROM projects WHERE id = ? LIMIT 1").get(projectId) as
      | { workspace_id: string }
      | undefined;
    return row?.workspace_id ?? null;
  };

  const getRmaCaseWorkspaceId = (rmaCaseId: string) => {
    const row = database.prepare("SELECT workspace_id FROM rma_cases WHERE id = ? LIMIT 1").get(rmaCaseId) as
      | { workspace_id: string }
      | undefined;
    return row?.workspace_id ?? null;
  };

  const getIncidentFileWorkspaceId = (fileId: string) => {
    const row = database
      .prepare(
        `
          SELECT incidents.workspace_id
          FROM incident_files
          JOIN incidents ON incidents.id = incident_files.incident_id
          WHERE incident_files.id = ?
          LIMIT 1
        `,
      )
      .get(fileId) as { workspace_id: string } | undefined;
    return row?.workspace_id ?? null;
  };

  const assertWorkspaceAccess = async ({
    workspaceId,
    action,
    accessLevel = "read",
    requiredPermission,
  }: AssertWorkspaceAccessInput): Promise<void> => {
    assertLocalWorkspaceExists(workspaceId);

    if (workspaceId === DEFAULT_WORKSPACE_ID || !isConfigured(supabaseUrl, anonKey)) {
      return;
    }

    const { accessToken } = await getTokens();

    if (!accessToken) {
      throw new Error(`Sign in again before you ${action}.`);
    }

    const payload = decodeJwtPayload(accessToken);
    const userId = payload?.sub;

    if (!userId) {
      throw new Error(`Sign in again before you ${action}.`);
    }

    const tokenExpiresAtMs = typeof payload.exp === "number" ? payload.exp * 1000 : null;
    if (tokenExpiresAtMs && tokenExpiresAtMs <= now()) {
      throw new Error(`Your session expired. Sign in again before you ${action}.`);
    }

    const cacheKey = `${userId}:${workspaceId}:${requiredPermission ?? "member"}`;
    const cachedAt = membershipCache.get(cacheKey);
    if (cachedAt && now() - cachedAt < cacheTtlMs) {
      return;
    }

    let response: Response;
    try {
      response = requiredPermission
        ? await fetchImpl(buildPermissionUrl(supabaseUrl), {
            method: "POST",
            headers: {
              apikey: anonKey,
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              target_workspace_id: workspaceId,
              permission_key: requiredPermission,
            }),
          })
        : await fetchImpl(buildMembershipUrl(supabaseUrl, workspaceId, userId), {
            headers: {
              apikey: anonKey,
              Authorization: `Bearer ${accessToken}`,
            },
          });
    } catch (error) {
      if (accessLevel === "read") {
        return;
      }

      if (error instanceof Error) {
        throw error;
      }

      throw new Error(`Supabase could not verify workspace access before you ${action}.`);
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error(`Sign in again before you ${action}.`);
    }

    if (!response.ok) {
      throw new Error(`Supabase could not verify workspace access before you ${action}.`);
    }

    const result = (await response.json()) as Array<{ workspace_id?: string }> | boolean;

    if (requiredPermission) {
      if (result !== true) {
        throw new Error(`You do not have permission to ${action}.`);
      }
    } else {
      const memberships = Array.isArray(result) ? result : [];
      if (!memberships.some((membership) => membership.workspace_id === workspaceId)) {
        throw new Error("You do not have access to this workspace.");
      }
    }

    membershipCache.set(cacheKey, now());
  };

  return {
    assertWorkspaceAccess,

    async assertAssetAccess(
      assetId: string,
      action: string,
      accessLevel: WorkspaceAccessLevel = "read",
      requiredPermission?: string,
    ) {
      const workspaceId = getAssetWorkspaceId(assetId);

      if (!workspaceId) {
        throw new Error("Asset was not found.");
      }

      await assertWorkspaceAccess({ workspaceId, action, accessLevel, requiredPermission });
      return workspaceId;
    },

    async assertAssetFileAccess(
      fileId: string,
      action: string,
      accessLevel: WorkspaceAccessLevel = "read",
      requiredPermission?: string,
    ) {
      const workspaceId = getAssetFileWorkspaceId(fileId);

      if (!workspaceId) {
        throw new Error("Asset file was not found.");
      }

      await assertWorkspaceAccess({ workspaceId, action, accessLevel, requiredPermission });
    },

    async assertPackingSlipAccess(
      packingSlipId: string,
      action: string,
      accessLevel: WorkspaceAccessLevel = "read",
      requiredPermission?: string,
    ) {
      const workspaceId = getPackingSlipWorkspaceId(packingSlipId);

      if (!workspaceId) {
        throw new Error("Packing slip was not found.");
      }

      await assertWorkspaceAccess({ workspaceId, action, accessLevel, requiredPermission });
    },

    async assertProjectAccess(
      projectId: string,
      action: string,
      accessLevel: WorkspaceAccessLevel = "read",
      requiredPermission?: string,
    ) {
      const workspaceId = getProjectWorkspaceId(projectId);

      if (!workspaceId) {
        throw new Error("Project was not found.");
      }

      await assertWorkspaceAccess({ workspaceId, action, accessLevel, requiredPermission });
      return workspaceId;
    },

    async assertIncidentAccess(
      incidentId: string,
      action: string,
      accessLevel: WorkspaceAccessLevel = "read",
      requiredPermission?: string,
    ) {
      const workspaceId = getIncidentWorkspaceId(incidentId);

      if (!workspaceId) {
        throw new Error("Incident was not found.");
      }

      await assertWorkspaceAccess({ workspaceId, action, accessLevel, requiredPermission });
    },

    async assertRmaCaseAccess(
      rmaCaseId: string,
      action: string,
      accessLevel: WorkspaceAccessLevel = "read",
      requiredPermission?: string,
    ) {
      const workspaceId = getRmaCaseWorkspaceId(rmaCaseId);

      if (!workspaceId) {
        throw new Error("RMA case was not found.");
      }

      await assertWorkspaceAccess({ workspaceId, action, accessLevel, requiredPermission });
      return workspaceId;
    },

    async assertIncidentFileAccess(
      fileId: string,
      action: string,
      accessLevel: WorkspaceAccessLevel = "read",
      requiredPermission?: string,
    ) {
      const workspaceId = getIncidentFileWorkspaceId(fileId);

      if (!workspaceId) {
        throw new Error("Incident file was not found.");
      }

      await assertWorkspaceAccess({ workspaceId, action, accessLevel, requiredPermission });
    },
  };
};
