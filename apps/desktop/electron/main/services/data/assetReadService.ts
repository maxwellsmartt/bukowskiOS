import type { DatabaseSync } from "node:sqlite";

import type {
  AssetsOverviewSnapshot,
  AssetSummarySnapshot,
  AssetListQuery,
  AssetSortField,
  AssetDetailSnapshot,
  AssetLinkedIncidentRow,
  AssetListRow,
  AssetTimelineItem,
  OverviewSnapshot,
  ListSortDirection,
} from "@contracts";

type SortRows = <T>(rows: T[], comparator: (left: T, right: T) => number) => T[];

type AssetReadDeps = {
  defaultAssetListQuery: AssetListQuery;
  formatCurrency: (amount: number | null | undefined) => string;
  mapTrackingLabel: (value: string) => string;
  mapAssetStatus: (operationalStatus: string, custodyStatus: string) => string;
  matchesSearch: (query: string | undefined, values: Array<string | null | undefined>) => boolean;
  resolveAssetComparator: (sortBy: AssetSortField, direction: ListSortDirection) => (left: any, right: any) => number;
  sortRows: SortRows;
  mapEventTitle: (eventType: string) => string;
  formatTimelineTimestamp: (value: string) => string;
  toIsoDate: (value?: string | null) => string;
  addDays: (date: string, days: number) => string;
  getOverviewSnapshot: () => OverviewSnapshot;
};

type CountRow = {
  count: number;
};

