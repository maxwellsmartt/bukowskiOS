import type { DatabaseSync } from "node:sqlite";

const now = "2026-04-09T16:00:00.000Z";

const permissions = [
  ["perm-assets-read", "assets.read", "Read assets", "View asset registry and current state"],
  ["perm-assets-manage", "assets.manage", "Manage assets", "Create movements and update assets"],
  ["perm-incidents-read", "incidents.read", "Read incidents", "View incident queues and details"],
  ["perm-incidents-create", "incidents.create", "Create incidents", "Report new incidents"],
  ["perm-finance-read", "finance.read", "Read finance shell", "View finance exposure and entries"],
] as const;

const roles = [
  ["role-admin", "admin", "Admin", "Full operational access", 1],
  ["role-supervisor", "supervisor", "Supervisor", "Supervise operations and incidents", 0],
] as const;

const users = [
  ["user-paola", "Paola Rivas", "paola@metadata.cine", "+1 809 555 0101"],
  ["user-luis", "Luis Mena", "luis@metadata.cine", "+1 809 555 0102"],
  ["user-miguel", "Miguel Peralta", "miguel@metadata.cine", "+1 809 555 0103"],
  ["user-ops", "Ops Repair", "ops@metadata.cine", "+1 809 555 0199"],
] as const;

const departments = [
  ["dept-camera", "CAM", "Camera", "Camera department"],
  ["dept-ge", "GE", "Grip & Electric", "Grip and electric department"],
  ["dept-video", "VID", "Video Assist", "Video assist department"],
  ["dept-ops", "OPS", "Operations", "Operations and maintenance"],
] as const;

const projects = [
  ["project-aurora", "AURORA", "Aurora Campaign", "Altura", "Active", "2026-04-01", "2026-04-18", "Main April slate production"],
  ["project-studio", "STUDIO", "Studio Sessions", "Metadata Internal", "Prep", "2026-04-10", "2026-04-15", "Internal prep and studio tests"],
  ["project-house", "HOUSE", "House Tests", "Internal", "Wrap", "2026-04-03", "2026-04-09", "House camera and video tests"],
] as const;

const locations = [
  ["loc-warehouse-a", "WH-A", "Warehouse A", "storage", "Primary warehouse bay"],
  ["loc-set-cam-b", "SET-B", "Set / Cam B", "field", "Camera B field position"],
  ["loc-studio-3", "STU-3", "Set / Studio 3", "field", "Studio 3 stage"],
  ["loc-video-village", "VID-V", "Set / Video Village", "field", "Video village cart position"],
  ["loc-service-bench", "SRV-1", "Service Bench", "maintenance", "Repair and maintenance bench"],
] as const;

const categories = [
  ["cat-monitors", "MON", "Monitors", "Monitor systems"],
  ["cat-lighting", "LGT", "Lighting", "Lighting fixtures"],
  ["cat-wireless-video", "VID", "Wireless Video", "Wireless video systems"],
  ["cat-support", "SUP", "Support", "Tripods and support gear"],
] as const;

const assets = [
  [
    "asset-smallhd-cine7",
    "cat-monitors",
    "SmallHD Cine 7",
    "SmallHD",
    "Cine 7",
    "SMHD-778811",
    "MON-014",
    2299,
    "USD",
    "owned",
    "loc-warehouse-a",
  ],
  [
    "asset-aputure-600d",
    "cat-lighting",
    "Aputure 600D",
    "Aputure",
    "600D",
    "APT-600D-221",
    "LGT-022",
    1890,
    "USD",
    "owned",
    "loc-warehouse-a",
  ],
  [
    "asset-teradek-bolt",
    "cat-wireless-video",
    "Teradek Bolt 6 XT",
    "Teradek",
    "Bolt 6 XT",
    "TDK-B6XT-008",
    "VID-008",
    4490,
    "USD",
    "owned",
    "loc-warehouse-a",
  ],
  [
    "asset-sachtler-flowtech",
    "cat-support",
    "Sachtler Flowtech 100",
    "Sachtler",
    "Flowtech 100",
    "SCH-FLT-010",
    "SUP-010",
    1799,
    "USD",
    "owned",
    "loc-service-bench",
  ],
] as const;

