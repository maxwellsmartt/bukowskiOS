import type { DatabaseSync } from "node:sqlite";

import {
  DEFAULT_WORKSPACE_ID,
  type BankAccountRow,
  type BankAccountType,
  type BankName,
  type BankStatementImportRow,
  type BankTransactionRow,
  type CounterpartyRulePreview,
  type CounterpartyRulePreviewQuery,
  type StatementSourceFormat,
  type FiscalStatus,
  type ProjectAllocationRow,
  type ProjectPnlRow,
  type ReimbursementStatus,
  type ReviewQueueRow,
  type TransactionAnnotationView,
  type TransactionDirection,
  type TransactionKind,
  type TreasuryOverviewQuery,
  type TreasuryOverviewSnapshot,
  type TreasuryTransactionListQuery,
} from "@contracts";
import {
  endOfMonth,
  endOfQuarter,
  endOfYear,
  format,
  startOfMonth,
  startOfQuarter,
  startOfYear,
} from "date-fns";

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const toIsoDate = (value: Date) => value.toISOString().slice(0, 10);
const resolveWorkspaceId = (workspaceId?: string | null) =>
  workspaceId?.trim() || DEFAULT_WORKSPACE_ID;
const normalizeRuleText = (value: string | null | undefined) =>
  (value ?? "").trim().replace(/\s+/g, " ").toUpperCase();

const resolveWindow = (query?: TreasuryOverviewQuery) => {
  const now = new Date();
  if (query?.period === "custom" && query.customStartDate && query.customEndDate) {
    return {
      startDate: query.customStartDate,
      endDate: query.customEndDate,
      label: `${query.customStartDate} → ${query.customEndDate}`,
    };
  }
  if (query?.period === "all") {
    return {
      startDate: null,
      endDate: null,
      label: "All time",
    };
  }
  if (query?.period === "fiscal" || !query?.period) {
    const fiscalStartYear = now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1;
    const fiscalStart = new Date(fiscalStartYear, 9, 1);
    const fiscalEnd = new Date(fiscalStartYear + 1, 8, 30);
    return {
      startDate: toIsoDate(fiscalStart),
      endDate: toIsoDate(fiscalEnd),
      label: `FY ${fiscalStartYear}-${fiscalStartYear + 1}`,
    };
  }
  if (query?.period === "quarter") {
    return {
      startDate: toIsoDate(startOfQuarter(now)),
      endDate: toIsoDate(endOfQuarter(now)),
      label: "This quarter",
    };
  }
  if (query?.period === "month") {
    return {
      startDate: toIsoDate(startOfMonth(now)),
      endDate: toIsoDate(endOfMonth(now)),
      label: "This month",
    };
  }
  return {
    startDate: toIsoDate(startOfYear(now)),
    endDate: toIsoDate(endOfYear(now)),
    label: "This year",
  };
};

const mapAccount = (row: Record<string, unknown>): BankAccountRow => ({
  id: row.id as string,
  workspaceId: row.workspace_id as string,
  bankName: row.bank_name as BankName,
  accountLabel: row.account_label as string,
  accountNumberMasked: (row.account_number_masked as string | null) ?? null,
  accountNumberFull: (row.account_number_full as string | null) ?? null,
  currency: row.currency as string,
  accountType: (row.account_type as BankAccountType | null) ?? null,
  openingBalance: Number(row.opening_balance ?? 0),
  openingBalanceDate: (row.opening_balance_date as string | null) ?? null,
  isActive: Number(row.is_active ?? 1) === 1,
  notes: (row.notes as string | null) ?? null,
  currentBalance:
    row.current_balance === null || row.current_balance === undefined
      ? null
      : Number(row.current_balance),
  transactionCount: Number(row.transaction_count ?? 0),
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
});

