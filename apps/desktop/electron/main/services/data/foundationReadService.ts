import type { DatabaseSync } from "node:sqlite";

import type {
  AssetDetailSnapshot,
  AssetLinkedIncidentRow,
  AssetListRow,
  AssetTimelineItem,
  CatalogSnapshot,
  FinanceCostLinkRow,
  FinanceEntryRow,
  FinanceOverviewSnapshot,
  IncidentListRow,
  OverviewMetric,
  OverviewSnapshot,
  PackingSlipRow,
  ProjectCardRow,
  ProjectDetailAssetRow,
  ProjectDetailIncidentRow,
  ProjectDetailSnapshot,
  ProjectExposureRow,
  ProjectResponsibleRow,
  ShellBootstrap,
} from "@contracts";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "2-digit",
});

const eventTimeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

type CountRow = {
  count: number;
};

type AmountRow = {
  amount: number | null;
};

const formatCurrency = (amount: number | null | undefined) =>
  typeof amount === "number" ? currencyFormatter.format(amount) : "Pending";

const formatShortDate = (value: string | null) => {
  if (!value) {
    return "—";
  }

  return dateFormatter.format(new Date(value));
};

const formatTimelineTimestamp = (value: string) => {
  const eventDate = new Date(value);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  const sameDay =
    eventDate.getFullYear() === now.getFullYear() &&
    eventDate.getMonth() === now.getMonth() &&
    eventDate.getDate() === now.getDate();

  const isYesterday =
    eventDate.getFullYear() === yesterday.getFullYear() &&
    eventDate.getMonth() === yesterday.getMonth() &&
    eventDate.getDate() === yesterday.getDate();

  if (sameDay) {
    return `Today · ${eventTimeFormatter.format(eventDate)}`;
  }

  if (isYesterday) {
    return `Yesterday · ${eventTimeFormatter.format(eventDate)}`;
  }

  return `${dateFormatter.format(eventDate)} · ${eventTimeFormatter.format(eventDate)}`;
};

const mapAssetStatus = (operationalStatus: string, custodyStatus: string) => {
  if (operationalStatus === "maintenance") {
    return "Maintenance";
  }

  if (custodyStatus === "checked_out") {
    return "Checked out";
  }

  if (custodyStatus === "assigned") {
    return "Assigned";
  }

  return "Available";
};

const mapTrackingLabel = (value: string | null | undefined) => {
  switch (value) {
    case "serialized":
      return "Serialized";
    case "grouped":
      return "Grouped";
    default:
      return "Single";
  }
};

const mapEventTitle = (eventType: string) => {
  switch (eventType) {
    case "asset_created":
      return "Asset created";
    case "check_out":
      return "Checked out";
    case "check_in":
      return "Checked in";
    case "assigned":
      return "Assigned";
    case "moved":
      return "Moved";
    case "incident_reported":
      return "Incident reported";
    case "maintenance_started":
      return "Maintenance started";
    case "maintenance_completed":
      return "Maintenance completed";
    default:
      return "Status updated";
  }
};

