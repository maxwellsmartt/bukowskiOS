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
  type DgiiReport,
  type DgiiReportColumn,
  type DgiiReportQuery,
  type DgiiReportRow,
  type StatementSourceFormat,
  type FiscalStatus,
  type PaymentInstrumentKind,
  type PaymentInstrumentOwner,
  type ProjectAllocationRow,
  type ProjectPnlRow,
  type ReimbursementStatus,
  type ReviewQueueRow,
  type TransactionAnnotationView,
  type TransactionDirection,
  type TransactionKind,
  type TreasuryOverviewQuery,
  type TreasuryOverviewSnapshot,
  type TreasuryDeductibleLedger,
  type TreasuryDeductibleLedgerQuery,
  type TreasuryTransactionListQuery,
  type TreasuryUndoPreview,
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
const normalizeCurrency = (value: string | null | undefined, fallback = "DOP") =>
  (value?.trim().toUpperCase() || fallback).slice(0, 8);
const normalizeRuleText = (value: string | null | undefined) =>
  (value ?? "").trim().replace(/\s+/g, " ").toUpperCase();

const latestConversionRate = (
  db: DatabaseSync,
  workspaceId: string,
  fromCurrency: string,
  toCurrency: string,
): number | null => {
  const from = normalizeCurrency(fromCurrency);
  const to = normalizeCurrency(toCurrency);
  if (from === to) return 1;

  const direct = db
    .prepare(
      `SELECT rate
       FROM exchange_rates
       WHERE workspace_id = ? AND base_currency = ? AND quote_currency = ?
       ORDER BY effective_date DESC, created_at DESC
       LIMIT 1`,
    )
    .get(workspaceId, from, to) as { rate: number } | undefined;
  if (direct?.rate && Number(direct.rate) > 0) return Number(direct.rate);

  const inverse = db
    .prepare(
      `SELECT rate
       FROM exchange_rates
       WHERE workspace_id = ? AND base_currency = ? AND quote_currency = ?
       ORDER BY effective_date DESC, created_at DESC
       LIMIT 1`,
    )
    .get(workspaceId, to, from) as { rate: number } | undefined;
  if (inverse?.rate && Number(inverse.rate) > 0) return 1 / Number(inverse.rate);

  return null;
};

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
  owner: (row.owner as PaymentInstrumentOwner | null) ?? "company",
  ownerUserId: (row.owner_user_id as string | null) ?? null,
  ownerUserNameSnapshot: (row.owner_user_name_snapshot as string | null) ?? null,
  instrumentKind: (row.instrument_kind as PaymentInstrumentKind | null) ?? "bank_account",
  last4: (row.last4 as string | null) ?? null,
  issuer: (row.issuer as string | null) ?? null,
  statementCycleDay:
    row.statement_cycle_day === null || row.statement_cycle_day === undefined
      ? null
      : Number(row.statement_cycle_day),
  paymentDueDay:
    row.payment_due_day === null || row.payment_due_day === undefined
      ? null
      : Number(row.payment_due_day),
  reminderUserId: (row.reminder_user_id as string | null) ?? null,
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
    supplierNcf: (row.supplier_ncf as string | null) ?? null,
    dgiiExpenseType: (row.dgii_expense_type as string | null) ?? null,
    withholdingType: (row.withholding_type as string | null) ?? null,
    withholdingRate:
      row.withholding_rate === null || row.withholding_rate === undefined
        ? null
        : Number(row.withholding_rate),
    withholdingAmount:
      row.withholding_amount === null || row.withholding_amount === undefined
        ? null
        : Number(row.withholding_amount),
    fiscalPeriod: (row.fiscal_period as string | null) ?? null,
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
                  a.supplier_ncf, a.dgii_expense_type, a.withholding_type,
                  a.withholding_rate, a.withholding_amount, a.fiscal_period,
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
      const reportCurrency = query.reportCurrency ? normalizeCurrency(query.reportCurrency) : "";
      const shouldConvert = reportCurrency.length > 0;
      const conversionRateCache = new Map<string, number | null>();
      const convertAmount = (amount: number, currency: string) => {
        if (!shouldConvert) return { amount, missing: false };
        const sourceCurrency = normalizeCurrency(currency, reportCurrency);
        const cacheKey = `${sourceCurrency}:${reportCurrency}`;
        if (!conversionRateCache.has(cacheKey)) {
          conversionRateCache.set(cacheKey, latestConversionRate(db, ws, sourceCurrency, reportCurrency));
        }
        const rate = conversionRateCache.get(cacheKey);
        if (!rate) return { amount, missing: true };
        return { amount: amount * rate, missing: false };
      };

      const rows = (
        window.startDate && window.endDate
          ? db
              .prepare(
                `SELECT t.txn_date, t.amount, t.direction, acc.currency,
                        a.txn_kind, a.is_internal_transfer, a.deductible_amount,
                        a.expense_category, a.reimbursement_status, a.transaction_id AS a_transaction_id
                 FROM bank_transactions t
                 JOIN bank_accounts acc ON acc.id = t.bank_account_id
                 LEFT JOIN transaction_annotations a ON a.transaction_id = t.id
                 WHERE t.workspace_id = ? AND t.txn_date >= ? AND t.txn_date <= ?`,
              )
              .all(ws, window.startDate, window.endDate)
          : db
              .prepare(
                `SELECT t.txn_date, t.amount, t.direction, acc.currency,
                        a.txn_kind, a.is_internal_transfer, a.deductible_amount,
                        a.expense_category, a.reimbursement_status, a.transaction_id AS a_transaction_id
                 FROM bank_transactions t
                 JOIN bank_accounts acc ON acc.id = t.bank_account_id
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
      let conversionMissingCount = 0;
      const monthlyMap = new Map<string, { income: number; expense: number; deductible: number }>();
      const categoryMap = new Map<string, number>();

      for (const row of rows) {
        const rawAmount = Number(row.amount ?? 0);
        const converted = convertAmount(rawAmount, row.currency as string);
        const amount = converted.amount;
        const direction = row.direction as TransactionDirection;
        const annotation = row.a_transaction_id == null ? null : mapAnnotation(row);
        const excluded = isExcluded(annotation);
        const monthKey = String(row.txn_date).slice(0, 7);
        const bucket = monthlyMap.get(monthKey) ?? { income: 0, expense: 0, deductible: 0 };

        if (!annotation || !annotation.txnKind) unclassifiedCount += 1;
        if (annotation?.reimbursementStatus === "pending") pendingReviewCount += 1;
        if (converted.missing) conversionMissingCount += 1;

        if (excluded) {
          excludedTransferTotal += amount;
        } else if (direction === "credit") {
          totalIncome += amount;
          bucket.income += amount;
        } else {
          totalExpense += amount;
          bucket.expense += amount;
          // Convert the reviewed deductible the same way as the expense so it
          // stays consistent with the (possibly currency-converted) totals.
          const deductible =
            annotation?.deductibleAmount != null
              ? convertAmount(annotation.deductibleAmount, row.currency as string).amount
              : amount;
          totalDeductibleExpense += deductible;
          bucket.deductible += deductible;
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
          deductible: round2(value.deductible),
        }));

      const expenseTotalForPct = totalExpense || 1;
      const expenseByCategory = Array.from(categoryMap.entries())
        .sort(([, a], [, b]) => b - a)
        .map(([category, amount]) => ({
          category,
          amount: round2(amount),
          percentage: round2((amount / expenseTotalForPct) * 100),
        }));

      // Per-account closing-balance trend. One series per account, each kept in
      // its own currency (no conversion): balance = opening + cumulative signed
      // amount. We sum ALL movements (incl. transfers) up to each month end so
      // each account's real cash position is reflected.
      const trendRows = (
        window.endDate
          ? db
              .prepare(
                `SELECT bank_account_id, substr(txn_date, 1, 7) AS ym,
                        SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END) AS net
                 FROM bank_transactions
                 WHERE workspace_id = ? AND txn_date <= ?
                 GROUP BY bank_account_id, ym`,
              )
              .all(ws, window.endDate)
          : db
              .prepare(
                `SELECT bank_account_id, substr(txn_date, 1, 7) AS ym,
                        SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END) AS net
                 FROM bank_transactions
                 WHERE workspace_id = ?
                 GROUP BY bank_account_id, ym`,
              )
              .all(ws)
      ) as Array<{ bank_account_id: string; ym: string; net: number }>;

      const netByAccountMonth = new Map<string, Map<string, number>>();
      for (const trendRow of trendRows) {
        const perMonth = netByAccountMonth.get(trendRow.bank_account_id) ?? new Map<string, number>();
        perMonth.set(trendRow.ym, Number(trendRow.net ?? 0));
        netByAccountMonth.set(trendRow.bank_account_id, perMonth);
      }
      const startYm = window.startDate ? window.startDate.slice(0, 7) : null;
      const endYm = window.endDate ? window.endDate.slice(0, 7) : null;
      const monthsInWindow = Array.from(
        new Set(
          trendRows
            .filter((r) => (!startYm || r.ym >= startYm) && (!endYm || r.ym <= endYm))
            .map((r) => r.ym),
        ),
      ).sort();
      const balanceByAccount = new Map<string, number>();
      for (const account of accounts) {
        let baseline = account.openingBalance;
        const perMonth = netByAccountMonth.get(account.id);
        if (perMonth && startYm) {
          for (const [ym, net] of perMonth) if (ym < startYm) baseline += net;
        }
        balanceByAccount.set(account.id, baseline);
      }
      const balanceTrend = monthsInWindow.map((ym) => {
        for (const account of accounts) {
          const net = netByAccountMonth.get(account.id)?.get(ym) ?? 0;
          balanceByAccount.set(account.id, (balanceByAccount.get(account.id) ?? 0) + net);
        }
        const point: { month: string; [accountId: string]: number | string } = {
          month: format(new Date(`${ym}-01T00:00:00Z`), "MMM yyyy"),
        };
        for (const account of accounts) point[account.id] = round2(balanceByAccount.get(account.id) ?? 0);
        return point;
      });
      const balanceTrendAccounts = accounts.map((account) => ({
        accountId: account.id,
        label: account.accountLabel,
        currency: account.currency,
      }));

      return {
        activePeriodLabel: window.label,
        reportCurrency: shouldConvert ? reportCurrency : "mixed",
        conversionRate: shouldConvert ? conversionRateCache.get(`USD:${reportCurrency}`) ?? null : null,
        conversionMissingCount,
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
        balanceTrend,
        balanceTrendAccounts,
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

    /**
     * Distinct expense categories already used in the workspace (annotations +
     * invoice extractions). Feeds the creatable category select: pick an
     * existing one or type a new one (which then appears here next time).
     */
    listExpenseCategories(workspaceId: string): string[] {
      const ws = resolveWorkspaceId(workspaceId);
      const rows = db
        .prepare(
          `SELECT DISTINCT category FROM (
             SELECT expense_category AS category FROM transaction_annotations
               WHERE workspace_id = ? AND expense_category IS NOT NULL AND TRIM(expense_category) <> ''
             UNION
             SELECT expense_category AS category FROM invoice_extractions
               WHERE workspace_id = ? AND expense_category IS NOT NULL AND TRIM(expense_category) <> ''
           )
           ORDER BY category COLLATE NOCASE ASC`,
        )
        .all(ws, ws) as Array<{ category: string }>;
      return rows.map((row) => row.category);
    },

    getReviewQueue(workspaceId: string): ReviewQueueRow[] {
      const ws = resolveWorkspaceId(workspaceId);
      const rows = db
        .prepare(
          `SELECT t.id AS transaction_id, acc.account_label, t.txn_date, t.raw_description,
                  t.amount, t.currency,
                  a.concept, a.counterparty, a.reimbursement_status,
                  a.claimed_amount, a.deductible_amount,
                  a.supplier_ncf, a.dgii_expense_type, a.withholding_type,
                  a.withholding_rate, a.withholding_amount, a.fiscal_period,
                  a.fiscal_status
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
        supplierNcf: (row.supplier_ncf as string | null) ?? null,
        dgiiExpenseType: (row.dgii_expense_type as string | null) ?? null,
        withholdingType: (row.withholding_type as string | null) ?? null,
        withholdingRate:
          row.withholding_rate === null || row.withholding_rate === undefined
            ? null
            : Number(row.withholding_rate),
        withholdingAmount:
          row.withholding_amount === null || row.withholding_amount === undefined
            ? null
            : Number(row.withholding_amount),
        fiscalPeriod: (row.fiscal_period as string | null) ?? null,
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

    getUndoPreview(workspaceId: string): TreasuryUndoPreview {
      const ws = resolveWorkspaceId(workspaceId);
      const row = db
        .prepare(
          `SELECT id, kind, label, created_at
           FROM treasury_undo_journal
           WHERE workspace_id = ? AND undone = 0
           ORDER BY rowid DESC
           LIMIT 1`,
        )
        .get(ws) as
        | {
            id: string;
            kind: NonNullable<TreasuryUndoPreview>["kind"];
            label: string;
            created_at: string;
          }
        | undefined;
      if (!row) return null;
      return {
        id: row.id,
        kind: row.kind,
        label: row.label,
        createdAt: row.created_at,
      };
    },

    getDeductibleLedger(query: TreasuryDeductibleLedgerQuery): TreasuryDeductibleLedger {
      const ws = resolveWorkspaceId(query.workspaceId);
      const window = resolveWindow(query);
      const conditions: string[] = [
        "t.workspace_id = ?",
        "t.direction = 'debit'",
        "COALESCE(a.is_internal_transfer, 0) = 0",
        "(a.txn_kind IS NULL OR a.txn_kind NOT IN ('transfer', 'fx_exchange'))",
      ];
      const params: Array<string | number> = [ws];
      if (window.startDate) {
        conditions.push("t.txn_date >= ?");
        params.push(window.startDate);
      }
      if (window.endDate) {
        conditions.push("t.txn_date <= ?");
        params.push(window.endDate);
      }

      const rows = db
        .prepare(
          `SELECT t.id, t.txn_date, t.raw_description, t.reference, t.amount, t.currency,
                  acc.account_label,
                  a.concept, a.counterparty, a.counterparty_rnc, a.expense_category,
                  a.supplier_ncf, a.dgii_expense_type, a.withholding_type,
                  a.withholding_rate, a.withholding_amount, a.fiscal_period,
                  a.claimed_amount, a.deductible_amount, a.fiscal_status, a.support_doc_file_id
           FROM bank_transactions t
           JOIN bank_accounts acc ON acc.id = t.bank_account_id
           LEFT JOIN transaction_annotations a ON a.transaction_id = t.id
           WHERE ${conditions.join(" AND ")}
           ORDER BY t.txn_date ASC, t.created_at ASC`,
        )
        .all(...params) as Record<string, unknown>[];

      const ledgerRows = rows.map((row) => {
        const claimedAmount = round2(Number(row.claimed_amount ?? row.amount ?? 0));
        const fiscalStatus = (row.fiscal_status as FiscalStatus | null) ?? "pending";
        const deductibleAmount =
          row.deductible_amount === null || row.deductible_amount === undefined
            ? fiscalStatus === "rejected"
              ? 0
              : claimedAmount
            : round2(Number(row.deductible_amount));
        return {
          transactionId: row.id as string,
          txnDate: row.txn_date as string,
          accountLabel: row.account_label as string,
          currency: row.currency as string,
          rawDescription: (row.raw_description as string | null) ?? null,
          counterparty: (row.counterparty as string | null) ?? null,
          counterpartyRnc: (row.counterparty_rnc as string | null) ?? null,
          concept: (row.concept as string | null) ?? null,
          expenseCategory: (row.expense_category as string | null) ?? null,
          supplierNcf: (row.supplier_ncf as string | null) ?? null,
          dgiiExpenseType: (row.dgii_expense_type as string | null) ?? null,
          withholdingType: (row.withholding_type as string | null) ?? null,
          withholdingRate:
            row.withholding_rate === null || row.withholding_rate === undefined
              ? null
              : Number(row.withholding_rate),
          withholdingAmount:
            row.withholding_amount === null || row.withholding_amount === undefined
              ? null
              : Number(row.withholding_amount),
          fiscalPeriod: (row.fiscal_period as string | null) ?? null,
          claimedAmount,
          deductibleAmount,
          rejectedAmount: round2(Math.max(claimedAmount - deductibleAmount, 0)),
          fiscalStatus,
          supportDocFileId: (row.support_doc_file_id as string | null) ?? null,
          reference: (row.reference as string | null) ?? null,
        };
      });

      const totals = new Map<string, { claimedAmount: number; deductibleAmount: number; rejectedAmount: number }>();
      for (const row of ledgerRows) {
        const bucket = totals.get(row.currency) ?? { claimedAmount: 0, deductibleAmount: 0, rejectedAmount: 0 };
        bucket.claimedAmount = round2(bucket.claimedAmount + row.claimedAmount);
        bucket.deductibleAmount = round2(bucket.deductibleAmount + row.deductibleAmount);
        bucket.rejectedAmount = round2(bucket.rejectedAmount + row.rejectedAmount);
        totals.set(row.currency, bucket);
      }

      return {
        query: { ...query, workspaceId: ws },
        activePeriodLabel: window.label,
        rows: ledgerRows,
        totalsByCurrency: Array.from(totals.entries()).map(([currency, totalsForCurrency]) => ({
          currency,
          ...totalsForCurrency,
        })),
      };
    },

    // DGII fiscal reports: 606 (compras) reuses the deductible ledger; 607
    // (ventas) and 608 (anulados) read from issued invoices.
    getDgiiReport(query: DgiiReportQuery): DgiiReport {
      const ws = resolveWorkspaceId(query.workspaceId);
      const window = resolveWindow(query);
      const fmt = (value: number, currency: string) =>
        `${round2(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

      if (query.report === "606") {
        const ledger = this.getDeductibleLedger({
          workspaceId: ws,
          period: query.period,
          customStartDate: query.customStartDate ?? null,
          customEndDate: query.customEndDate ?? null,
        });
        const columns: DgiiReportColumn[] = [
          { key: "rnc", label: "RNC / Cédula" },
          { key: "ncf", label: "NCF" },
          { key: "dgiiType", label: "Tipo bienes/servicios" },
          { key: "date", label: "Fecha comprobante" },
          { key: "supplier", label: "Proveedor" },
          { key: "claimed", label: "Monto facturado", numeric: true },
          { key: "deductible", label: "Monto deducible", numeric: true },
          { key: "withholdingType", label: "Tipo retención" },
          { key: "withholdingAmount", label: "Monto retenido", numeric: true },
          { key: "currency", label: "Moneda" },
        ];
        const rows: DgiiReportRow[] = ledger.rows.map((row) => ({
          rnc: row.counterpartyRnc,
          ncf: row.supplierNcf,
          dgiiType: row.dgiiExpenseType,
          date: row.txnDate,
          supplier: row.counterparty ?? row.concept,
          claimed: row.claimedAmount,
          deductible: row.deductibleAmount,
          withholdingType: row.withholdingType,
          withholdingAmount: row.withholdingAmount,
          currency: row.currency,
        }));
        return {
          kind: "606",
          title: "DGII 606 · Compras",
          activePeriodLabel: window.label,
          columns,
          rows,
          totals: ledger.totalsByCurrency.map((total) => ({
            label: total.currency,
            value: `deducible ${fmt(total.deductibleAmount, total.currency)} · facturado ${fmt(total.claimedAmount, total.currency)}`,
          })),
          rowCount: rows.length,
        };
      }

      const conditions: string[] = ["workspace_id = ?"];
      const params: Array<string | number> = [ws];
      if (query.report === "608") {
        conditions.push("voided_at IS NOT NULL");
        if (window.startDate) {
          conditions.push("substr(voided_at, 1, 10) >= ?");
          params.push(window.startDate);
        }
        if (window.endDate) {
          conditions.push("substr(voided_at, 1, 10) <= ?");
          params.push(window.endDate);
        }
      } else {
        conditions.push("voided_at IS NULL");
        conditions.push("status <> 'draft'");
        conditions.push("ncf IS NOT NULL");
        if (window.startDate) {
          conditions.push("issue_date >= ?");
          params.push(window.startDate);
        }
        if (window.endDate) {
          conditions.push("issue_date <= ?");
          params.push(window.endDate);
        }
      }
      const invoiceRows = db
        .prepare(
          `SELECT ncf, issue_date, voided_at, client_name_snapshot, client_rnc_snapshot,
                  subtotal_amount, tax_amount, total_amount, currency, status
           FROM invoices
           WHERE ${conditions.join(" AND ")}
           ORDER BY ${query.report === "608" ? "voided_at" : "issue_date"} ASC`,
        )
        .all(...params) as Record<string, unknown>[];

      if (query.report === "607") {
        const columns: DgiiReportColumn[] = [
          { key: "rnc", label: "RNC cliente" },
          { key: "ncf", label: "NCF" },
          { key: "date", label: "Fecha comprobante" },
          { key: "client", label: "Cliente" },
          { key: "subtotal", label: "Monto facturado", numeric: true },
          { key: "itbis", label: "ITBIS facturado", numeric: true },
          { key: "total", label: "Total", numeric: true },
          { key: "currency", label: "Moneda" },
        ];
        const rows: DgiiReportRow[] = invoiceRows.map((row) => ({
          rnc: (row.client_rnc_snapshot as string | null) ?? null,
          ncf: (row.ncf as string | null) ?? null,
          date: row.issue_date as string,
          client: row.client_name_snapshot as string,
          subtotal: round2(Number(row.subtotal_amount ?? 0)),
          itbis: round2(Number(row.tax_amount ?? 0)),
          total: round2(Number(row.total_amount ?? 0)),
          currency: row.currency as string,
        }));
        const byCurrency = new Map<string, { itbis: number; total: number }>();
        for (const row of rows) {
          const currency = String(row.currency);
          const bucket = byCurrency.get(currency) ?? { itbis: 0, total: 0 };
          bucket.itbis = round2(bucket.itbis + Number(row.itbis ?? 0));
          bucket.total = round2(bucket.total + Number(row.total ?? 0));
          byCurrency.set(currency, bucket);
        }
        return {
          kind: "607",
          title: "DGII 607 · Ventas",
          activePeriodLabel: window.label,
          columns,
          rows,
          totals: Array.from(byCurrency.entries()).map(([currency, bucket]) => ({
            label: currency,
            value: `total ${fmt(bucket.total, currency)} · ITBIS ${fmt(bucket.itbis, currency)}`,
          })),
          rowCount: rows.length,
        };
      }

      const columns: DgiiReportColumn[] = [
        { key: "ncf", label: "NCF anulado" },
        { key: "voidedAt", label: "Fecha anulación" },
        { key: "issueDate", label: "Fecha emisión" },
        { key: "client", label: "Cliente" },
        { key: "total", label: "Monto", numeric: true },
        { key: "currency", label: "Moneda" },
      ];
      const rows: DgiiReportRow[] = invoiceRows.map((row) => ({
        ncf: (row.ncf as string | null) ?? null,
        voidedAt: ((row.voided_at as string | null) ?? "").slice(0, 10),
        issueDate: row.issue_date as string,
        client: row.client_name_snapshot as string,
        total: round2(Number(row.total_amount ?? 0)),
        currency: row.currency as string,
      }));
      return {
        kind: "608",
        title: "DGII 608 · Anulados",
        activePeriodLabel: window.label,
        columns,
        rows,
        totals: [{ label: "Anulados", value: String(rows.length) }],
        rowCount: rows.length,
      };
    },
  };
};

export type TreasuryReadService = ReturnType<typeof createTreasuryReadService>;
