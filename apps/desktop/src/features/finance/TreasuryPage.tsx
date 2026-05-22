import { Landmark, Plus, Trash2, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type {
  BankAccountRow,
  BankName,
  BankTransactionRow,
  ReviewQueueRow,
  TransactionKind,
  TreasuryPeriodPreset,
} from "@contracts";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { DataTable } from "@shared/components/DataTable";
import { GuidedEmptyState } from "@shared/components/GuidedEmptyState";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { TableSkeleton } from "@shared/components/TableSkeleton";
import { useLocale } from "@shared/hooks/useLocale";

import { formatCurrency, newCommandId } from "./quoteHelpers";
import { parseStatementFile } from "./treasury/bankStatementParsers";
import {
  useBankAccounts,
  useReviewQueue,
  useProjectPnl,
  useTreasuryImports,
  useTreasuryMutations,
  useTreasuryOverview,
  useTreasuryTransactions,
} from "./useTreasuryData";

type Tab = "overview" | "movements" | "review" | "projects";

const transactionKinds: TransactionKind[] = [
  "income",
  "expense",
  "transfer",
  "fx_exchange",
  "salary",
  "reimbursement",
  "tax",
  "tss",
  "bank_fee",
  "interest",
  "owner_draw",
  "other",
];

const bankNames: BankName[] = ["popular", "santa_cruz", "custom"];

const periods: TreasuryPeriodPreset[] = ["month", "quarter", "year"];

export const TreasuryPage = () => {
  const { t } = useTranslation();
  const { language } = useLocale();
  const { activeWorkspaceId } = useWorkspace();
  const mutations = useTreasuryMutations();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [tab, setTab] = useState<Tab>("overview");
  const [period, setPeriod] = useState<TreasuryPeriodPreset>("year");
  const [accountFilter, setAccountFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [unclassifiedOnly, setUnclassifiedOnly] = useState(false);
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [importBankName, setImportBankName] = useState<BankName>("popular");
  const [importAccountId, setImportAccountId] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const accounts = useBankAccounts(activeWorkspaceId);
  const overview = useTreasuryOverview(
    useMemo(() => ({ workspaceId: activeWorkspaceId, period }), [activeWorkspaceId, period]),
  );
  const transactions = useTreasuryTransactions(
    useMemo(
      () => ({
        workspaceId: activeWorkspaceId,
        bankAccountId: accountFilter || undefined,
        search: search.trim() || undefined,
        unclassifiedOnly: unclassifiedOnly || undefined,
        limit: 500,
      }),
      [activeWorkspaceId, accountFilter, search, unclassifiedOnly],
    ),
  );
  const reviewQueue = useReviewQueue(activeWorkspaceId);
  const projectPnl = useProjectPnl(activeWorkspaceId);
  const imports = useTreasuryImports(activeWorkspaceId, accountFilter || undefined);

  const kindLabel = (kind: TransactionKind | null | undefined) =>
    kind ? t(`finance.treasury.kinds.${kind}`, { defaultValue: kind }) : "—";

  const refreshAll = () => {
    accounts.refresh();
    overview.refresh();
    transactions.refresh();
    reviewQueue.refresh();
    imports.refresh();
  };

  const openAccount = (accountId: string) => {
    setAccountFilter(accountId);
    setTab("movements");
  };

  const removeImport = async (importId: string) => {
    if (!window.confirm(t("finance.treasury.imports.confirmDelete"))) return;
    try {
      await mutations.deleteImport({
        commandId: newCommandId("treasury-del-import"),
        workspaceId: activeWorkspaceId,
        actorType: "user",
        sourceChannel: "desktop",
        importId,
      });
      toast.success(t("finance.treasury.imports.deleted"));
      refreshAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("finance.treasury.imports.deleteFailed"));
    }
  };

  /* --------------------------- Import handlers --------------------------- */

  const triggerImport = (accountId: string, bankName: BankName) => {
    setImportAccountId(accountId);
    setImportBankName(bankName);
    fileInputRef.current?.click();
  };

  const handleFile = async (file: File | undefined) => {
    if (!file || !importAccountId) return;
    setBusy(true);
    try {
      const parsed = await parseStatementFile(file, importBankName);
      if (parsed.rows.length === 0) {
        toast.error(t("finance.treasury.import.noRows"));
        return;
      }
      // Guard against importing a statement into the wrong account: warn when
      // the file's detected currency or account number doesn't match the
      // target account (e.g. a Santa Cruz USD statement into the DOP account).
      const target = accounts.data.find((a) => a.id === importAccountId);
      if (target) {
        const currencyMismatch = parsed.currencyHint && parsed.currencyHint !== target.currency;
        const numberMismatch =
          parsed.accountNumber &&
          target.accountNumberFull &&
          !target.accountNumberFull.includes(parsed.accountNumber) &&
          !parsed.accountNumber.includes(target.accountNumberFull);
        if (currencyMismatch || numberMismatch) {
          const proceed = window.confirm(
            t("finance.treasury.import.mismatch", {
              fileCurrency: parsed.currencyHint ?? "?",
              fileAccount: parsed.accountNumber ?? "?",
              accountLabel: target.accountLabel,
              accountCurrency: target.currency,
            }),
          );
          if (!proceed) return;
        }
      }
      const result = await mutations.importStatement({
        commandId: newCommandId("treasury-import"),
        workspaceId: activeWorkspaceId,
        actorType: "user",
        sourceChannel: "desktop",
        bankAccountId: importAccountId,
        sourceFormat: parsed.bankName === "santa_cruz" ? "xlsx" : "csv",
        originalFilename: file.name,
        periodStart: parsed.periodStart,
        periodEnd: parsed.periodEnd,
        rows: parsed.rows,
      });
      toast.success(result.summary);
      refreshAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("finance.treasury.import.failed"));
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  /* --------------------------- Classify handler -------------------------- */

  const classify = async (transactionId: string, kind: TransactionKind) => {
    try {
      await mutations.annotate({
        commandId: newCommandId("treasury-classify"),
        workspaceId: activeWorkspaceId,
        actorType: "user",
        sourceChannel: "desktop",
        transactionId,
        txnKind: kind,
        isInternalTransfer: kind === "transfer" || kind === "fx_exchange",
      });
      transactions.refresh();
      overview.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("finance.treasury.classify.failed"));
    }
  };

  /* --------------------------- Review handler ---------------------------- */

  const applyReview = async (row: ReviewQueueRow, deductible: number) => {
    try {
      await mutations.reviewReimbursement({
        commandId: newCommandId("treasury-review"),
        workspaceId: activeWorkspaceId,
        actorType: "user",
        sourceChannel: "desktop",
        transactionId: row.transactionId,
        reimbursementStatus: deductible >= row.amount ? "accepted" : deductible > 0 ? "partial" : "rejected",
        deductibleAmount: deductible,
        fiscalStatus: deductible > 0 ? "accepted" : "rejected",
      });
      toast.success(t("finance.treasury.review.saved"));
      reviewQueue.refresh();
      overview.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("finance.treasury.review.failed"));
    }
  };

  const snap = overview.data;

  const movementColumns = useMemo(
    () => [
      { key: "date", label: t("finance.treasury.columns.date"), render: (row: BankTransactionRow) => row.txnDate },
      {
        key: "account",
        label: t("finance.treasury.columns.account"),
        render: (row: BankTransactionRow) => row.bankAccountLabel,
      },
      {
        key: "description",
        label: t("finance.treasury.columns.description"),
        render: (row: BankTransactionRow) => (
          <div className="cell-stack">
            <span>{row.annotation?.concept || row.rawDescription || "—"}</span>
            {row.annotation?.counterparty ? (
              <small className="text-muted">{row.annotation.counterparty}</small>
            ) : null}
          </div>
        ),
      },
      {
        key: "amount",
        label: t("finance.treasury.columns.amount"),
        align: "right" as const,
        render: (row: BankTransactionRow) => (
          <strong
            style={{
              fontVariantNumeric: "tabular-nums",
              color: row.excludedFromTotals
                ? "var(--text-muted)"
                : row.direction === "credit"
                  ? "var(--status-success-text, #15803d)"
                  : "inherit",
            }}
          >
            {row.direction === "credit" ? "+" : "−"}
            {formatCurrency(row.amount, row.currency, language)}
          </strong>
        ),
      },
      {
        key: "kind",
        label: t("finance.treasury.columns.kind"),
        render: (row: BankTransactionRow) =>
          row.excludedFromTotals ? (
            <StatusBadge tone="neutral">{kindLabel(row.annotation?.txnKind) }</StatusBadge>
          ) : (
            <select
              className="compact-filter-select"
              onChange={(event) => classify(row.id, event.target.value as TransactionKind)}
              value={row.annotation?.txnKind ?? ""}
            >
              <option value="">{t("finance.treasury.classify.placeholder")}</option>
              {transactionKinds.map((kind) => (
                <option key={kind} value={kind}>
                  {kindLabel(kind)}
                </option>
              ))}
            </select>
          ),
      },
    ],
    [language, t],
  );

  return (
    <div className="page-stack">
      <input
        accept=".csv,.xlsx,.xls"
        hidden
        onChange={(event) => handleFile(event.target.files?.[0])}
        ref={fileInputRef}
        type="file"
      />

      <div className="page-stack-row">
        <SectionHeader eyebrow={t("finance.title")} title={t("finance.treasury.title")} titleTone="accent" />
        <button className="ghost-control is-active" onClick={() => setShowAccountForm((v) => !v)} type="button">
          <Plus size={13} />
          <span>{t("finance.treasury.actions.newAccount")}</span>
        </button>
      </div>

      {showAccountForm ? (
        <AccountForm
          onCancel={() => setShowAccountForm(false)}
          onSave={async (draft) => {
            try {
              await mutations.upsertAccount({
                commandId: newCommandId("treasury-account"),
                workspaceId: activeWorkspaceId,
                actorType: "user",
                sourceChannel: "desktop",
                ...draft,
              });
              toast.success(t("finance.treasury.account.saved"));
              setShowAccountForm(false);
              accounts.refresh();
            } catch (error) {
              toast.error(error instanceof Error ? error.message : t("finance.treasury.account.failed"));
            }
          }}
        />
      ) : null}

      <div className="surface-card-actions" style={{ gap: 6 }}>
        {(["overview", "movements", "review", "projects"] as Tab[]).map((value) => (
          <button
            className={`ghost-control${tab === value ? " is-active" : ""}`}
            key={value}
            onClick={() => setTab(value)}
            type="button"
          >
            {t(`finance.treasury.tabs.${value}`)}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <>
          <div className="surface-card-actions" style={{ gap: 6 }}>
            {periods.map((value) => (
              <button
                className={`ghost-control${period === value ? " is-active" : ""}`}
                key={value}
                onClick={() => setPeriod(value)}
                type="button"
              >
                {t(`finance.treasury.period.${value}`)}
              </button>
            ))}
          </div>

          <SurfaceCard className="quotes-summary-card">
            <div className="quotes-summary-grid">
              <div className="quotes-summary-tile">
                <span className="quotes-summary-tile-label">{t("finance.treasury.kpi.income")}</span>
                <strong className="quotes-summary-tile-value">
                  {formatCurrency(snap?.totalIncome ?? 0, "DOP", language)}
                </strong>
              </div>
              <div className="quotes-summary-tile">
                <span className="quotes-summary-tile-label">{t("finance.treasury.kpi.expense")}</span>
                <strong className="quotes-summary-tile-value">
                  {formatCurrency(snap?.totalExpense ?? 0, "DOP", language)}
                </strong>
              </div>
              <div className="quotes-summary-tile">
                <span className="quotes-summary-tile-label">{t("finance.treasury.kpi.net")}</span>
                <strong className="quotes-summary-tile-value">
                  {formatCurrency(snap?.net ?? 0, "DOP", language)}
                </strong>
              </div>
              <div className="quotes-summary-tile">
                <span className="quotes-summary-tile-label">{t("finance.treasury.kpi.deductible")}</span>
                <strong className="quotes-summary-tile-value">
                  {formatCurrency(snap?.totalDeductibleExpense ?? 0, "DOP", language)}
                </strong>
              </div>
              <div className="quotes-summary-tile">
                <span className="quotes-summary-tile-label">{t("finance.treasury.kpi.unclassified")}</span>
                <strong className="quotes-summary-tile-value">{snap?.unclassifiedCount ?? 0}</strong>
              </div>
            </div>
          </SurfaceCard>

          <SurfaceCard>
            <h3 className="section-subtitle">{t("finance.treasury.accounts.title")}</h3>
            {accounts.data.length === 0 ? (
              <GuidedEmptyState
                body={t("finance.treasury.accounts.emptyBody")}
                title={t("finance.treasury.accounts.emptyTitle")}
              />
            ) : (
              <div className="quotes-summary-grid">
                {accounts.data.map((account) => (
                  <button
                    className="quotes-summary-tile quotes-summary-tile--button"
                    key={account.id}
                    onClick={() => openAccount(account.id)}
                    style={{ textAlign: "left", cursor: "pointer" }}
                    title={t("finance.treasury.accounts.openHint")}
                    type="button"
                  >
                    <span className="quotes-summary-tile-label">
                      {account.accountLabel} · {account.currency}
                    </span>
                    <strong className="quotes-summary-tile-value">
                      {formatCurrency(account.currentBalance ?? account.openingBalance, account.currency, language)}
                    </strong>
                    <small className="text-muted" style={{ marginTop: 4 }}>
                      {t("finance.treasury.accounts.movementCount", { count: account.transactionCount })}
                    </small>
                    <span
                      className="ghost-control"
                      onClick={(event) => {
                        event.stopPropagation();
                        triggerImport(account.id, account.bankName);
                      }}
                      role="button"
                      style={{ marginTop: 8 }}
                    >
                      <Upload size={12} />
                      <span>{t("finance.treasury.actions.import")}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </SurfaceCard>
        </>
      ) : null}

      {tab === "movements" ? (
        <SurfaceCard>
          <div className="surface-card-actions" style={{ gap: 8, flexWrap: "wrap" }}>
            <label className="compact-filter-field">
              <span>{t("finance.treasury.filters.account")}</span>
              <select
                className="compact-filter-select"
                onChange={(event) => setAccountFilter(event.target.value)}
                value={accountFilter}
              >
                <option value="">{t("finance.treasury.filters.allAccounts")}</option>
                {accounts.data.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.accountLabel}
                  </option>
                ))}
              </select>
            </label>
            <label className="compact-filter-field">
              <span>{t("finance.treasury.filters.unclassified")}</span>
              <input
                checked={unclassifiedOnly}
                onChange={(event) => setUnclassifiedOnly(event.target.checked)}
                type="checkbox"
              />
            </label>
            <input
              className="field-input"
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("finance.treasury.searchPlaceholder")}
              style={{ minWidth: 240, marginLeft: "auto" }}
              value={search}
            />
            <button
              className="ghost-control"
              disabled={accounts.data.length === 0 || busy}
              onClick={() => {
                const account = accounts.data.find((a) => a.id === accountFilter) ?? accounts.data[0];
                if (account) triggerImport(account.id, account.bankName);
              }}
              type="button"
            >
              <Upload size={13} />
              <span>{t("finance.treasury.actions.import")}</span>
            </button>
          </div>

          {imports.data.length > 0 ? (
            <div className="treasury-import-history" style={{ margin: "8px 0 14px" }}>
              <h4 className="section-subtitle" style={{ marginBottom: 6 }}>
                {t("finance.treasury.imports.title")}
              </h4>
              <div className="cell-stack" style={{ gap: 4 }}>
                {imports.data.map((batch) => (
                  <div
                    className="surface-card-actions"
                    key={batch.id}
                    style={{ gap: 8, alignItems: "center", justifyContent: "space-between" }}
                  >
                    <small className="text-muted">
                      {batch.originalFilename || batch.sourceFormat.toUpperCase()} ·{" "}
                      {t("finance.treasury.imports.summary", {
                        inserted: batch.insertedCount,
                        duplicates: batch.duplicateCount,
                      })}
                      {batch.periodStart ? ` · ${batch.periodStart} → ${batch.periodEnd ?? "?"}` : ""} ·{" "}
                      {batch.createdAt.slice(0, 10)}
                    </small>
                    <button
                      className="icon-ghost-control"
                      onClick={() => removeImport(batch.id)}
                      title={t("finance.treasury.imports.delete")}
                      type="button"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {transactions.isLoading && transactions.data.length === 0 ? (
            <TableSkeleton rows={6} />
          ) : transactions.data.length === 0 ? (
            <GuidedEmptyState
              body={t("finance.treasury.movements.emptyBody")}
              title={t("finance.treasury.movements.emptyTitle")}
            />
          ) : (
            <DataTable<BankTransactionRow>
              columns={movementColumns}
              getRowId={(row) => row.id}
              persistKey="treasury-movements-v1"
              rows={transactions.data}
            />
          )}
          {transactions.error ? <div className="form-inline-error">{transactions.error}</div> : null}
        </SurfaceCard>
      ) : null}

      {tab === "review" ? (
        <SurfaceCard>
          <h3 className="section-subtitle">{t("finance.treasury.review.title")}</h3>
          {reviewQueue.data.length === 0 ? (
            <GuidedEmptyState
              body={t("finance.treasury.review.emptyBody")}
              title={t("finance.treasury.review.emptyTitle")}
            />
          ) : (
            <div className="cell-stack" style={{ gap: 10 }}>
              {reviewQueue.data.map((row) => (
                <ReviewRow key={row.transactionId} language={language} onApply={applyReview} row={row} t={t} />
              ))}
            </div>
          )}
        </SurfaceCard>
      ) : null}

      {tab === "projects" ? (
        <SurfaceCard>
          <h3 className="section-subtitle">{t("finance.treasury.projects.title")}</h3>
          {projectPnl.data.length === 0 ? (
            <GuidedEmptyState
              body={t("finance.treasury.projects.emptyBody")}
              title={t("finance.treasury.projects.emptyTitle")}
            />
          ) : (
            <DataTable
              columns={[
                { key: "project", label: t("finance.treasury.columns.project"), render: (row) => row.projectName },
                {
                  key: "income",
                  label: t("finance.treasury.kpi.income"),
                  align: "right" as const,
                  render: (row) => formatCurrency(row.income, "DOP", language),
                },
                {
                  key: "expense",
                  label: t("finance.treasury.kpi.expense"),
                  align: "right" as const,
                  render: (row) => formatCurrency(row.expense, "DOP", language),
                },
                {
                  key: "net",
                  label: t("finance.treasury.kpi.net"),
                  align: "right" as const,
                  render: (row) => formatCurrency(row.net, "DOP", language),
                },
                {
                  key: "margin",
                  label: t("finance.treasury.columns.margin"),
                  align: "right" as const,
                  render: (row) => (row.marginPercent != null ? `${row.marginPercent}%` : "—"),
                },
              ]}
              getRowId={(row) => row.projectId ?? row.projectName}
              persistKey="treasury-pnl-v1"
              rows={projectPnl.data}
            />
          )}
        </SurfaceCard>
      ) : null}

      <SurfaceCard className="invoice-footnote-card">
        <div className="invoice-footnote-content">
          <Landmark size={15} />
          <span>{t("finance.treasury.footnote")}</span>
        </div>
      </SurfaceCard>
    </div>
  );
};

/* ------------------------------------------------------------------------- */
/* Subcomponents                                                             */
/* ------------------------------------------------------------------------- */

type AccountDraft = {
  bankName: BankName;
  accountLabel: string;
  accountNumberFull: string;
  currency: string;
  openingBalance: number;
};

const AccountForm = ({
  onCancel,
  onSave,
}: {
  onCancel: () => void;
  onSave: (draft: AccountDraft) => void;
}) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<AccountDraft>({
    bankName: "popular",
    accountLabel: "",
    accountNumberFull: "",
    currency: "DOP",
    openingBalance: 0,
  });

  return (
    <SurfaceCard>
      <div className="surface-card-actions" style={{ gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label className="compact-filter-field">
          <span>{t("finance.treasury.account.bank")}</span>
          <select
            className="compact-filter-select"
            onChange={(event) => setDraft((d) => ({ ...d, bankName: event.target.value as BankName }))}
            value={draft.bankName}
          >
            {bankNames.map((name) => (
              <option key={name} value={name}>
                {t(`finance.treasury.banks.${name}`, { defaultValue: name })}
              </option>
            ))}
          </select>
        </label>
        <label className="compact-filter-field">
          <span>{t("finance.treasury.account.label")}</span>
          <input
            className="field-input"
            onChange={(event) => setDraft((d) => ({ ...d, accountLabel: event.target.value }))}
            value={draft.accountLabel}
          />
        </label>
        <label className="compact-filter-field">
          <span>{t("finance.treasury.account.number")}</span>
          <input
            className="field-input"
            onChange={(event) => setDraft((d) => ({ ...d, accountNumberFull: event.target.value }))}
            value={draft.accountNumberFull}
          />
        </label>
        <label className="compact-filter-field">
          <span>{t("finance.treasury.account.currency")}</span>
          <select
            className="compact-filter-select"
            onChange={(event) => setDraft((d) => ({ ...d, currency: event.target.value }))}
            value={draft.currency}
          >
            <option value="DOP">DOP</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
        </label>
        <label className="compact-filter-field">
          <span>{t("finance.treasury.account.openingBalance")}</span>
          <input
            className="field-input"
            onChange={(event) => setDraft((d) => ({ ...d, openingBalance: Number(event.target.value) || 0 }))}
            type="number"
            value={draft.openingBalance}
          />
        </label>
        <button
          className="ghost-control is-active"
          disabled={!draft.accountLabel.trim()}
          onClick={() => onSave(draft)}
          type="button"
        >
          {t("common.save", { defaultValue: "Save" })}
        </button>
        <button className="ghost-control" onClick={onCancel} type="button">
          {t("common.cancel", { defaultValue: "Cancel" })}
        </button>
      </div>
    </SurfaceCard>
  );
};

const ReviewRow = ({
  row,
  language,
  onApply,
  t,
}: {
  row: ReviewQueueRow;
  language: string;
  onApply: (row: ReviewQueueRow, deductible: number) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) => {
  const [deductible, setDeductible] = useState<number>(row.deductibleAmount ?? row.amount);
  return (
    <div className="surface-card-actions" style={{ gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
      <div className="cell-stack" style={{ flex: 1, minWidth: 220 }}>
        <strong>{row.concept || row.rawDescription || "—"}</strong>
        <small className="text-muted">
          {row.txnDate} · {row.bankAccountLabel} · {formatCurrency(row.amount, row.currency, language)}
        </small>
      </div>
      <label className="compact-filter-field">
        <span>{t("finance.treasury.review.deductible")}</span>
        <input
          className="field-input"
          onChange={(event) => setDeductible(Number(event.target.value) || 0)}
          type="number"
          value={deductible}
        />
      </label>
      <button className="ghost-control is-active" onClick={() => onApply(row, deductible)} type="button">
        {t("finance.treasury.review.apply")}
      </button>
    </div>
  );
};

export default TreasuryPage;
