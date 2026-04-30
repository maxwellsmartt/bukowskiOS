import { describe, expect, it } from "vitest";

import { bootstrapAdminFoundation } from "../../electron/main/services/data/adminFoundationBootstrap";
import { createUserAdminService } from "../../electron/main/services/data/userAdminService";
import { createTestDatabase } from "./helpers/createTestDatabase";

describe("user admin service", () => {
  it("exposes the simplified product role set", () => {
    const { cleanup, database } = createTestDatabase("bukowski-user-admin-roles");
    const service = createUserAdminService(database);

    const roleKeys = service.getSnapshot().roles.map((role) => role.key);

    expect(roleKeys).toEqual(["admin", "crew", "supervisor", "finance_viewer", "maintenance"]);

    cleanup();
  });

  it("bootstraps the same product roles for additional workspaces", () => {
    const { cleanup, database } = createTestDatabase("bukowski-user-admin-workspace-roles");

    database
      .prepare(
        `
          INSERT INTO workspaces (id, slug, name, base_currency, is_active, created_at, updated_at)
          VALUES ('workspace-casa', 'casa', 'Casa', 'USD', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `,
      )
      .run();

    bootstrapAdminFoundation(database);
    const service = createUserAdminService(database);
    const snapshot = service.getSnapshot({ workspaceId: "workspace-casa" });

    expect(snapshot.roles.map((role) => role.key)).toEqual(["admin", "crew", "supervisor", "finance_viewer", "maintenance"]);
    expect(snapshot.users.find((user) => user.id === "user-ops")?.roleKey).toBe("admin");

    cleanup();
  });

  it("creates workspace users, links crew, updates roles, and tracks Telegram readiness", () => {
    const { cleanup, database } = createTestDatabase("bukowski-user-admin-create");
    const service = createUserAdminService(database);

    const created = service.createUser({
      workspaceId: "workspace-metadata",
      fullName: "Daniel VTR",
      email: "daniel@metadata.cine",
      phone: "+1 809 555 9999",
      roleId: "role-crew",
    });

    const createdUser = created.snapshot.users.find((user) => user.id === created.userId);
    expect(createdUser?.fullName).toBe("Daniel VTR");
    expect(createdUser?.roleKey).toBe("crew");
    expect(createdUser?.readyForTelegram).toBe(true);

    const crewId = database
      .prepare(
        `
          INSERT INTO crew_members (
            id, workspace_id, full_name, role_label, is_active, created_at, updated_at
          ) VALUES ('crew-daniel-vtr', 'workspace-metadata', 'Daniel VTR', 'VTR Operator', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `,
      )
      .run();

    expect(crewId.changes).toBe(1);

    const updated = service.updateUser({
      workspaceId: "workspace-metadata",
      userId: created.userId ?? "",
      fullName: "Daniel VTR",
      email: "daniel.vtr@metadata.cine",
      phone: "+1 809 555 8888",
      roleId: "role-maintenance",
      linkedCrewMemberId: "crew-daniel-vtr",
    });

    const updatedUser = updated.snapshot.users.find((user) => user.id === created.userId);
    expect(updatedUser?.roleKey).toBe("maintenance");
    expect(updatedUser?.linkedCrewId).toBe("crew-daniel-vtr");
    expect(updatedUser?.permissionKeys).toContain("rma.create");

    cleanup();
  });

  it("creates users linked to crew in the selected non-default workspace", () => {
    const { cleanup, database } = createTestDatabase("bukowski-user-admin-workspace-crew-link");

    database
      .prepare(
        `
          INSERT INTO workspaces (id, slug, name, base_currency, is_active, created_at, updated_at)
          VALUES ('workspace-casa', 'casa', 'Casa', 'USD', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `,
      )
      .run();

    database
      .prepare(
        `
          INSERT INTO crew_members (
            id, workspace_id, full_name, role_label, email, phone, is_active, created_at, updated_at
          ) VALUES ('crew-casa-daniel', 'workspace-casa', 'Daniel Casa', 'DIT', 'daniel@casa.test', '+1 809 555 1212', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `,
      )
      .run();

    bootstrapAdminFoundation(database);
    const service = createUserAdminService(database);
    const crewRole = service.getSnapshot({ workspaceId: "workspace-casa" }).roles.find((role) => role.key === "crew");

    const created = service.createUser({
      workspaceId: "workspace-casa",
      fullName: "Daniel Casa",
      email: "daniel.user@casa.test",
      phone: "+1 809 555 3434",
      roleId: crewRole?.id ?? "",
      linkedCrewMemberId: "crew-casa-daniel",
    });

    const createdUser = created.snapshot.users.find((user) => user.id === created.userId);
    expect(createdUser?.linkedCrewId).toBe("crew-casa-daniel");
    expect(createdUser?.linkedCrewLabel).toBe("Daniel Casa");

    const crew = database.prepare("SELECT linked_user_id FROM crew_members WHERE id = ?").get("crew-casa-daniel") as {
      linked_user_id: string | null;
    };
    expect(crew.linked_user_id).toBe(created.userId);

    cleanup();
  });

  it("deactivates users and revokes linked Telegram identities", () => {
    const { cleanup, database } = createTestDatabase("bukowski-user-admin-revoke");
    const service = createUserAdminService(database);

    database.prepare(
      `
        INSERT INTO connector_accounts (
          id,
          workspace_id,
          connector_key,
          external_user_id,
          external_username,
          display_name,
          linked_user_id,
          link_status,
          linked_at,
          created_at,
          updated_at
        ) VALUES (
          'connector-account-user-ops',
          'workspace-metadata',
          'telegram',
          'telegram-ops',
          'ops_repair',
          'Ops Repair',
          'user-ops',
          'linked',
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
      `,
    ).run();

    database.prepare(
      `
        INSERT INTO connector_channels (
          id,
          workspace_id,
          connector_key,
          external_channel_id,
          channel_type,
          display_name,
          operational_mode,
          status,
          default_policy_json,
          created_at,
          updated_at
        ) VALUES (
          'channel-user-ops',
          'workspace-metadata',
          'telegram',
          'telegram-dm-user-ops',
          'dm',
          'Ops Repair',
          'dm_first',
          'active',
          '{}',
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
      `,
    ).run();

    database.prepare(
      `
        INSERT INTO connector_channel_memberships (
          id,
          workspace_id,
          connector_key,
          channel_id,
          external_user_id,
          linked_user_id,
          membership_status,
          last_seen_at,
          created_at,
          updated_at
        ) VALUES (
          'connector-membership-user-ops',
          'workspace-metadata',
          'telegram',
          'channel-user-ops',
          'telegram-ops',
          'user-ops',
          'linked',
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
      `,
    ).run();

    const deactivated = service.setUserActive({
      workspaceId: "workspace-metadata",
      userId: "user-ops",
      isActive: false,
    });
    const deactivatedUser = deactivated.snapshot.users.find((user) => user.id === "user-ops");
    expect(deactivatedUser?.isActive).toBe(false);
    expect(deactivatedUser?.membershipStatus).toBe("inactive");
    expect(deactivatedUser?.readyForTelegram).toBe(false);

    const revoked = service.revokeTelegramLink({
      workspaceId: "workspace-metadata",
      userId: "user-ops",
    });
    const revokedUser = revoked.snapshot.users.find((user) => user.id === "user-ops");
    expect(revokedUser?.telegramLinkStatus).toBe("revoked");

    cleanup();
  });

  it("removes inactive users from the workspace and clears crew links", () => {
    const { cleanup, database } = createTestDatabase("bukowski-user-admin-delete");
    const service = createUserAdminService(database);

    database
      .prepare(
        `
          INSERT INTO crew_members (
            id, workspace_id, full_name, role_label, is_active, created_at, updated_at
          ) VALUES ('crew-remove-user', 'workspace-metadata', 'Remove User', 'Crew', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `,
      )
      .run();

    const created = service.createUser({
      workspaceId: "workspace-metadata",
      fullName: "Remove User",
      email: "remove.user@metadata.cine",
      roleId: "role-crew",
      linkedCrewMemberId: "crew-remove-user",
    });

    service.setUserActive({
      workspaceId: "workspace-metadata",
      userId: created.userId ?? "",
      isActive: false,
    });

    const removed = service.deleteUser({
      workspaceId: "workspace-metadata",
      userId: created.userId ?? "",
    });

    expect(removed.snapshot.users.some((user) => user.id === created.userId)).toBe(false);

    const membership = database
      .prepare("SELECT id FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?")
      .get("workspace-metadata", created.userId) as { id: string } | undefined;
    expect(membership).toBeUndefined();

    const crew = database.prepare("SELECT linked_user_id FROM crew_members WHERE id = ?").get("crew-remove-user") as {
      linked_user_id: string | null;
    };
    expect(crew.linked_user_id).toBeNull();

    cleanup();
  });

  it("blocks removal while users still have active access or active operational links", () => {
    const { cleanup, database } = createTestDatabase("bukowski-user-admin-delete-blockers");
    const service = createUserAdminService(database);

    expect(() =>
      service.deleteUser({
        workspaceId: "workspace-metadata",
        userId: "user-ops",
      }),
    ).toThrow(/deactivate the user first/u);

    service.setUserActive({
      workspaceId: "workspace-metadata",
      userId: "user-ops",
      isActive: false,
    });

    database
      .prepare(
        `
          UPDATE asset_current_state
          SET current_responsible_user_id = ?,
              assigned_quantity = 1,
              custody_status = 'assigned'
          WHERE workspace_id = ?
            AND asset_id = (
              SELECT asset_id
              FROM asset_current_state
              WHERE workspace_id = ?
              LIMIT 1
            )
        `,
      )
      .run("user-ops", "workspace-metadata", "workspace-metadata");

    expect(() =>
      service.deleteUser({
        workspaceId: "workspace-metadata",
        userId: "user-ops",
      }),
    ).toThrow(/return or reassign active assets first/u);

    cleanup();
  });
});