const assignments = [
  [
    "assign-smallhd",
    "asset-smallhd-cine7",
    "project-aurora",
    "dept-camera",
    "user-paola",
    "user-paola",
    "loc-warehouse-a",
    "loc-set-cam-b",
    "checked_out",
    "2026-04-09T14:22:00.000Z",
    "2026-04-10T22:00:00.000Z",
    null,
    "Checked out for Aurora Campaign camera package",
  ],
  [
    "assign-teradek",
    "asset-teradek-bolt",
    "project-aurora",
    "dept-video",
    "user-luis",
    "user-luis",
    "loc-warehouse-a",
    "loc-video-village",
    "assigned",
    "2026-04-09T11:45:00.000Z",
    "2026-04-10T20:00:00.000Z",
    null,
    "Assigned to video village for live monitoring",
  ],
] as const;

const incidents = [
  [
    "incident-cine7-scratch",
    "asset-smallhd-cine7",
    "project-aurora",
    "dept-camera",
    "assign-smallhd",
    "user-paola",
    "scratch",
    "Medium",
    "Open",
    "Cine 7 top plate scratch",
    "Minor scratch logged during prep. Cost estimate pending review.",
    "2026-04-08T18:44:00.000Z",
    null,
    "user-paola",
    120,
    "USD",
    "Estimate linked",
    "Photo pending upload",
  ],
  [
    "incident-flowtech-latch",
    "asset-sachtler-flowtech",
    null,
    "dept-ops",
    null,
    "user-ops",
    "malfunction",
    "High",
    "In review",
    "Flowtech latch not locking",
    "Latch is not locking under load. Bench review requested.",
    "2026-04-08T10:12:00.000Z",
    null,
    "user-ops",
    380,
    "USD",
    "Needs approval",
    "Bench review in progress",
  ],
  [
    "incident-hdmi-clamp",
    "asset-smallhd-cine7",
    "project-aurora",
    "dept-camera",
    "assign-smallhd",
    "user-paola",
    "missing_part",
    "Low",
    "Open",
    "Missing HDMI clamp",
    "Clamp not found on return prep. Replacement still unquoted.",
    "2026-04-09T09:05:00.000Z",
    null,
    "user-paola",
    null,
    "USD",
    "Estimate missing",
    "Check previous packing slip notes",
  ],
] as const;

const packingSlips = [
  ["packing-1042", "PS-1042", "project-aurora", "dept-camera", "user-paola", null, "user-paola", "Issued", "2026-04-09", "2026-04-10", "Aurora camera package"],
  ["packing-1041", "PS-1041", "project-studio", "dept-ge", "user-miguel", null, "user-miguel", "Partial return", "2026-04-08", "2026-04-09", "Studio lighting prep"],
  ["packing-1039", "PS-1039", "project-house", "dept-video", "user-luis", null, "user-luis", "Overdue", "2026-04-07", "2026-04-08", "House tests video kit"],
] as const;

const financialEntries = [
  ["entry-incident-reserve", "reserve", "Repair", 120, "USD", 1, 120, "Draft", "project-aurora", "asset-smallhd-cine7", "incident-cine7-scratch", "user-paola", "2026-04-09", "Incident reserve for Cine 7 scratch", "Created from incident estimate"],
  ["entry-replacement-risk", "exposure", "Asset risk", 2299, "USD", 1, 2299, "Linked", "project-aurora", "asset-smallhd-cine7", null, "user-paola", "2026-04-08", "Replacement value at risk for MON-014", "Linked from active assignment"],
] as const;

type SeedRow = readonly (string | number | null)[];

const runSeedRows = (db: DatabaseSync, sql: string, rows: readonly SeedRow[]) => {
  const statement = db.prepare(sql);

  for (const row of rows) {
    statement.run(...row);
  }
};

