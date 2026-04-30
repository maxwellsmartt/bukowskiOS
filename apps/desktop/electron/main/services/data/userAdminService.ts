import type { DatabaseSync } from "node:sqlite";

import type {
  AppUserAdminRow,
  AppUserMutationResult,
  AppUserRoleRow,
  AppUsersSnapshot,
  AppUsersSnapshotQuery,
  CreateAppUserCommand,
  DeleteAppUserCommand,
  RevokeTelegramLinkCommand,
  SetAppUserActiveCommand,
  UpdateAppUserCommand,
} from "@contracts";
import { DEFAULT_WORKSPACE_ID } from "@contracts";

const slugify = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

const nowIso = () => new Date().toISOString();
const buildId = (prefix: string, seed?: string) =>
  `${prefix}-${seed ? slugify(seed).slice(0, 24) : Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const optionalValue = (value?: string | null) => {
  const nextValue = value?.trim();
  return nextValue ? nextValue : null;
};

const resolveWorkspaceId = (workspaceId?: string | null) => optionalValue(workspaceId) ?? DEFAULT_WORKSPACE_ID;

const loadRoles = (db: DatabaseSync, workspaceId: string): AppUserRoleRow[] =>
  db
    .prepare(
      `
        SELECT
          roles.id,
          roles.key,
          roles.name,
          COALESCE(roles.description, '') AS description,
          roles.is_system_role,
          GROUP_CONCAT(DISTINCT permissions.key) AS permission_keys,
          COUNT(DISTINCT workspace_memberships.user_id) AS assigned_user_count
        FROM roles
        LEFT JOIN role_permissions ON role_permissions.role_id = roles.id
        LEFT JOIN permissions ON permissions.id = role_permissions.permission_id
        LEFT JOIN workspace_memberships
          ON workspace_memberships.role_id = roles.id
          AND workspace_memberships.workspace_id = ?
        WHERE roles.workspace_id = ?
        GROUP BY roles.id, roles.key, roles.name, roles.description, roles.is_system_role
        ORDER BY CASE roles.key
          WHEN 'admin' THEN 0
          WHEN 'crew' THEN 1
          WHEN 'supervisor' THEN 2
          WHEN 'finance_viewer' THEN 3
          WHEN 'maintenance' THEN 4
          ELSE 5
        END,
        roles.name COLLATE NOCASE ASC
      `,
    )
    .all(workspaceId, workspaceId)
    .map((row) => {
      const typedRow = row as {
        id: string;
        key: string;
        name: string;
        description: string;
        is_system_role: number;
        permission_keys: string | null;
        assigned_user_count: number;
      };

      return {
        id: typedRow.id,
        key: typedRow.key,
        name: typedRow.name,
        description: typedRow.description,
        isSystemRole: typedRow.is_system_role === 1,
        permissionKeys: (typedRow.permission_keys ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
          .sort((left, right) => left.localeCompare(right)),
        assignedUserCount: typedRow.assigned_user_count,
      };
    });

const loadUsers = (db: DatabaseSync, workspaceId: string): AppUserAdminRow[] =>
  db
    .prepare(
      `
        SELECT
          users.id,
          users.full_name,
          COALESCE(users.email, '') AS email,
          COALESCE(users.phone, '') AS phone,
          users.is_active,
          COALESCE(workspace_memberships.status, 'missing') AS membership_status,
          workspace_memberships.role_id,
          roles.key AS role_key,
          roles.name AS role_name,
          GROUP_CONCAT(DISTINCT permissions.key) AS permission_keys,
          crew_members.id AS linked_crew_id,
          crew_members.full_name AS linked_crew_name,
          (
            SELECT connector_accounts.id
            FROM connector_accounts
            WHERE connector_accounts.workspace_id = ?
              AND connector_accounts.connector_key = 'telegram'
              AND connector_accounts.linked_user_id = users.id
            ORDER BY connector_accounts.updated_at DESC
            LIMIT 1
          ) AS telegram_account_id,
          (
            SELECT connector_accounts.link_status
            FROM connector_accounts
            WHERE connector_accounts.workspace_id = ?
              AND connector_accounts.connector_key = 'telegram'
              AND connector_accounts.linked_user_id = users.id
            ORDER BY connector_accounts.updated_at DESC
            LIMIT 1
          ) AS telegram_link_status,
          (
            SELECT connector_accounts.display_name
            FROM connector_accounts
            WHERE connector_accounts.workspace_id = ?
              AND connector_accounts.connector_key = 'telegram'
              AND connector_accounts.linked_user_id = users.id
            ORDER BY connector_accounts.updated_at DESC
            LIMIT 1
          ) AS telegram_display_name,
          (
            SELECT connector_accounts.external_username
            FROM connector_accounts
            WHERE connector_accounts.workspace_id = ?
              AND connector_accounts.connector_key = 'telegram'
              AND connector_accounts.linked_user_id = users.id
            ORDER BY connector_accounts.updated_at DESC
            LIMIT 1
          ) AS telegram_username,
          (
            SELECT connector_accounts.external_user_id
            FROM connector_accounts
            WHERE connector_accounts.workspace_id = ?
              AND connector_accounts.connector_key = 'telegram'
              AND connector_accounts.linked_user_id = users.id
            ORDER BY connector_accounts.updated_at DESC
            LIMIT 1
          ) AS telegram_external_user_id,
          (
            SELECT connector_accounts.linked_at
            FROM connector_accounts
            WHERE connector_accounts.workspace_id = ?
              AND connector_accounts.connector_key = 'telegram'
              AND connector_accounts.linked_user_id = users.id
            ORDER BY connector_accounts.updated_at DESC
            LIMIT 1
          ) AS telegram_linked_at,
          (
            SELECT MAX(connector_channel_memberships.last_seen_at)
            FROM connector_channel_memberships
            WHERE connector_channel_memberships.workspace_id = ?
              AND connector_channel_memberships.connector_key = 'telegram'
              AND connector_channel_memberships.linked_user_id = users.id
          ) AS telegram_last_seen_at
        FROM workspace_memberships
        JOIN users ON users.id = workspace_memberships.user_id
        LEFT JOIN roles ON roles.id = workspace_memberships.role_id
        LEFT JOIN role_permissions ON role_permissions.role_id = roles.id
        LEFT JOIN permissions ON permissions.id = role_permissions.permission_id
        LEFT JOIN crew_members
          ON crew_members.linked_user_id = users.id
          AND crew_members.workspace_id = ?
          AND crew_members.is_active = 1
        WHERE workspace_memberships.workspace_id = ?
        GROUP BY
          users.id,
          users.full_name,
          users.email,
          users.phone,
          users.is_active,
          workspace_memberships.status,
          workspace_memberships.role_id,
          roles.key,
          roles.name,
          crew_members.id,
          crew_members.full_name
        ORDER BY users.full_name COLLATE NOCASE ASC
      `,
    )
    .all(workspaceId, workspaceId, workspaceId, workspaceId, workspaceId, workspaceId, workspaceId, workspaceId, workspaceId)
    .map((row) => {
      const typedRow = row as {
        id: string;
        full_name: string;
        email: string;
        phone: string;
        is_active: number;
        membership_status: string;
        role_id: string | null;
        role_key: string | null;
        role_name: string | null;
        permission_keys: string | null;
        linked_crew_id: string | null;
        linked_crew_name: string | null;
        telegram_account_id: string | null;
        telegram_link_status: string | null;
        telegram_display_name: string | null;
        telegram_username: string | null;
        telegram_external_user_id: string | null;
        telegram_linked_at: string | null;
        telegram_last_seen_at: string | null;
      };

      const membershipStatus =
        typedRow.membership_status === "active" || typedRow.membership_status === "inactive" ? typedRow.membership_status : "missing";
      const telegramLinkStatus =
        typedRow.telegram_link_status === "linked" || typedRow.telegram_link_status === "pending" || typedRow.telegram_link_status === "revoked"
          ? typedRow.telegram_link_status
          : "none";
      const permissionKeys = (typedRow.permission_keys ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right));

      return {
        id: typedRow.id,
        fullName: typedRow.full_name,
        email: typedRow.email,
        phone: typedRow.phone,
        isActive: typedRow.is_active === 1,
        membershipStatus,
        roleId: typedRow.role_id,
        roleKey: typedRow.role_key,
        roleName: typedRow.role_name,
        permissionKeys,
        linkedCrewId: typedRow.linked_crew_id,
        linkedCrewLabel: typedRow.linked_crew_name,
        telegramAccountId: typedRow.telegram_account_id,
        telegramLinkStatus,
        telegramDisplayName: typedRow.telegram_display_name,
        telegramUsername: typedRow.telegram_username,
        telegramExternalUserId: typedRow.telegram_external_user_id,
        telegramLinkedAt: typedRow.telegram_linked_at,
        telegramLastSeenAt: typedRow.telegram_last_seen_at,
        readyForTelegram: typedRow.is_active === 1 && membershipStatus === "active" && Boolean(typedRow.role_id),
      };
    });

const loadSnapshot = (db: DatabaseSync, workspaceId: string): AppUsersSnapshot => ({
  users: loadUsers(db, workspaceId),
  roles: loadRoles(db, workspaceId),
});

const resolveRole = (db: DatabaseSync, workspaceId: string, roleId: string) => {
  const role = db
    .prepare(
      `
        SELECT id
        FROM roles
        WHERE workspace_id = ?
          AND id = ?
        LIMIT 1
      `,
    )
    .get(workspaceId, roleId) as { id: string } | undefined;

  if (!role) {
    throw new Error("Role not found.");
  }

  return role;
};

const ensureWorkspaceMembership = (db: DatabaseSync, workspaceId: string, userId: string, roleId: string, isActive: boolean) => {
  const now = nowIso();
  const existingMembership = db
    .prepare(
      `
        SELECT id
        FROM workspace_memberships
        WHERE workspace_id = ?
          AND user_id = ?
        LIMIT 1
      `,
    )
    .get(workspaceId, userId) as { id: string } | undefined;

  if (existingMembership) {
    db.prepare(
      `
        UPDATE workspace_memberships
        SET role_id = ?,
            status = ?
        WHERE id = ?
      `,
    ).run(roleId, isActive ? "active" : "inactive", existingMembership.id);
    return existingMembership.id;
  }

  const membershipId = buildId("membership", userId);
  db.prepare(
    `
      INSERT INTO workspace_memberships (
        id,
        workspace_id,
        user_id,
        role_id,
        status,
        joined_at,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(membershipId, workspaceId, userId, roleId, isActive ? "active" : "inactive", now, now);

  return membershipId;
};