export const createAssetReadService = (db: DatabaseSync, deps: AssetReadDeps) => {
  const service = {
    getAssetSummary(): AssetSummarySnapshot {
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

      return {
        totalAssets: String(totalAssets.count),
        assignedAssets: String(assignedAssets.count),
      };
    },

    getAssetsOverview(): AssetsOverviewSnapshot {
      const overviewSnapshot = deps.getOverviewSnapshot();
      const assetSummary = service.getAssetSummary();

      return {
        totalAssets: assetSummary.totalAssets,
        assignedAssets: assetSummary.assignedAssets,
        cards: overviewSnapshot.cards,
        recentMovements: overviewSnapshot.recentMovements,
      };
    },

    getAssets(query: AssetListQuery = deps.defaultAssetListQuery): AssetListRow[] {
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
              asset_current_state.current_project_id AS project_id,
              COALESCE(projects.name, '—') AS project,
              asset_current_state.project_unit_id AS project_unit_id,
              COALESCE(project_units.name, '—') AS project_unit,
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
              assets.created_at,
              assets.updated_at,
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
            LEFT JOIN project_units ON project_units.id = asset_current_state.project_unit_id
            LEFT JOIN users ON users.id = asset_current_state.current_responsible_user_id
            WHERE assets.is_active = 1
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
        project_id: string | null;
        project: string;
        project_unit_id: string | null;
        project_unit: string;
        responsible: string;
        serial_number: string;
        qr_code_value: string;
        warehouse_slot: string;
        folder_path: string;
        has_accessories: string;
        source_label: string;
        created_at: string | null;
        updated_at: string | null;
        incidents_open: number;
      }>;

      const scopedRows = rows
        .map((row) => ({
          id: row.id,
          name: row.name,
          code: row.code,
          category: row.category,
          quantity: row.quantity,
          tracking: deps.mapTrackingLabel(row.tracking),
          status: deps.mapAssetStatus(row.operational_status, row.custody_status),
          condition: row.condition_status,
          custody: row.custody_status,
          location: row.location,
          projectId: row.project_id,
          project: row.project,
          projectUnitId: row.project_unit_id,
          projectUnit: row.project_unit,
          responsible: row.responsible,
          serialNumber: row.serial_number,
          qrCode: row.qr_code_value,
          warehouseSlot: row.warehouse_slot,
          folderPath: row.folder_path,
          hasAccessories: row.has_accessories,
          source: row.source_label,
          incidentsOpen: row.incidents_open,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }))
        .filter((row) => !query.scopeProjectId || row.projectId === query.scopeProjectId)
        .filter((row) =>
          deps.matchesSearch(query.search, [
            row.name,
            row.code,
            row.category,
            row.location,
            row.project,
            row.projectUnit,
            row.responsible,
            row.serialNumber,
            row.qrCode,
          ]),
        );

      return deps.sortRows(
        scopedRows,
        deps.resolveAssetComparator(query.sortBy ?? deps.defaultAssetListQuery.sortBy, query.sortDirection ?? deps.defaultAssetListQuery.sortDirection),
      ).map(({ createdAt: _createdAt, updatedAt: _updatedAt, ...row }) => row);
    },

    getAssetDetail(assetId: string): AssetDetailSnapshot {
      const asset = db
        .prepare(
          `
            SELECT
              assets.id,
              assets.name,
              COALESCE(legacy_rentman_items.legacy_code, assets.internal_code) AS code,
              assets.internal_code,
              assets.category_id,
              COALESCE(asset_categories.name, '—') AS category_name,
              assets.brand,
              assets.model,
              assets.serial_number,
              assets.description,
              assets.replacement_value,
              assets.default_location_id,
              assets.notes,
              assets.ownership_type,
              assets.is_active,
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
            LEFT JOIN asset_categories ON asset_categories.id = assets.category_id
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
            internal_code: string;
            category_id: string;
            category_name: string;
            brand: string | null;
            model: string | null;
            serial_number: string | null;
            description: string | null;
            replacement_value: number | null;
            default_location_id: string | null;
            notes: string | null;
            ownership_type: string | null;
            is_active: number;
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
          editor: null,
          scannableCodes: [],
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

      const scannableCodes = db
        .prepare(
          `
            SELECT id, symbology, code_value, is_primary
            FROM scannable_codes
            WHERE entity_type = 'asset'
              AND entity_id = ?
            ORDER BY is_primary DESC, created_at ASC
          `,
        )
        .all(assetId) as Array<{
        id: string;
        symbology: string;
        code_value: string;
        is_primary: number;
      }>;

      const primaryCodeValue = scannableCodes.find((row) => row.is_primary)?.code_value ?? asset.qr_code_value;

      const timeline: AssetTimelineItem[] = timelineRows.map((row) => ({
        timestamp: deps.formatTimelineTimestamp(row.event_timestamp),
        title: deps.mapEventTitle(row.event_type),
        body: row.notes ?? "Operational event recorded in the asset timeline.",
      }));

      const incidentRows: AssetLinkedIncidentRow[] = linkedIncidents.map((row) => ({
        id: row.id,
        title: row.title,
        project: row.project,
        costEstimate: deps.formatCurrency(row.cost_estimate),
        severity: row.severity,
      }));

      return {
        asset: {
          id: asset.id,
          name: asset.name,
          code: asset.code,
          status: deps.mapAssetStatus(asset.operational_status, asset.custody_status),
          quantity: asset.quantity,
          tracking: deps.mapTrackingLabel(asset.tracking),
          location: asset.location,
          project: asset.project,
          responsible: asset.responsible,
          replacementValue: deps.formatCurrency(asset.replacement_value),
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
        editor: {
          id: asset.id,
          name: asset.name,
          internalCode: asset.internal_code,
          categoryId: asset.category_id,
          brand: asset.brand ?? "",
          model: asset.model ?? "",
          serialNumber: asset.serial_number ?? "",
          description: asset.description ?? "",
          defaultLocationId: asset.default_location_id,
          conditionStatus: asset.condition_status,
          notes: asset.notes ?? "",
          replacementValue: asset.replacement_value,
          ownershipType: asset.ownership_type ?? "owned",
          isActive: Boolean(asset.is_active),
          qrCodeValue: asset.qr_code_value === "—" ? "" : asset.qr_code_value,
          primaryCodeValue: primaryCodeValue ?? "",
        },
        scannableCodes: scannableCodes.map((row) => ({
          id: row.id,
          symbology: row.symbology,
          codeValue: row.code_value,
          isPrimary: Boolean(row.is_primary),
        })),
      };
    },

    getAssetAvailability(input?: { assetId?: string | null; query?: string | null; rangeStart?: string | null; rangeEnd?: string | null; limit?: number }) {
      const rangeStart = deps.toIsoDate(input?.rangeStart);
      const rangeEnd = deps.toIsoDate(input?.rangeEnd ?? deps.addDays(rangeStart, 30));
      const rows = service
        .getAssets({
          scopeProjectId: null,
          search: input?.assetId ? undefined : input?.query ?? "",
          sortBy: "name",
          sortDirection: "asc",
        })
        .filter((row) => !input?.assetId || row.id === input.assetId)
        .slice(0, input?.limit ?? 8);

      return rows.map((row) => {
        const reservations = db
          .prepare(
            `
              SELECT COUNT(*) AS count
              FROM asset_assignments
              WHERE asset_id = ?
                AND returned_at IS NULL
                AND assignment_status IN ('reserved', 'assigned', 'checked_out')
                AND (
                  expected_return_at IS NULL
                  OR expected_return_at >= ?
                )
                AND created_at <= ?
            `,
          )
          .get(row.id, rangeStart, `${rangeEnd}T23:59:59.000Z`) as CountRow;

        return {
          id: row.id,
          code: row.code,
          name: row.name,
          status: row.status,
          location: row.location,
          project: row.project,
          projectUnit: row.projectUnit,
          reservationsInWindow: reservations.count,
          availableNow: row.status === "Available" && reservations.count === 0,
          rangeStart,
          rangeEnd,
        };
      });
    },

    getAssetLocation(assetId: string) {
      const detail = service.getAssetDetail(assetId);

      if (!detail.asset) {
        return { asset: null };
      }

      return {
        asset: {
          id: detail.asset.id,
          name: detail.asset.name,
          code: detail.asset.code,
          location: detail.asset.location,
          project: detail.asset.project,
          responsible: detail.asset.responsible,
          status: detail.asset.status,
          custody: detail.asset.custody,
        },
      };
    },

    getAssetMovements(assetId: string, limit = 8) {
      const rows = db
        .prepare(
          `
            SELECT
              asset_events.id,
              asset_events.event_type,
              asset_events.event_timestamp,
              COALESCE(users.full_name, '—') AS performed_by,
              COALESCE(projects.name, '—') AS project_name,
              COALESCE(from_locations.name, '—') AS from_location,
              COALESCE(to_locations.name, '—') AS to_location,
              COALESCE(asset_events.notes, '') AS notes
            FROM asset_events
            LEFT JOIN users ON users.id = asset_events.performed_by_user_id
            LEFT JOIN projects ON projects.id = asset_events.project_id
            LEFT JOIN locations AS from_locations ON from_locations.id = asset_events.from_location_id
            LEFT JOIN locations AS to_locations ON to_locations.id = asset_events.to_location_id
            WHERE asset_events.asset_id = ?
            ORDER BY asset_events.event_timestamp DESC
            LIMIT ?
          `,
        )
        .all(assetId, limit) as Array<{
        id: string;
        event_type: string;
        event_timestamp: string;
        performed_by: string;
        project_name: string;
        from_location: string;
        to_location: string;
        notes: string;
      }>;

      return rows.map((row) => ({
        id: row.id,
        type: row.event_type,
        title: deps.mapEventTitle(row.event_type),
        timestamp: deps.formatTimelineTimestamp(row.event_timestamp),
        performedBy: row.performed_by,
        project: row.project_name,
        fromLocation: row.from_location,
        toLocation: row.to_location,
        notes: row.notes,
      }));
    },

    getAssetReservations(input?: { assetId?: string | null; query?: string | null; rangeStart?: string | null; rangeEnd?: string | null; limit?: number }) {
      const rangeStart = deps.toIsoDate(input?.rangeStart);
      const rangeEnd = deps.toIsoDate(input?.rangeEnd ?? deps.addDays(rangeStart, 30));
      const clauses = [
        "asset_assignments.returned_at IS NULL",
        "asset_assignments.assignment_status IN ('reserved', 'assigned', 'checked_out')",
        "COALESCE(asset_assignments.expected_return_at, '9999-12-31T23:59:59.000Z') >= ?",
        "asset_assignments.created_at <= ?",
      ];
      const params: Array<string | number | null> = [rangeStart, `${rangeEnd}T23:59:59.000Z`];

      if (input?.assetId) {
        clauses.push("assets.id = ?");
        params.push(input.assetId);
      }

      const rows = db
        .prepare(
          `
            SELECT
              asset_assignments.id,
              assets.id AS asset_id,
              assets.name AS asset_name,
              COALESCE(legacy_rentman_items.legacy_code, assets.internal_code) AS asset_code,
              COALESCE(projects.name, '—') AS project_name,
              COALESCE(users.full_name, '—') AS assigned_to,
              asset_assignments.assignment_status,
              asset_assignments.checked_out_at,
              asset_assignments.expected_return_at,
              asset_assignments.returned_at
            FROM asset_assignments
            JOIN assets ON assets.id = asset_assignments.asset_id
            LEFT JOIN legacy_rentman_asset_links ON legacy_rentman_asset_links.asset_id = assets.id
            LEFT JOIN legacy_rentman_items ON legacy_rentman_items.id = legacy_rentman_asset_links.legacy_item_id
            LEFT JOIN projects ON projects.id = asset_assignments.project_id
            LEFT JOIN users ON users.id = asset_assignments.assigned_to_user_id
            WHERE ${clauses.join(" AND ")}
            ORDER BY COALESCE(asset_assignments.expected_return_at, asset_assignments.created_at) ASC
            LIMIT ?
          `,
        )
        .all(...params, input?.limit ?? 10) as Array<{
        id: string;
        asset_id: string;
        asset_name: string;
        asset_code: string;
        project_name: string;
        assigned_to: string;
        assignment_status: string;
        checked_out_at: string | null;
        expected_return_at: string | null;
        returned_at: string | null;
      }>;

      return rows
        .filter((row) =>
          deps.matchesSearch(input?.query ?? "", [row.asset_name, row.asset_code, row.project_name, row.assigned_to, row.assignment_status]),
        )
        .map((row) => ({
          id: row.id,
          assetId: row.asset_id,
          asset: row.asset_name,
          code: row.asset_code,
          project: row.project_name,
          assignedTo: row.assigned_to,
          status: row.assignment_status,
          checkedOutAt: row.checked_out_at ? deps.formatTimelineTimestamp(row.checked_out_at) : "Not checked out",
          expectedReturnAt: row.expected_return_at ? deps.formatTimelineTimestamp(row.expected_return_at) : "Open-ended",
          returnedAt: row.returned_at ? deps.formatTimelineTimestamp(row.returned_at) : "Pending return",
        }));
    },

    getKitContents(input?: { kitId?: string | null; query?: string | null; limit?: number }) {
      const rows = db
        .prepare(
          `
            SELECT
              kits.id AS kit_id,
              kits.code AS kit_code,
              kits.name AS kit_name,
              COALESCE(kits.description, '') AS kit_description,
              assets.id AS asset_id,
              assets.name AS asset_name,
              COALESCE(legacy_rentman_items.legacy_code, assets.internal_code) AS asset_code
            FROM kits
            LEFT JOIN kit_assets ON kit_assets.kit_id = kits.id
            LEFT JOIN assets ON assets.id = kit_assets.asset_id
            LEFT JOIN legacy_rentman_asset_links ON legacy_rentman_asset_links.asset_id = assets.id
            LEFT JOIN legacy_rentman_items ON legacy_rentman_items.id = legacy_rentman_asset_links.legacy_item_id
            WHERE kits.is_active = 1
              AND (? IS NULL OR kits.id = ?)
            ORDER BY kits.name, assets.name
          `,
        )
        .all(input?.kitId ?? null, input?.kitId ?? null) as Array<{
        kit_id: string;
        kit_code: string;
        kit_name: string;
        kit_description: string;
        asset_id: string | null;
        asset_name: string | null;
        asset_code: string | null;
      }>;

      const byKit = new Map<
        string,
        {
          id: string;
          code: string;
          name: string;
          description: string;
          assets: Array<{ id: string; name: string; code: string }>;
        }
      >();

      rows.forEach((row) => {
        const current =
          byKit.get(row.kit_id) ??
          {
            id: row.kit_id,
            code: row.kit_code,
            name: row.kit_name,
            description: row.kit_description,
            assets: [],
          };

        if (!byKit.has(row.kit_id)) {
          byKit.set(row.kit_id, current);
        }

        if (row.asset_id && row.asset_name && row.asset_code) {
          current.assets.push({
            id: row.asset_id,
            name: row.asset_name,
            code: row.asset_code,
          });
        }
      });

      return Array.from(byKit.values())
        .filter((row) => deps.matchesSearch(input?.query ?? "", [row.code, row.name, row.description, ...row.assets.map((asset) => asset.name)]))
        .slice(0, input?.limit ?? 6);
    },
  };

  return service;
};
