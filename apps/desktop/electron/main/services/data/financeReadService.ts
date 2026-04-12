import type { DatabaseSync } from "node:sqlite";

import type {
  FinanceCostLinkRow,
  FinanceEntryListQuery,
  FinanceEntryRow,
  FinanceEntrySortField,
  FinanceOverviewSnapshot,
  ListSortDirection,
  ProjectExposureRow,
} from "@contracts";

type SortRows = <T>(rows: T[], comparator: (left: T, right: T) => number) => T[];

type FinanceReadDeps = {
  defaultFinanceEntryListQuery: FinanceEntryListQuery;
  formatCurrency: (amount: number | null | undefined) => string;
  matchesSearch: (query: string | undefined, values: Array<string | null | undefined>) => boolean;
  resolveFinanceEntryComparator: (
    sortBy: FinanceEntrySortField,
    direction: ListSortDirection,
  ) => (left: any, right: any) => number;
  sortRows: SortRows;
};

type CountRow = {
  count: number;
};

type AmountRow = {
  amount: number | null;
};

export const createFinanceReadService = (db: DatabaseSync, deps: FinanceReadDeps) => ({
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
        { label: "Incident exposure", value: deps.formatCurrency(incidentExposure.amount), tone: "critical" },
        { label: "Replacement at risk", value: deps.formatCurrency(replacementAtRisk.amount), tone: "warning" },
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
      exposure: deps.formatCurrency(row.exposure),
      incidentCount: row.incident_count,
      assetsOut: deps.formatCurrency(row.assets_out),
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
      costEstimate: deps.formatCurrency(row.cost_estimate),
      replacementValue: deps.formatCurrency(row.replacement_value),
      financialStatus: row.financial_status,
    }));
  },

  getFinanceEntries(query: FinanceEntryListQuery = deps.defaultFinanceEntryListQuery): FinanceEntryRow[] {
    const rows = db
      .prepare(
        `
          SELECT
            financial_entries.id,
            financial_entries.entry_date,
            financial_entries.entry_type,
            financial_entries.category,
            financial_entries.amount,
            financial_entries.currency,
            financial_entries.status,
            financial_entries.project_id,
            financial_entries.asset_id,
            financial_entries.incident_id,
            financial_entries.description,
            financial_entries.notes,
            COALESCE(projects.name, '—') AS project,
            COALESCE(incidents.title, assets.internal_code, financial_entries.id) AS reference
          FROM financial_entries
          LEFT JOIN projects ON projects.id = financial_entries.project_id
          LEFT JOIN incidents ON incidents.id = financial_entries.incident_id
          LEFT JOIN assets ON assets.id = financial_entries.asset_id
        `,
      )
      .all() as Array<{
      id: string;
      entry_date: string;
      entry_type: string;
      category: string;
      amount: number;
      currency: string;
      status: string;
      project_id: string | null;
      asset_id: string | null;
      incident_id: string | null;
      description: string | null;
      notes: string | null;
      project: string;
      reference: string;
    }>;

    const mappedRows = rows
      .map((row) => ({
        id: row.id,
        date: row.entry_date,
        type: row.entry_type,
        category: row.category,
        reference: row.reference,
        project: row.project,
        amount: deps.formatCurrency(row.amount),
        status: row.status,
        amountValue: row.amount,
        currency: row.currency,
        projectId: row.project_id,
        assetId: row.asset_id,
        incidentId: row.incident_id,
        description: row.description,
        notes: row.notes,
        dateValue: row.entry_date,
      }))
      .filter((row) => deps.matchesSearch(query.search, [row.reference, row.project, row.category, row.type, row.status]));

    return deps.sortRows(
      mappedRows,
      deps.resolveFinanceEntryComparator(
        query.sortBy ?? deps.defaultFinanceEntryListQuery.sortBy,
        query.sortDirection ?? deps.defaultFinanceEntryListQuery.sortDirection,
      ),
    ).map(({ dateValue: _dateValue, ...row }) => row);
  },
});