const syncCrewLink = (db: DatabaseSync, workspaceId: string, userId: string, linkedCrewMemberId?: string) => {
  db.prepare(
    `
      UPDATE crew_members
      SET linked_user_id = NULL,
          updated_at = ?
      WHERE workspace_id = ?
        AND linked_user_id = ?
    `,
  ).run(nowIso(), workspaceId, userId);

  if (!linkedCrewMemberId) {
    return;
  }

  const crew = db
    .prepare(
      `
        SELECT id, linked_user_id
        FROM crew_members
        WHERE workspace_id = ?
          AND id = ?
        LIMIT 1
      `,
    )
    .get(workspaceId, linkedCrewMemberId) as { id: string; linked_user_id: string | null } | undefined;

  if (!crew) {
    throw new Error("Crew member not found.");
  }

  if (crew.linked_user_id && crew.linked_user_id !== userId) {
    throw new Error("That crew member is already linked to another internal user.");
  }

  db.prepare(
    `
      UPDATE crew_members
      SET linked_user_id = ?,
          updated_at = ?
      WHERE id = ?
    `,
  ).run(userId, nowIso(), crew.id);
};

const ensureUniqueEmail = (db: DatabaseSync, email: string | null, userId?: string) => {
  if (!email) {
    return;
  }

  const existing = db
    .prepare(
      `
        SELECT id
        FROM users
        WHERE lower(COALESCE(email, '')) = lower(?)
          AND (? IS NULL OR id != ?)
        LIMIT 1
      `,
    )
    .get(email, userId ?? null, userId ?? null) as { id: string } | undefined;

  if (existing) {
    throw new Error("Another user already uses that email.");
  }
};