const mapAnnotation = (row: Record<string, unknown>): TransactionAnnotationView | null => {
  if (row.a_transaction_id == null) return null;
  return {
    txnKind: (row.txn_kind as TransactionKind | null) ?? null,
    concept: (row.concept as string | null) ?? null,
    counterparty: (row.counterparty as string | null) ?? null,
    counterpartyRnc: (row.counterparty_rnc as string | null) ?? null,
    expenseCategory: (row.expense_category as string | null) ?? null,
    isInternalTransfer: Number(row.is_internal_transfer ?? 0) === 1,
    reimbursementStatus: (row.reimbursement_status as ReimbursementStatus) ?? "n/a",
    claimedAmount:
      row.claimed_amount === null || row.claimed_amount === undefined
        ? null
        : Number(row.claimed_amount),
    deductibleAmount:
      row.deductible_amount === null || row.deductible_amount === undefined
        ? null
        : Number(row.deductible_amount),
    fiscalStatus: (row.fiscal_status as FiscalStatus) ?? "pending",
    reviewedByUserId: (row.reviewed_by_user_id as string | null) ?? null,
    reviewedAt: (row.reviewed_at as string | null) ?? null,
    supportDocFileId: (row.support_doc_file_id as string | null) ?? null,
    notes: (row.annotation_notes as string | null) ?? null,
  };
};

const isExcluded = (annotation: TransactionAnnotationView | null) => {
  if (!annotation) return false;
  return (
    annotation.isInternalTransfer ||
    annotation.txnKind === "transfer" ||
    annotation.txnKind === "fx_exchange"
  );
};

