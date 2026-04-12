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

const manufacturers = [
  ["manufacturer-sachtler", "Sachtler", "Service Desk", "support@sachtler.test", "+1 809 555 0401", "Tripods and support systems"],
  ["manufacturer-smallhd", "SmallHD", "Monitor Support", "support@smallhd.test", "+1 809 555 0402", "Displays and monitor accessories"],
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

const rmaCases = [
  [
    "rma-flowtech-latch",
    "manufacturer-sachtler",
    "Flowtech latch review",
    "support@sachtler.test",
    "Latch is not locking correctly under load and needs manufacturer review.",
    "Bench review completed. Ready to share with manufacturer.",
    "Ready",
    "user-ops",
    "2026-04-09T09:20:00.000Z",
    "2026-04-10T15:40:00.000Z",
    null,
    null,
  ],
] as const;

const rmaCaseAssets = [
  ["rma-flowtech-latch-asset-1", "rma-flowtech-latch", "asset-sachtler-flowtech", "2023", "Latch not locking under load on spreader side."],
] as const;

const agents = [
  [
    "agent-supervisor",
    "supervisor-agent",
    "Supervisor Agent",
    "◎",
    "Receives global intent, routes work and keeps approval discipline.",
    "control",
    "openai",
    "openai:gpt-5.4",
    "GPT-5.4",
    "active",
    "supervised",
    JSON.stringify(["workspace.search", "runs.create", "routing.review"]),
    JSON.stringify(["assets", "finance", "incidents", "projects", "connectors"]),
    "Primary orchestrator for BukowskiOS. Commands stay behind the command layer.",
    1,
    0,
  ],
  [
    "agent-assets",
    "assets-agent",
    "Assets Agent",
    "▣",
    "Keeps inventory, movement context and packing operations organized.",
    "assets",
    "openai",
    "openai:gpt-5.4-mini",
    "GPT-5.4 Mini",
    "active",
    "needs_approval",
    JSON.stringify(["assets.read", "packing.read", "compare.prepare"]),
    JSON.stringify(["assets", "packing_slips", "catalog"]),
    "Prepared to assist with registry, movements and packing review.",
    0,
    1,
  ],
  [
    "agent-incidents",
    "incidents-maintenance-agent",
    "Incidents & Maintenance Agent",
    "◈",
    "Tracks incidents, maintenance queues and RMA-related follow-up.",
    "incidents",
    "anthropic",
    "anthropic:sonnet-4",
    "Claude Sonnet 4",
    "active",
    "supervised",
    JSON.stringify(["incidents.read", "maintenance.watch", "rma.prepare"]),
    JSON.stringify(["incidents", "maintenance", "rma"]),
    "Best for structured follow-up and approvals around maintenance workflows.",
    0,
    2,
  ],
  [
    "agent-finance",
    "finance-agent",
    "Finance Agent",
    "◌",
    "Prepares financial context, exposure summaries and cost-link drafts.",
    "finance",
    "openai",
    "openai:gpt-5.4-mini",
    "GPT-5.4 Mini",
    "active",
    "needs_approval",
    JSON.stringify(["finance.read", "entries.review", "cost-links.review"]),
    JSON.stringify(["finance"]),
    "Focused on visibility before any financial mutation is approved.",
    0,
    3,
  ],
  [
    "agent-communications",
    "communications-agent",
    "Communications Agent",
    "✦",
    "Prepares outbound drafts for email, notifications and connectors.",
    "communications",
    "openclaw",
    "openclaw:command",
    "OpenClaw Command",
    "paused",
    "needs_approval",
    JSON.stringify(["connector.email", "connector.notifications", "draft.compose"]),
    JSON.stringify(["connectors", "notifications"]),
    "Held in paused mode until outbound connectors are fully enabled.",
    0,
    4,
  ],
  [
    "agent-projects",
    "projects-scheduling-agent",
    "Projects & Scheduling Agent",
    "◇",
    "Reviews project timing, unit coordination and schedule conflicts.",
    "projects",
    "anthropic",
    "anthropic:sonnet-4",
    "Claude Sonnet 4",
    "active",
    "supervised",
    JSON.stringify(["projects.read", "timeline.review", "unit.conflicts"]),
    JSON.stringify(["projects", "schedule", "units"]),
    "Strong fit for cross-project schedule and unit planning questions.",
    0,
    5,
  ],
] as const;

const aiProviderConfigs = [
  [
    "provider-openai",
    "openai",
    "OpenAI",
    1,
    0,
    "openai:gpt-5.4-mini",
    "",
    30000,
    1,
    "not_configured",
    "First live AI provider for supervised routing.",
  ],
  [
    "provider-anthropic",
    "anthropic",
    "Anthropic",
    0,
    0,
    "anthropic:sonnet-4",
    "",
    30000,
    1,
    "not_configured",
    "Provider shell staged for future expansion.",
  ],
  [
    "provider-openclaw",
    "openclaw",
    "OpenClaw",
    0,
    0,
    "openclaw:command",
    "",
    30000,
    1,
    "not_configured",
    "Provider shell staged for future expansion.",
  ],
  [
    "provider-custom",
    "custom",
    "Custom / Gateway",
    0,
    0,
    "custom:gateway-default",
    "",
    30000,
    1,
    "not_configured",
    "Provider shell staged for future gateway routing.",
  ],
] as const;

const agentRuns = [
  [
    "run-assets-overdue",
    "agent-assets",
    "agent-supervisor",
    "chat",
    "Review overdue returns for the next 48 hours",
    "User asked for a return-risk sweep across active packing slips.",
    "Prepared a draft return watchlist grouped by project and responsible person.",
    "done",
    "needs_approval",
    1,
    "2026-04-10T12:10:00.000Z",
    "2026-04-10T12:18:00.000Z",
  ],
  [
    "run-incidents-rma",
    "agent-incidents",
    "agent-supervisor",
    "chat",
    "Prepare RMA follow-up for maintenance assets",
    "User requested a maintenance and manufacturer outreach summary.",
    "Routed to maintenance review and waiting for approval before drafting outreach.",
    "needs_approval",
    "supervised",
    1,
    "2026-04-10T13:02:00.000Z",
    "2026-04-10T13:05:00.000Z",
  ],
  [
    "run-finance-exposure",
    "agent-finance",
    "agent-supervisor",
    "system",
    "Summarize current open incident exposure",
    "Mission Control requested a quick finance snapshot for open incidents.",
    "Exposure summary prepared from incident-linked reserves and replacement risk.",
    "running",
    "needs_approval",
    0,
    "2026-04-10T13:18:00.000Z",
    "2026-04-10T13:24:00.000Z",
  ],
  [
    "run-projects-conflicts",
    "agent-projects",
    "agent-supervisor",
    "chat",
    "Check project and unit conflicts for next week",
    "User asked whether any unit overlaps or schedule conflicts are coming up.",
    "Routing project windows and unit lane conflicts through scheduling context.",
    "queued",
    "supervised",
    0,
    "2026-04-10T13:40:00.000Z",
    "2026-04-10T13:40:00.000Z",
  ],
  [
    "run-connectors-audit",
    "agent-communications",
    "agent-supervisor",
    "system",
    "Audit connector readiness",
    "Mission Control requested a connector readiness audit.",
    "Outbound connectors are still staged and remain disabled for live execution.",
    "paused",
    "needs_approval",
    1,
    "2026-04-10T11:30:00.000Z",
    "2026-04-10T11:44:00.000Z",
  ],
] as const;

const agentActivityEvents = [
  [
    "agent-activity-1",
    "agent-supervisor",
    "run-assets-overdue",
    "routing",
    "Assets request routed",
    "Supervisor routed an overdue-return review to Assets Agent.",
    "info",
    "2026-04-10T12:11:00.000Z",
  ],
  [
    "agent-activity-2",
    "agent-assets",
    "run-assets-overdue",
    "done",
    "Return watchlist prepared",
    "Assets Agent completed a draft watchlist and marked it ready for review.",
    "success",
    "2026-04-10T12:18:00.000Z",
  ],
  [
    "agent-activity-3",
    "agent-incidents",
    "run-incidents-rma",
    "approval",
    "Approval requested",
    "Incidents & Maintenance Agent needs approval before preparing outbound RMA messaging.",
    "warning",
    "2026-04-10T13:05:00.000Z",
  ],
  [
    "agent-activity-4",
    "agent-finance",
    "run-finance-exposure",
    "running",
    "Exposure summary in progress",
    "Finance Agent is building a current incident exposure summary.",
    "info",
    "2026-04-10T13:24:00.000Z",
  ],
  [
    "agent-activity-5",
    "agent-communications",
    "run-connectors-audit",
    "paused",
    "Connector work paused",
    "Communications Agent remains paused until outbound connectors are configured.",
    "neutral",
    "2026-04-10T11:44:00.000Z",
  ],
] as const;

const agentModelConfigs = [
  ["agent-model-openai", "openai", "OpenAI", "assigned", "Assigned to Supervisor and Assets agents."],
  ["agent-model-anthropic", "anthropic", "Anthropic", "assigned", "Assigned to scheduling and maintenance reasoning."],
  ["agent-model-openclaw", "openclaw", "OpenClaw", "available", "Prepared for connector and command-facing workflows."],
  ["agent-model-custom", "custom", "Custom / Future", "unassigned", "Reserved for future gateways and private backends."],
] as const;

const agentConnectorConfigs = [
  ["agent-connector-whatsapp", "whatsapp", "WhatsApp", "not_configured", "Inbound and outbound production messaging."],
  ["agent-connector-telegram", "telegram", "Telegram", "disabled", "Fast operator messaging and alert routing."],
  ["agent-connector-email", "email", "Email / Notifications", "configured", "Drafts, support outreach and internal notices."],
  ["agent-connector-webhook", "webhook", "Webhook / Future", "not_configured", "Future integrations and gateway automations."],
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
        INSERT INTO manufacturers (
          id,
          workspace_id,
          name,
          contact_name,
          support_email,
          phone,
          notes,
          is_active,
          created_at,
          updated_at
        )
        VALUES (?, 'workspace-metadata', ?, ?, ?, ?, ?, 1, ?, ?)
      `,
      manufacturers.map((manufacturer) => [
        manufacturer[0],
        manufacturer[1],
        manufacturer[2],
        manufacturer[3],
        manufacturer[4],
        manufacturer[5],
        now,
        now,
      ]),
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

    runSeedRows(
      db,
      `
        INSERT INTO rma_cases (
          id,
          workspace_id,
          manufacturer_id,
          title,
          support_email,
          problem_summary,
          notes,
          status,
          created_by_user_id,
          created_at,
          updated_at,
          sent_at,
          closed_at
        )
        VALUES (?, 'workspace-metadata', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      rmaCases,
    );

    runSeedRows(
      db,
      `
        INSERT INTO rma_case_assets (
          id,
          rma_case_id,
          asset_id,
          equipment_year,
          issue_summary,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      rmaCaseAssets.map((row) => [...row, now, now]),
    );

    runSeedRows(
      db,
      `
        INSERT INTO agents (
          id,
          workspace_id,
          agent_key,
          display_name,
          emoji,
          role_summary,
          domain_key,
          provider_key,
          model_key,
          model_label,
          status,
          approval_mode,
          allowed_tools_json,
          allowed_domains_json,
          notes,
          is_supervisor,
          sort_order,
          created_at,
          updated_at
        )
        VALUES (?, 'workspace-metadata', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      agents.map((agent) => [...agent, now, now]),
    );

    runSeedRows(
      db,
      `
        INSERT INTO ai_provider_configs (
          id,
          workspace_id,
          provider_key,
          display_name,
          supports_live_requests,
          enabled,
          default_model_key,
          base_url,
          timeout_ms,
          retry_count,
          status,
          notes,
          created_at,
          updated_at
        )
        VALUES (?, 'workspace-metadata', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      aiProviderConfigs.map((row) => [...row, now, now]),
    );

    runSeedRows(
      db,
      `
        INSERT INTO agent_runs (
          id,
          workspace_id,
          agent_id,
          routed_by_agent_id,
          source_channel,
          title,
          input_summary,
          output_summary,
          status,
          approval_mode,
          approval_required,
          created_at,
          updated_at
        )
        VALUES (?, 'workspace-metadata', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      agentRuns,
    );

    runSeedRows(
      db,
      `
        INSERT INTO agent_activity_events (
          id,
          workspace_id,
          agent_id,
          run_id,
          kind,
          title,
          body,
          tone,
          created_at
        )
        VALUES (?, 'workspace-metadata', ?, ?, ?, ?, ?, ?, ?)
      `,
      agentActivityEvents,
    );

    runSeedRows(
      db,
      `
        INSERT INTO agent_model_configs (
          id,
          workspace_id,
          provider_key,
          display_name,
          status,
          notes,
          created_at,
          updated_at
        )
        VALUES (?, 'workspace-metadata', ?, ?, ?, ?, ?, ?)
      `,
      agentModelConfigs.map((row) => [...row, now, now]),
    );

    runSeedRows(
      db,
      `
        INSERT INTO agent_connector_configs (
          id,
          workspace_id,
          connector_key,
          display_name,
          status,
          capability_summary,
          notes,
          created_at,
          updated_at
        )
        VALUES (?, 'workspace-metadata', ?, ?, ?, ?, '', ?, ?)
      `,
      agentConnectorConfigs.map((row) => [...row, now, now]),
    );

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
};