const countUserDeleteBlockers = (db: DatabaseSync, workspaceId: string, userId: string) => {
  const userState = db
    .prepare(
      `
        SELECT
          users.id,
          users.full_name,
          users.is_active,
          COALESCE(workspace_memberships.status, 'missing') AS membership_status
        FROM users
        LEFT JOIN workspace_memberships
          ON workspace_memberships.user_id = users.id
          AND workspace_memberships.workspace_id = ?
        WHERE users.id = ?
        LIMIT 1
      `,
    )
    .get(workspaceId, userId) as
    | {
        id: string;
        full_name: string;
        is_active: number;
        membership_status: string;
      }
    | undefined;

  if (!userState || userState.membership_status === "missing") {
    throw new Error("That user is not part of this workspace.");
  }

  const telegramLinks = db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM connector_accounts
        WHERE workspace_id = ?
          AND linked_user_id = ?
          AND link_status IN ('linked', 'pending')
      `,
    )
    .get(workspaceId, userId) as { count: number };

  const activeAssetState = db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM asset_current_state
        WHERE workspace_id = ?
          AND current_responsible_user_id = ?
          AND (
            active_assignment_id IS NOT NULL
            OR assigned_quantity > 0
            OR checked_out_quantity > 0
            OR custody_status IN ('assigned', 'partial_assigned', 'checked_out', 'partial_checked_out')
          )
      `,
    )
    .get(workspaceId, userId) as { count: number };

  const activeAssignments = db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM asset_assignments
        WHERE workspace_id = ?
          AND assigned_to_user_id = ?
          AND assignment_status NOT IN ('returned', 'cancelled', 'canceled', 'void')
      `,
    )
    .get(workspaceId, userId) as { count: number };

  const openPackingSlips = db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM packing_slips
        WHERE workspace_id = ?
          AND responsible_user_id = ?
          AND status NOT IN ('Closed', 'Returned', 'Cancelled', 'Canceled', 'Void')
      `,
    )
    .get(workspaceId, userId) as { count: number };

  const openIncidents = db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM incidents
        WHERE workspace_id = ?
          AND responsible_user_id = ?
          AND status NOT IN ('Resolved', 'Closed', 'Cancelled', 'Canceled')
      `,
    )
    .get(workspaceId, userId) as { count: number };

  return {
    userName: userState.full_name,
    isActive: userState.is_active === 1,
    membershipStatus: userState.membership_status,
    telegramLinks: telegramLinks.count,
    activeAssetState: activeAssetState.count,
    activeAssignments: activeAssignments.count,
    openPackingSlips: openPackingSlips.count,
    openIncidents: openIncidents.count,
  };
};

const buildUserDeleteBlockerMessage = (blockers: ReturnType<typeof countUserDeleteBlockers>) => {
  const messages = [
    blockers.isActive || blockers.membershipStatus === "active" ? "deactivate the user first" : null,
    blockers.telegramLinks ? "revoke Telegram access first" : null,
    blockers.activeAssetState || blockers.activeAssignments ? "return or reassign active assets first" : null,
    blockers.openPackingSlips ? "close or reassign open packing slips first" : null,
    blockers.openIncidents ? "resolve or reassign open incidents first" : null,
  ].filter(Boolean);

  return `This user cannot be removed yet. Please ${messages.join(", ")}.`;
};

export const createUserAdminService = (db: DatabaseSync) => ({
  getSnapshot(query?: AppUsersSnapshotQuery): AppUsersSnapshot {
    return loadSnapshot(db, resolveWorkspaceId(query?.workspaceId));
  },

  createUser(input: CreateAppUserCommand): AppUserMutationResult {
    const workspaceId = resolveWorkspaceId(input.workspaceId);
    resolveRole(db, workspaceId, input.roleId);
    ensureUniqueEmail(db, optionalValue(input.email));

    const now = nowIso();
    const userId = buildId("user", input.fullName);
    db.exec("BEGIN");

    try {
      db.prepare(
        `
          INSERT INTO users (id, full_name, email, phone, is_active, created_at, updated_at)
          VALUES (?, ?, ?, ?, 1, ?, ?)
        `,
      ).run(userId, input.fullName.trim(), optionalValue(input.email), optionalValue(input.phone), now, now);

      ensureWorkspaceMembership(db, workspaceId, userId, input.roleId, true);
      syncCrewLink(db, workspaceId, userId, optionalValue(input.linkedCrewMemberId) ?? undefined);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    return {
      summary: `${input.fullName.trim()} is now an internal user and ready for role-based access.`,
      snapshot: loadSnapshot(db, workspaceId),
      userId,
    };
  },

  updateUser(input: UpdateAppUserCommand): AppUserMutationResult {
    const workspaceId = resolveWorkspaceId(input.workspaceId);
    const existing = db
      .prepare(
        `
          SELECT id
          FROM users
          WHERE id = ?
          LIMIT 1
        `,
      )
      .get(input.userId) as { id: string } | undefined;

    if (!existing) {
      throw new Error("User not found.");
    }

    resolveRole(db, workspaceId, input.roleId);
    ensureUniqueEmail(db, optionalValue(input.email), input.userId);

    db.exec("BEGIN");

    try {
      db.prepare(
        `
          UPDATE users
          SET full_name = ?,
              email = ?,
              phone = ?,
              updated_at = ?
          WHERE id = ?
        `,
      ).run(input.fullName.trim(), optionalValue(input.email), optionalValue(input.phone), nowIso(), input.userId);

      const currentActive = db.prepare("SELECT is_active FROM users WHERE id = ?").get(input.userId) as { is_active: number };
      ensureWorkspaceMembership(db, workspaceId, input.userId, input.roleId, currentActive.is_active === 1);
      syncCrewLink(db, workspaceId, input.userId, optionalValue(input.linkedCrewMemberId) ?? undefined);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    return {
      summary: `${input.fullName.trim()} was updated.`,
      snapshot: loadSnapshot(db, workspaceId),
      userId: input.userId,
    };
  },

  setUserActive(input: SetAppUserActiveCommand): AppUserMutationResult {
    const workspaceId = resolveWorkspaceId(input.workspaceId);
    const existingMembership = db
      .prepare(
        `
          SELECT role_id
          FROM workspace_memberships
          WHERE workspace_id = ?
            AND user_id = ?
          LIMIT 1
        `,
      )
      .get(workspaceId, input.userId) as { role_id: string } | undefined;

    if (!existingMembership) {
      throw new Error("User does not have a workspace membership yet.");
    }

    db.exec("BEGIN");

    try {
      db.prepare(
        `
          UPDATE users
          SET is_active = ?,
              updated_at = ?
          WHERE id = ?
        `,
      ).run(input.isActive ? 1 : 0, nowIso(), input.userId);

      ensureWorkspaceMembership(db, workspaceId, input.userId, existingMembership.role_id, input.isActive);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    return {
      summary: input.isActive ? "User activated for workspace operations." : "User deactivated and blocked from connector access.",
      snapshot: loadSnapshot(db, workspaceId),
      userId: input.userId,
    };
  },

  revokeTelegramLink(input: RevokeTelegramLinkCommand): AppUserMutationResult {
    const workspaceId = resolveWorkspaceId(input.workspaceId);
    const now = nowIso();
    db.exec("BEGIN");

    try {
      db.prepare(
        `
          UPDATE connector_accounts
          SET link_status = 'revoked',
              revoked_at = ?,
              updated_at = ?
          WHERE workspace_id = ?
            AND connector_key = 'telegram'
            AND linked_user_id = ?
        `,
      ).run(now, now, workspaceId, input.userId);

      db.prepare(
        `
          UPDATE connector_channel_memberships
          SET membership_status = 'revoked',
              updated_at = ?
          WHERE workspace_id = ?
            AND connector_key = 'telegram'
            AND linked_user_id = ?
        `,
      ).run(now, workspaceId, input.userId);

      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    return {
      summary: "Telegram access was revoked for this user.",
      snapshot: loadSnapshot(db, workspaceId),
      userId: input.userId,
    };
  },

  deleteUser(input: DeleteAppUserCommand): AppUserMutationResult {
    const workspaceId = resolveWorkspaceId(input.workspaceId);
    const blockers = countUserDeleteBlockers(db, workspaceId, input.userId);

    if (
      blockers.isActive ||
      blockers.membershipStatus === "active" ||
      blockers.telegramLinks ||
      blockers.activeAssetState ||
      blockers.activeAssignments ||
      blockers.openPackingSlips ||
      blockers.openIncidents
    ) {
      throw new Error(buildUserDeleteBlockerMessage(blockers));
    }

    const now = nowIso();
    db.exec("BEGIN");

    try {
      db.prepare(
        `
          UPDATE crew_members
          SET linked_user_id = NULL,
              updated_at = ?
          WHERE workspace_id = ?
            AND linked_user_id = ?
        `,
      ).run(now, workspaceId, input.userId);

      db.prepare(
        `
          DELETE FROM workspace_memberships
          WHERE workspace_id = ?
            AND user_id = ?
        `,
      ).run(workspaceId, input.userId);

      db.prepare(
        `
          UPDATE users
          SET is_active = 0,
              updated_at = ?
          WHERE id = ?
        `,
      ).run(now, input.userId);

      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    return {
      summary: `${blockers.userName} was removed from this workspace.`,
      snapshot: loadSnapshot(db, workspaceId),
      userId: null,
    };
  },
});

export type UserAdminService = ReturnType<typeof createUserAdminService>;
