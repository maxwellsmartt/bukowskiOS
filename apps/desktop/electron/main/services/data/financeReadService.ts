import fs from "node:fs";
import type { DatabaseSync } from "node:sqlite";

import type {
  FinancialDocumentRow,
  FinanceCostLinkRow,
  FinanceEntryListQuery,
  FinanceEntryRow,
  FinanceEntrySortField,
  FinanceOverviewQuery,
  FinanceOverviewSnapshot,
  ListSortDirection,
  ProjectExposureRow,
} from "@contracts";
import { endOfMonth, endOfQuarter, endOfYear, format, startOfMonth, startOfQuarter, startOfYear, subMonths } from "date-fns";

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

const toIsoDate = (value: Date) => value.toISOString().slice(0, 10);

const resolveFinanceOverviewWindow = (query?: FinanceOverviewQuery) => {
  const now = new Date();

  if (query?.period === "custom" && query.customStartDate && query.customEndDate) {
    return {
      endDate: query.customEndDate,
      label: `${query.customStartDate} to ${query.customEndDate}`,
      startDate: query.customStartDate,
    };
  }

  if (query?.period === "quarter") {
    return {
      endDate: toIsoDate(endOfQuarter(now)),
      label: "This quarter",
      startDate: toIsoDate(startOfQuarter(now)),
    };
  }

  if (query?.period === "year") {
    return {
      endDate: toIsoDate(endOfYear(now)),
      label: "This year",
      startDate: toIsoDate(startOfYear(now)),
    };
  }

  return {
    endDate: toIsoDate(endOfMonth(now)),
    label: "This month",
    startDate: toIsoDate(startOfMonth(now)),
  };
};

const buildMonthlyWindows = (months: number) =>
  Array.from({ length: months }, (_value, index) => {
    const anchor = subMonths(new Date(), months - 1 - index);
    return {
      endDate: toIsoDate(endOfMonth(anchor)),
      key: format(anchor, "MMM yyyy"),
      startDate: toIsoDate(startOfMonth(anchor)),
    };
  });

const maxInlinePreviewBytes = 5 * 1024 * 1024;

