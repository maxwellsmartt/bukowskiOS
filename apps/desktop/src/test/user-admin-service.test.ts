import { describe, expect, it } from "vitest";

import { createUserAdminService } from "../../electron/main/services/data/userAdminService";
import { createTestDatabase } from "./helpers/createTestDatabase";

describe("user admin service", () => {
  it("creates workspace users, links crew, updates roles, and tracks Telegram readiness", () => {
    const { cleanup, database } = createTestDatabase("bukowski-user-admin-create");
    const service = createUserAdminService(database);

    const created = service.createUser({
      workspaceId: "workspace-metadata",
      fullName: "Daniel VTR",
      email: "daniel@metadata.cine",
      phone: "+1 809 555 9999",
      roleId: "role-vtr-operator",
    });

    const createdUser = created.snapshot.users.find((user) => user.id === created.userId);
    expect(createdUser?.fullName).toBe("Daniel VTR");
    expect(createdUser?.roleKey).toBe("vtr_operator");
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
      roleId: "role-maintenance-operator",
      linkedCrewMemberId: "crew-daniel-vtr",
    });

    const updatedUser = updated.snapshot.users.find((user) => user.id === created.userId);
    expect(updatedUser?.roleKey).toBe("maintenance_operator");
    expect(updatedUser?.linkedCrewId).toBe("crew-daniel-vtr");
    expect(updatedUser?.permissionKeys).toContain("rma.create");

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
});
