import type { DatabaseSync } from "node:sqlite";

const defaultActorUserId = "user-ops";

type AuthorizationRow = {
  user_id: string;
  full_name: string;
  is_active: number;
  membership_status: string;
  permission_keys: string | null;
};

const loadActorAuthorization = (db: DatabaseSync, workspaceId: string, actorUserId: string) =>
  db
    .prepare(
      `
        SELECT
          users.id AS user_id,
          users.full_name,
          users.is_active,
          COALESCE(workspace_memberships.status, 'missing') AS membership_status,
          GROUP_CONCAT(DISTINCT permissions.key) AS permission_keys
        FROM users
        LEFT JOIN workspace_memberships
          ON workspace_memberships.user_id = users.id
          AND workspace_memberships.workspace_id = ?
        LEFT JOIN roles ON roles.id = workspace_memberships.role_id
        LEFT JOIN role_permissions ON role_permissions.role_id = roles.id
        LEFT JOIN permissions ON permissions.id = role_permissions.permission_id
        WHERE users.id = ?
        GROUP BY users.id, users.full_name, users.is_active, workspace_memberships.status
        LIMIT 1
      `,
    )
    .get(workspaceId, actorUserId) as AuthorizationRow | undefined;

export const resolveAuthorizedActor = (
  db: DatabaseSync,
  args: {
    workspaceId: string;
    actorUserId?: string | null;
    requiredPermission: string;
    actionLabel: string;
  },
) => {
  const actorUserId = args.actorUserId?.trim() || defaultActorUserId;
  const actor = loadActorAuthorization(db, args.workspaceId, actorUserId);

  if (!actor) {
    throw new Error(`Actor user not found for ${args.actionLabel}.`);
  }

  if (actor.is_active !== 1) {
    throw new Error(`Blocked. ${actor.full_name} is inactive and cannot ${args.actionLabel}.`);
  }

  if (actor.membership_status !== "active") {
    throw new Error(`Blocked. ${actor.full_name} does not have active workspace access for ${args.actionLabel}.`);
  }

  const permissions = (actor.permission_keys ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!permissions.includes(args.requiredPermission)) {
    throw new Error(`Blocked. ${actor.full_name} does not have permission to ${args.actionLabel}.`);
  }

  return {
    actorUserId,
    actorName: actor.full_name,
    permissions,
  };
};