export const createTreasuryReadService = (db: DatabaseSync) => {
  const loadAllocations = (transactionIds: string[]): Map<string, ProjectAllocationRow[]> => {
    const byTxn = new Map<string, ProjectAllocationRow[]>();
    if (transactionIds.length === 0) return byTxn;
    const placeholders = transactionIds.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT id, transaction_id, project_id, project_name_snapshot, amount, percent, notes
         FROM transaction_project_allocations
         WHERE transaction_id IN (${placeholders})
         ORDER BY created_at ASC`,
      )
      .all(...transactionIds) as Record<string, unknown>[];
    for (const row of rows) {
      const txnId = row.transaction_id as string;
      const list = byTxn.get(txnId) ?? [];
      list.push({
        id: row.id as string,
        transactionId: txnId,
        projectId: (row.project_id as string | null) ?? null,
        projectNameSnapshot: (row.project_name_snapshot as string | null) ?? null,
        amount: Number(row.amount ?? 0),
        percent:
          row.percent === null || row.percent === undefined ? null : Number(row.percent),
        notes: (row.notes as string | null) ?? null,
      });
      byTxn.set(txnId, list);
    }
    return byTxn;
  };

  return {
    getAccounts(workspaceId: string): BankAccountRow[] {
      const ws = resolveWorkspaceId(workspaceId);
      const rows = db
        .prepare(
          `SELECT acc.*,
                  COALESCE(
                    (SELECT t.running_balance FROM bank_transactions t
                      WHERE t.bank_account_id = acc.id AND t.running_balance IS NOT NULL
                      ORDER BY t.txn_date DESC, t.created_at DESC LIMIT 1),
                    acc.opening_balance + COALESCE((
                      SELECT SUM(CASE WHEN t.direction = 'credit' THEN t.amount ELSE -t.amount END)
                      FROM bank_transactions t
                      WHERE t.bank_account_id = acc.id
                    ), 0)
                  ) AS current_balance,
                  (SELECT COUNT(*) FROM bank_transactions t2
                    WHERE t2.bank_account_id = acc.id) AS transaction_count
           FROM bank_accounts acc
           WHERE acc.workspace_id = ?
           ORDER BY acc.is_active DESC, acc.account_label ASC`,
        )
        .all(ws) as Record<string, unknown>[];
      return rows.map(mapAccount);
    },

    listTransactions(query: TreasuryTransactionListQuery): BankTransactionRow[] {
      const ws = resolveWorkspaceId(query.workspaceId);
      const conditions: string[] = ["t.workspace_id = ?"];
      const params: Array<string | number> = [ws];

      if (query.bankAccountId) {
        conditions.push("t.bank_account_id = ?");
        params.push(query.bankAccountId);
      }
      if (query.dateFrom) {
        conditions.push("t.txn_date >= ?");
        params.push(query.dateFrom);
      }
      if (query.dateTo) {
        conditions.push("t.txn_date <= ?");
        params.push(query.dateTo);
      }
      if (query.direction) {
        conditions.push("t.direction = ?");
        params.push(query.direction);
      }
      if (query.kind) {
        conditions.push("a.txn_kind = ?");
        params.push(query.kind);
      }
      if (query.unclassifiedOnly) {
        conditions.push("(a.transaction_id IS NULL OR a.txn_kind IS NULL)");
      }
      if (query.pendingReviewOnly) {
        conditions.push("a.reimbursement_status = 'pending'");
      }
      if (query.search) {
        conditions.push("(t.raw_description LIKE ? OR a.concept LIKE ? OR a.counterparty LIKE ?)");
        const like = `%${query.search.trim()}%`;
        params.push(like, like, like);
      }

      const limit = query.limit && query.limit > 0 ? Math.min(query.limit, 1000) : 200;
      const rows = db
        .prepare(
          `SELECT t.*, acc.account_label AS account_label,
                  a.transaction_id AS a_transaction_id, a.txn_kind, a.concept, a.counterparty,
                  a.counterparty_rnc, a.expense_category, a.is_internal_transfer,
                  a.reimbursement_status, a.claimed_amount, a.deductible_amount,
                  a.fiscal_status, a.reviewed_by_user_id, a.reviewed_at,
                  a.support_doc_file_id, a.notes AS annotation_notes
           FROM bank_transactions t
           JOIN bank_accounts acc ON acc.id = t.bank_account_id
           LEFT JOIN transaction_annotations a ON a.transaction_id = t.id
           WHERE ${conditions.join(" AND ")}
           ORDER BY t.txn_date DESC, t.created_at DESC
           LIMIT ${limit}`,
        )
        .all(...params) as Record<string, unknown>[];

      const ids = rows.map((row) => row.id as string);
      const allocationsByTxn = loadAllocations(ids);

      const mapped = rows.map((row): BankTransactionRow => {
        const annotation = mapAnnotation(row);
        const amount = Number(row.amount ?? 0);
        const direction = row.direction as TransactionDirection;
        const signedAmount = direction === "credit" ? amount : -amount;
        const allocations = allocationsByTxn.get(row.id as string) ?? [];
        const txn: BankTransactionRow = {
          id: row.id as string,
          workspaceId: row.workspace_id as string,
          bankAccountId: row.bank_account_id as string,
          bankAccountLabel: (row.account_label as string) ?? "",
          importId: (row.import_id as string | null) ?? null,
          txnDate: row.txn_date as string,
          valueDate: (row.value_date as string | null) ?? null,
          rawDescription: (row.raw_description as string | null) ?? null,
          reference: (row.reference as string | null) ?? null,
          serial: (row.serial as string | null) ?? null,
          amount,
          direction,
          signedAmount,
          runningBalance:
            row.running_balance === null || row.running_balance === undefined
              ? null
              : Number(row.running_balance),
          currency: row.currency as string,
          excludedFromTotals: isExcluded(annotation),
          annotation,
          allocations,
          createdAt: row.created_at as string,
        };
        return txn;
      });

      // Filter by project requires joining allocations — done in memory.
      if (query.projectId) {
        return mapped.filter((txn) =>
          txn.allocations.some((alloc) => alloc.projectId === query.projectId),
        );
      }
      return mapped;
    },

    previewClassificationRule(query: CounterpartyRulePreviewQuery): CounterpartyRulePreview {
      const ws = resolveWorkspaceId(query.workspaceId);
      const selected = db
        .prepare(
          `SELECT raw_description FROM bank_transactions WHERE id = ? AND workspace_id = ? LIMIT 1`,
        )
        .get(query.transactionId, ws) as { raw_description: string | null } | undefined;
      if (!selected) throw new Error("Transaction not found.");

      const matchPattern = (query.matchPattern?.trim() || selected.raw_description?.trim() || "").replace(/\s+/g, " ");
      if (!matchPattern) {
        return {
          transactionId: query.transactionId,
          matchPattern: "",
          matchType: query.matchType ?? "exact",
          matchCount: 0,
          sampleDescriptions: [],
        };
      }

      const matchType = query.matchType ?? "exact";
      const where =
        matchType === "contains"
          ? "UPPER(t.raw_description) LIKE ?"
          : "UPPER(TRIM(t.raw_description)) = ?";
      const param =
        matchType === "contains"
          ? `%${normalizeRuleText(matchPattern)}%`
          : normalizeRuleText(matchPattern);
      const rows = db
        .prepare(
          `SELECT t.raw_description
           FROM bank_transactions t
           LEFT JOIN transaction_annotations a ON a.transaction_id = t.id
           WHERE t.workspace_id = ?
             AND t.raw_description IS NOT NULL
             AND ${where}
             AND (a.transaction_id IS NULL OR a.txn_kind IS NULL)
           ORDER BY t.txn_date DESC, t.created_at DESC
           LIMIT 25`,
        )
        .all(ws, param) as Array<{ raw_description: string | null }>;
      const count = db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM bank_transactions t
           LEFT JOIN transaction_annotations a ON a.transaction_id = t.id
           WHERE t.workspace_id = ?
             AND t.raw_description IS NOT NULL
             AND ${where}
             AND (a.transaction_id IS NULL OR a.txn_kind IS NULL)`,
        )
        .get(ws, param) as { count: number };

      return {
        transactionId: query.transactionId,
        matchPattern,
        matchType,
        matchCount: Number(count.count ?? 0),
        sampleDescriptions: Array.from(new Set(rows.map((row) => row.raw_description || "").filter(Boolean))).slice(0, 5),
      };
    },

    getOverview(query: TreasuryOverviewQuery): TreasuryOverviewSnapshot {
      const ws = resolveWorkspaceId(query.workspaceId);
      const window = resolveWindow(query);
      const accounts = this.getAccounts(ws);

      const rows = (
        window.startDate && window.endDate
          ? db
              .prepare(
                `SELECT t.txn_date, t.amount, t.direction,
                        a.txn_kind, a.is_internal_transfer, a.deductible_amount,
                        a.expense_category, a.reimbursement_status, a.transaction_id AS a_transaction_id
                 FROM bank_transactions t
                 LEFT JOIN transaction_annotations a ON a.transaction_id = t.id
                 WHERE t.workspace_id = ? AND t.txn_date >= ? AND t.txn_date <= ?`,
              )
              .all(ws, window.startDate, window.endDate)
          : db
              .prepare(
                `SELECT t.txn_date, t.amount, t.direction,
                        a.txn_kind, a.is_internal_transfer, a.deductible_amount,
                        a.expense_category, a.reimbursement_status, a.transaction_id AS a_transaction_id
                 FROM bank_transactions t
                 LEFT JOIN transaction_annotations a ON a.transaction_id = t.id
                 WHERE t.workspace_id = ?`,
              )
              .all(ws)
      ) as Record<string, unknown>[];

      let totalIncome = 0;
      let totalExpense = 0;
      let totalDeductibleExpense = 0;
      let excludedTransferTotal = 0;
      let unclassifiedCount = 0;
      let pendingReviewCount = 0;
      const monthlyMap = new Map<string, { income: number; expense: number }>();
      const categoryMap = new Map<string, number>();

      for (const row of rows) {
        const amount = Number(row.amount ?? 0);
        const direction = row.direction as TransactionDirection;
        const annotation = row.a_transaction_id == null ? null : mapAnnotation(row);
        const excluded = isExcluded(annotation);
        const monthKey = String(row.txn_date).slice(0, 7);
        const bucket = monthlyMap.get(monthKey) ?? { income: 0, expense: 0 };

        if (!annotation || !annotation.txnKind) unclassifiedCount += 1;
        if (annotation?.reimbursementStatus === "pending") pendingReviewCount += 1;

        if (excluded) {
          excludedTransferTotal += amount;
        } else if (direction === "credit") {
          totalIncome += amount;
          bucket.income += amount;
        } else {
          totalExpense += amount;
          bucket.expense += amount;
          const deductible =
            annotation?.deductibleAmount != null ? annotation.deductibleAmount : amount;
          totalDeductibleExpense += deductible;
          const category =
            annotation?.expenseCategory || annotation?.txnKind || "uncategorized";
          categoryMap.set(category, (categoryMap.get(category) ?? 0) + amount);
        }
        monthlyMap.set(monthKey, bucket);
      }

      const monthly = Array.from(monthlyMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, value]) => ({
          month: format(new Date(`${month}-01T00:00:00Z`), "MMM yyyy"),
          income: round2(value.income),
          expense: round2(value.expense),
          net: round2(value.income - value.expense),
        }));

      const expenseTotalForPct = totalExpense || 1;
      const expenseByCategory = Array.from(categoryMap.entries())
        .sort(([, a], [, b]) => b - a)
        .map(([category, amount]) => ({
          category,
          amount: round2(amount),
          percentage: round2((amount / expenseTotalForPct) * 100),
        }));

      return {
        activePeriodLabel: window.label,
        totalIncome: round2(totalIncome),
        totalExpense: round2(totalExpense),
        net: round2(totalIncome - totalExpense),
        totalDeductibleExpense: round2(totalDeductibleExpense),
        excludedTransferTotal: round2(excludedTransferTotal),
        unclassifiedCount,
        pendingReviewCount,
        accounts,
        monthly,
        expenseByCategory,
      };
    },

    listImports(workspaceId: string, bankAccountId?: string): BankStatementImportRow[] {
      const ws = resolveWorkspaceId(workspaceId);
      const conditions: string[] = ["workspace_id = ?"];
      const params: Array<string | number> = [ws];
      if (bankAccountId) {
        conditions.push("bank_account_id = ?");
        params.push(bankAccountId);
      }
      const rows = db
        .prepare(
          `SELECT * FROM bank_statement_imports
           WHERE ${conditions.join(" AND ")}
           ORDER BY created_at DESC
           LIMIT 200`,
        )
        .all(...params) as Record<string, unknown>[];
      return rows.map((row) => ({
        id: row.id as string,
        workspaceId: row.workspace_id as string,
        bankAccountId: row.bank_account_id as string,
        sourceFormat: row.source_format as StatementSourceFormat,
        originalFilename: (row.original_filename as string | null) ?? null,
        periodStart: (row.period_start as string | null) ?? null,
        periodEnd: (row.period_end as string | null) ?? null,
        rowCount: Number(row.row_count ?? 0),
        insertedCount: Number(row.inserted_count ?? 0),
        duplicateCount: Number(row.duplicate_count ?? 0),
        importedByUserId: (row.imported_by_user_id as string | null) ?? null,
        notes: (row.notes as string | null) ?? null,
        createdAt: row.created_at as string,
      }));
    },

    getReviewQueue(workspaceId: string): ReviewQueueRow[] {
      const ws = resolveWorkspaceId(workspaceId);
      const rows = db
        .prepare(
          `SELECT t.id AS transaction_id, acc.account_label, t.txn_date, t.raw_description,
                  t.amount, t.currency,
                  a.concept, a.counterparty, a.reimbursement_status,
                  a.claimed_amount, a.deductible_amount, a.fiscal_status
           FROM bank_transactions t
           JOIN bank_accounts acc ON acc.id = t.bank_account_id
           JOIN transaction_annotations a ON a.transaction_id = t.id
           WHERE t.workspace_id = ?
             AND (a.reimbursement_status IN ('pending', 'partial') OR a.fiscal_status = 'pending')
             AND a.txn_kind IN ('reimbursement', 'expense')
           ORDER BY t.txn_date DESC, t.created_at DESC
           LIMIT 500`,
        )
        .all(ws) as Record<string, unknown>[];
      return rows.map((row) => ({
        transactionId: row.transaction_id as string,
        bankAccountLabel: row.account_label as string,
        txnDate: row.txn_date as string,
        rawDescription: (row.raw_description as string | null) ?? null,
        concept: (row.concept as string | null) ?? null,
        counterparty: (row.counterparty as string | null) ?? null,
        amount: Number(row.amount ?? 0),
        currency: row.currency as string,
        reimbursementStatus: (row.reimbursement_status as ReimbursementStatus) ?? "n/a",
        claimedAmount:
          row.claimed_amount === null || row.claimed_amount === undefined
            ? null
            : Number(row.claimed_amount),
        deductibleAmount:
          row.deductible_amount === null || row.deductible_amount === undefined
            ? null
            : Number(row.deductible_amount),
        fiscalStatus: (row.fiscal_status as FiscalStatus) ?? "pending",
      }));
    },

    getProjectPnl(workspaceId: string, dateFrom?: string, dateTo?: string): ProjectPnlRow[] {
      const ws = resolveWorkspaceId(workspaceId);
      const conditions: string[] = ["al.workspace_id = ?"];
      const params: Array<string | number> = [ws];
      if (dateFrom) {
        conditions.push("t.txn_date >= ?");
        params.push(dateFrom);
      }
      if (dateTo) {
        conditions.push("t.txn_date <= ?");
        params.push(dateTo);
      }
      const rows = db
        .prepare(
          `SELECT al.project_id, al.project_name_snapshot, al.amount AS alloc_amount,
                  t.direction,
                  a.txn_kind, a.is_internal_transfer
           FROM transaction_project_allocations al
           JOIN bank_transactions t ON t.id = al.transaction_id
           LEFT JOIN transaction_annotations a ON a.transaction_id = t.id
           WHERE ${conditions.join(" AND ")}`,
        )
        .all(...params) as Record<string, unknown>[];

      const byProject = new Map<string, { name: string; income: number; expense: number }>();
      for (const row of rows) {
        const kind = row.txn_kind as TransactionKind | null;
        const internal = Number(row.is_internal_transfer ?? 0) === 1;
        if (internal || kind === "transfer" || kind === "fx_exchange") continue;
        const projectId = (row.project_id as string | null) ?? "__unassigned__";
        const name = (row.project_name_snapshot as string | null) ?? "Unassigned";
        const amount = Number(row.alloc_amount ?? 0);
        const entry = byProject.get(projectId) ?? { name, income: 0, expense: 0 };
        if ((row.direction as TransactionDirection) === "credit") entry.income += amount;
        else entry.expense += amount;
        byProject.set(projectId, entry);
      }

      return Array.from(byProject.entries()).map(([projectId, entry]) => {
        const net = entry.income - entry.expense;
        return {
          projectId: projectId === "__unassigned__" ? null : projectId,
          projectName: entry.name,
          income: round2(entry.income),
          expense: round2(entry.expense),
          net: round2(net),
          marginPercent: entry.income > 0 ? round2((net / entry.income) * 100) : null,
        };
      });
    },
  };
};

export type TreasuryReadService = ReturnType<typeof createTreasuryReadService>;
