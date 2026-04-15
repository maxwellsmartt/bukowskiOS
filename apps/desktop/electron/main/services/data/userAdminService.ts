import type { DatabaseSync } from "node:sqlite";

import type {
  AppUserAdminRow,
  AppUserMutationResult,
  AppUserRoleRow,
  AppUsersSnapshot,
  CreateAppUserCommand,
  RevokeTelegramLinkCommand,
  SetAppUserActiveCommand,
  UpdateAppUserCommand,
} from "@contracts";
import { DEFAULT_WORKSPACE_ID } from "@contracts";

const workspaceId = DEFAULT_WORKSPACE_ID;

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

const loadRoles = (db: DatabaseSync): AppUserRoleRow[] =>
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
        ORDER BY roles.is_system_role DESC, roles.name COLLATE NOCASE ASC
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

const loadUsers = (db: DatabaseSync): AppUserAdminRow[] =>
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
        FROM users
        LEFT JOIN workspace_memberships
          ON workspace_memberships.user_id = users.id
          AND workspace_memberships.workspace_id = ?
        LEFT JOIN roles ON roles.id = workspace_memberships.role_id
        LEFT JOIN role_permissions ON role_permissions.role_id = roles.id
        LEFT JOIN permissions ON permissions.id = role_permissions.permission_id
        LEFT JOIN crew_members
          ON crew_members.linked_user_id = users.id
          AND crew_members.workspace_id = ?
          AND crew_members.is_active = 1
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

const loadSnapshot = (db: DatabaseSync): AppUsersSnapshot => ({
  users: loadUsers(db),
  roles: loadRoles(db),
});

const resolveRole = (db: DatabaseSync, roleId: string) => {
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

const ensureWorkspaceMembership = (db: DatabaseSync, userId: string, roleId: string, isActive: boolean) => {
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

const syncCrewLink = (db: DatabaseSync, userId: string, linkedCrewMemberId?: string) => {
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

export const createUserAdminService = (db: DatabaseSync) => ({
  getSnapshot(): AppUsersSnapshot {
    return loadSnapshot(db);
  },

  createUser(input: CreateAppUserCommand): AppUserMutationResult {
    resolveRole(db, input.roleId);
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

      ensureWorkspaceMembership(db, userId, input.roleId, true);
      syncCrewLink(db, userId, optionalValue(input.linkedCrewMemberId) ?? undefined);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    return {
      summary: `${input.fullName.trim()} is now an internal user and ready for role-based access.`,
      snapshot: loadSnapshot(db),
      userId,
    };
  },

  updateUser(input: UpdateAppUserCommand): AppUserMutationResult {
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

    resolveRole(db, input.roleId);
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
      ensureWorkspaceMembership(db, input.userId, input.roleId, currentActive.is_active === 1);
      syncCrewLink(db, input.userId, optionalValue(input.linkedCrewMemberId) ?? undefined);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    return {
      summary: `${input.fullName.trim()} was updated.`,
      snapshot: loadSnapshot(db),
      userId: input.userId,
    };
  },

  setUserActive(input: SetAppUserActiveCommand): AppUserMutationResult {
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

      ensureWorkspaceMembership(db, input.userId, existingMembership.role_id, input.isActive);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    return {
      summary: input.isActive ? "User activated for workspace operations." : "User deactivated and blocked from connector access.",
      snapshot: loadSnapshot(db),
      userId: input.userId,
    };
  },

  revokeTelegramLink(input: RevokeTelegramLinkCommand): AppUserMutationResult {
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
      snapshot: loadSnapshot(db),
      userId: input.userId,
    };
  },
});

export type UserAdminService = ReturnType<typeof createUserAdminService>;