export const seedFoundationData = (db: DatabaseSync) => {
  const { count } = db.prepare("SELECT COUNT(*) AS count FROM workspaces").get() as { count: number };

  if (count > 0) {
    return;
  }

  db.exec("BEGIN");

  try {
    runSeedRows(
      db,
      `
        INSERT INTO workspaces (id, slug, name, base_currency, is_active, created_at, updated_at)
        VALUES (?, 'metadata-cine', 'Metadata Cine', 'USD', 1, ?, ?)
      `,
      [["workspace-metadata", now, now]],
    );

    runSeedRows(
      db,
      `
        INSERT INTO permissions (id, key, label, description)
        VALUES (?, ?, ?, ?)
      `,
      permissions,
    );

    runSeedRows(
      db,
      `
        INSERT INTO roles (id, workspace_id, key, name, description, is_system_role, created_at)
        VALUES (?, 'workspace-metadata', ?, ?, ?, ?, ?)
      `,
      roles.map((role) => [role[0], role[1], role[2], role[3], role[4], now]),
    );

    runSeedRows(
      db,
      `
        INSERT INTO role_permissions (role_id, permission_id, created_at)
        VALUES (?, ?, ?)
      `,
      [
        ["role-admin", "perm-assets-read", now],
        ["role-admin", "perm-assets-manage", now],
        ["role-admin", "perm-incidents-read", now],
        ["role-admin", "perm-incidents-create", now],
        ["role-admin", "perm-finance-read", now],
        ["role-supervisor", "perm-assets-read", now],
        ["role-supervisor", "perm-incidents-read", now],
        ["role-supervisor", "perm-incidents-create", now],
        ["role-supervisor", "perm-finance-read", now],
      ],
    );

    runSeedRows(
      db,
      `
        INSERT INTO users (id, full_name, email, phone, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)
      `,
      users.map((user) => [user[0], user[1], user[2], user[3], now, now]),
    );

    runSeedRows(
      db,
      `
        INSERT INTO workspace_memberships (id, workspace_id, user_id, role_id, status, joined_at, created_at)
        VALUES (?, 'workspace-metadata', ?, ?, 'active', ?, ?)
      `,
      [
        ["membership-paola", "user-paola", "role-admin", now, now],
        ["membership-luis", "user-luis", "role-supervisor", now, now],
        ["membership-miguel", "user-miguel", "role-supervisor", now, now],
        ["membership-ops", "user-ops", "role-supervisor", now, now],
      ],
    );

    runSeedRows(
      db,
      `
        INSERT INTO departments (id, workspace_id, code, name, description, is_active, created_at)
        VALUES (?, 'workspace-metadata', ?, ?, ?, 1, ?)
      `,
      departments.map((department) => [department[0], department[1], department[2], department[3], now]),
    );

    runSeedRows(
      db,
      `
        INSERT INTO projects (id, workspace_id, code, name, client_name, status, start_date, end_date, description, created_at, updated_at)
        VALUES (?, 'workspace-metadata', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      projects.map((project) => [project[0], project[1], project[2], project[3], project[4], project[5], project[6], project[7], now, now]),
    );

    runSeedRows(
      db,
      `
        INSERT INTO locations (id, workspace_id, code, name, type, description, is_active, created_at)
        VALUES (?, 'workspace-metadata', ?, ?, ?, ?, 1, ?)
      `,
      locations.map((location) => [location[0], location[1], location[2], location[3], location[4], now]),
    );

    runSeedRows(
      db,
      `
        INSERT INTO asset_categories (id, workspace_id, parent_category_id, code, name, description, created_at)
        VALUES (?, 'workspace-metadata', NULL, ?, ?, ?, ?)
      `,
      categories.map((category) => [category[0], category[1], category[2], category[3], now]),
    );

    runSeedRows(
      db,
      `
        INSERT INTO assets (
          id,
          workspace_id,
          category_id,
          name,
          brand,
          model,
          serial_number,
          internal_code,
          description,
          purchase_date,
          purchase_price,
          currency,
          replacement_value,
          current_book_value,
          ownership_type,
          default_location_id,
          qr_code_value,
          notes,
          is_active,
          created_at,
          updated_at
        )
        VALUES (?, 'workspace-metadata', ?, ?, ?, ?, ?, ?, ?, '2025-01-15', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `,
      assets.map((asset) => [
        asset[0],
        asset[1],
        asset[2],
        asset[3],
        asset[4],
        asset[5],
        asset[6],
        `${asset[2]} inventory asset`,
        asset[7],
        asset[8],
        asset[7],
        asset[7],
        asset[9],
        asset[10],
        `${asset[6]}-QR`,
        "Seeded foundation asset",
        now,
        now,
      ]),
    );

    runSeedRows(
      db,
      `
        INSERT INTO asset_assignments (
          id,
          workspace_id,
          asset_id,
          project_id,
          department_id,
          assigned_to_user_id,
          assigned_by_user_id,
          source_location_id,
          target_location_id,
          assignment_status,
          checked_out_at,
          expected_return_at,
          returned_at,
          notes,
          created_at,
          updated_at
        )
        VALUES (?, 'workspace-metadata', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      assignments.map((assignment) => [...assignment, now, now]),
    );

    runSeedRows(
      db,
      `
        INSERT INTO asset_events (
          id,
          workspace_id,
          asset_id,
          assignment_id,
          project_id,
          department_id,
          performed_by_user_id,
          event_type,
          location_id,
          from_location_id,
          to_location_id,
          event_timestamp,
          command_id,
          actor_type,
          source_channel,
          notes,
          metadata_json,
          created_at
        )
        VALUES (?, 'workspace-metadata', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'user', 'desktop', ?, ?, ?)
      `,
      [
        ["event-smallhd-created", "asset-smallhd-cine7", null, null, null, "user-paola", "asset_created", "loc-warehouse-a", null, null, "2026-04-07T08:00:00.000Z", "cmd-smallhd-created", "Asset registered in warehouse", "{\"condition\":\"good\"}", "2026-04-07T08:00:00.000Z"],
        ["event-smallhd-incident", "asset-smallhd-cine7", "assign-smallhd", "project-aurora", "dept-camera", "user-paola", "incident_reported", "loc-warehouse-a", null, null, "2026-04-08T18:44:00.000Z", "cmd-smallhd-incident", "Minor scratch logged during prep", "{\"incidentId\":\"incident-cine7-scratch\"}", "2026-04-08T18:44:00.000Z"],
        ["event-smallhd-checkout", "asset-smallhd-cine7", "assign-smallhd", "project-aurora", "dept-camera", "user-paola", "check_out", "loc-set-cam-b", "loc-warehouse-a", "loc-set-cam-b", "2026-04-09T14:22:00.000Z", "cmd-smallhd-checkout", "Checked out to Cam B for Aurora Campaign", "{\"responsible\":\"user-paola\"}", "2026-04-09T14:22:00.000Z"],
        ["event-aputure-created", "asset-aputure-600d", null, null, null, "user-miguel", "asset_created", "loc-warehouse-a", null, null, "2026-04-06T12:00:00.000Z", "cmd-aputure-created", "Lighting fixture registered in storage", "{\"condition\":\"good\"}", "2026-04-06T12:00:00.000Z"],
        ["event-teradek-created", "asset-teradek-bolt", null, null, null, "user-luis", "asset_created", "loc-warehouse-a", null, null, "2026-04-06T10:30:00.000Z", "cmd-teradek-created", "Wireless video kit registered", "{\"condition\":\"good\"}", "2026-04-06T10:30:00.000Z"],
        ["event-teradek-assigned", "asset-teradek-bolt", "assign-teradek", "project-aurora", "dept-video", "user-luis", "assigned", "loc-video-village", "loc-warehouse-a", "loc-video-village", "2026-04-09T11:45:00.000Z", "cmd-teradek-assigned", "Assigned to video village", "{\"responsible\":\"user-luis\"}", "2026-04-09T11:45:00.000Z"],
        ["event-flowtech-created", "asset-sachtler-flowtech", null, null, null, "user-ops", "asset_created", "loc-warehouse-a", null, null, "2026-04-05T09:10:00.000Z", "cmd-flowtech-created", "Support asset registered", "{\"condition\":\"good\"}", "2026-04-05T09:10:00.000Z"],
        ["event-flowtech-maintenance", "asset-sachtler-flowtech", null, null, "dept-ops", "user-ops", "maintenance_started", "loc-service-bench", "loc-warehouse-a", "loc-service-bench", "2026-04-08T10:12:00.000Z", "cmd-flowtech-maintenance", "Latch issue sent to service bench", "{\"incidentId\":\"incident-flowtech-latch\"}", "2026-04-08T10:12:00.000Z"]
      ],
    );

    runSeedRows(
      db,
      `
        INSERT INTO asset_current_state (
          asset_id,
          workspace_id,
          current_location_id,
          current_project_id,
          current_department_id,
          current_responsible_user_id,
          active_assignment_id,
          condition_status,
          operational_status,
          custody_status,
          last_event_id,
          version,
          updated_at
        )
        VALUES (?, 'workspace-metadata', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        ["asset-smallhd-cine7", "loc-set-cam-b", "project-aurora", "dept-camera", "user-paola", "assign-smallhd", "Good", "ready", "checked_out", "event-smallhd-checkout", 3, "2026-04-09T14:22:00.000Z"],
        ["asset-aputure-600d", "loc-warehouse-a", null, null, null, null, "Good", "ready", "available", "event-aputure-created", 1, "2026-04-06T12:00:00.000Z"],
        ["asset-teradek-bolt", "loc-video-village", "project-aurora", "dept-video", "user-luis", "assign-teradek", "Good", "ready", "assigned", "event-teradek-assigned", 2, "2026-04-09T11:45:00.000Z"],
        ["asset-sachtler-flowtech", "loc-service-bench", null, "dept-ops", "user-ops", null, "Needs review", "maintenance", "maintenance", "event-flowtech-maintenance", 2, "2026-04-08T10:12:00.000Z"],
      ],
    );

    runSeedRows(
      db,
      `
        INSERT INTO packing_slips (
          id,
          workspace_id,
          project_id,
          department_id,
          prepared_by_user_id,
          approved_by_user_id,
          responsible_user_id,
          status,
          issue_date,
          return_due_date,
          notes,
          created_at,
          updated_at
        )
        VALUES (?, 'workspace-metadata', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      packingSlips.map((slip) => [slip[0], slip[2], slip[3], slip[4], slip[5], slip[6], slip[7], slip[8], slip[9], slip[10], now, now]),
    );

    runSeedRows(
      db,
      `
        INSERT INTO packing_slip_items (
          id,
          packing_slip_id,
          asset_id,
          quantity,
          condition_out,
          condition_in,
          returned_at,
          notes
        )
        VALUES (?, ?, ?, 1, ?, ?, ?, ?)
      `,
      [
        ["packing-item-1042-1", "packing-1042", "asset-smallhd-cine7", "Good", null, null, "Primary field monitor"],
        ["packing-item-1041-1", "packing-1041", "asset-aputure-600d", "Good", "Good", "2026-04-09T13:08:00.000Z", "Partial return completed"],
        ["packing-item-1039-1", "packing-1039", "asset-teradek-bolt", "Good", null, null, "Still out with video village"],
      ],
    );

    runSeedRows(
      db,
      `
        INSERT INTO incidents (
          id,
          workspace_id,
          asset_id,
          project_id,
          department_id,
          assignment_id,
          reported_by_user_id,
          incident_type,
          severity,
          status,
          title,
          description,
          reported_at,
          resolved_at,
          responsible_user_id,
          cost_estimate,
          currency,
          financial_status,
          notes,
          created_at,
          updated_at
        )
        VALUES (?, 'workspace-metadata', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      incidents.map((incident) => [...incident, now, now]),
    );

    runSeedRows(
      db,
      `
        INSERT INTO financial_entries (
          id,
          workspace_id,
          entry_type,
          category,
          amount,
          currency,
          exchange_rate,
          base_currency_amount,
          status,
          project_id,
          asset_id,
          incident_id,
          created_by_user_id,
          entry_date,
          description,
          notes,
          created_at,
          updated_at
        )
        VALUES (?, 'workspace-metadata', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      financialEntries.map((entry) => [...entry, now, now]),
    );

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
};
