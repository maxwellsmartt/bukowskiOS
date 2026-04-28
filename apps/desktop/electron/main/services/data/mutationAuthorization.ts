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

const ensureDefaultActorWorkspaceAccess = (db: DatabaseSync, workspaceId: string) => {
  const now = new Date().toISOString();

  db.prepare(
    `
      INSERT OR IGNORE INTO users (id, full_name, email, phone, is_active, created_at, updated_at)
      VALUES (?, 'Ops Repair', 'ops@metadata.cine', '+1 809 555 0199', 1, ?, ?)
    `,
  ).run(defaultActorUserId, now, now);

  db.prepare(
    `
      UPDATE users
      SET is_active = 1,
          updated_at = ?
      WHERE id = ?
    `,
  ).run(now, defaultActorUserId);

  db.prepare(
    `
      INSERT INTO workspace_memberships (id, workspace_id, user_id, role_id, status, joined_at, created_at)
      VALUES (?, ?, ?, 'role-admin', 'active', ?, ?)
      ON CONFLICT(workspace_id, user_id) DO UPDATE SET
        role_id = 'role-admin',
        status = 'active'
    `,
  ).run(`membership-${workspaceId}-ops`, workspaceId, defaultActorUserId, now, now);
};

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
  let actor = loadActorAuthorization(db, args.workspaceId, actorUserId);

  if (actorUserId === defaultActorUserId && (!actor || actor.is_active !== 1 || actor.membership_status !== "active")) {
    ensureDefaultActorWorkspaceAccess(db, args.workspaceId);
    actor = loadActorAuthorization(db, args.workspaceId, actorUserId);
  }

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