export const createFinanceReadService = (db: DatabaseSync, deps: FinanceReadDeps) => ({
  getFinanceOverview(query?: FinanceOverviewQuery): FinanceOverviewSnapshot {
    const window = resolveFinanceOverviewWindow(query);
    const incidentExposure = db
      .prepare(
        `
          SELECT COALESCE(SUM(cost_estimate), 0) AS amount
          FROM incidents
          WHERE status IN ('Open', 'In review')
            AND reported_at >= ?
            AND reported_at <= ?
        `,
      )
      .get(window.startDate, `${window.endDate}T23:59:59.999Z`) as AmountRow;
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
          WHERE status IN ('Open', 'In review')
            AND reported_at >= ?
            AND reported_at <= ?
            AND cost_estimate IS NULL
        `,
      )
      .get(window.startDate, `${window.endDate}T23:59:59.999Z`) as CountRow;
    const trackedSpend = db
      .prepare(
        `
          SELECT COALESCE(SUM(amount), 0) AS amount
          FROM financial_entries
          WHERE entry_date >= ?
            AND entry_date <= ?
        `,
      )
      .get(window.startDate, window.endDate) as AmountRow;
    const reserveAmount = db
      .prepare(
        `
          SELECT COALESCE(SUM(amount), 0) AS amount
          FROM financial_entries
          WHERE entry_type = 'reserve'
            AND entry_date >= ?
            AND entry_date <= ?
        `,
      )
      .get(window.startDate, window.endDate) as AmountRow;
    const monthlyBurn = buildMonthlyWindows(6).map((entry) => {
      const amount = (db
        .prepare(
          `
            SELECT COALESCE(SUM(amount), 0) AS amount
            FROM financial_entries
            WHERE entry_date >= ?
              AND entry_date <= ?
          `,
        )
        .get(entry.startDate, entry.endDate) as AmountRow).amount ?? 0;

      return {
        amount: deps.formatCurrency(amount),
        amountValue: amount,
        month: entry.key,
      };
    });
    const totalBurnValue = monthlyBurn.reduce((sum, row) => sum + row.amountValue, 0);
    const burnRateAverageValue = monthlyBurn.length ? totalBurnValue / monthlyBurn.length : 0;
    const categoryBreakdownRows = db
      .prepare(
        `
          SELECT category, COALESCE(SUM(amount), 0) AS amount
          FROM financial_entries
          WHERE entry_date >= ?
            AND entry_date <= ?
          GROUP BY category
          ORDER BY amount DESC, category
        `,
      )
      .all(window.startDate, window.endDate) as Array<{ category: string; amount: number }>;
    const totalCategoryAmount = categoryBreakdownRows.reduce((sum, row) => sum + row.amount, 0);

    return {
      activePeriodLabel: window.label,
      metrics: [
        { label: "Incident exposure", value: deps.formatCurrency(incidentExposure.amount), tone: "critical" },
        { label: "Replacement at risk", value: deps.formatCurrency(replacementAtRisk.amount), tone: "warning" },
        { label: "Tracked spend", value: deps.formatCurrency(trackedSpend.amount), tone: "info" },
        { label: "Missing estimates", value: `${missingEstimates.count} incidents`, tone: "neutral" },
        { label: "Maintenance queue", value: `${maintenanceQueue.count} assets`, tone: "warning" },
      ],
      totals: {
        trackedSpend: deps.formatCurrency(trackedSpend.amount),
        trackedSpendValue: trackedSpend.amount ?? 0,
        reserve: deps.formatCurrency(reserveAmount.amount),
        reserveValue: reserveAmount.amount ?? 0,
        incidentExposure: deps.formatCurrency(incidentExposure.amount),
        incidentExposureValue: incidentExposure.amount ?? 0,
        burnRateAverage: deps.formatCurrency(burnRateAverageValue),
        burnRateAverageValue,
      },
      exposureByProject: this.getFinanceProjectExposure(window.startDate, window.endDate),
      costLinks: this.getFinanceCostLinks(),
      monthlyBurn,
      categoryBreakdown: categoryBreakdownRows.map((row) => ({
        amount: deps.formatCurrency(row.amount),
        amountValue: row.amount,
        category: row.category,
        percentage: totalCategoryAmount > 0 ? Number(((row.amount / totalCategoryAmount) * 100).toFixed(1)) : 0,
      })),
    };
  },

  getFinanceProjectExposure(startDate?: string, endDate?: string): ProjectExposureRow[] {
    const rows = db
      .prepare(
        `
          SELECT
            projects.name AS project,
            COALESCE((
              SELECT SUM(cost_estimate)
              FROM incidents
              WHERE incidents.project_id = projects.id
                AND (? IS NULL OR incidents.reported_at >= ?)
                AND (? IS NULL OR incidents.reported_at <= ?)
            ), 0) AS exposure,
            COALESCE((
              SELECT COUNT(*)
              FROM incidents
              WHERE incidents.project_id = projects.id
                AND (? IS NULL OR incidents.reported_at >= ?)
                AND (? IS NULL OR incidents.reported_at <= ?)
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
      .all(
        startDate ?? null,
        startDate ?? null,
        endDate ? `${endDate}T23:59:59.999Z` : null,
        endDate ? `${endDate}T23:59:59.999Z` : null,
        startDate ?? null,
        startDate ?? null,
        endDate ? `${endDate}T23:59:59.999Z` : null,
        endDate ? `${endDate}T23:59:59.999Z` : null,
      ) as Array<{
      project: string;
      exposure: number;
      incident_count: number;
      assets_out: number;
    }>;

    return rows.map((row) => ({
      project: row.project,
      exposure: deps.formatCurrency(row.exposure),
      exposureValue: row.exposure,
      incidentCount: row.incident_count,
      assetsOut: deps.formatCurrency(row.assets_out),
      assetsOutValue: row.assets_out,
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

  getFinanceEntryDocuments(entryId: string): FinancialDocumentRow[] {
    const rows = db
      .prepare(
        `
          SELECT
            id,
            file_type,
            original_name,
            mime_type,
            byte_size,
            status,
            uploaded_at,
            storage_path
          FROM financial_documents
          WHERE financial_entry_id = ?
            AND deleted_at IS NULL
          ORDER BY uploaded_at DESC
        `,
      )
      .all(entryId) as Array<{
      id: string;
      file_type: string | null;
      original_name: string | null;
      mime_type: string | null;
      byte_size: number | null;
      status: string | null;
      uploaded_at: string;
      storage_path: string | null;
    }>;

    return rows.map((row) => {
      const isMissing = row.status !== "deleted" && row.storage_path ? !fs.existsSync(row.storage_path) : row.status === "missing";
      const mimeType = row.mime_type?.trim() || "application/octet-stream";
      const status = (isMissing ? "missing" : row.status?.trim() || "available") as "available" | "missing" | "deleted";
      const canInlinePreview =
        status === "available" &&
        row.storage_path &&
        fs.existsSync(row.storage_path) &&
        (mimeType.startsWith("image/") || mimeType === "application/pdf") &&
        (row.byte_size ?? 0) <= maxInlinePreviewBytes;

      let previewDataUrl: string | null = null;

      if (canInlinePreview) {
        const storagePath = row.storage_path!;
        const encoded = fs.readFileSync(storagePath).toString("base64");
        previewDataUrl = `data:${mimeType};base64,${encoded}`;
      }

      return {
        id: row.id,
        fileType: row.file_type?.trim() || "file",
        originalName: row.original_name?.trim() || "Attached finance document",
        mimeType,
        byteSize: row.byte_size ?? 0,
        status,
        createdAt: row.uploaded_at,
        isPreviewable: mimeType.startsWith("image/") || mimeType === "application/pdf",
        previewDataUrl,
      };
    });
  },

  getBudgetVsActual(projectId: string) {
    const project = db
      .prepare(
        `
          SELECT id, name
          FROM projects
          WHERE id = ?
          LIMIT 1
        `,
      )
      .get(projectId) as { id: string; name: string } | undefined;

    if (!project) {
      return {
        project: null,
      };
    }

    const row = db
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

    const exposureRow = db
      .prepare(
        `
          SELECT COALESCE(SUM(cost_estimate), 0) AS amount
          FROM incidents
          WHERE project_id = ?
            AND status IN ('Open', 'In review')
        `,
      )
      .get(projectId) as AmountRow;

    return {
      project: {
        id: project.id,
        name: project.name,
      },
      hasExplicitBudget: false,
      budgetCap: null,
      actualSpend: deps.formatCurrency(row.committed_amount),
      actualSpendValue: row.committed_amount,
      totalEntries: deps.formatCurrency(row.total_entries),
      totalEntriesValue: row.total_entries,
      reserve: deps.formatCurrency(row.reserve_amount),
      reserveValue: row.reserve_amount,
      exposure: deps.formatCurrency(exposureRow.amount),
      exposureValue: exposureRow.amount ?? 0,
      varianceToBudget: null,
      summary:
        row.total_entries > 0
          ? "No explicit budget cap is configured yet, so BukowskiOS is comparing actual spend against current reserves and exposure only."
          : "This project still has no financial entries. Configure entries first before asking for budget versus actual.",
    };
  },

  getMonthlyBurnRate(input?: { projectId?: string | null; months?: number }) {
    const months = Math.max(1, Math.min(input?.months ?? 6, 12));
    const series = buildMonthlyWindows(months).map((entry) => {
      const amount = (db
        .prepare(
          `
            SELECT COALESCE(SUM(amount), 0) AS amount
            FROM financial_entries
            WHERE entry_date >= ?
              AND entry_date <= ?
              AND (? IS NULL OR project_id = ?)
          `,
        )
        .get(entry.startDate, entry.endDate, input?.projectId ?? null, input?.projectId ?? null) as AmountRow).amount ?? 0;

      return {
        month: entry.key,
        amount: deps.formatCurrency(amount),
        amountValue: amount,
      };
    });

    const average = series.length ? series.reduce((sum, row) => sum + row.amountValue, 0) / series.length : 0;

    return {
      months,
      average: deps.formatCurrency(average),
      averageValue: average,
      series,
    };
  },

  getExpenseBreakdown(input?: { projectId?: string | null; query?: FinanceOverviewQuery }) {
    const window = resolveFinanceOverviewWindow(input?.query);
    const rows = db
      .prepare(
        `
          SELECT category, COALESCE(SUM(amount), 0) AS amount
          FROM financial_entries
          WHERE entry_date >= ?
            AND entry_date <= ?
            AND (? IS NULL OR project_id = ?)
          GROUP BY category
          ORDER BY amount DESC, category
        `,
      )
      .all(window.startDate, window.endDate, input?.projectId ?? null, input?.projectId ?? null) as Array<{
      category: string;
      amount: number;
    }>;

    const total = rows.reduce((sum, row) => sum + row.amount, 0);

    return {
      periodLabel: window.label,
      total: deps.formatCurrency(total),
      totalValue: total,
      items: rows.map((row) => ({
        category: row.category,
        amount: deps.formatCurrency(row.amount),
        amountValue: row.amount,
        share: total > 0 ? Number(((row.amount / total) * 100).toFixed(1)) : 0,
      })),
    };
  },

  getFinancialHealth(input?: { projectId?: string | null; query?: FinanceOverviewQuery }) {
    if (input?.projectId) {
      const budget = this.getBudgetVsActual(input.projectId);
      const breakdown = this.getExpenseBreakdown({
        projectId: input.projectId,
        query: input.query,
      });
      const missingEstimates = (db
        .prepare(
          `
            SELECT COUNT(*) AS count
            FROM incidents
            WHERE project_id = ?
              AND status IN ('Open', 'In review')
              AND cost_estimate IS NULL
          `,
        )
        .get(input.projectId) as CountRow).count;

      return {
        scope: budget.project?.name ?? "Unknown project",
        trackedSpend: budget.totalEntries,
        reserve: budget.reserve,
        exposure: budget.exposure,
        missingEstimates,
        topCategory: breakdown.items[0] ?? null,
        summary: budget.project
          ? `Project ${budget.project.name} is carrying ${budget.exposure} in open exposure, ${budget.reserve} in reserves and ${budget.totalEntries} across tracked entries.`
          : "Project financial health is unavailable.",
      };
    }

    const overview = this.getFinanceOverview(input?.query);
    const missingEstimates = (db
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM incidents
          WHERE status IN ('Open', 'In review')
            AND cost_estimate IS NULL
        `,
      )
      .get() as CountRow).count;

    return {
      scope: "Workspace",
      trackedSpend: overview.totals.trackedSpend,
      reserve: overview.totals.reserve,
      exposure: overview.totals.incidentExposure,
      burnRateAverage: overview.totals.burnRateAverage,
      missingEstimates,
      topProject: overview.exposureByProject[0] ?? null,
      topCategory: overview.categoryBreakdown[0] ?? null,
      summary: `Workspace finance is carrying ${overview.totals.incidentExposure} in incident exposure, ${overview.totals.reserve} in reserves and ${overview.totals.trackedSpend} in tracked spend for ${overview.activePeriodLabel.toLowerCase()}.`,
    };
  },
});