export const createFoundationReadService = (db: DatabaseSync) => ({
  getShellBootstrap(): ShellBootstrap {
    const workspace = db.prepare("SELECT name FROM workspaces WHERE is_active = 1 ORDER BY created_at LIMIT 1").get() as
      | { name: string }
      | undefined;

    const activeProject = db
      .prepare(
        `
          SELECT name
          FROM projects
          WHERE workspace_id = 'workspace-metadata'
          ORDER BY CASE status
            WHEN 'Active' THEN 0
            WHEN 'Prep' THEN 1
            ELSE 2
          END, name
          LIMIT 1
        `,
      )
      .get() as { name: string } | undefined;

    return {
      workspaceName: workspace?.name ?? "Metadata Cine",
      projectScope: activeProject ? `Global / ${activeProject.name}` : "Global",
      syncLabel: "Local-first",
    };
  },

  getOverviewSnapshot(): OverviewSnapshot {
    const totalAssets = db.prepare("SELECT COUNT(*) AS count FROM assets WHERE is_active = 1").get() as CountRow;
    const assignedAssets = db
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM asset_current_state
          WHERE custody_status IN ('checked_out', 'assigned')
        `,
      )
      .get() as CountRow;
    const activeIncidents = db
      .prepare("SELECT COUNT(*) AS count FROM incidents WHERE status IN ('Open', 'In review')")
      .get() as CountRow;
    const openPackingSlips = db
      .prepare("SELECT COUNT(*) AS count FROM packing_slips WHERE status IN ('Issued', 'Partial return', 'Overdue')")
      .get() as CountRow;
    const maintenanceWatch = db
      .prepare("SELECT COUNT(*) AS count FROM asset_current_state WHERE operational_status = 'maintenance'")
      .get() as CountRow;

    const metrics: OverviewMetric[] = [
      { label: "Total assets", value: String(totalAssets.count), tone: "neutral" },
      { label: "Assigned assets", value: String(assignedAssets.count), tone: "info" },
      { label: "Active incidents", value: String(activeIncidents.count), tone: "critical" },
      { label: "Open packing slips", value: String(openPackingSlips.count), tone: "warning" },
      { label: "Maintenance watch", value: String(maintenanceWatch.count), tone: "success" },
    ];

    const recentMovements = db
      .prepare(
        `
          SELECT
            assets.name AS asset,
            assets.internal_code AS code,
            COALESCE(from_location.name, '—') AS from_location,
            COALESCE(to_location.name, location.name, '—') AS to_location,
            COALESCE(departments.name, users.full_name, 'Operations') AS actor,
            asset_events.event_timestamp AS event_timestamp
          FROM asset_events
          JOIN assets ON assets.id = asset_events.asset_id
          LEFT JOIN locations AS from_location ON from_location.id = asset_events.from_location_id
          LEFT JOIN locations AS to_location ON to_location.id = asset_events.to_location_id
          LEFT JOIN locations AS location ON location.id = asset_events.location_id
          LEFT JOIN departments ON departments.id = asset_events.department_id
          LEFT JOIN users ON users.id = asset_events.performed_by_user_id
          WHERE asset_events.event_type IN ('asset_created', 'check_out', 'assigned', 'moved', 'maintenance_started', 'check_in')
          ORDER BY asset_events.event_timestamp DESC
          LIMIT 3
        `,
      )
      .all() as Array<{
      asset: string;
      code: string;
      from_location: string;
      to_location: string;
      actor: string;
      event_timestamp: string;
    }>;

    return {
      metrics,
      recentMovements: recentMovements.map((row) => ({
        asset: row.asset,
        code: row.code,
        from: row.from_location,
        to: row.to_location,
        actor: row.actor,
        timestamp: eventTimeFormatter.format(new Date(row.event_timestamp)),
      })),
    };
  },

  getAssets(): AssetListRow[] {
    const rows = db
      .prepare(
        `
          SELECT
            assets.id,
            assets.name,
            COALESCE(legacy_rentman_items.legacy_code, assets.internal_code) AS code,
            asset_categories.name AS category,
            COALESCE(legacy_rentman_items.current_quantity, 1) AS quantity,
            COALESCE(legacy_rentman_asset_links.import_strategy, 'single') AS tracking,
            asset_current_state.operational_status,
            asset_current_state.custody_status,
            asset_current_state.condition_status,
            COALESCE(locations.name, '—') AS location,
            COALESCE(projects.name, '—') AS project,
            COALESCE(users.full_name, '—') AS responsible,
            COALESCE(legacy_rentman_items.serial_number, assets.serial_number, '—') AS serial_number,
            COALESCE(legacy_rentman_items.qr_code_value, assets.qr_code_value, '—') AS qr_code_value,
            COALESCE(legacy_rentman_items.warehouse_slot, '—') AS warehouse_slot,
            COALESCE(legacy_rentman_items.folder_path, '—') AS folder_path,
            CASE legacy_rentman_items.has_accessories
              WHEN 1 THEN 'Yes'
              WHEN 0 THEN 'No'
              ELSE 'Unknown'
            END AS has_accessories,
            COALESCE(legacy_rentman_imports.source_label, 'Operational registry') AS source_label,
            (
              SELECT COUNT(*)
              FROM incidents
              WHERE incidents.asset_id = assets.id
                AND incidents.status IN ('Open', 'In review')
            ) AS incidents_open
          FROM assets
          JOIN asset_categories ON asset_categories.id = assets.category_id
          JOIN asset_current_state ON asset_current_state.asset_id = assets.id
          LEFT JOIN legacy_rentman_asset_links ON legacy_rentman_asset_links.asset_id = assets.id
          LEFT JOIN legacy_rentman_items ON legacy_rentman_items.id = legacy_rentman_asset_links.legacy_item_id
          LEFT JOIN legacy_rentman_imports ON legacy_rentman_imports.id = legacy_rentman_items.import_id
          LEFT JOIN locations ON locations.id = asset_current_state.current_location_id
          LEFT JOIN projects ON projects.id = asset_current_state.current_project_id
          LEFT JOIN users ON users.id = asset_current_state.current_responsible_user_id
          WHERE assets.is_active = 1
          ORDER BY assets.name
        `,
      )
      .all() as Array<{
      id: string;
      name: string;
      code: string;
      category: string;
      quantity: number;
      tracking: string;
      operational_status: string;
      custody_status: string;
      condition_status: string;
      location: string;
      project: string;
      responsible: string;
      serial_number: string;
      qr_code_value: string;
      warehouse_slot: string;
      folder_path: string;
      has_accessories: string;
      source_label: string;
      incidents_open: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code,
      category: row.category,
      quantity: row.quantity,
      tracking: mapTrackingLabel(row.tracking),
      status: mapAssetStatus(row.operational_status, row.custody_status),
      condition: row.condition_status,
      custody: row.custody_status,
      location: row.location,
      project: row.project,
      responsible: row.responsible,
      serialNumber: row.serial_number,
      qrCode: row.qr_code_value,
      warehouseSlot: row.warehouse_slot,
      folderPath: row.folder_path,
      hasAccessories: row.has_accessories,
      source: row.source_label,
      incidentsOpen: row.incidents_open,
    }));
  },

  getAssetDetail(assetId: string): AssetDetailSnapshot {
    const asset = db
      .prepare(
        `
          SELECT
            assets.id,
            assets.name,
            COALESCE(legacy_rentman_items.legacy_code, assets.internal_code) AS code,
            assets.replacement_value,
            asset_current_state.condition_status,
            asset_current_state.custody_status,
            asset_current_state.operational_status,
            COALESCE(legacy_rentman_items.current_quantity, 1) AS quantity,
            COALESCE(legacy_rentman_asset_links.import_strategy, 'single') AS tracking,
            COALESCE(locations.name, '—') AS location,
            COALESCE(projects.name, '—') AS project,
            COALESCE(users.full_name, '—') AS responsible,
            COALESCE(legacy_rentman_imports.source_label, 'Operational registry') AS source_label,
            COALESCE(legacy_rentman_items.qr_code_value, assets.qr_code_value, '—') AS qr_code_value,
            COALESCE(legacy_rentman_items.warehouse_slot, '—') AS warehouse_slot,
            COALESCE(legacy_rentman_items.folder_path, '—') AS folder_path,
            CASE legacy_rentman_items.has_accessories
              WHEN 1 THEN 'Yes'
              WHEN 0 THEN 'No'
              ELSE 'Unknown'
            END AS has_accessories
          FROM assets
          JOIN asset_current_state ON asset_current_state.asset_id = assets.id
          LEFT JOIN legacy_rentman_asset_links ON legacy_rentman_asset_links.asset_id = assets.id
          LEFT JOIN legacy_rentman_items ON legacy_rentman_items.id = legacy_rentman_asset_links.legacy_item_id
          LEFT JOIN legacy_rentman_imports ON legacy_rentman_imports.id = legacy_rentman_items.import_id
          LEFT JOIN locations ON locations.id = asset_current_state.current_location_id
          LEFT JOIN projects ON projects.id = asset_current_state.current_project_id
          LEFT JOIN users ON users.id = asset_current_state.current_responsible_user_id
          WHERE assets.id = ?
          LIMIT 1
        `,
      )
      .get(assetId) as
      | {
          id: string;
          name: string;
          code: string;
          replacement_value: number | null;
          condition_status: string;
          custody_status: string;
          operational_status: string;
          quantity: number;
          tracking: string;
          location: string;
          project: string;
          responsible: string;
          source_label: string;
          qr_code_value: string;
          warehouse_slot: string;
          folder_path: string;
          has_accessories: string;
        }
      | undefined;

    if (!asset) {
      return {
        asset: null,
        legacy: null,
        timeline: [],
        linkedIncidents: [],
      };
    }

    const timelineRows = db
      .prepare(
        `
          SELECT event_type, event_timestamp, notes
          FROM asset_events
          WHERE asset_id = ?
          ORDER BY event_timestamp DESC
          LIMIT 6
        `,
      )
      .all(assetId) as Array<{
      event_type: string;
      event_timestamp: string;
      notes: string | null;
    }>;

    const linkedIncidents = db
      .prepare(
        `
          SELECT
            incidents.id,
            title,
            COALESCE(projects.name, '—') AS project,
            cost_estimate,
            severity
          FROM incidents
          LEFT JOIN projects ON projects.id = incidents.project_id
          WHERE asset_id = ?
          ORDER BY reported_at DESC
          LIMIT 3
        `,
      )
      .all(assetId) as Array<{
      id: string;
      title: string;
      project: string;
      cost_estimate: number | null;
      severity: string;
    }>;

    const timeline: AssetTimelineItem[] = timelineRows.map((row) => ({
      timestamp: formatTimelineTimestamp(row.event_timestamp),
      title: mapEventTitle(row.event_type),
      body: row.notes ?? "Operational event recorded in the asset timeline.",
    }));

    const incidentRows: AssetLinkedIncidentRow[] = linkedIncidents.map((row) => ({
      id: row.id,
      title: row.title,
      project: row.project,
      costEstimate: formatCurrency(row.cost_estimate),
      severity: row.severity,
    }));

    return {
      asset: {
        id: asset.id,
        name: asset.name,
        code: asset.code,
        status: mapAssetStatus(asset.operational_status, asset.custody_status),
        quantity: asset.quantity,
        tracking: mapTrackingLabel(asset.tracking),
        location: asset.location,
        project: asset.project,
        responsible: asset.responsible,
        replacementValue: formatCurrency(asset.replacement_value),
        condition: asset.condition_status,
        custody: asset.custody_status,
      },
      legacy: {
        source: asset.source_label,
        legacyCode: asset.code || "—",
        qrCode: asset.qr_code_value,
        warehouseSlot: asset.warehouse_slot,
        folderPath: asset.folder_path,
        hasAccessories: asset.has_accessories,
      },
      timeline,
      linkedIncidents: incidentRows,
    };
  },

  getPackingSlips(): PackingSlipRow[] {
    const rows = db
      .prepare(
        `
          SELECT
            packing_slips.id,
            packing_slips.status,
            packing_slips.return_due_date,
            projects.name AS project,
            COALESCE(departments.name, '—') AS department,
            COALESCE(users.full_name, '—') AS responsible
          FROM packing_slips
          JOIN projects ON projects.id = packing_slips.project_id
          LEFT JOIN departments ON departments.id = packing_slips.department_id
          LEFT JOIN users ON users.id = packing_slips.responsible_user_id
          ORDER BY packing_slips.issue_date DESC
        `,
      )
      .all() as Array<{
      id: string;
      status: string;
      return_due_date: string | null;
      project: string;
      department: string;
      responsible: string;
    }>;

    return rows.map((row) => ({
      number: row.id.replace("packing-", "PS-"),
      project: row.project,
      department: row.department,
      responsible: row.responsible,
      dueDate: formatShortDate(row.return_due_date),
      status: row.status,
    }));
  },

  getIncidents(): IncidentListRow[] {
    const rows = db
      .prepare(
        `
          SELECT
            incidents.id,
            incidents.title,
            COALESCE(assets.internal_code, '—') AS asset_code,
            COALESCE(projects.name, '—') AS project,
            COALESCE(users.full_name, '—') AS responsible,
            incidents.severity,
            incidents.cost_estimate,
            incidents.status
          FROM incidents
          LEFT JOIN assets ON assets.id = incidents.asset_id
          LEFT JOIN projects ON projects.id = incidents.project_id
          LEFT JOIN users ON users.id = incidents.responsible_user_id
          ORDER BY incidents.reported_at DESC
        `,
      )
      .all() as Array<{
      id: string;
      title: string;
      asset_code: string;
      project: string;
      responsible: string;
      severity: string;
      cost_estimate: number | null;
      status: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      asset: row.asset_code,
      project: row.project,
      responsible: row.responsible,
      severity: row.severity,
      costEstimate: formatCurrency(row.cost_estimate),
      status: row.status,
    }));
  },

  getProjects(): ProjectCardRow[] {
    const rows = db
      .prepare(
        `
          SELECT
            projects.id,
            projects.code,
            projects.name,
            COALESCE(projects.client_name, '—') AS client_name,
            projects.status,
            COALESCE(projects.description, '—') AS description,
            COALESCE((
              SELECT group_concat(name, ', ')
              FROM (
                SELECT DISTINCT departments.name AS name
                FROM asset_assignments
                JOIN departments ON departments.id = asset_assignments.department_id
                WHERE asset_assignments.project_id = projects.id
                ORDER BY departments.name
              )
            ), '—') AS departments,
            COALESCE((
              SELECT SUM(cost_estimate)
              FROM incidents
              WHERE incidents.project_id = projects.id
            ), 0) AS exposure,
            COALESCE((
              SELECT COUNT(*)
              FROM asset_current_state
              WHERE asset_current_state.current_project_id = projects.id
            ), 0) AS asset_count,
            COALESCE((
              SELECT COUNT(*)
              FROM incidents
              WHERE incidents.project_id = projects.id
            ), 0) AS incident_count
          FROM projects
          ORDER BY CASE projects.status
            WHEN 'Active' THEN 0
            WHEN 'Prep' THEN 1
            ELSE 2
          END, projects.name
        `,
      )
      .all() as Array<{
      id: string;
      code: string;
      name: string;
      client_name: string;
      status: string;
      description: string;
      departments: string;
      exposure: number;
      asset_count: number;
      incident_count: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      client: row.client_name,
      status: row.status,
      departments: row.departments,
      exposure: formatCurrency(row.exposure),
      assetCount: row.asset_count,
      incidentCount: row.incident_count,
      description: row.description,
    }));
  },

  getProjectDetail(projectId: string): ProjectDetailSnapshot {
    const project = db
      .prepare(
        `
          SELECT
            projects.id,
            projects.code,
            projects.name,
            COALESCE(projects.client_name, '—') AS client_name,
            projects.status,
            COALESCE(projects.description, '—') AS description,
            COALESCE((
              SELECT group_concat(name, ', ')
              FROM (
                SELECT DISTINCT departments.name AS name
                FROM asset_assignments
                JOIN departments ON departments.id = asset_assignments.department_id
                WHERE asset_assignments.project_id = projects.id
                ORDER BY departments.name
              )
            ), '—') AS departments,
            COALESCE((
              SELECT SUM(cost_estimate)
              FROM incidents
              WHERE incidents.project_id = projects.id
            ), 0) AS exposure,
            COALESCE((
              SELECT COUNT(*)
              FROM asset_current_state
              WHERE asset_current_state.current_project_id = projects.id
            ), 0) AS asset_count,
            COALESCE((
              SELECT COUNT(*)
              FROM incidents
              WHERE incidents.project_id = projects.id
            ), 0) AS incident_count,
            COALESCE((
              SELECT SUM(assets.replacement_value)
              FROM asset_current_state
              JOIN assets ON assets.id = asset_current_state.asset_id
              WHERE asset_current_state.current_project_id = projects.id
            ), 0) AS replacement_at_risk
          FROM projects
          WHERE projects.id = ?
          LIMIT 1
        `,
      )
      .get(projectId) as
      | {
          id: string;
          code: string;
          name: string;
          client_name: string;
          status: string;
          description: string;
          departments: string;
          exposure: number;
          asset_count: number;
          incident_count: number;
          replacement_at_risk: number;
        }
      | undefined;

    if (!project) {
      return {
        project: null,
        metrics: [],
        assets: [],
        incidents: [],
        responsibles: [],
        budget: {
          totalEntries: formatCurrency(0),
          reserve: formatCurrency(0),
          exposure: formatCurrency(0),
          status: "No project selected",
          note: "Select a project from the sidebar or registry to inspect operational detail.",
        },
      };
    }

    const assets = db
      .prepare(
        `
          SELECT
            assets.id,
            assets.name,
            COALESCE(legacy_rentman_items.legacy_code, assets.internal_code) AS code,
            asset_current_state.operational_status,
            asset_current_state.custody_status,
            asset_current_state.condition_status,
            COALESCE(locations.name, '—') AS location,
            COALESCE(users.full_name, '—') AS responsible,
            assets.replacement_value
          FROM asset_current_state
          JOIN assets ON assets.id = asset_current_state.asset_id
          LEFT JOIN legacy_rentman_asset_links ON legacy_rentman_asset_links.asset_id = assets.id
          LEFT JOIN legacy_rentman_items ON legacy_rentman_items.id = legacy_rentman_asset_links.legacy_item_id
          LEFT JOIN locations ON locations.id = asset_current_state.current_location_id
          LEFT JOIN users ON users.id = asset_current_state.current_responsible_user_id
          WHERE asset_current_state.current_project_id = ?
          ORDER BY users.full_name IS NULL, users.full_name, assets.name
        `,
      )
      .all(projectId) as Array<{
      id: string;
      name: string;
      code: string;
      operational_status: string;
      custody_status: string;
      condition_status: string;
      location: string;
      responsible: string;
      replacement_value: number | null;
    }>;

    const incidents = db
      .prepare(
        `
          SELECT
            incidents.id,
            incidents.title,
            COALESCE(assets.internal_code, '—') AS asset_code,
            COALESCE(users.full_name, '—') AS responsible,
            incidents.severity,
            incidents.cost_estimate,
            incidents.status
          FROM incidents
          LEFT JOIN assets ON assets.id = incidents.asset_id
          LEFT JOIN users ON users.id = incidents.responsible_user_id
          WHERE incidents.project_id = ?
          ORDER BY CASE incidents.status
            WHEN 'Open' THEN 0
            WHEN 'In review' THEN 1
            ELSE 2
          END, incidents.reported_at DESC
        `,
      )
      .all(projectId) as Array<{
      id: string;
      title: string;
      asset_code: string;
      responsible: string;
      severity: string;
      cost_estimate: number | null;
      status: string;
    }>;

    const responsibles = db
      .prepare(
        `
          SELECT
            users.full_name AS name,
            COALESCE((
              SELECT COUNT(*)
              FROM asset_current_state
              WHERE asset_current_state.current_project_id = ?
                AND asset_current_state.current_responsible_user_id = users.id
            ), 0) AS asset_count,
            COALESCE((
              SELECT COUNT(*)
              FROM incidents
              WHERE incidents.project_id = ?
                AND incidents.responsible_user_id = users.id
                AND incidents.status IN ('Open', 'In review')
            ), 0) AS incident_count
          FROM users
          WHERE EXISTS (
            SELECT 1
            FROM asset_current_state
            WHERE asset_current_state.current_project_id = ?
              AND asset_current_state.current_responsible_user_id = users.id
          )
          OR EXISTS (
            SELECT 1
            FROM incidents
            WHERE incidents.project_id = ?
              AND incidents.responsible_user_id = users.id
          )
          ORDER BY asset_count DESC, incident_count DESC, users.full_name
        `,
      )
      .all(projectId, projectId, projectId, projectId) as Array<{
      name: string;
      asset_count: number;
      incident_count: number;
    }>;

    const budgetRow = db
      .prepare(
        `
          SELECT
            COALESCE(SUM(amount), 0) AS total_entries,
            COALESCE(SUM(CASE WHEN entry_type = 'reserve' THEN amount ELSE 0 END), 0) AS reserve_amount,
            COALESCE(SUM(CASE WHEN status IN ('Approved', 'Linked', 'Booked', 'Paid') THEN amount ELSE 0 END), 0) AS committed_amount
          FROM financial_entries
          WHERE project_id = ?
        `,
      )
      .get(projectId) as {
      total_entries: number;
      reserve_amount: number;
      committed_amount: number;
    };

    const detailMetrics: OverviewMetric[] = [
      { label: "Assigned assets", value: String(project.asset_count), tone: "info" },
      { label: "Open incidents", value: String(incidents.filter((row) => row.status !== "Closed").length), tone: "critical" },
      { label: "Incident exposure", value: formatCurrency(project.exposure), tone: "warning" },
      { label: "Replacement at risk", value: formatCurrency(project.replacement_at_risk), tone: "neutral" },
    ];

    const assetRows: ProjectDetailAssetRow[] = assets.map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code,
      status: mapAssetStatus(row.operational_status, row.custody_status),
      location: row.location,
      responsible: row.responsible,
      condition: row.condition_status,
      replacementValue: formatCurrency(row.replacement_value),
    }));

    const incidentRows: ProjectDetailIncidentRow[] = incidents.map((row) => ({
      id: row.id,
      title: row.title,
      asset: row.asset_code,
      responsible: row.responsible,
      severity: row.severity,
      costEstimate: formatCurrency(row.cost_estimate),
      status: row.status,
    }));

    const responsibleRows: ProjectResponsibleRow[] = responsibles.map((row) => ({
      name: row.name,
      assetCount: row.asset_count,
      incidentCount: row.incident_count,
    }));

    const hasBudgetEntries = budgetRow.total_entries > 0;

    return {
      project: {
        id: project.id,
        code: project.code,
        name: project.name,
        client: project.client_name,
        status: project.status,
        departments: project.departments,
        exposure: formatCurrency(project.exposure),
        assetCount: project.asset_count,
        incidentCount: project.incident_count,
        description: project.description,
      },
      metrics: detailMetrics,
      assets: assetRows,
      incidents: incidentRows,
      responsibles: responsibleRows,
      budget: {
        totalEntries: formatCurrency(budgetRow.total_entries),
        reserve: formatCurrency(budgetRow.reserve_amount),
        exposure: formatCurrency(project.exposure),
        status: hasBudgetEntries ? "Finance hooks linked" : "No finance entries yet",
        note: hasBudgetEntries
          ? `Committed foundation entries: ${formatCurrency(budgetRow.committed_amount)}.`
          : "This project is ready for budget, reserve and actual tracking once Finance flows are expanded.",
      },
    };
  },

  getCatalogSnapshot(): CatalogSnapshot {
    const locations = db
      .prepare("SELECT id, code, name, type FROM locations WHERE is_active = 1 ORDER BY name")
      .all() as Array<{ id: string; code: string; name: string; type: string }>;

    const departments = db
      .prepare("SELECT id, code, name FROM departments WHERE is_active = 1 ORDER BY name")
      .all() as Array<{ id: string; code: string; name: string }>;

    const users = db
      .prepare(
        `
          SELECT users.id, users.full_name
          FROM workspace_memberships
          JOIN users ON users.id = workspace_memberships.user_id
          WHERE workspace_memberships.workspace_id = 'workspace-metadata'
            AND workspace_memberships.status = 'active'
          ORDER BY users.full_name
        `,
      )
      .all() as Array<{ id: string; full_name: string }>;

    return {
      locations,
      departments,
      users: users.map((row) => ({
        id: row.id,
        fullName: row.full_name,
      })),
    };
  },

  getFinanceOverview(): FinanceOverviewSnapshot {
    const incidentExposure = db
      .prepare(
        `
          SELECT COALESCE(SUM(cost_estimate), 0) AS amount
          FROM incidents
          WHERE status IN ('Open', 'In review')
        `,
      )
      .get() as AmountRow;
    const replacementAtRisk = db
      .prepare(
        `
          SELECT COALESCE(SUM(assets.replacement_value), 0) AS amount
          FROM asset_current_state
          JOIN assets ON assets.id = asset_current_state.asset_id
          WHERE asset_current_state.custody_status IN ('checked_out', 'assigned')
        `,
      )
      .get() as AmountRow;
    const maintenanceQueue = db
      .prepare("SELECT COUNT(*) AS count FROM asset_current_state WHERE operational_status = 'maintenance'")
      .get() as CountRow;
    const missingEstimates = db
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM incidents
          WHERE status IN ('Open', 'In review') AND cost_estimate IS NULL
        `,
      )
      .get() as CountRow;

    return {
      metrics: [
        { label: "Incident exposure", value: formatCurrency(incidentExposure.amount), tone: "critical" },
        { label: "Replacement at risk", value: formatCurrency(replacementAtRisk.amount), tone: "warning" },
        { label: "Maintenance queue", value: `${maintenanceQueue.count} assets`, tone: "info" },
        { label: "Missing estimates", value: `${missingEstimates.count} incidents`, tone: "neutral" },
      ],
      exposureByProject: this.getFinanceProjectExposure(),
      costLinks: this.getFinanceCostLinks(),
    };
  },

  getFinanceProjectExposure(): ProjectExposureRow[] {
    const rows = db
      .prepare(
        `
          SELECT
            projects.name AS project,
            COALESCE((
              SELECT SUM(cost_estimate)
              FROM incidents
              WHERE incidents.project_id = projects.id
            ), 0) AS exposure,
            COALESCE((
              SELECT COUNT(*)
              FROM incidents
              WHERE incidents.project_id = projects.id
            ), 0) AS incident_count,
            COALESCE((
              SELECT SUM(assets.replacement_value)
              FROM asset_current_state
              JOIN assets ON assets.id = asset_current_state.asset_id
              WHERE asset_current_state.current_project_id = projects.id
            ), 0) AS assets_out
          FROM projects
          ORDER BY exposure DESC, projects.name
        `,
      )
      .all() as Array<{
      project: string;
      exposure: number;
      incident_count: number;
      assets_out: number;
    }>;

    return rows.map((row) => ({
      project: row.project,
      exposure: formatCurrency(row.exposure),
      incidentCount: row.incident_count,
      assetsOut: formatCurrency(row.assets_out),
    }));
  },

  getFinanceCostLinks(): FinanceCostLinkRow[] {
    const rows = db
      .prepare(
        `
          SELECT
            incidents.title AS incident,
            COALESCE(assets.internal_code, '—') AS asset,
            COALESCE(projects.name, '—') AS project,
            COALESCE(users.full_name, '—') AS responsible,
            incidents.severity,
            incidents.cost_estimate,
            assets.replacement_value,
            COALESCE(incidents.financial_status, 'Unlinked') AS financial_status
          FROM incidents
          LEFT JOIN assets ON assets.id = incidents.asset_id
          LEFT JOIN projects ON projects.id = incidents.project_id
          LEFT JOIN users ON users.id = incidents.responsible_user_id
          ORDER BY incidents.reported_at DESC
        `,
      )
      .all() as Array<{
      incident: string;
      asset: string;
      project: string;
      responsible: string;
      severity: string;
      cost_estimate: number | null;
      replacement_value: number | null;
      financial_status: string;
    }>;

    return rows.map((row) => ({
      incident: row.incident,
      asset: row.asset,
      project: row.project,
      responsible: row.responsible,
      severity: row.severity,
      costEstimate: formatCurrency(row.cost_estimate),
      replacementValue: formatCurrency(row.replacement_value),
      financialStatus: row.financial_status,
    }));
  },

  getFinanceEntries(): FinanceEntryRow[] {
    const rows = db
      .prepare(
        `
          SELECT
            financial_entries.entry_date,
            financial_entries.entry_type,
            financial_entries.category,
            financial_entries.amount,
            financial_entries.status,
            COALESCE(projects.name, '—') AS project,
            COALESCE(incidents.title, assets.internal_code, financial_entries.id) AS reference
          FROM financial_entries
          LEFT JOIN projects ON projects.id = financial_entries.project_id
          LEFT JOIN incidents ON incidents.id = financial_entries.incident_id
          LEFT JOIN assets ON assets.id = financial_entries.asset_id
          ORDER BY financial_entries.entry_date DESC
        `,
      )
      .all() as Array<{
      entry_date: string;
      entry_type: string;
      category: string;
      amount: number;
      status: string;
      project: string;
      reference: string;
    }>;

    return rows.map((row) => ({
      date: row.entry_date,
      type: row.entry_type,
      category: row.category,
      reference: row.reference,
      project: row.project,
      amount: formatCurrency(row.amount),
      status: row.status,
    }));
  },
});

export type FoundationReadService = ReturnType<typeof createFoundationReadService>;
