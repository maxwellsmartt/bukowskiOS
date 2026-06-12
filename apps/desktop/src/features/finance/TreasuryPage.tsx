import { ArrowUpRight, Banknote, Check, ChevronDown, CreditCard, Download, Edit3, FileDown, FileUp, Landmark, Plus, RotateCcw, Search, Trash2, UploadCloud, Wallet, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { useChartAnimationsEnabled } from "@shared/hooks/useChartAnimations";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type {
  BankAccountRow,
  BankAccountType,
  BankName,
  BankTransactionRow,
  CounterpartyRulePreview,
  DgiiReportExportFormat,
  DgiiReportKind,
  PaymentInstrumentKind,
  PaymentInstrumentOwner,
  StatementImportPreview,
  ReviewQueueRow,
  TreasuryDeductibleLedgerExportFormat,
  TransactionDirection,
  TransactionKind,
  TreasuryPeriodPreset,
} from "@contracts";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { DataTable } from "@shared/components/DataTable";
import { CompactSelect } from "@shared/components/CompactSelect";
import { ConfirmDialog } from "@shared/components/ConfirmDialog";
import { GuidedEmptyState } from "@shared/components/GuidedEmptyState";
import { ModalShell } from "@shared/components/ModalShell";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { TableSkeleton } from "@shared/components/TableSkeleton";
import { usePersistentState } from "@shared/hooks/usePersistentState";
import { useCatalogData } from "@features/projects/useProjectsData";
import bancoPopularLogo from "@shared/assets/inbox/logos/banco popular dominicano-logo.jpg";
import bancoSantaCruzLogo from "@shared/assets/inbox/logos/banco santa cruz-logo.png";

import { newCommandId } from "./quoteHelpers";
import { InvoiceInboxPanel } from "./InvoiceInboxPanel";
import { parseStatementFile } from "./treasury/bankStatementParsers";
import {
  exportTreasuryOverviewPdf,
  useBankAccounts,
  useReviewQueue,
  useProjectPnl,
  useTreasuryImports,
  useTreasuryMutations,
  useTreasuryOverview,
  useTreasuryTransactions,
  useTreasuryUndoPreview,
  useTreasuryDeductibleLedger,
} from "./useTreasuryData";

type Tab = "overview" | "accounts" | "movements" | "review" | "invoices" | "projects";
const treasuryTabs: Tab[] = ["overview", "accounts", "movements", "review", "invoices", "projects"];
type MovementDateFilter = "all" | "month" | "custom";
type TreasuryReportCurrency = "DOP" | "USD";
type PendingClassificationRule = {
  row: BankTransactionRow;
  kind: TransactionKind;
  expenseCategory?: string | null;
  preview: CounterpartyRulePreview;
};
type FiscalReviewDraft = {
  supplierNcf: string;
  dgiiExpenseType: string;
  withholdingType: string;
  withholdingRate: string;
  withholdingAmount: string;
  fiscalPeriod: string;
};
type BankOptionValue = BankName | `custom:${string}`;
type TreasuryClassificationSuggestion = {
  kind: TransactionKind;
  expenseCategory?: string;
  labelKey?: string;
  labelDefault: string;
  reasonKey: string;
  reasonDefault: string;
};
type TransactionDraft = {
  txnDate: string;
  rawDescription: string;
  reference: string;
  amount: number;
  direction: TransactionDirection;
  runningBalance: string;
};
type PendingStatementImport = {
  bankAccountId: string;
  bankName: BankName;
  sourceFormat: "csv" | "xlsx" | "manual" | "pdf";
  originalFilename: string;
  accountAutofillLast4: string | null;
  preview: StatementImportPreview;
};

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

type SelectOption<T extends string = string> = {
  value: T;
  label: string;
  description?: string;
};

const dgiiExpenseTypeOptions: ReadonlyArray<SelectOption<string>> = [
  { value: "", label: "Sin especificar" },
  { value: "01", label: "01 · Gastos de personal" },
  { value: "02", label: "02 · Trabajos, suministros y servicios" },
  { value: "03", label: "03 · Arrendamientos" },
  { value: "04", label: "04 · Gastos de activos fijos" },
  { value: "05", label: "05 · Gastos de representación" },
  { value: "06", label: "06 · Otras deducciones admitidas" },
  { value: "07", label: "07 · Gastos financieros" },
  { value: "08", label: "08 · Gastos extraordinarios" },
  { value: "09", label: "09 · Compras y gastos para costo de venta" },
  { value: "10", label: "10 · Adquisiciones de activos" },
  { value: "11", label: "11 · Gastos de seguro" },
];

const dgiiWithholdingTypeOptions: ReadonlyArray<SelectOption<string>> = [
  { value: "", label: "Sin retención" },
  { value: "01", label: "01 · Alquileres" },
  { value: "02", label: "02 · Honorarios por servicios" },
  { value: "03", label: "03 · Otras rentas" },
  { value: "04", label: "04 · Otras rentas (rentas presuntas)" },
  { value: "05", label: "05 · Intereses pagados a personas jurídicas residentes" },
  { value: "06", label: "06 · Intereses pagados a personas físicas residentes" },
  { value: "07", label: "07 · Retención por proveedores del Estado" },
  { value: "08", label: "08 · Juegos telefónicos" },
  { value: "09", label: "09 · Retenciones subsector ganadería bovina" },
];

const DGII_OTHER_OPTION = "__other__";
const recentDgiiExpenseTypeKey = "bukowski:treasury-review:recent-dgii-expense-types";
const recentDgiiWithholdingTypeKey = "bukowski:treasury-review:recent-withholding-types";
const maxRecentDgiiOptions = 4;

const periods: TreasuryPeriodPreset[] = ["fiscal", "month", "quarter", "year", "all"];
const bankLogoByName: Partial<Record<BankName, string>> = {
  popular: bancoPopularLogo,
  santa_cruz: bancoSantaCruzLogo,
};
const normalizeDgiiCode = (value: string | null | undefined) => {
  const trimmed = value?.trim() ?? "";
  const match = trimmed.match(/^(\d{1,2})/);
  return match ? match[1].padStart(2, "0") : trimmed;
};
const withLegacySelectOption = (
  options: ReadonlyArray<SelectOption<string>>,
  value: string,
  label: string,
): ReadonlyArray<SelectOption<string>> => {
  if (!value || options.some((option) => option.value === value)) return options;
  return [...options, { value, label: `${value} · ${label}` }];
};

const readRecentDgiiOptions = (key: string) => {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
};

const pushRecentDgiiOption = (key: string, value: string) => {
  const normalized = normalizeDgiiCode(value);
  if (!normalized || normalized === DGII_OTHER_OPTION) return;
  if (typeof window === "undefined") return;
  try {
    const next = [normalized, ...readRecentDgiiOptions(key).filter((item) => item !== normalized)].slice(0, maxRecentDgiiOptions);
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Best effort only; the form still works without local recents.
  }
};

const buildDgiiOptions = (
  baseOptions: ReadonlyArray<SelectOption<string>>,
  recentValues: ReadonlyArray<string>,
  currentValue: string,
  currentLabel: string,
  otherLabel: string,
  recentLabel: string,
): ReadonlyArray<SelectOption<string>> => {
  const withCurrent = withLegacySelectOption(baseOptions, currentValue, currentLabel);
  const values = new Set<string>();
  const recentOptions: SelectOption<string>[] = [];
  for (const recentValue of recentValues) {
    const value = normalizeDgiiCode(recentValue);
    if (!value || values.has(value)) continue;
    const option = withCurrent.find((candidate) => candidate.value === value);
    if (!option) continue;
    values.add(value);
    recentOptions.push({ ...option, description: recentLabel });
  }
  const recentSet = new Set(recentOptions.map((option) => option.value));
  const rest = withCurrent.filter((option) => !recentSet.has(option.value));
  return [...recentOptions, ...rest, { value: DGII_OTHER_OPTION, label: otherLabel }];
};
const currencySuffix = (currency: string) => {
  const normalized = currency.trim().toUpperCase();
  if (normalized === "USD") return "US$";
  if (normalized === "EUR") return "€";
  return normalized || currency;
};
const formatTreasuryMoney = (value: number, currency = "DOP") => {
  const safe = Number.isFinite(value) ? value : 0;
  return `${safe.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currencySuffix(currency)}`;
};
const formatSignedTreasuryMoney = (
  value: number,
  currency = "DOP",
  polarity: "auto" | "positive" | "negative" = "auto",
) => {
  const safe = Number.isFinite(value) ? value : 0;
  const sign =
    polarity === "positive" ? "+" : polarity === "negative" ? "−" : safe > 0 ? "+" : safe < 0 ? "−" : "";
  return `${sign}${formatTreasuryMoney(Math.abs(safe), currency)}`;
};
const monthStart = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
};
const monthEnd = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
};
const transactionDraftFromRow = (row: BankTransactionRow): TransactionDraft => ({
  txnDate: row.txnDate,
  rawDescription: row.rawDescription ?? "",
  reference: row.reference ?? "",
  amount: row.amount,
  direction: row.direction,
  runningBalance: row.runningBalance == null ? "" : String(row.runningBalance),
});

const chartPalette = ["#d6b37a", "#7eb7b2", "#c88d7f", "#92a7c1", "#a29cd8", "#8ca772", "#d7a0b0", "#b7c482"];
const formatAxisCurrency = (value: number, currency = "DOP") => {
  const prefix = currencySuffix(currency);
  const spacer = prefix.endsWith("$") ? "" : " ";
  if (Math.abs(value) >= 1_000_000) return `${prefix}${spacer}${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `${prefix}${spacer}${(value / 1_000).toFixed(0)}k`;
  return `${prefix}${spacer}${Math.round(value)}`;
};

const normalizeCategoryKey = (value: string) => value.trim().replace(/\s+/g, "_").toLowerCase();
const normalizedMovementText = (row: BankTransactionRow) =>
  [row.rawDescription, row.reference, row.annotation?.counterparty]
    .filter(Boolean)
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();

const includesAny = (text: string, patterns: string[]) => patterns.some((pattern) => text.includes(pattern));

const inferTreasurySuggestion = (row: BankTransactionRow): TreasuryClassificationSuggestion | null => {
  if (row.annotation?.txnKind) return null;
  const text = normalizedMovementText(row);
  if (!text.trim()) return null;

  if (includesAny(text, ["DGII", "PAGO IMPUESTO", "PAG IMPUESTO"])) {
    return {
      kind: "tax",
      expenseCategory: "taxes",
      labelKey: "finance.treasury.categories.taxes",
      labelDefault: "Taxes",
      reasonKey: "finance.treasury.classify.suggestionReasons.tax",
      reasonDefault: "Tax wording detected",
    };
  }
  if (includesAny(text, ["PAG TSS", " TSS ", "TESORERIA SEGURIDAD SOCIAL"])) {
    return {
      kind: "tss",
      expenseCategory: "social_security",
      labelKey: "finance.treasury.categories.social_security",
      labelDefault: "Social security (TSS)",
      reasonKey: "finance.treasury.classify.suggestionReasons.tss",
      reasonDefault: "TSS wording detected",
    };
  }
  if (includesAny(text, ["COMISION", "COMISIONES", "POR 1000", "1.5 X 1000", "1.5 POR 1000"])) {
    return {
      kind: "bank_fee",
      expenseCategory: "bank_fees",
      labelKey: "finance.treasury.categories.bank_fees",
      labelDefault: "Bank fees",
      reasonKey: "finance.treasury.classify.suggestionReasons.bankFee",
      reasonDefault: "Bank fee wording detected",
    };
  }
  if (includesAny(text, ["PAGO TC", "TARJETA", "VISA", "MASTERCARD", "AMEX"])) {
    return {
      kind: "expense",
      expenseCategory: "credit_card",
      labelKey: "finance.treasury.categories.credit_card",
      labelDefault: "Credit card",
      reasonKey: "finance.treasury.classify.suggestionReasons.creditCard",
      reasonDefault: "Card payment wording detected",
    };
  }
  if (includesAny(text, ["HONORARIO", "HONORARIOS", "TECNICO", "TECNICOS", "CREW", "OPERADOR", "GAFFER", "CAMAROGRAFO"])) {
    return {
      kind: "expense",
      expenseCategory: "crew_fees",
      labelKey: "finance.treasury.categories.crew_fees",
      labelDefault: "Crew fees",
      reasonKey: "finance.treasury.classify.suggestionReasons.crewFees",
      reasonDefault: "Crew or fee wording detected",
    };
  }
  if (includesAny(text, ["SERVICIO", "SERVICIOS", "FACTURA", "SUPLIDOR", "CLARO", "ALTICE", "EDESUR", "EDENORTE", "EDEESTE"])) {
    return {
      kind: "expense",
      expenseCategory: "services",
      labelKey: "finance.treasury.categories.services",
      labelDefault: "Service payments",
      reasonKey: "finance.treasury.classify.suggestionReasons.services",
      reasonDefault: "Service/vendor wording detected",
    };
  }
  if (includesAny(text, ["PRESTAMO", "FINANCIAMIENTO", "CUOTA PREST", "PAGO PREST"])) {
    return {
      kind: "expense",
      expenseCategory: "loan_financing",
      labelKey: "finance.treasury.categories.loan_financing",
      labelDefault: "Loans and financing",
      reasonKey: "finance.treasury.classify.suggestionReasons.loan",
      reasonDefault: "Loan wording detected",
    };
  }
  if (includesAny(text, ["PAGO INTERESES", "COMPENSACION POR BALANCE"])) {
    return {
      kind: "interest",
      expenseCategory: "interest_income",
      labelKey: "finance.treasury.categories.interest_income",
      labelDefault: "Interest",
      reasonKey: "finance.treasury.classify.suggestionReasons.interest",
      reasonDefault: "Interest wording detected",
    };
  }
  return null;
};

const TreasuryChartTooltip = ({
  active,
  currency = "DOP",
  label,
  payload,
}: {
  active?: boolean;
  currency?: string;
  label?: string;
  payload?: Array<{ color?: string; name?: string; payload?: { label?: string }; value?: number | string }>;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="finance-chart-tooltip">
      {label ? <strong>{label}</strong> : null}
      {payload.map((entry, index) => (
        <div className="finance-chart-tooltip-row" key={`${entry.name}-${index}`}>
          <span className="finance-chart-tooltip-dot" style={{ background: entry.color ?? "rgba(255,255,255,0.6)" }} />
          <span>
            {entry.payload?.label ?? entry.name ? `${entry.payload?.label ?? entry.name}: ` : ""}
            {typeof entry.value === "number" ? formatTreasuryMoney(entry.value, currency) : String(entry.value ?? "—")}
          </span>
        </div>
      ))}
    </div>
  );
};

const TreasuryBalanceTooltip = ({
  active,
  accounts = [],
  label,
  payload,
}: {
  active?: boolean;
  accounts?: Array<{ accountId: string; label: string; currency: string }>;
  label?: string;
  payload?: Array<{ color?: string; dataKey?: string; value?: number | string }>;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="finance-chart-tooltip">
      {label ? <strong>{label}</strong> : null}
      {payload.map((entry, index) => {
        const meta = accounts.find((account) => account.accountId === entry.dataKey);
        return (
          <div className="finance-chart-tooltip-row" key={`${entry.dataKey}-${index}`}>
            <span className="finance-chart-tooltip-dot" style={{ background: entry.color ?? "rgba(255,255,255,0.6)" }} />
            <span>
              {meta ? `${meta.label}: ` : ""}
              {typeof entry.value === "number" ? formatTreasuryMoney(entry.value, meta?.currency) : String(entry.value ?? "—")}
            </span>
          </div>
        );
      })}
    </div>
  );
};

export const TreasuryPage = () => {
  const { t } = useTranslation();
  const chartsAnimated = useChartAnimationsEnabled();
  const { activeWorkspaceId, hasPermission } = useWorkspace();
  // Defense in depth + clearer UX: hide/disable write controls the signed-in
  // role can't use, instead of letting the click bounce off the main-process
  // guard with an error toast.
  const canManageAccounts = hasPermission("treasury.accounts.manage");
  const canImport = hasPermission("treasury.import");
  const canExport = hasPermission("treasury.export");
  const mutations = useTreasuryMutations();
  const catalog = useCatalogData({ workspaceId: activeWorkspaceId, entityType: "crew", search: "", sortBy: "fullName", sortDirection: "asc" });
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Remember which Treasury tab the user was on across reloads/sessions.
  const [tab, setTab] = usePersistentState<Tab>(
    `bukowski:treasury-tab:${activeWorkspaceId}`,
    "overview",
  );
  const [period, setPeriod] = useState<TreasuryPeriodPreset>("fiscal");
  const [accountFilter, setAccountFilter] = useState<string>("");
  const [dateFilter, setDateFilter] = useState<MovementDateFilter>("all");
  const [dateFrom, setDateFrom] = useState(monthStart);
  const [dateTo, setDateTo] = useState(monthEnd);
  const [search, setSearch] = useState("");
  const [unclassifiedOnly, setUnclassifiedOnly] = useState(false);
  const [suggestedOnly, setSuggestedOnly] = useState(false);
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [editingAccount, setEditingAccount] = useState<BankAccountRow | null>(null);
  const [deactivatingAccountId, setDeactivatingAccountId] = useState<string | null>(null);
  const [showManualForm, setShowManualForm] = useState(false);
  const [importHistoryOpen, setImportHistoryOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeMovementId, setActiveMovementId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<TransactionDraft | null>(null);
  const [pendingRule, setPendingRule] = useState<PendingClassificationRule | null>(null);
  const [isApplyingRule, setIsApplyingRule] = useState(false);
  const [pendingImportDelete, setPendingImportDelete] = useState<string | null>(null);
  const [isDeletingImport, setIsDeletingImport] = useState(false);
  const [importBankName, setImportBankName] = useState<BankName>("popular");
  const [importAccountId, setImportAccountId] = useState<string>("");
  const [pendingStatementImport, setPendingStatementImport] = useState<PendingStatementImport | null>(null);
  const [isConfirmingStatementImport, setIsConfirmingStatementImport] = useState(false);
  const [busy, setBusy] = useState(false);
  const [overviewCurrency, setOverviewCurrency] = useState<TreasuryReportCurrency>("DOP");
  const [selectedMovementIds, setSelectedMovementIds] = useState<string[]>([]);
  const [bulkKind, setBulkKind] = useState<TransactionKind | "">("");
  const [isBulkClassifying, setIsBulkClassifying] = useState(false);
  const [isUndoingTreasuryAction, setIsUndoingTreasuryAction] = useState(false);
  const [deductibleLedgerPeriod, setDeductibleLedgerPeriod] = useState<TreasuryPeriodPreset>("fiscal");
  const [deductibleLedgerFormat, setDeductibleLedgerFormat] = useState<TreasuryDeductibleLedgerExportFormat>("xlsx");
  const [dgiiReportKind, setDgiiReportKind] = useState<DgiiReportKind>("606");
  const [dgiiReportFormat, setDgiiReportFormat] = useState<DgiiReportExportFormat>("xlsx");
  const [reviewSearch, setReviewSearch] = useState("");
  const [reviewAccountFilter, setReviewAccountFilter] = useState("");
  const [reviewMissingNcfOnly, setReviewMissingNcfOnly] = useState(false);
  const [bulkAcceptOpen, setBulkAcceptOpen] = useState(false);
  const [isBulkAccepting, setIsBulkAccepting] = useState(false);
  const [reviewLimit, setReviewLimit] = useState(40);
  const [isExportingDeductibleLedger, setIsExportingDeductibleLedger] = useState(false);
  const [isExportingDgiiReport, setIsExportingDgiiReport] = useState(false);
  const [isExportingOverviewPdf, setIsExportingOverviewPdf] = useState(false);

  const accounts = useBankAccounts(activeWorkspaceId);
  const overview = useTreasuryOverview(
    useMemo(
      () => ({ workspaceId: activeWorkspaceId, period, reportCurrency: overviewCurrency }),
      [activeWorkspaceId, overviewCurrency, period],
    ),
  );
  const overviewQuery = useMemo(
    () => ({ workspaceId: activeWorkspaceId, period, reportCurrency: overviewCurrency }),
    [activeWorkspaceId, overviewCurrency, period],
  );
  const transactions = useTreasuryTransactions(
    useMemo(
      () => ({
        workspaceId: activeWorkspaceId,
        bankAccountId: accountFilter || undefined,
        dateFrom: dateFilter === "all" ? undefined : dateFrom,
        dateTo: dateFilter === "all" ? undefined : dateTo,
        search: search.trim() || undefined,
        unclassifiedOnly: unclassifiedOnly || undefined,
        limit: 500,
      }),
      [activeWorkspaceId, accountFilter, dateFilter, dateFrom, dateTo, search, unclassifiedOnly],
    ),
  );
  const reviewQueue = useReviewQueue(activeWorkspaceId);
  const projectPnl = useProjectPnl(activeWorkspaceId);
  const imports = useTreasuryImports(activeWorkspaceId, accountFilter || undefined);
  const undoPreview = useTreasuryUndoPreview(activeWorkspaceId);
  const deductibleLedger = useTreasuryDeductibleLedger(
    useMemo(
      () => ({ workspaceId: activeWorkspaceId, period: deductibleLedgerPeriod }),
      [activeWorkspaceId, deductibleLedgerPeriod],
    ),
  );
  const selectedAccount = useMemo(
    () => accounts.data.find((account) => account.id === accountFilter) ?? null,
    [accountFilter, accounts.data],
  );
  const periodOptions = useMemo(
    () =>
      periods.map((value) => ({
        value,
        label: t(`finance.treasury.period.${value}`),
      })),
    [t],
  );
  const dgiiReportOptions = useMemo(
    () => [
      { value: "606" as const, label: t("finance.treasury.review.dgii606", { defaultValue: "606 compras" }) },
      { value: "607" as const, label: t("finance.treasury.review.dgii607", { defaultValue: "607 ventas" }) },
      { value: "608" as const, label: t("finance.treasury.review.dgii608", { defaultValue: "608 anulados" }) },
    ],
    [t],
  );
  const exportFormatOptions = useMemo(
    () => [
      { value: "xlsx" as const, label: "XLSX" },
      { value: "csv" as const, label: "CSV" },
      { value: "pdf" as const, label: "PDF" },
    ],
    [],
  );
  const dateFilterOptions = useMemo(
    () => [
      { value: "all" as const, label: t("finance.treasury.filters.allDates") },
      { value: "month" as const, label: t("finance.treasury.filters.thisMonth") },
      { value: "custom" as const, label: t("finance.treasury.filters.customDates") },
    ],
    [t],
  );
  const formatMoney = formatTreasuryMoney;
  const instrumentKindLabel = (kind: PaymentInstrumentKind) =>
    t(`finance.treasury.instrumentKinds.${kind}`, { defaultValue: kind.replace(/_/g, " ") });
  const accountTypeLabel = (type: BankAccountType | null | undefined) =>
    t(`finance.treasury.accountTypes.${type ?? "other"}`, { defaultValue: type ?? "Otra" });
  const ownerLabel = (owner: PaymentInstrumentOwner) =>
    t(`finance.treasury.owners.${owner}`, { defaultValue: owner });
  const bankDisplayLabel = (account: BankAccountRow) =>
    account.bankName === "custom" && account.issuer
      ? account.issuer
      : t(`finance.treasury.banks.${account.bankName}`, { defaultValue: account.bankName });
  const accountTerminal = (account: BankAccountRow) =>
    account.last4 || account.accountNumberMasked?.match(/(\d{4})\D*$/)?.[1] || null;
  const paymentInstrumentDisplayLabel = (account: BankAccountRow) => {
    const terminal = accountTerminal(account);
    return `${account.accountLabel}${terminal ? ` · •••• ${terminal}` : ""} · ${account.currency}`;
  };
  const customBankOptions = useMemo(
    () =>
      Array.from(
        new Set(
          accounts.data
            .filter((account) => account.bankName === "custom" && account.issuer?.trim())
            .map((account) => account.issuer?.trim() ?? ""),
        ),
      ).map((name) => ({ value: `custom:${name}` as const, label: name })),
    [accounts.data],
  );
  const accountOptions = useMemo(
    () => [
      { value: "", label: t("finance.treasury.filters.allAccounts") },
      ...accounts.data.map((account) => ({
        value: account.id,
        label: paymentInstrumentDisplayLabel(account),
      })),
    ],
    [accounts.data, t],
  );
  const paymentUserOptions = useMemo(
    () => [
      { value: "", label: t("finance.treasury.account.chooseResponsible", { defaultValue: "Elegir responsable..." }) },
      ...catalog.data.crewMembers
        .filter((member) => member.isActive)
        .map((member) => ({
          value: member.linkedUserId || member.id,
          label: member.roleLabel ? `${member.fullName} · ${member.roleLabel}` : member.fullName,
        })),
    ],
    [catalog.data.crewMembers, t],
  );
  const activeAccounts = useMemo(() => accounts.data.filter((account) => account.isActive), [accounts.data]);
  const inactiveAccounts = useMemo(() => accounts.data.filter((account) => !account.isActive), [accounts.data]);
  const visibleMovements = useMemo(
    () => (suggestedOnly ? transactions.data.filter((row) => inferTreasurySuggestion(row)) : transactions.data),
    [suggestedOnly, transactions.data],
  );
  const selectedMovements = useMemo(() => {
    const selectedIds = new Set(selectedMovementIds);
    return visibleMovements.filter((row) => selectedIds.has(row.id));
  }, [selectedMovementIds, visibleMovements]);

  const kindLabel = (kind: TransactionKind | null | undefined) =>
    kind ? t(`finance.treasury.kinds.${kind}`, { defaultValue: kind }) : "—";
  const kindOptions = useMemo(
    () => [
      { value: "" as const, label: t("finance.treasury.classify.placeholder") },
      ...transactionKinds.map((kind) => ({
        value: kind,
        label: t(`finance.treasury.kinds.${kind}`, { defaultValue: kind }),
      })),
    ],
    [t],
  );
  const categoryLabel = (category: string | null | undefined) => {
    if (!category) return t("finance.treasury.categories.uncategorized");
    return t(`finance.treasury.categories.${normalizeCategoryKey(category)}`, {
      defaultValue: kindLabel(category as TransactionKind),
    });
  };
  const suggestionLabel = (suggestion: TreasuryClassificationSuggestion) =>
    suggestion.labelKey ? t(suggestion.labelKey, { defaultValue: suggestion.labelDefault }) : kindLabel(suggestion.kind);
  const suggestionReason = (suggestion: TreasuryClassificationSuggestion) =>
    t(suggestion.reasonKey, { defaultValue: suggestion.reasonDefault });
  const kindToneClass = (kind: TransactionKind | null | undefined) => {
    switch (kind) {
      case "income":
      case "interest":
        return "is-positive";
      case "expense":
      case "salary":
      case "tax":
      case "tss":
      case "bank_fee":
      case "owner_draw":
        return "is-negative";
      case "transfer":
      case "fx_exchange":
      case "reimbursement":
        return "is-neutral";
      default:
        return "is-muted";
    }
  };

  const refreshAll = () => {
    accounts.refresh();
    overview.refresh();
    transactions.refresh();
    reviewQueue.refresh();
    imports.refresh();
    undoPreview.refresh();
    deductibleLedger.refresh();
  };

  useEffect(() => {
    if (tab === "accounts" || !showAccountForm) return;
    setShowAccountForm(false);
    setEditingAccount(null);
  }, [showAccountForm, tab]);

  useEffect(() => {
    setSelectedMovementIds((current) => {
      if (!current.length) return current;
      const visibleIds = new Set(visibleMovements.map((row) => row.id));
      const next = current.filter((id) => visibleIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [visibleMovements]);

  const openAccount = (accountId: string) => {
    setAccountFilter(accountId);
    setTab("movements");
  };

  const openMovement = (transactionId: string) => {
    setPeriod("all");
    setAccountFilter("");
    setDateFilter("all");
    setSearch("");
    setUnclassifiedOnly(false);
    setSuggestedOnly(false);
    setSelectedMovementIds([transactionId]);
    setActiveMovementId(transactionId);
    setTab("movements");
  };

  const startNewPaymentInstrument = () => {
    setEditingAccount(null);
    setShowAccountForm((current) => !current);
    setTab("accounts");
  };

  const startEditPaymentInstrument = (account: BankAccountRow) => {
    setEditingAccount(account);
    setShowAccountForm(true);
    setTab("accounts");
  };

  const savePaymentInstrument = async (draft: AccountDraft) => {
    try {
      const isDraftBankAccount = draft.instrumentKind === "bank_account";
      const isDraftCard = draft.instrumentKind === "credit_card" || draft.instrumentKind === "debit_card";
      const isDraftCreditCard = draft.instrumentKind === "credit_card";
      const sanitizedDraft: AccountDraft = {
        ...draft,
        bankName: draft.instrumentKind === "cash" ? "custom" : draft.bankName,
        accountType: isDraftBankAccount ? draft.accountType : "other",
        accountNumberMasked: isDraftBankAccount ? draft.accountNumberMasked : "",
        last4: isDraftCard ? draft.last4 : "",
        issuer: isDraftCard || draft.bankName === "custom" ? draft.issuer : "",
        statementCycleDay: isDraftCreditCard ? draft.statementCycleDay : null,
        paymentDueDay: isDraftCreditCard ? draft.paymentDueDay : null,
        reminderUserId: isDraftCreditCard ? draft.reminderUserId : "",
        ownerUserId: draft.owner === "company" ? "" : draft.ownerUserId,
        ownerUserNameSnapshot: "",
      };
      await mutations.upsertPaymentInstrument({
        commandId: newCommandId("treasury-instrument"),
        workspaceId: activeWorkspaceId,
        actorType: "user",
        sourceChannel: "desktop",
        bankAccountId: editingAccount?.id ?? null,
        ...sanitizedDraft,
        accountNumberFull: null,
      });
      toast.success(t("finance.treasury.account.saved"));
      setShowAccountForm(false);
      setEditingAccount(null);
      accounts.refresh();
      overview.refresh();
      undoPreview.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("finance.treasury.account.failed"));
    }
  };

  const deactivatePaymentInstrument = async (account: BankAccountRow) => {
    setDeactivatingAccountId(account.id);
    try {
      await mutations.deactivatePaymentInstrument({
        commandId: newCommandId("treasury-instrument-deactivate"),
        workspaceId: activeWorkspaceId,
        actorType: "user",
        sourceChannel: "desktop",
        paymentInstrumentId: account.id,
      });
      toast.success(t("finance.treasury.account.deactivated", { defaultValue: "Medio de pago desactivado." }));
      accounts.refresh();
      overview.refresh();
      undoPreview.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("finance.treasury.account.deactivateFailed", { defaultValue: "No se pudo desactivar el medio de pago." }));
    } finally {
      setDeactivatingAccountId(null);
    }
  };

  const beginEdit = (row: BankTransactionRow) => {
    setEditingId(row.id);
    setEditDraft(transactionDraftFromRow(row));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft(null);
  };

  const saveEdit = async (row: BankTransactionRow) => {
    if (!editDraft) return;
    try {
      await mutations.correctTransaction({
        commandId: newCommandId("treasury-correct"),
        workspaceId: activeWorkspaceId,
        actorType: "user",
        sourceChannel: "desktop",
        transactionId: row.id,
        txnDate: editDraft.txnDate,
        rawDescription: editDraft.rawDescription,
        reference: editDraft.reference,
        amount: editDraft.amount,
        direction: editDraft.direction,
        runningBalance: editDraft.runningBalance.trim() ? Number(editDraft.runningBalance) : null,
        notes: "Manual correction from treasury table.",
      });
      toast.success(t("finance.treasury.movements.corrected"));
      cancelEdit();
      refreshAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("finance.treasury.movements.correctFailed"));
    }
  };

  const confirmRemoveImport = async () => {
    if (!pendingImportDelete) return;
    setIsDeletingImport(true);
    try {
      await mutations.deleteImport({
        commandId: newCommandId("treasury-del-import"),
        workspaceId: activeWorkspaceId,
        actorType: "user",
        sourceChannel: "desktop",
        importId: pendingImportDelete,
      });
      toast.success(t("finance.treasury.imports.deleted"));
      setPendingImportDelete(null);
      refreshAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("finance.treasury.imports.deleteFailed"));
    } finally {
      setIsDeletingImport(false);
    }
  };

  const undoLastTreasuryAction = async () => {
    setIsUndoingTreasuryAction(true);
    try {
      const result = await mutations.undoLastAction({
        commandId: newCommandId("treasury-undo"),
        workspaceId: activeWorkspaceId,
        actorType: "user",
        sourceChannel: "desktop",
      });
      toast.success(t("finance.treasury.undo.done", { defaultValue: "Last treasury change undone." }), {
        description: result.summary,
      });
      setSelectedMovementIds([]);
      setBulkKind("");
      cancelEdit();
      refreshAll();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("finance.treasury.undo.failed", { defaultValue: "Could not undo the last treasury change." }),
      );
    } finally {
      setIsUndoingTreasuryAction(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.key.toLowerCase() !== "z") return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tagName = target.tagName.toLowerCase();
        if (target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select") return;
      }
      if (tab !== "movements" || isUndoingTreasuryAction || !undoPreview.data) return;
      event.preventDefault();
      void undoLastTreasuryAction();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isUndoingTreasuryAction, tab, undoPreview.data]);

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
          toast.error(
            t("finance.treasury.import.mismatchBlocked", {
              fileCurrency: parsed.currencyHint ?? "?",
              fileAccount: parsed.accountNumber ?? "?",
              accountLabel: target.accountLabel,
              accountCurrency: target.currency,
            }),
          );
          return;
        }
      }
      const sourceFormat = parsed.bankName === "santa_cruz" ? "xlsx" : "csv";
      const preview = await mutations.previewStatementImport({
        workspaceId: activeWorkspaceId,
        bankAccountId: importAccountId,
        sourceFormat,
        originalFilename: file.name,
        periodStart: parsed.periodStart,
        periodEnd: parsed.periodEnd,
        rows: parsed.rows,
      });
      setPendingStatementImport({
        bankAccountId: importAccountId,
        bankName: importBankName,
        sourceFormat,
        originalFilename: file.name,
        accountAutofillLast4: target && parsed.accountNumber && !accountTerminal(target) ? parsed.accountNumber.slice(-4) : null,
        preview,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("finance.treasury.import.failed"));
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const confirmStatementImport = async () => {
    if (!pendingStatementImport) return;
    setIsConfirmingStatementImport(true);
    try {
      const target = accounts.data.find((account) => account.id === pendingStatementImport.bankAccountId);
      if (target && pendingStatementImport.accountAutofillLast4) {
        const last4 = pendingStatementImport.accountAutofillLast4;
        await mutations.upsertPaymentInstrument({
          commandId: newCommandId("treasury-instrument-autofill"),
          workspaceId: activeWorkspaceId,
          actorType: "user",
          sourceChannel: "desktop",
          bankAccountId: target.id,
          bankName: target.bankName,
          accountLabel: target.accountLabel,
          accountNumberFull: null,
          accountNumberMasked: `•••• ${last4}`,
          currency: target.currency,
          accountType: target.accountType ?? "other",
          owner: target.owner,
          ownerUserId: target.ownerUserId ?? "",
          ownerUserNameSnapshot: target.ownerUserNameSnapshot ?? "",
          instrumentKind: target.instrumentKind,
          last4: target.instrumentKind === "credit_card" || target.instrumentKind === "debit_card" ? last4 : target.last4 ?? "",
          issuer: target.issuer ?? "",
          statementCycleDay: target.statementCycleDay,
          paymentDueDay: target.paymentDueDay,
          reminderUserId: target.reminderUserId ?? "",
          openingBalance: target.openingBalance,
          openingBalanceDate: target.openingBalanceDate,
          notes: target.notes ?? "",
        });
      }
      const result = await mutations.importStatement({
        commandId: newCommandId("treasury-import"),
        workspaceId: activeWorkspaceId,
        actorType: "user",
        sourceChannel: "desktop",
        bankAccountId: pendingStatementImport.bankAccountId,
        sourceFormat: pendingStatementImport.sourceFormat,
        originalFilename: pendingStatementImport.originalFilename,
        periodStart: pendingStatementImport.preview.periodStart,
        periodEnd: pendingStatementImport.preview.periodEnd,
        rows: pendingStatementImport.preview.rows.map((row) => ({
          txnDate: row.txnDate,
          valueDate: row.valueDate ?? null,
          rawDescription: row.rawDescription ?? null,
          reference: row.reference ?? null,
          serial: row.serial ?? null,
          amount: row.amount,
          direction: row.direction,
          runningBalance: row.runningBalance ?? null,
        })),
      });
      toast.success(result.summary);
      setPendingStatementImport(null);
      refreshAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("finance.treasury.import.failed"));
    } finally {
      setIsConfirmingStatementImport(false);
    }
  };

  /* --------------------------- Classify handler -------------------------- */

  const classify = async (row: BankTransactionRow, kind: TransactionKind) => {
    if (!kind) return;
    try {
      const baseCommand = {
        workspaceId: activeWorkspaceId,
        actorType: "user" as const,
        sourceChannel: "desktop" as const,
        transactionId: row.id,
        txnKind: kind,
        isInternalTransfer: kind === "transfer" || kind === "fx_exchange",
      };
      const preview = row.rawDescription?.trim()
        ? await mutations.previewClassificationRule({
            workspaceId: activeWorkspaceId,
            transactionId: row.id,
            matchType: "exact",
          })
        : null;
      if (preview && preview.matchCount > 1) {
        setPendingRule({ row, kind, preview });
        return;
      }

      await mutations.annotate({
        commandId: newCommandId("treasury-classify"),
        ...baseCommand,
      });
      toast.success(t("finance.treasury.classify.saved"));
      transactions.refresh();
      overview.refresh();
      undoPreview.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("finance.treasury.classify.failed"));
    }
  };

  const previewSimilarClassification = async (row: BankTransactionRow, kind: TransactionKind) => {
    if (!row.rawDescription?.trim()) {
      toast.error(t("finance.treasury.classify.noDescription", { defaultValue: "This movement has no description to match." }));
      return;
    }
    try {
      const preview = await mutations.previewClassificationRule({
        workspaceId: activeWorkspaceId,
        transactionId: row.id,
        matchType: "exact",
      });
      if (preview.matchCount <= 1) {
        toast.info(t("finance.treasury.classify.noSimilar", { defaultValue: "No unclassified similar movements found." }));
        return;
      }
      setPendingRule({ row, kind, preview });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("finance.treasury.classify.failed"));
    }
  };

  const applySuggestedClassification = async (row: BankTransactionRow, suggestion: TreasuryClassificationSuggestion) => {
    const baseCommand = {
      workspaceId: activeWorkspaceId,
      actorType: "user" as const,
      sourceChannel: "desktop" as const,
      transactionId: row.id,
      txnKind: suggestion.kind,
      expenseCategory: suggestion.expenseCategory ?? null,
      isInternalTransfer: suggestion.kind === "transfer" || suggestion.kind === "fx_exchange",
    };
    try {
      const preview = row.rawDescription?.trim()
        ? await mutations.previewClassificationRule({
            workspaceId: activeWorkspaceId,
            transactionId: row.id,
            matchType: "exact",
          })
        : null;
      if (preview && preview.matchCount > 1) {
        setPendingRule({ row, kind: suggestion.kind, expenseCategory: suggestion.expenseCategory ?? null, preview });
        return;
      }
      await mutations.annotate({
        commandId: newCommandId("treasury-suggest-classify"),
        ...baseCommand,
      });
      toast.success(t("finance.treasury.classify.saved"));
      transactions.refresh();
      overview.refresh();
      undoPreview.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("finance.treasury.classify.failed"));
    }
  };

  const applyPendingRule = async (applyToAll: boolean) => {
    if (!pendingRule) return;
    const baseCommand = {
      workspaceId: activeWorkspaceId,
      actorType: "user" as const,
      sourceChannel: "desktop" as const,
      transactionId: pendingRule.row.id,
      txnKind: pendingRule.kind,
      expenseCategory: pendingRule.expenseCategory ?? null,
      isInternalTransfer: pendingRule.kind === "transfer" || pendingRule.kind === "fx_exchange",
    };
    setIsApplyingRule(true);
    try {
      if (applyToAll) {
        const result = await mutations.applyClassificationRule({
          commandId: newCommandId("treasury-rule"),
          ...baseCommand,
          matchType: "exact",
        });
        toast.success(t("finance.treasury.classify.appliedSimilar", { count: result.affectedCount }));
      } else {
        await mutations.annotate({
          commandId: newCommandId("treasury-classify"),
          ...baseCommand,
        });
        toast.success(t("finance.treasury.classify.saved"));
      }
      setPendingRule(null);
      transactions.refresh();
      overview.refresh();
      undoPreview.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("finance.treasury.classify.failed"));
    } finally {
      setIsApplyingRule(false);
    }
  };

  const applyBulkClassification = async () => {
    if (!bulkKind || selectedMovements.length === 0) return;
    setIsBulkClassifying(true);
    try {
      for (const row of selectedMovements) {
        await mutations.annotate({
          commandId: newCommandId("treasury-bulk-classify"),
          workspaceId: activeWorkspaceId,
          actorType: "user",
          sourceChannel: "desktop",
          transactionId: row.id,
          txnKind: bulkKind,
          isInternalTransfer: bulkKind === "transfer" || bulkKind === "fx_exchange",
        });
      }
      toast.success(
        t("finance.treasury.classify.bulkSaved", {
          count: selectedMovements.length,
          kind: kindLabel(bulkKind),
          defaultValue: "{{count}} movements marked as {{kind}}.",
        }),
      );
      setSelectedMovementIds([]);
      setBulkKind("");
      transactions.refresh();
      overview.refresh();
      undoPreview.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("finance.treasury.classify.failed"));
    } finally {
      setIsBulkClassifying(false);
    }
  };

  /* --------------------------- Review handler ---------------------------- */

  const submitReviewRow = (row: ReviewQueueRow, deductible: number, fiscalDraft?: FiscalReviewDraft) => {
    const withholdingRate = fiscalDraft?.withholdingRate.trim() ? Number(fiscalDraft.withholdingRate) : null;
    const withholdingAmount = fiscalDraft?.withholdingAmount.trim() ? Number(fiscalDraft.withholdingAmount) : null;
    return mutations.reviewReimbursement({
      commandId: newCommandId("treasury-review"),
      workspaceId: activeWorkspaceId,
      actorType: "user",
      sourceChannel: "desktop",
      transactionId: row.transactionId,
      reimbursementStatus: deductible >= row.amount ? "accepted" : deductible > 0 ? "partial" : "rejected",
      deductibleAmount: deductible,
      supplierNcf: fiscalDraft?.supplierNcf.trim() || null,
      dgiiExpenseType: fiscalDraft?.dgiiExpenseType.trim() || null,
      withholdingType: fiscalDraft?.withholdingType.trim() || null,
      withholdingRate,
      withholdingAmount,
      fiscalPeriod: fiscalDraft?.fiscalPeriod.trim() || null,
      fiscalStatus: deductible > 0 ? "accepted" : "rejected",
    });
  };
  const refreshAfterReview = () => {
    reviewQueue.refresh();
    overview.refresh();
    undoPreview.refresh();
    deductibleLedger.refresh();
  };
  // Keeps a row's already-captured fiscal data intact when bulk-accepting.
  const fiscalDraftFromRow = (row: ReviewQueueRow): FiscalReviewDraft => ({
    supplierNcf: row.supplierNcf ?? "",
    dgiiExpenseType: row.dgiiExpenseType ?? "",
    withholdingType: row.withholdingType ?? "",
    withholdingRate: row.withholdingRate == null ? "" : String(row.withholdingRate),
    withholdingAmount: row.withholdingAmount == null ? "" : String(row.withholdingAmount),
    fiscalPeriod: row.fiscalPeriod ?? row.txnDate.slice(0, 7),
  });
  const applyReview = async (row: ReviewQueueRow, deductible: number, fiscalDraft?: FiscalReviewDraft) => {
    try {
      await submitReviewRow(row, deductible, fiscalDraft);
      toast.success(t("finance.treasury.review.saved"));
      refreshAfterReview();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("finance.treasury.review.failed"));
    }
  };
  const confirmBulkAccept = async () => {
    setIsBulkAccepting(true);
    let accepted = 0;
    try {
      for (const row of filteredReviewRows) {
        await submitReviewRow(row, row.amount, fiscalDraftFromRow(row));
        accepted += 1;
      }
      toast.success(t("finance.treasury.review.bulkAccepted", { defaultValue: "Accepted {{count}} reimbursements", count: accepted }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("finance.treasury.review.failed"));
    } finally {
      refreshAfterReview();
      setIsBulkAccepting(false);
      setBulkAcceptOpen(false);
    }
  };

  const exportDeductibleLedger = async () => {
    setIsExportingDeductibleLedger(true);
    try {
      const result = await mutations.exportDeductibleLedger({
        workspaceId: activeWorkspaceId,
        period: deductibleLedgerPeriod,
        format: deductibleLedgerFormat,
      });
      if (result.saved) {
        toast.success(t("finance.treasury.review.ledgerExported", { defaultValue: "Deductible ledger exported" }), {
          description: result.summary,
        });
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("finance.treasury.review.ledgerExportFailed", { defaultValue: "Could not export the deductible ledger." }),
      );
    } finally {
      setIsExportingDeductibleLedger(false);
    }
  };

  const exportDgiiReport = async () => {
    setIsExportingDgiiReport(true);
    try {
      const result = await mutations.exportDgiiReport({
        workspaceId: activeWorkspaceId,
        report: dgiiReportKind,
        period: deductibleLedgerPeriod,
        format: dgiiReportFormat,
      });
      if (result.saved) {
        toast.success(t("finance.treasury.review.dgiiExported", { defaultValue: "Reporte DGII exportado" }), {
          description: result.summary,
        });
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("finance.treasury.review.dgiiExportFailed", { defaultValue: "No se pudo exportar el reporte DGII." }),
      );
    } finally {
      setIsExportingDgiiReport(false);
    }
  };

  const exportOverviewPdf = async () => {
    setIsExportingOverviewPdf(true);
    try {
      const result = await exportTreasuryOverviewPdf(overviewQuery);
      if (result.saved) {
        toast.success(t("finance.treasury.overview.exported"), {
          description: result.summary,
        });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("finance.treasury.overview.exportFailed"));
    } finally {
      setIsExportingOverviewPdf(false);
    }
  };

  const snap = overview.data;
  const moneyCurrency = snap?.reportCurrency && snap.reportCurrency !== "mixed" ? snap.reportCurrency : overviewCurrency;
  const importTotals = useMemo(
    () => ({
      duplicates: imports.data.reduce((sum, batch) => sum + batch.duplicateCount, 0),
      inserted: imports.data.reduce((sum, batch) => sum + batch.insertedCount, 0),
    }),
    [imports.data],
  );
  const categoryChartData = useMemo(() => {
    if (!snap?.expenseByCategory.length) return [];
    const total = snap.expenseByCategory.reduce((sum, row) => sum + row.amount, 0) || 1;
    const primary = snap.expenseByCategory.filter((row, index) => index < 7 && row.amount / total >= 0.015);
    const grouped = snap.expenseByCategory.filter((row) => !primary.includes(row));
    const rows = primary.map((row) => ({
      ...row,
      label: categoryLabel(row.category),
    }));
    if (grouped.length > 0) {
      const amount = grouped.reduce((sum, row) => sum + row.amount, 0);
      rows.push({
        category: "other_small",
        label: categoryLabel("other_small"),
        amount: Math.round((amount + Number.EPSILON) * 100) / 100,
        percentage: Math.round(((amount / total) * 100 + Number.EPSILON) * 100) / 100,
      });
    }
    return rows;
  }, [snap?.expenseByCategory, t]);
  const deductibleChartData = useMemo(() => {
    if (!snap?.monthly.length) return [];
    return snap.monthly.map((point) => ({
      month: point.month,
      deductible: point.deductible,
      nonDeductible: Math.max(Math.round((point.expense - point.deductible + Number.EPSILON) * 100) / 100, 0),
    }));
  }, [snap?.monthly]);
  const hasDeductibleData = deductibleChartData.some((p) => p.deductible > 0 || p.nonDeductible > 0);
  const reviewSummary = useMemo(() => {
    const byCurrency = new Map<string, { claimed: number; deductible: number }>();
    for (const row of reviewQueue.data) {
      const bucket = byCurrency.get(row.currency) ?? { claimed: 0, deductible: 0 };
      bucket.claimed += row.amount;
      bucket.deductible += row.deductibleAmount ?? row.amount;
      byCurrency.set(row.currency, bucket);
    }
    return Array.from(byCurrency.entries()).map(([currency, totals]) => ({ currency, ...totals }));
  }, [reviewQueue.data]);
  // A deductible expense the DGII will accept must carry the supplier's NCF —
  // surface the ones still missing it so Jeannette can triage them fast.
  const reviewIsMissingNcf = (row: ReviewQueueRow) => !(row.supplierNcf ?? "").trim();
  const reviewAccountOptions = useMemo(() => {
    const labels = Array.from(new Set(reviewQueue.data.map((row) => row.bankAccountLabel))).sort();
    return [
      { value: "", label: t("finance.treasury.filters.allAccounts") },
      ...labels.map((label) => ({ value: label, label })),
    ];
  }, [reviewQueue.data, t]);
  const filteredReviewRows = useMemo(() => {
    const needle = reviewSearch.trim().toLowerCase();
    return reviewQueue.data.filter((row) => {
      if (reviewAccountFilter && row.bankAccountLabel !== reviewAccountFilter) return false;
      if (reviewMissingNcfOnly && !reviewIsMissingNcf(row)) return false;
      if (needle) {
        const haystack = `${row.concept ?? ""} ${row.counterparty ?? ""} ${row.rawDescription ?? ""}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [reviewQueue.data, reviewSearch, reviewAccountFilter, reviewMissingNcfOnly]);
  const reviewMissingNcfCount = useMemo(
    () => reviewQueue.data.filter(reviewIsMissingNcf).length,
    [reviewQueue.data],
  );
  // Render the long queue incrementally so 400+ rows never paint at once.
  useEffect(() => {
    setReviewLimit(40);
  }, [reviewSearch, reviewAccountFilter, reviewMissingNcfOnly]);
  const visibleReviewRows = filteredReviewRows.slice(0, reviewLimit);
  // Each currency gets its own Y axis so small-magnitude USD lines stay readable
  // next to large DOP balances (left axis = first currency, right = second).
  const balanceCurrencies = useMemo(() => {
    const list = Array.from(new Set((snap?.balanceTrendAccounts ?? []).map((account) => account.currency)));
    return list.map((currency, index) => ({
      currency,
      orientation: (index === 0 ? "left" : "right") as "left" | "right",
    }));
  }, [snap?.balanceTrendAccounts]);

  const movementColumns = useMemo(
    () => [
      {
        key: "date",
        label: t("finance.treasury.columns.date"),
        width: 108,
        minWidth: 96,
        render: (row: BankTransactionRow) =>
          editingId === row.id && editDraft ? (
            <input
              className="field-input treasury-table-input"
              onChange={(event) => setEditDraft((draft) => (draft ? { ...draft, txnDate: event.target.value } : draft))}
              type="date"
              value={editDraft.txnDate}
            />
          ) : (
            <span className="treasury-date-chip">{row.txnDate}</span>
          ),
      },
      {
        key: "account",
        label: t("finance.treasury.columns.account"),
        width: 136,
        minWidth: 96,
        render: (row: BankTransactionRow) => (
          <span className="treasury-account-cell" title={row.bankAccountLabel}>
            {row.bankAccountLabel}
          </span>
        ),
      },
      {
        key: "description",
        label: t("finance.treasury.columns.description"),
        width: 320,
        minWidth: 56,
        render: (row: BankTransactionRow) =>
          editingId === row.id && editDraft ? (
            <input
              className="field-input treasury-table-input"
              onChange={(event) =>
                setEditDraft((draft) => (draft ? { ...draft, rawDescription: event.target.value } : draft))
              }
              value={editDraft.rawDescription}
            />
          ) : (
            (() => {
              const suggestion = inferTreasurySuggestion(row);
              const descriptionText = row.annotation?.concept || row.rawDescription || "—";
              const counterpartyText = row.annotation?.counterparty;
              return (
                <div className="cell-stack treasury-description-cell">
                  <span
                    className="treasury-description-primary"
                    data-tooltip={descriptionText}
                    title={descriptionText}
                  >
                    {descriptionText}
                  </span>
                  {row.annotation?.counterparty || row.reference || suggestion ? (
                    <small className="treasury-description-meta">
                      {counterpartyText ? (
                        <span data-tooltip={counterpartyText} title={counterpartyText}>
                          {counterpartyText}
                        </span>
                      ) : null}
                      {row.reference ? (
                        <span data-tooltip={row.reference} title={row.reference}>
                          {row.reference}
                        </span>
                      ) : null}
                      {suggestion ? (
                        <button
                          className={`treasury-suggestion-chip ${kindToneClass(suggestion.kind)}`}
                          data-table-row-action
                          onClick={() => void applySuggestedClassification(row, suggestion)}
                          title={suggestionReason(suggestion)}
                          type="button"
                        >
                          <span>{t("finance.treasury.classify.suggested", { defaultValue: "Suggested" })}</span>
                          <strong>{suggestionLabel(suggestion)}</strong>
                        </button>
                      ) : null}
                    </small>
                  ) : null}
                </div>
              );
            })()
          ),
      },
      {
        key: "amount",
        label: t("finance.treasury.columns.amount"),
        align: "right" as const,
        width: 146,
        minWidth: 104,
        render: (row: BankTransactionRow) =>
          editingId === row.id && editDraft ? (
            <div className="treasury-inline-amount-edit">
              <CompactSelect<TransactionDirection>
                ariaLabel={t("finance.treasury.columns.direction")}
                onChange={(direction) => setEditDraft((draft) => (draft ? { ...draft, direction } : draft))}
                options={[
                  { value: "credit", label: t("finance.treasury.directions.credit") },
                  { value: "debit", label: t("finance.treasury.directions.debit") },
                ]}
                value={editDraft.direction}
              />
              <input
                className="field-input treasury-table-input"
                min={0}
                onChange={(event) =>
                  setEditDraft((draft) => (draft ? { ...draft, amount: Number(event.target.value) || 0 } : draft))
                }
                type="number"
                value={editDraft.amount}
              />
            </div>
          ) : (
            <strong
              className={`treasury-table-amount ${
                row.excludedFromTotals ? "is-muted" : row.direction === "credit" ? "is-positive" : "is-negative"
              }`}
            >
              {row.direction === "credit" ? "+" : "−"}
              {formatMoney(row.amount, row.currency)}
            </strong>
          ),
      },
      {
        key: "kind",
        label: t("finance.treasury.columns.kind"),
        width: 132,
        minWidth: 100,
        render: (row: BankTransactionRow) => (
          <CompactSelect<TransactionKind | "">
            ariaLabel={t("finance.treasury.columns.kind")}
            className={`treasury-kind-select ${kindToneClass(row.annotation?.txnKind)}`}
            onChange={(next) => {
              if (next) classify(row, next);
            }}
            options={kindOptions}
            popupMinWidth={190}
            value={row.annotation?.txnKind ?? ""}
          />
        ),
      },
      {
        key: "actions",
        label: "",
        align: "right" as const,
        width: 58,
        minWidth: 52,
        hideable: false,
        render: (row: BankTransactionRow) =>
          editingId === row.id ? (
            <span className="treasury-row-actions">
              <button
                aria-label={t("common.save", { defaultValue: "Save" })}
                className="icon-ghost-control is-success"
                onClick={() => saveEdit(row)}
                type="button"
              >
                <Check size={13} />
              </button>
              <button
                aria-label={t("common.cancel", { defaultValue: "Cancel" })}
                className="icon-ghost-control"
                onClick={cancelEdit}
                type="button"
              >
                <X size={13} />
              </button>
            </span>
          ) : (
            <button
              className="icon-ghost-control"
              onClick={() => beginEdit(row)}
              aria-label={t("finance.treasury.movements.edit")}
              type="button"
            >
              <Edit3 size={13} />
            </button>
          ),
      },
    ],
    [editDraft, editingId, t],
  );

  return (
    <>
    <div className={`page-stack is-dense${tab === "movements" ? " treasury-page-stack--fill" : ""}`}>
      <input
        accept=".csv,.xlsx,.xls"
        hidden
        onChange={(event) => handleFile(event.target.files?.[0])}
        ref={fileInputRef}
        type="file"
      />

      <div className="page-stack-row treasury-page-header">
        <SectionHeader title={t("finance.treasury.title")} titleTone="accent" compact />
        {canManageAccounts ? (
          <button
            className={`ghost-control treasury-new-account-button${showAccountForm ? " is-active" : ""}`}
            onClick={startNewPaymentInstrument}
            type="button"
          >
            <Plus size={13} />
            <span>{t("finance.treasury.actions.newAccount")}</span>
          </button>
        ) : null}
      </div>

      <div
        className="treasury-segmented-tabs"
        role="tablist"
        style={{ "--treasury-tab-count": treasuryTabs.length, "--treasury-tab-index": treasuryTabs.indexOf(tab) } as CSSProperties}
      >
        <span aria-hidden="true" className="treasury-segmented-tabs-indicator" />
        {treasuryTabs.map((value) => (
          <button
            aria-selected={tab === value}
            className="treasury-segmented-tab"
            key={value}
            onClick={() => setTab(value)}
            role="tab"
            type="button"
          >
            {t(`finance.treasury.tabs.${value}`)}
          </button>
        ))}
      </div>

      {showAccountForm ? (
        <AccountForm
          customBankOptions={customBankOptions}
          initialAccount={editingAccount}
          onCancel={() => {
            setShowAccountForm(false);
            setEditingAccount(null);
          }}
          onSave={savePaymentInstrument}
          userOptions={paymentUserOptions}
        />
      ) : null}

      {tab === "overview" ? (
        <>
          <SurfaceCard className="treasury-hero-card">
            <div className="treasury-hero-topline">
              <div>
                <span className="finance-period-active-pill">{snap?.activePeriodLabel ?? t("finance.treasury.period.fiscal")}</span>
                <h3>{t("finance.treasury.overview.title")}</h3>
              </div>
              <div className="treasury-overview-controls">
                <label className="compact-filter-field treasury-period-picker">
                  <CompactSelect<TreasuryPeriodPreset>
                    ariaLabel={t("finance.treasury.overview.window")}
                    onChange={setPeriod}
                    options={periodOptions}
                    value={period}
                  />
                </label>
                <div className="compact-filter-field treasury-currency-picker">
                  <div aria-label={t("finance.treasury.overview.currency")} className="treasury-chart-toggle" role="group">
                    <span
                      aria-hidden="true"
                      className={`treasury-chart-toggle-indicator is-${overviewCurrency.toLowerCase()}`}
                    />
                    {(["DOP", "USD"] as TreasuryReportCurrency[]).map((currency) => (
                      <button
                        aria-pressed={overviewCurrency === currency}
                        className={overviewCurrency === currency ? "active" : ""}
                        key={currency}
                        onClick={() => setOverviewCurrency(currency)}
                        type="button"
                      >
                        {currency}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  className="ghost-control treasury-overview-export-button"
                  disabled={isExportingOverviewPdf || overview.isLoading}
                  onClick={() => void exportOverviewPdf()}
                  type="button"
                >
                  <FileUp size={13} />
                  <span>
                    {isExportingOverviewPdf
                      ? t("finance.treasury.overview.exportingSummary")
                      : t("finance.treasury.overview.exportSummary")}
                  </span>
                </button>
              </div>
            </div>

            <div className="treasury-kpi-layout">
              <div className="treasury-kpi-primary-grid">
                <dl className="treasury-kpi-tile treasury-kpi-income">
                  <dt className="quotes-summary-tile-label">{t("finance.treasury.kpi.income")}</dt>
                  <dd className="treasury-money-value">
                    {formatSignedTreasuryMoney(snap?.totalIncome ?? 0, moneyCurrency, "positive")}
                  </dd>
                </dl>
                <dl className="treasury-kpi-tile treasury-kpi-expense">
                  <dt className="quotes-summary-tile-label">{t("finance.treasury.kpi.expense")}</dt>
                  <dd className="treasury-money-value">
                    {formatSignedTreasuryMoney(snap?.totalExpense ?? 0, moneyCurrency, "negative")}
                  </dd>
                </dl>
                <dl className="treasury-kpi-tile treasury-kpi-net">
                  <dt className="quotes-summary-tile-label">{t("finance.treasury.kpi.net")}</dt>
                  <dd className="treasury-money-value">{formatSignedTreasuryMoney(snap?.net ?? 0, moneyCurrency)}</dd>
                </dl>
              </div>
              <div className="treasury-kpi-secondary-grid">
                <dl className="treasury-kpi-tile treasury-kpi-secondary treasury-kpi-deductible">
                  <dt className="quotes-summary-tile-label">{t("finance.treasury.kpi.deductible")}</dt>
                  <dd className="treasury-money-value">
                    {formatSignedTreasuryMoney(snap?.totalDeductibleExpense ?? 0, moneyCurrency, "negative")}
                  </dd>
                </dl>
                <dl className="treasury-kpi-tile treasury-kpi-secondary treasury-kpi-neutral">
                  <dt className="quotes-summary-tile-label">{t("finance.treasury.kpi.unclassified")}</dt>
                  <dd className="treasury-money-value">{snap?.unclassifiedCount ?? 0}</dd>
                </dl>
              </div>
            </div>
          </SurfaceCard>

          <div className="treasury-charts-grid">
            <SurfaceCard className="treasury-chart-card">
              <div className="treasury-chart-heading">
                <h2 className="section-subtitle">{t("finance.treasury.overview.flowTitle")}</h2>
                <div className="treasury-flow-legend" aria-label={t("finance.treasury.overview.legend")}>
                  <span><i style={{ background: "#7eb7b2" }} />{t("finance.treasury.kpi.income")}</span>
                  <span><i style={{ background: "#c88d7f" }} />{t("finance.treasury.kpi.expense")}</span>
                  <span><i className="line" />{t("finance.treasury.overview.netLabel")}</span>
                </div>
              </div>
              {snap?.conversionMissingCount ? (
                <p className="treasury-chart-note">
                  {t("finance.treasury.overview.conversionMissing", { count: snap.conversionMissingCount, currency: moneyCurrency })}
                </p>
              ) : null}
              {snap && snap.monthly.length > 0 ? (
                <div className="finance-chart-shell">
                  <ResponsiveContainer height={260} width="100%">
                    <BarChart data={snap.monthly} margin={{ top: 10, right: 12, left: 10, bottom: 2 }}>
                      <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                      <XAxis
                        axisLine={false}
                        dataKey="month"
                        stroke="rgba(255,255,255,0.48)"
                        tick={{ fontSize: 11 }}
                        tickLine={false}
                      />
                      <YAxis
                        axisLine={false}
                        stroke="rgba(255,255,255,0.44)"
                        tick={{ fontSize: 11 }}
                        tickFormatter={(value) => formatAxisCurrency(Number(value), moneyCurrency)}
                        tickLine={false}
                        width={70}
                      />
                      <Tooltip content={<TreasuryChartTooltip currency={moneyCurrency} />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                      <Bar isAnimationActive={chartsAnimated} dataKey="income" fill="#7eb7b2" name={t("finance.treasury.kpi.income")} radius={[8, 8, 0, 0]} />
                      <Bar isAnimationActive={chartsAnimated} dataKey="expense" fill="#c88d7f" name={t("finance.treasury.kpi.expense")} radius={[8, 8, 0, 0]} />
                      <Line isAnimationActive={chartsAnimated}
                        dataKey="net"
                        dot={{ r: 3, fill: "#d6b37a" }}
                        name={t("finance.treasury.overview.netLabel")}
                        stroke="#d6b37a"
                        strokeWidth={2.4}
                        type="monotone"
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <GuidedEmptyState
                  body={t("finance.treasury.overview.flowEmpty")}
                  title={t("finance.treasury.overview.flowTitle")}
                />
              )}
            </SurfaceCard>

            <SurfaceCard className="treasury-chart-card">
              <div className="treasury-chart-heading treasury-chart-heading-solo">
                <h2 className="section-subtitle">{t("finance.treasury.overview.categoryTitle")}</h2>
              </div>
              {snap && categoryChartData.length > 0 ? (
                <div className="finance-chart-shell finance-chart-shell-pie">
                  <div className="finance-category-layout">
                    <div className="finance-donut-wrap">
                      <ResponsiveContainer height="100%" width="100%">
                        <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                          <Pie
                            cx="50%"
                            cy="50%"
                            data={categoryChartData}
                            dataKey="amount"
                            innerRadius="55%"
                            nameKey="label"
                            outerRadius="92%"
                            paddingAngle={1.5}
                            stroke="rgba(15,18,24,0.92)"
                            strokeWidth={2}
                          >
                            {categoryChartData.map((row, index) => (
                              <Cell fill={chartPalette[index % chartPalette.length] ?? "#d6b37a"} key={row.category} />
                            ))}
                          </Pie>
                          <Tooltip content={<TreasuryChartTooltip currency={moneyCurrency} />} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="finance-donut-center">
                        <span>{t("finance.treasury.overview.expenseTotal")}</span>
                        <strong>{formatAxisCurrency(snap.totalExpense, moneyCurrency)}</strong>
                      </div>
                    </div>
                    <div className="finance-pie-legend">
                      {categoryChartData.map((row, index) => (
                        <div className="finance-pie-legend-row" key={row.category}>
                          <span
                            className="finance-pie-legend-swatch"
                            style={{ background: chartPalette[index % chartPalette.length] ?? "#d6b37a" }}
                          />
                          <span className="finance-pie-legend-label">{row.label}</span>
                          <span className="finance-pie-legend-amount">{formatMoney(row.amount, moneyCurrency)}</span>
                          <span className="finance-pie-legend-percent">{row.percentage}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <GuidedEmptyState
                  body={t("finance.treasury.overview.categoryEmpty")}
                  title={t("finance.treasury.overview.categoryTitle")}
                />
              )}
            </SurfaceCard>

            <SurfaceCard className="treasury-chart-card">
              <div className="treasury-chart-heading">
                <h2 className="section-subtitle">{t("finance.treasury.overview.deductibleTitle")}</h2>
                <div className="treasury-flow-legend" aria-label={t("finance.treasury.overview.legend")}>
                  <span><i style={{ background: "#7eb7b2" }} />{t("finance.treasury.overview.deductibleLabel")}</span>
                  <span><i style={{ background: "#5a6072" }} />{t("finance.treasury.overview.nonDeductibleLabel")}</span>
                </div>
              </div>
              {hasDeductibleData ? (
                <div className="finance-chart-shell">
                  <ResponsiveContainer height={260} width="100%">
                    <BarChart data={deductibleChartData} margin={{ top: 10, right: 12, left: 10, bottom: 2 }}>
                      <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                      <XAxis
                        axisLine={false}
                        dataKey="month"
                        stroke="rgba(255,255,255,0.48)"
                        tick={{ fontSize: 11 }}
                        tickLine={false}
                      />
                      <YAxis
                        axisLine={false}
                        stroke="rgba(255,255,255,0.44)"
                        tick={{ fontSize: 11 }}
                        tickFormatter={(value) => formatAxisCurrency(Number(value), moneyCurrency)}
                        tickLine={false}
                        width={70}
                      />
                      <Tooltip content={<TreasuryChartTooltip currency={moneyCurrency} />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                      <Bar isAnimationActive={chartsAnimated} dataKey="deductible" fill="#7eb7b2" name={t("finance.treasury.overview.deductibleLabel")} radius={[0, 0, 0, 0]} stackId="exp" />
                      <Bar isAnimationActive={chartsAnimated} dataKey="nonDeductible" fill="#5a6072" name={t("finance.treasury.overview.nonDeductibleLabel")} radius={[8, 8, 0, 0]} stackId="exp" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <GuidedEmptyState
                  body={t("finance.treasury.overview.deductibleEmpty")}
                  title={t("finance.treasury.overview.deductibleTitle")}
                />
              )}
            </SurfaceCard>
          </div>

          <SurfaceCard className="treasury-chart-card treasury-balance-trend-card">
            <div className="treasury-chart-heading">
              <h2 className="section-subtitle">{t("finance.treasury.overview.balanceTitle")}</h2>
              <div className="treasury-flow-legend" aria-label={t("finance.treasury.overview.legend")}>
                {(snap?.balanceTrendAccounts ?? []).map((account, index) => (
                  <span key={account.accountId}>
                    <i style={{ background: chartPalette[index % chartPalette.length] }} />
                    {account.label} · {account.currency}
                  </span>
                ))}
              </div>
            </div>
            {snap && snap.balanceTrend.length > 0 ? (
              <div className="finance-chart-shell treasury-balance-chart-shell">
                <ResponsiveContainer height={300} width="100%">
                  <LineChart data={snap.balanceTrend} margin={{ top: 24, right: 28, left: 10, bottom: 12 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis
                      axisLine={false}
                      dataKey="month"
                      stroke="rgba(255,255,255,0.48)"
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                    />
                    {balanceCurrencies.map((axis) => (
                      <YAxis
                        axisLine={false}
                        key={axis.currency}
                        orientation={axis.orientation}
                        stroke="rgba(255,255,255,0.44)"
                        tick={{ fontSize: 11 }}
                        tickFormatter={(value) => formatAxisCurrency(Number(value), axis.currency)}
                        tickLine={false}
                        width={70}
                        yAxisId={axis.currency}
                      />
                    ))}
                    <Tooltip content={<TreasuryBalanceTooltip accounts={snap.balanceTrendAccounts} />} />
                    {snap.balanceTrendAccounts.map((account, index) => (
                      <Line isAnimationActive={chartsAnimated}
                        connectNulls
                        dataKey={account.accountId}
                        dot={false}
                        key={account.accountId}
                        name={account.label}
                        stroke={chartPalette[index % chartPalette.length]}
                        strokeWidth={2.2}
                        type="monotone"
                        yAxisId={account.currency}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <GuidedEmptyState
                body={t("finance.treasury.overview.balanceEmpty")}
                title={t("finance.treasury.overview.balanceTitle")}
              />
            )}
          </SurfaceCard>

          <SurfaceCard className="treasury-accounts-card">
            <h2 className="section-subtitle">{t("finance.treasury.accounts.title")}</h2>
            {accounts.data.length === 0 ? (
              <GuidedEmptyState
                body={t("finance.treasury.accounts.emptyBody")}
                title={t("finance.treasury.accounts.emptyTitle")}
              />
            ) : (
              <div className="treasury-account-grid">
                {accounts.data.map((account) => (
                  <button
                    className="treasury-account-tile"
                    key={account.id}
                    onClick={() => openAccount(account.id)}
                    title={t("finance.treasury.accounts.openHint")}
                    type="button"
                  >
                    <span className="treasury-account-heading">
                      <span className="treasury-bank-avatar">
                        {bankLogoByName[account.bankName] ? (
                          <img alt="" src={bankLogoByName[account.bankName]} />
                        ) : (
                          <Banknote size={18} />
                        )}
                      </span>
                      <span>
                        <span className="treasury-account-name">{account.accountLabel}</span>
                        <small>{account.currency} · {t(`finance.treasury.banks.${account.bankName}`, { defaultValue: account.bankName })}</small>
                      </span>
                    </span>
                    <strong className="treasury-account-balance">
                      {formatMoney(account.currentBalance ?? account.openingBalance, account.currency)}
                    </strong>
                    <span className="treasury-account-meta">
                      {t("finance.treasury.accounts.movementCount", { count: account.transactionCount })}
                      <ArrowUpRight size={13} />
                    </span>
                    {canImport ? (
                      <span
                        className="ghost-control"
                        onClick={(event) => {
                          event.stopPropagation();
                          triggerImport(account.id, account.bankName);
                        }}
                        role="button"
                        style={{ marginTop: 8 }}
                      >
                        <Download size={12} />
                        <span>{t("finance.treasury.actions.import")}</span>
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            )}
          </SurfaceCard>
        </>
      ) : null}

      {tab === "accounts" ? (
        <SurfaceCard className="treasury-payment-instruments-card">
          <div className="treasury-payment-instruments-header">
            <div>
              <h2 className="section-subtitle">{t("finance.treasury.accounts.paymentTitle", { defaultValue: "Cuentas y tarjetas" })}</h2>
              <p>
                {t("finance.treasury.accounts.paymentHint", {
                  defaultValue:
                    "Organiza las cuentas, tarjetas y efectivo que usas para pagar facturas. Solo guardamos datos visibles como nombre, moneda y últimos 4 dígitos.",
                })}
              </p>
            </div>
            <div className="treasury-payment-instruments-stats">
              <span>{t("finance.treasury.accounts.activeCount", { defaultValue: "{{count}} activos", count: activeAccounts.length })}</span>
              <span>{t("finance.treasury.accounts.inactiveCount", { defaultValue: "{{count}} inactivos", count: inactiveAccounts.length })}</span>
            </div>
          </div>

          {accounts.isLoading ? (
            <TableSkeleton rows={4} columns={4} />
          ) : accounts.data.length === 0 ? (
            <GuidedEmptyState
              body={t("finance.treasury.accounts.emptyBody")}
              title={t("finance.treasury.accounts.emptyTitle")}
            />
          ) : (
            <div className="treasury-payment-instruments-grid">
              {accounts.data.map((account) => {
                const isCard = account.instrumentKind === "credit_card" || account.instrumentKind === "debit_card";
                const isCashLike = account.instrumentKind === "cash" || account.instrumentKind === "other";
                const terminal = accountTerminal(account);
                return (
                  <article
                    className={`treasury-payment-instrument${account.isActive ? "" : " is-inactive"}`}
                    key={account.id}
                  >
                    <div className="treasury-payment-instrument-top">
                      <span className="treasury-payment-instrument-icon">
                        {isCard ? <CreditCard size={18} /> : isCashLike ? <Wallet size={18} /> : <Landmark size={18} />}
                      </span>
                      <div>
                        <h3>{account.accountLabel}</h3>
                        <p>
                          {instrumentKindLabel(account.instrumentKind)} · {account.currency}
                          {terminal ? (
                            <>
                              {" · "}
                              <span className="treasury-account-terminal">•••• {terminal}</span>
                            </>
                          ) : null}
                        </p>
                      </div>
                      <StatusBadge tone={account.isActive ? "success" : "neutral"}>
                        {account.isActive
                          ? t("finance.treasury.accounts.active", { defaultValue: "Activo" })
                          : t("finance.treasury.accounts.inactive", { defaultValue: "Inactivo" })}
                      </StatusBadge>
                    </div>

                    <dl className="treasury-payment-instrument-meta">
                      <div>
                        <dt>{t("finance.treasury.account.bank")}</dt>
                        <dd>{bankDisplayLabel(account)}</dd>
                      </div>
                      <div>
                        <dt>{t("finance.treasury.account.owner", { defaultValue: "Owner" })}</dt>
                        <dd>{ownerLabel(account.owner)}</dd>
                      </div>
                      <div>
                        <dt>{t("finance.treasury.account.balance", { defaultValue: "Balance" })}</dt>
                        <dd>{formatMoney(account.currentBalance ?? account.openingBalance, account.currency)}</dd>
                      </div>
                      {account.instrumentKind === "bank_account" ? (
                        <div>
                          <dt>{t("finance.treasury.account.accountType", { defaultValue: "Tipo de cuenta" })}</dt>
                          <dd>{accountTypeLabel(account.accountType)}</dd>
                        </div>
                      ) : !isCard ? (
                        <div>
                          <dt>{t("finance.treasury.accounts.movementsLabel", { defaultValue: "Movimientos" })}</dt>
                          <dd>{t("finance.treasury.accounts.movementCountValue", { defaultValue: "{{count}} movimientos", count: account.transactionCount })}</dd>
                        </div>
                      ) : null}
                      {account.instrumentKind === "credit_card" ? (
                        <div>
                          <dt>{t("finance.treasury.account.cardCycle", { defaultValue: "Ciclo tarjeta" })}</dt>
                          <dd>
                            {t("finance.treasury.account.cardCycleValue", {
                              defaultValue: "Corte {{cycle}} · Pago {{due}}",
                              cycle: account.statementCycleDay ?? "—",
                              due: account.paymentDueDay ?? "—",
                            })}
                          </dd>
                        </div>
                      ) : null}
                    </dl>

                    <div className="treasury-payment-instrument-actions">
                      <button className="ghost-control" onClick={() => openAccount(account.id)} type="button">
                        <ArrowUpRight size={13} />
                        {t("finance.treasury.accounts.openMovements", { defaultValue: "Movimientos" })}
                      </button>
                      {canImport && account.isActive ? (
                        <button
                          className="ghost-control"
                          onClick={() => triggerImport(account.id, account.bankName)}
                          type="button"
                        >
                          <FileUp size={13} />
                          {t("finance.treasury.actions.import")}
                        </button>
                      ) : null}
                      {canManageAccounts ? (
                        <button className="ghost-control" onClick={() => startEditPaymentInstrument(account)} type="button">
                          <Edit3 size={13} />
                          {t("common.edit", { defaultValue: "Editar" })}
                        </button>
                      ) : null}
                      {canManageAccounts && account.isActive ? (
                        <button
                          className="ghost-control treasury-danger-control treasury-payment-instrument-deactivate"
                          disabled={deactivatingAccountId === account.id}
                          onClick={() => deactivatePaymentInstrument(account)}
                          type="button"
                        >
                          <Trash2 size={13} />
                          {deactivatingAccountId === account.id
                            ? t("common.saving", { defaultValue: "Guardando..." })
                            : t("finance.treasury.account.deactivate", { defaultValue: "Desactivar" })}
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </SurfaceCard>
      ) : null}

      {tab === "movements" ? (
        <SurfaceCard className="treasury-detail-card">
          <div className="treasury-movements-header">
            <div className="treasury-movements-title-stack">
              <h3>{t("finance.treasury.movements.title")}</h3>
              <div className="treasury-movements-meta">
                <span>
                  {selectedAccount
                    ? `${selectedAccount.currency} · ${t(`finance.treasury.banks.${selectedAccount.bankName}`, { defaultValue: selectedAccount.bankName })}`
                    : t("finance.treasury.filters.allAccounts")}
                </span>
                <span>{t("finance.treasury.accounts.movementCount", { count: visibleMovements.length })}</span>
                {unclassifiedOnly ? <span>{t("finance.treasury.filters.unclassified")}</span> : null}
                {suggestedOnly ? <span>{t("finance.treasury.filters.suggested")}</span> : null}
              </div>
            </div>
            <div className="treasury-movement-actions">
              <button
                className="ghost-control treasury-undo-button"
                disabled={isUndoingTreasuryAction || !undoPreview.data}
                onClick={() => void undoLastTreasuryAction()}
                title={
                  undoPreview.data
                    ? t("finance.treasury.undo.hintWithLabel", {
                        defaultValue: "Undo {{label}}",
                        label: undoPreview.data.label,
                      })
                    : t("finance.treasury.undo.empty", { defaultValue: "No Treasury change to undo" })
                }
                type="button"
              >
                <RotateCcw size={13} />
                <span>
                  {isUndoingTreasuryAction
                    ? t("common.saving")
                    : undoPreview.data
                      ? t("finance.treasury.undo.actionWithLabel", {
                          defaultValue: "Undo: {{label}}",
                          label: undoPreview.data.label,
                        })
                      : t("finance.treasury.undo.action", { defaultValue: "Undo" })}
                </span>
              </button>
              <button
                className="ghost-control treasury-add-movement-button"
                disabled={accounts.data.length === 0}
                onClick={() => setShowManualForm((value) => !value)}
                type="button"
              >
                <Plus size={13} />
                <span>{t("finance.treasury.actions.addRow")}</span>
              </button>
              {canImport ? (
                <button
                  className="ghost-control treasury-import-button"
                  disabled={accounts.data.length === 0 || busy}
                  onClick={() => {
                    const account = accounts.data.find((a) => a.id === accountFilter) ?? accounts.data[0];
                    if (account) triggerImport(account.id, account.bankName);
                  }}
                  type="button"
                >
                  <Download size={13} />
                  <span>{t("finance.treasury.actions.import")}</span>
                </button>
              ) : null}
            </div>
          </div>

          {showManualForm ? (
            <ManualTransactionForm
              accounts={accounts.data}
              defaultAccountId={accountFilter || accounts.data[0]?.id || ""}
              onCancel={() => setShowManualForm(false)}
              onSave={async (draft) => {
                try {
                  await mutations.addManualTransactions({
                    commandId: newCommandId("treasury-manual"),
                    workspaceId: activeWorkspaceId,
                    actorType: "user",
                    sourceChannel: "desktop",
                    bankAccountId: draft.bankAccountId,
                    sourceFormat: "manual",
                    rows: [
                      {
                        txnDate: draft.txnDate,
                        rawDescription: draft.rawDescription,
                        reference: draft.reference || null,
                        amount: draft.amount,
                        direction: draft.direction,
                      },
                    ],
                    notes: "Manual treasury row.",
                  });
                  toast.success(t("finance.treasury.movements.added"));
                  setShowManualForm(false);
                  refreshAll();
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : t("finance.treasury.movements.addFailed"));
                }
              }}
            />
          ) : null}

          {imports.data.length > 0 ? (
            <div className={`treasury-import-history${importHistoryOpen ? " is-open" : ""}`}>
              <button
                className="treasury-import-history-header"
                onClick={() => setImportHistoryOpen((value) => !value)}
                type="button"
              >
                <span className="treasury-import-history-title">{t("finance.treasury.imports.title")}</span>
                <small className="text-muted">
                  {t("finance.treasury.imports.summary", {
                    inserted: importTotals.inserted,
                    duplicates: importTotals.duplicates,
                  })}
                </small>
                <span className="treasury-import-history-toggle">
                  <ChevronDown size={14} />
                </span>
              </button>
              {importHistoryOpen ? (
                <>
                  <small className="text-muted treasury-import-history-note">{t("finance.treasury.imports.dedupeHint")}</small>
                  <div className="treasury-import-list">
                    {imports.data.map((batch) => (
                      <div
                        className="treasury-import-row"
                        key={batch.id}
                      >
                        <div className="cell-stack">
                          <strong>{batch.originalFilename || batch.sourceFormat.toUpperCase()}</strong>
                          <small className="text-muted">
                            {batch.periodStart
                              ? t("finance.treasury.imports.period", {
                                  start: batch.periodStart,
                                  end: batch.periodEnd ?? "?",
                                })
                              : t("finance.treasury.imports.noPeriod")}
                            {" · "}
                            {t("finance.treasury.imports.created", { date: batch.createdAt.slice(0, 10) })}
                          </small>
                        </div>
                        <div className="treasury-import-stats">
                          <span>{t("finance.treasury.imports.inserted", { count: batch.insertedCount })}</span>
                          <span>{t("finance.treasury.imports.duplicates", { count: batch.duplicateCount })}</span>
                        </div>
                        <button
                          className="icon-ghost-control"
                          onClick={() => setPendingImportDelete(batch.id)}
                          title={t("finance.treasury.imports.delete")}
                          type="button"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          <div className="treasury-table-shell">
            <div className="treasury-table-toolbar">
              <div className="treasury-table-search-wrap">
                <Search aria-hidden="true" size={14} />
                <input
                  className="field-input treasury-table-search"
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t("finance.treasury.searchPlaceholder")}
                  value={search}
                />
              </div>
              <div className="treasury-table-filter-group">
                <label className="compact-filter-field treasury-table-filter-select">
                  <CompactSelect<string>
                    ariaLabel={t("finance.treasury.filters.account")}
                    onChange={setAccountFilter}
                    options={accountOptions}
                    popupMinWidth={240}
                    value={accountFilter}
                  />
                </label>
                <label className="compact-filter-field treasury-table-filter-select">
                  <CompactSelect<MovementDateFilter>
                    ariaLabel={t("finance.treasury.filters.period")}
                    onChange={setDateFilter}
                    options={dateFilterOptions}
                    popupMinWidth={180}
                    value={dateFilter}
                  />
                </label>
                {dateFilter !== "all" ? (
                  <>
                    <label className="compact-filter-field treasury-table-date-filter">
                      <span>{t("finance.treasury.filters.from")}</span>
                      <input className="field-input" onChange={(event) => setDateFrom(event.target.value)} type="date" value={dateFrom} />
                    </label>
                    <label className="compact-filter-field treasury-table-date-filter">
                      <span>{t("finance.treasury.filters.to")}</span>
                      <input
                        className="field-input"
                        min={dateFrom || undefined}
                        onChange={(event) => setDateTo(event.target.value)}
                        type="date"
                        value={dateTo}
                      />
                    </label>
                  </>
                ) : null}
                <label className="compact-filter-field treasury-unclassified-toggle">
                  <input
                    checked={unclassifiedOnly}
                    onChange={(event) => setUnclassifiedOnly(event.target.checked)}
                    type="checkbox"
                  />
                  <span>{t("finance.treasury.filters.unclassified")}</span>
                </label>
                <label className="compact-filter-field treasury-unclassified-toggle treasury-suggested-toggle">
                  <input
                    checked={suggestedOnly}
                    onChange={(event) => setSuggestedOnly(event.target.checked)}
                    type="checkbox"
                  />
                  <span>{t("finance.treasury.filters.suggested")}</span>
                </label>
              </div>
            </div>

          {selectedMovements.length > 0 ? (
            <div className="treasury-bulk-classify-bar" role="status">
              <div className="treasury-bulk-classify-copy">
                <strong>
                  {t("finance.treasury.classify.selectedCount", {
                    count: selectedMovements.length,
                    defaultValue: "{{count}} selected",
                  })}
                </strong>
                <span>
                  {t("finance.treasury.classify.bulkHint", {
                    defaultValue: "Apply one Type to the selected movements.",
                  })}
                </span>
              </div>
              <div className="treasury-bulk-classify-actions">
                <CompactSelect<TransactionKind | "">
                  ariaLabel={t("finance.treasury.columns.kind")}
                  className={`treasury-kind-select treasury-bulk-kind-select ${kindToneClass(bulkKind || null)}`}
                  onChange={setBulkKind}
                  options={kindOptions}
                  popupMinWidth={190}
                  value={bulkKind}
                />
                <button
                  className="ghost-control treasury-bulk-apply-button"
                  disabled={!bulkKind || isBulkClassifying}
                  onClick={() => void applyBulkClassification()}
                  type="button"
                >
                  <Check size={13} />
                  <span>
                    {isBulkClassifying
                      ? t("common.saving")
                      : t("finance.treasury.classify.applyBulk", { defaultValue: "Apply type" })}
                  </span>
                </button>
                {selectedMovements.length === 1 && bulkKind ? (
                  <button
                    className="ghost-control treasury-similar-apply-button"
                    disabled={isBulkClassifying}
                    onClick={() => void previewSimilarClassification(selectedMovements[0], bulkKind)}
                    type="button"
                  >
                    <Search size={13} />
                    <span>
                      {t("finance.treasury.classify.reviewSimilar", { defaultValue: "Review similar" })}
                    </span>
                  </button>
                ) : null}
                <button
                  className="ghost-control"
                  disabled={isBulkClassifying}
                  onClick={() => {
                    setSelectedMovementIds([]);
                    setBulkKind("");
                  }}
                  type="button"
                >
                  <X size={13} />
                  <span>{t("common.cancel")}</span>
                </button>
              </div>
            </div>
          ) : null}

          {transactions.isLoading && transactions.data.length === 0 ? (
            <TableSkeleton rows={6} />
          ) : visibleMovements.length === 0 ? (
            <GuidedEmptyState
              body={
                suggestedOnly
                  ? t("finance.treasury.movements.noSuggestedBody")
                  : t("finance.treasury.movements.emptyBody")
              }
              title={
                suggestedOnly
                  ? t("finance.treasury.movements.noSuggestedTitle")
                  : t("finance.treasury.movements.emptyTitle")
              }
            />
          ) : (
            <DataTable<BankTransactionRow>
              activeRowId={activeMovementId}
              autoScrollToActiveRow
              columns={movementColumns}
              fillRemainingColumnKey="actions"
              fitToColumnWidths
              getRowId={(row) => row.id}
              // Flex-fill the movements card's remaining height (pure CSS, no
              // measurement) so only the table scrolls and the page never gets
              // an external scrollbar. The parent chain is bounded by the shell.
              fillParent
              onSelectedRowIdsChange={setSelectedMovementIds}
              persistKey="treasury-movements-v3"
              rows={visibleMovements}
              selectable
              selectedRowIds={selectedMovementIds}
            />
          )}
          {transactions.error ? <div className="form-inline-error">{transactions.error}</div> : null}
          </div>
        </SurfaceCard>
      ) : null}

      {tab === "review" ? (
        <SurfaceCard className="treasury-review-card">
          <div className="treasury-review-header">
            <div className="cell-stack">
              <h2 className="section-subtitle">{t("finance.treasury.review.title")}</h2>
              <small className="text-muted">{t("finance.treasury.review.subtitle")}</small>
            </div>
            {reviewQueue.data.length > 0 || (deductibleLedger.data?.totalsByCurrency.length ?? 0) > 0 ? (
              <div className="treasury-review-summary">
                <div className="treasury-review-summary-tile">
                  <span>{t("finance.treasury.review.summaryPending")}</span>
                  <strong>{reviewQueue.data.length}</strong>
                </div>
                {reviewSummary.map((summary) => (
                  <div className="treasury-review-summary-tile" key={summary.currency}>
                    <span>{t("finance.treasury.review.summaryClaimed")} · {summary.currency}</span>
                    <strong>{formatMoney(summary.claimed, summary.currency)}</strong>
                    <small className="text-muted">
                      {t("finance.treasury.review.summaryDeductible", {
                        value: formatMoney(summary.deductible, summary.currency),
                      })}
                    </small>
                  </div>
                ))}
                {deductibleLedger.data?.totalsByCurrency.map((summary) => (
                  <div className="treasury-review-summary-tile" key={`ledger-${summary.currency}`}>
                    <span>{t("finance.treasury.review.ledgerDeductible", { defaultValue: "Ledger deductible" })} · {summary.currency}</span>
                    <strong>{formatMoney(summary.deductibleAmount, summary.currency)}</strong>
                    <small className="text-muted">
                      {t("finance.treasury.review.ledgerClaimed", {
                        defaultValue: "Claimed {{value}}",
                        value: formatMoney(summary.claimedAmount, summary.currency),
                      })}
                    </small>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          {reviewQueue.data.length === 0 ? (
            <GuidedEmptyState
              body={t("finance.treasury.review.emptyBody")}
              title={t("finance.treasury.review.emptyTitle")}
            />
          ) : (
            <>
              <div className="treasury-review-toolbar">
                {canExport ? (
                <div className="treasury-review-export-row">
                  <div className="treasury-review-export-group">
                    <span className="treasury-review-export-label">
                      {t("finance.treasury.review.ledgerGroup", { defaultValue: "Ledger deducible" })}
                    </span>
                    <CompactSelect<TreasuryPeriodPreset>
                      ariaLabel={t("finance.treasury.overview.window")}
                      onChange={setDeductibleLedgerPeriod}
                      options={periodOptions}
                      popupMinWidth={170}
                      value={deductibleLedgerPeriod}
                    />
                    <CompactSelect<TreasuryDeductibleLedgerExportFormat>
                      ariaLabel={t("finance.treasury.review.ledgerFormat", { defaultValue: "Formato del ledger" })}
                      onChange={setDeductibleLedgerFormat}
                      options={exportFormatOptions}
                      popupMinWidth={120}
                      value={deductibleLedgerFormat}
                    />
                    <button
                      className="ghost-control treasury-ledger-export-button"
                      disabled={isExportingDeductibleLedger || deductibleLedger.isLoading}
                      onClick={() => void exportDeductibleLedger()}
                      type="button"
                    >
                      <FileDown size={13} />
                      <span>
                        {isExportingDeductibleLedger
                          ? t("finance.treasury.review.exportingLedger", { defaultValue: "Exportando..." })
                          : t("finance.treasury.review.exportLedger", { defaultValue: "Exportar ledger" })}
                      </span>
                    </button>
                  </div>
                  <div className="treasury-review-export-group">
                    <span className="treasury-review-export-label">
                      {t("finance.treasury.review.dgiiGroup", { defaultValue: "Reportes DGII" })}
                    </span>
                    <CompactSelect<DgiiReportKind>
                      ariaLabel={t("finance.treasury.review.dgiiReport", { defaultValue: "Reporte DGII" })}
                      onChange={setDgiiReportKind}
                      options={dgiiReportOptions}
                      popupMinWidth={140}
                      value={dgiiReportKind}
                    />
                    <CompactSelect<DgiiReportExportFormat>
                      ariaLabel={t("finance.treasury.review.dgiiFormat", { defaultValue: "Formato DGII" })}
                      onChange={setDgiiReportFormat}
                      options={exportFormatOptions}
                      popupMinWidth={120}
                      value={dgiiReportFormat}
                    />
                    <button
                      className="ghost-control treasury-dgii-export-button"
                      disabled={isExportingDgiiReport}
                      onClick={() => void exportDgiiReport()}
                      type="button"
                    >
                      <FileDown size={13} />
                      <span>
                        {isExportingDgiiReport
                          ? t("finance.treasury.review.exportingDgii", { defaultValue: "Exportando..." })
                          : t("finance.treasury.review.exportDgii", { defaultValue: "Exportar DGII" })}
                      </span>
                    </button>
                  </div>
                </div>
                ) : null}
                <div className="treasury-review-filter-row">
                  <input
                    className="field-input treasury-review-search"
                    onChange={(event) => setReviewSearch(event.target.value)}
                    placeholder={t("finance.treasury.review.searchPlaceholder", { defaultValue: "Search concept or supplier" })}
                    value={reviewSearch}
                  />
                  <CompactSelect<string>
                    ariaLabel={t("finance.treasury.filters.account")}
                    onChange={setReviewAccountFilter}
                    options={reviewAccountOptions}
                    popupMinWidth={220}
                    value={reviewAccountFilter}
                  />
                  <button
                    className={`ghost-control treasury-review-ncf-filter${reviewMissingNcfOnly ? " is-active" : ""}`}
                    onClick={() => setReviewMissingNcfOnly((value) => !value)}
                    type="button"
                  >
                    {t("finance.treasury.review.missingNcfFilter", { defaultValue: "Missing NCF" })}
                    {reviewMissingNcfCount > 0 ? <span className="treasury-review-ncf-count">{reviewMissingNcfCount}</span> : null}
                  </button>
                  <span className="treasury-review-count text-muted">
                    {t("finance.treasury.review.showing", {
                      defaultValue: "{{shown}} of {{total}}",
                      shown: filteredReviewRows.length,
                      total: reviewQueue.data.length,
                    })}
                  </span>
                  <button
                    className="ghost-control treasury-review-bulk-accept"
                    disabled={filteredReviewRows.length === 0 || isBulkAccepting}
                    onClick={() => setBulkAcceptOpen(true)}
                    type="button"
                  >
                    <Check size={13} />
                    {t("finance.treasury.review.acceptAllVisible", { defaultValue: "Accept all visible" })}
                  </button>
                </div>
              </div>
              {filteredReviewRows.length === 0 ? (
                <GuidedEmptyState
                  body={t("finance.treasury.review.noMatchesBody", { defaultValue: "No movements match the current filters." })}
                  title={t("finance.treasury.review.noMatchesTitle", { defaultValue: "No matches" })}
                />
              ) : (
                <div className="treasury-review-list">
                  {visibleReviewRows.map((row) => (
                    <ReviewRow
                      key={row.transactionId}
                      missingNcf={reviewIsMissingNcf(row)}
                      onApply={applyReview}
                      row={row}
                      t={t}
                    />
                  ))}
                  {filteredReviewRows.length > visibleReviewRows.length ? (
                    <button
                      className="ghost-control treasury-review-load-more"
                      onClick={() => setReviewLimit((value) => value + 40)}
                      type="button"
                    >
                      {t("finance.treasury.review.loadMore", {
                        defaultValue: "Show more ({{remaining}})",
                        remaining: filteredReviewRows.length - visibleReviewRows.length,
                      })}
                    </button>
                  ) : null}
                </div>
              )}
            </>
          )}
        </SurfaceCard>
      ) : null}

      {tab === "invoices" ? (
        <InvoiceInboxPanel workspaceId={activeWorkspaceId} formatMoney={formatMoney} onOpenMovement={openMovement} />
      ) : null}

      {tab === "projects" ? (
        <SurfaceCard>
          <h2 className="section-subtitle">{t("finance.treasury.projects.title")}</h2>
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
                  render: (row) => formatMoney(row.income),
                },
                {
                  key: "expense",
                  label: t("finance.treasury.kpi.expense"),
                  align: "right" as const,
                  render: (row) => formatMoney(row.expense),
                },
                {
                  key: "net",
                  label: t("finance.treasury.kpi.net"),
                  align: "right" as const,
                  render: (row) => formatMoney(row.net),
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

    </div>
    {pendingStatementImport ? (
      <StatementImportPreviewDialog
        accountLabel={accounts.data.find((account) => account.id === pendingStatementImport.bankAccountId)?.accountLabel ?? ""}
        currency={accounts.data.find((account) => account.id === pendingStatementImport.bankAccountId)?.currency ?? "DOP"}
        importPreview={pendingStatementImport.preview}
        isSubmitting={isConfirmingStatementImport}
        onCancel={() => setPendingStatementImport(null)}
        onConfirm={() => void confirmStatementImport()}
      />
    ) : null}
    <ConfirmDialog
      body={t("finance.treasury.classify.applySimilarBody", {
        defaultValue:
          "There are {{count}} unclassified movements with the same description. Applying this will classify them as {{kind}} and remember the rule for future imports.",
        kind: pendingRule ? kindLabel(pendingRule.kind) : "",
        count: pendingRule?.preview.matchCount ?? 0,
      })}
      cancelLabel={t("finance.treasury.classify.onlyThis", { defaultValue: "Only this one" })}
      confirmLabel={t("finance.treasury.classify.applySimilar", { defaultValue: "Apply to all" })}
      details={
        pendingRule ? (
          <div className="treasury-similar-preview">
            <div className="treasury-similar-preview-stat">
              <strong>{pendingRule.preview.matchCount}</strong>
              <span>{t("finance.treasury.classify.unclassifiedMatches", { defaultValue: "unclassified matches" })}</span>
            </div>
            <div className="treasury-similar-preview-pattern">
              <span className="confirm-dialog-details-label">
                {t("finance.treasury.classify.matchPattern", { defaultValue: "Exact match" })}
              </span>
              <strong>{pendingRule.preview.matchPattern}</strong>
            </div>
            {pendingRule.preview.sampleDescriptions.length > 0 ? (
              <ul className="treasury-similar-preview-list">
                {pendingRule.preview.sampleDescriptions.slice(0, 3).map((description) => (
                  <li key={description}>{description}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null
      }
      isOpen={Boolean(pendingRule)}
      isSubmitting={isApplyingRule}
      onCancel={() => void applyPendingRule(false)}
      onConfirm={() => void applyPendingRule(true)}
      title={t("finance.treasury.classify.applySimilarTitle", { defaultValue: "Apply to similar movements" })}
    />
    <ConfirmDialog
      body={t("finance.treasury.imports.confirmDelete")}
      cancelLabel={t("common.cancel", { defaultValue: "Cancel" })}
      confirmLabel={t("finance.treasury.imports.delete", { defaultValue: "Delete" })}
      tone="danger"
      isOpen={Boolean(pendingImportDelete)}
      isSubmitting={isDeletingImport}
      onCancel={() => setPendingImportDelete(null)}
      onConfirm={() => void confirmRemoveImport()}
      title={t("finance.treasury.imports.confirmDeleteTitle", { defaultValue: "Delete import batch" })}
    />
    <ConfirmDialog
      body={t("finance.treasury.review.bulkAcceptBody", {
        defaultValue: "Mark all {{count}} visible movements as fully deductible? Existing fiscal data is kept.",
        count: filteredReviewRows.length,
      })}
      cancelLabel={t("common.cancel", { defaultValue: "Cancel" })}
      confirmLabel={t("finance.treasury.review.acceptAllVisible", { defaultValue: "Accept all visible" })}
      isOpen={bulkAcceptOpen}
      isSubmitting={isBulkAccepting}
      onCancel={() => setBulkAcceptOpen(false)}
      onConfirm={() => void confirmBulkAccept()}
      title={t("finance.treasury.review.bulkAcceptTitle", { defaultValue: "Accept all visible" })}
    />
    </>
  );
};

/* ------------------------------------------------------------------------- */
/* Subcomponents                                                             */
/* ------------------------------------------------------------------------- */

type AccountDraft = {
  bankName: BankName;
  accountLabel: string;
  accountNumberMasked: string;
  currency: string;
  accountType: BankAccountType | null;
  owner: PaymentInstrumentOwner;
  ownerUserId: string;
  ownerUserNameSnapshot: string;
  instrumentKind: PaymentInstrumentKind;
  last4: string;
  issuer: string;
  statementCycleDay: number | null;
  paymentDueDay: number | null;
  reminderUserId: string;
  openingBalance: number;
  notes: string;
};

type ManualTransactionDraft = {
  bankAccountId: string;
  txnDate: string;
  rawDescription: string;
  reference: string;
  amount: number;
  direction: TransactionDirection;
};

const StatementImportPreviewDialog = ({
  accountLabel,
  currency,
  importPreview,
  isSubmitting,
  onCancel,
  onConfirm,
}: {
  accountLabel: string;
  currency: string;
  importPreview: StatementImportPreview;
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) => {
  const { t } = useTranslation();
  const sampleRows = importPreview.rows.slice(0, 80);
  const duplicateRows = importPreview.rows.filter((row) => row.status !== "new").slice(0, 6);
  const hasNewRows = importPreview.newCount > 0;

  return (
    <ModalShell
      backdropClassName="compare-dialog-backdrop"
      className="treasury-import-preview-dialog"
      onClose={isSubmitting ? () => undefined : onCancel}
      width={1040}
    >
      <div className="treasury-import-preview-header">
        <div>
          <span className="finance-kicker">
            {t("finance.treasury.importPreview.kicker", { defaultValue: "Previsualización de importación" })}
          </span>
          <h2>{t("finance.treasury.importPreview.title", { defaultValue: "Revisar estado de cuenta" })}</h2>
          <p>
            {importPreview.originalFilename || importPreview.sourceFormat.toUpperCase()} · {accountLabel || importPreview.bankAccountId}
          </p>
        </div>
        <button className="icon-ghost-control" type="button" onClick={onCancel} disabled={isSubmitting} aria-label="Close">
          <X size={16} />
        </button>
      </div>

      <div className="treasury-import-preview-stats">
        <div className="treasury-import-preview-stat is-new">
          <span>{t("finance.treasury.importPreview.new", { defaultValue: "Nuevos" })}</span>
          <strong>{importPreview.newCount}</strong>
        </div>
        <div className="treasury-import-preview-stat is-duplicate">
          <span>{t("finance.treasury.importPreview.duplicates", { defaultValue: "Duplicados" })}</span>
          <strong>{importPreview.duplicateCount}</strong>
        </div>
        <div className="treasury-import-preview-stat">
          <span>{t("finance.treasury.importPreview.total", { defaultValue: "Filas leídas" })}</span>
          <strong>{importPreview.rowCount}</strong>
        </div>
        <div className="treasury-import-preview-stat">
          <span>{t("finance.treasury.importPreview.period", { defaultValue: "Período" })}</span>
          <strong>
            {importPreview.periodStart
              ? `${importPreview.periodStart} → ${importPreview.periodEnd ?? "?"}`
              : t("finance.treasury.imports.noPeriod", { defaultValue: "Sin período" })}
          </strong>
        </div>
      </div>

      {duplicateRows.length > 0 ? (
        <div className="treasury-import-preview-alert">
          <strong>{t("finance.treasury.importPreview.duplicateTitle", { defaultValue: "Duplicados detectados" })}</strong>
          <span>
            {t("finance.treasury.importPreview.duplicateBody", {
              defaultValue:
                "Estos movimientos no se volverán a insertar. El sistema importará solamente las filas nuevas y conservará intacto el historial existente.",
            })}
          </span>
        </div>
      ) : null}

      <div className="treasury-import-preview-table">
        <div className="treasury-import-preview-row is-head">
          <span>{t("finance.treasury.columns.date", { defaultValue: "Fecha" })}</span>
          <span>{t("finance.treasury.columns.description", { defaultValue: "Descripción" })}</span>
          <span>{t("finance.treasury.columns.amount", { defaultValue: "Monto" })}</span>
          <span>{t("finance.treasury.importPreview.status", { defaultValue: "Estado" })}</span>
        </div>
        {sampleRows.map((row) => (
          <div className="treasury-import-preview-row" key={`${row.dedupeHash}-${row.rowIndex}`}>
            <span>{row.txnDate}</span>
            <span title={row.rawDescription ?? ""}>{row.rawDescription || row.reference || "—"}</span>
            <span>{formatSignedTreasuryMoney(row.direction === "credit" ? row.amount : -row.amount, currency)}</span>
            <span>
              <StatusBadge tone={row.status === "new" ? "success" : "warning"}>
                {
                  row.status === "new"
                    ? t("finance.treasury.importPreview.statusNew", { defaultValue: "Nuevo" })
                    : row.status === "file_duplicate"
                      ? t("finance.treasury.importPreview.statusFileDuplicate", { defaultValue: "Duplicado en archivo" })
                      : t("finance.treasury.importPreview.statusDuplicate", { defaultValue: "Ya existe" })
                }
              </StatusBadge>
            </span>
          </div>
        ))}
      </div>

      <div className="treasury-import-preview-footer">
        <button className="ghost-control" type="button" onClick={onCancel} disabled={isSubmitting}>
          {t("common.cancel", { defaultValue: "Cancelar" })}
        </button>
        <button
          className="action-primary-button"
          type="button"
          onClick={onConfirm}
          disabled={!hasNewRows || isSubmitting}
        >
          <UploadCloud size={15} />
          <span>
            {isSubmitting
              ? t("finance.treasury.importPreview.importing", { defaultValue: "Importando..." })
              : t("finance.treasury.importPreview.confirm", {
                  defaultValue: "Importar {{count}} nuevo(s)",
                  count: importPreview.newCount,
                })}
          </span>
        </button>
      </div>
    </ModalShell>
  );
};

const ManualTransactionForm = ({
  accounts,
  defaultAccountId,
  onCancel,
  onSave,
}: {
  accounts: BankAccountRow[];
  defaultAccountId: string;
  onCancel: () => void;
  onSave: (draft: ManualTransactionDraft) => void;
}) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<ManualTransactionDraft>({
    bankAccountId: defaultAccountId,
    txnDate: new Date().toISOString().slice(0, 10),
    rawDescription: "",
    reference: "",
    amount: 0,
    direction: "debit",
  });
  const accountOptions = useMemo(
    () => accounts.map((account) => ({ value: account.id, label: `${account.accountLabel} · ${account.currency}` })),
    [accounts],
  );
  const directionOptions = useMemo(
    () => [
      { value: "credit" as const, label: t("finance.treasury.directions.credit") },
      { value: "debit" as const, label: t("finance.treasury.directions.debit") },
    ],
    [t],
  );

  return (
    <SurfaceCard className="treasury-manual-form-card">
      <div className="treasury-manual-form-grid">
        <label className="compact-filter-field treasury-manual-account">
          <span>{t("finance.treasury.filters.account")}</span>
          <CompactSelect<string>
            ariaLabel={t("finance.treasury.filters.account")}
            onChange={(bankAccountId) => setDraft((current) => ({ ...current, bankAccountId }))}
            options={accountOptions}
            popupMinWidth={240}
            value={draft.bankAccountId}
          />
        </label>
        <label className="compact-filter-field treasury-manual-date">
          <span>{t("finance.treasury.columns.date")}</span>
          <input
            className="field-input"
            onChange={(event) => setDraft((current) => ({ ...current, txnDate: event.target.value }))}
            type="date"
            value={draft.txnDate}
          />
        </label>
        <label className="compact-filter-field treasury-manual-direction">
          <span>{t("finance.treasury.columns.direction")}</span>
          <CompactSelect<TransactionDirection>
            ariaLabel={t("finance.treasury.columns.direction")}
            onChange={(direction) => setDraft((current) => ({ ...current, direction }))}
            options={directionOptions}
            value={draft.direction}
          />
        </label>
        <label className="compact-filter-field treasury-manual-amount">
          <span>{t("finance.treasury.columns.amount")}</span>
          <input
            className="field-input"
            min={0}
            onChange={(event) => setDraft((current) => ({ ...current, amount: Number(event.target.value) || 0 }))}
            type="number"
            value={draft.amount}
          />
        </label>
        <label className="compact-filter-field treasury-manual-description">
          <span>{t("finance.treasury.columns.description")}</span>
          <input
            className="field-input"
            onChange={(event) => setDraft((current) => ({ ...current, rawDescription: event.target.value }))}
            value={draft.rawDescription}
          />
        </label>
        <label className="compact-filter-field treasury-manual-reference">
          <span>{t("finance.treasury.columns.reference")}</span>
          <input
            className="field-input"
            onChange={(event) => setDraft((current) => ({ ...current, reference: event.target.value }))}
            value={draft.reference}
          />
        </label>
        <div className="treasury-account-form-actions">
          <button
            className="ghost-control treasury-action-save"
            disabled={!draft.bankAccountId || !draft.txnDate || !draft.rawDescription.trim() || draft.amount <= 0}
            onClick={() => onSave(draft)}
            type="button"
          >
            <Check size={13} />
            {t("finance.treasury.actions.addRow")}
          </button>
          <button className="ghost-control treasury-action-cancel" onClick={onCancel} type="button">
            <X size={13} />
            {t("common.cancel", { defaultValue: "Cancel" })}
          </button>
        </div>
      </div>
    </SurfaceCard>
  );
};

const AccountForm = ({
  customBankOptions,
  initialAccount,
  onCancel,
  onSave,
  userOptions,
}: {
  customBankOptions: Array<{ value: BankOptionValue; label: string }>;
  initialAccount?: BankAccountRow | null;
  onCancel: () => void;
  onSave: (draft: AccountDraft) => void;
  userOptions: Array<{ value: string; label: string }>;
}) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<AccountDraft>({
    bankName: initialAccount?.bankName ?? "popular",
    accountLabel: initialAccount?.accountLabel ?? "",
    accountNumberMasked: initialAccount?.accountNumberMasked ?? "",
    currency: initialAccount?.currency ?? "DOP",
    accountType: initialAccount?.accountType ?? "checking",
    owner: initialAccount?.owner ?? "company",
    ownerUserId: initialAccount?.ownerUserId ?? "",
    ownerUserNameSnapshot: initialAccount?.ownerUserNameSnapshot ?? "",
    instrumentKind: initialAccount?.instrumentKind ?? "bank_account",
    last4: initialAccount?.last4 ?? "",
    issuer: initialAccount?.issuer ?? "",
    statementCycleDay: initialAccount?.statementCycleDay ?? null,
    paymentDueDay: initialAccount?.paymentDueDay ?? null,
    reminderUserId: initialAccount?.reminderUserId ?? "",
    openingBalance: initialAccount?.openingBalance ?? 0,
    notes: initialAccount?.notes ?? "",
  });
  const isCreditCard = draft.instrumentKind === "credit_card";
  const isDebitCard = draft.instrumentKind === "debit_card";
  const isCard = isCreditCard || isDebitCard;
  const isBankAccount = draft.instrumentKind === "bank_account";
  const isCash = draft.instrumentKind === "cash";
  const needsResponsibleUser = draft.owner === "user" || draft.owner === "shared";
  const needsReminderUser = isCreditCard && !draft.ownerUserId.trim();
  const bankOptions = useMemo(
    () => {
      const options = [
        ...bankNames.map((name) => ({
          value: name as BankOptionValue,
          label: t(`finance.treasury.banks.${name}`, { defaultValue: name }),
        })),
        ...customBankOptions,
      ];
      if (draft.bankName === "custom" && draft.issuer && !options.some((option) => option.value === `custom:${draft.issuer}`)) {
        options.push({ value: `custom:${draft.issuer}` as const, label: draft.issuer });
      }
      return options;
    },
    [customBankOptions, draft.bankName, draft.issuer, t],
  );
  const selectedBankOption = draft.bankName === "custom" && draft.issuer ? (`custom:${draft.issuer}` as const) : draft.bankName;
  const currencyOptions = useMemo(
    () => [
      { value: "DOP", label: "DOP" },
      { value: "USD", label: "USD" },
      { value: "EUR", label: "EUR" },
    ],
    [],
  );
  const accountTypeOptions = useMemo(
    () => [
      { value: "checking" as const, label: t("finance.treasury.accountTypes.checking", { defaultValue: "Corriente" }) },
      { value: "savings" as const, label: t("finance.treasury.accountTypes.savings", { defaultValue: "Ahorro" }) },
      { value: "other" as const, label: t("finance.treasury.accountTypes.other", { defaultValue: "Otra" }) },
    ],
    [t],
  );
  const instrumentKindOptions = useMemo(
    () => [
      { value: "bank_account" as const, label: t("finance.treasury.instrumentKinds.bank_account", { defaultValue: "Cuenta bancaria" }) },
      { value: "debit_card" as const, label: t("finance.treasury.instrumentKinds.debit_card", { defaultValue: "Tarjeta débito" }) },
      { value: "credit_card" as const, label: t("finance.treasury.instrumentKinds.credit_card", { defaultValue: "Tarjeta crédito" }) },
      { value: "cash" as const, label: t("finance.treasury.instrumentKinds.cash", { defaultValue: "Efectivo" }) },
      { value: "other" as const, label: t("finance.treasury.instrumentKinds.other", { defaultValue: "Otro" }) },
    ],
    [t],
  );
  const ownerOptions = useMemo(
    () => [
      { value: "company" as const, label: t("finance.treasury.owners.company", { defaultValue: "Empresa" }) },
      { value: "user" as const, label: t("finance.treasury.owners.user", { defaultValue: "Usuario" }) },
      { value: "shared" as const, label: t("finance.treasury.owners.shared", { defaultValue: "Compartido" }) },
    ],
    [t],
  );
  const dayValue = (value: number | null) => (value == null ? "" : String(value));
  const parseDay = (value: string) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 31) return null;
    return parsed;
  };
  const canSave =
    draft.accountLabel.trim().length > 0 &&
    (!isCreditCard || (draft.statementCycleDay != null && draft.paymentDueDay != null)) &&
    (!needsResponsibleUser || draft.ownerUserId.trim().length > 0) &&
    (!needsReminderUser || draft.reminderUserId.trim().length > 0);
  const resolvedUserOptions = useMemo(() => {
    const options = [...userOptions];
    for (const value of [draft.ownerUserId, draft.reminderUserId]) {
      if (value && !options.some((option) => option.value === value)) {
        options.push({ value, label: value });
      }
    }
    return options;
  }, [draft.ownerUserId, draft.reminderUserId, userOptions]);

  return (
    <SurfaceCard className="treasury-account-form-card">
      <div className="treasury-account-form-heading">
        <div>
          <h3>{initialAccount ? t("finance.treasury.account.editTitle", { defaultValue: "Editar medio de pago" }) : t("finance.treasury.account.newTitle", { defaultValue: "Nuevo medio de pago" })}</h3>
          <p>{t("finance.treasury.account.safeHint", { defaultValue: "Guarda solo metadata operativa. No introduzcas números completos de cuenta o tarjeta." })}</p>
        </div>
        <span className="treasury-security-pill">{t("finance.treasury.account.noSensitiveData", { defaultValue: "Sin datos sensibles" })}</span>
      </div>
      <div className="treasury-account-form-grid">
        <label className="compact-filter-field">
          <span>{t("finance.treasury.account.instrumentKind", { defaultValue: "Tipo" })}</span>
          <CompactSelect<PaymentInstrumentKind>
            ariaLabel={t("finance.treasury.account.instrumentKind", { defaultValue: "Tipo" })}
            onChange={(instrumentKind) =>
              setDraft((d) => ({
                ...d,
                instrumentKind,
                bankName: instrumentKind === "cash" ? "custom" : d.bankName,
                accountType: instrumentKind === "bank_account" ? d.accountType ?? "checking" : "other",
                statementCycleDay: instrumentKind === "credit_card" ? d.statementCycleDay : null,
                paymentDueDay: instrumentKind === "credit_card" ? d.paymentDueDay : null,
                reminderUserId: instrumentKind === "credit_card" ? d.reminderUserId : "",
              }))
            }
            options={instrumentKindOptions}
            value={draft.instrumentKind}
          />
        </label>
        {!isCash ? (
          <label className="compact-filter-field">
            <span>{t("finance.treasury.account.bank")}</span>
            <CompactSelect<BankOptionValue>
              ariaLabel={t("finance.treasury.account.bank")}
              onChange={(bankOption) =>
                setDraft((d) =>
                  bankOption.startsWith("custom:")
                    ? { ...d, bankName: "custom", issuer: bankOption.slice("custom:".length) }
                    : { ...d, bankName: bankOption as BankName, issuer: bankOption === "custom" ? d.issuer : "" },
                )
              }
              options={bankOptions}
              value={selectedBankOption}
            />
          </label>
        ) : null}
        {!isCash && draft.bankName === "custom" ? (
          <label className="compact-filter-field">
            <span>{t("finance.treasury.account.customBankName", { defaultValue: "Nombre del banco" })}</span>
            <input
              className="field-input"
              onChange={(event) => setDraft((d) => ({ ...d, issuer: event.target.value }))}
              placeholder={t("finance.treasury.account.customBankPlaceholder", { defaultValue: "Ej. BHD, Banreservas..." })}
              value={draft.issuer}
            />
          </label>
        ) : null}
        <label className="compact-filter-field">
          <span>{t("finance.treasury.account.label")}</span>
          <input
            className="field-input"
            onChange={(event) => setDraft((d) => ({ ...d, accountLabel: event.target.value }))}
            placeholder={isCash ? t("finance.treasury.account.cashLabelPlaceholder", { defaultValue: "Caja chica, efectivo..." }) : undefined}
            value={draft.accountLabel}
          />
        </label>
        <label className="compact-filter-field">
          <span>{t("finance.treasury.account.currency")}</span>
          <CompactSelect<string>
            ariaLabel={t("finance.treasury.account.currency")}
            onChange={(currency) => setDraft((d) => ({ ...d, currency }))}
            options={currencyOptions}
            value={draft.currency}
          />
        </label>
        {isBankAccount ? (
          <label className="compact-filter-field">
            <span>{t("finance.treasury.account.accountType", { defaultValue: "Cuenta" })}</span>
            <CompactSelect<BankAccountType>
              ariaLabel={t("finance.treasury.account.accountType", { defaultValue: "Cuenta" })}
              onChange={(accountType) => setDraft((d) => ({ ...d, accountType }))}
              options={accountTypeOptions}
              value={draft.accountType ?? "other"}
            />
          </label>
        ) : null}
        <label className="compact-filter-field">
          <span>{t("finance.treasury.account.owner", { defaultValue: "Uso" })}</span>
          <CompactSelect<PaymentInstrumentOwner>
            ariaLabel={t("finance.treasury.account.owner", { defaultValue: "Uso" })}
            onChange={(owner) => setDraft((d) => ({ ...d, owner, ownerUserId: owner === "company" ? "" : d.ownerUserId }))}
            options={ownerOptions}
            value={draft.owner}
          />
        </label>
        {needsResponsibleUser ? (
          <label className="compact-filter-field">
            <span>{t("finance.treasury.account.ownerUserId", { defaultValue: "Responsable" })}</span>
            <CompactSelect<string>
              ariaLabel={t("finance.treasury.account.ownerUserId", { defaultValue: "Responsable" })}
              onChange={(ownerUserId) => setDraft((d) => ({ ...d, ownerUserId }))}
              options={resolvedUserOptions}
              value={draft.ownerUserId}
            />
          </label>
        ) : null}
        {isCard ? (
          <>
            <label className="compact-filter-field">
              <span>{t("finance.treasury.account.last4", { defaultValue: "Terminal (últimos 4)" })}</span>
              <input
                className="field-input"
                inputMode="numeric"
                maxLength={4}
                onChange={(event) => setDraft((d) => ({ ...d, last4: event.target.value.replace(/\D/g, "").slice(0, 4) }))}
                placeholder="1234"
                value={draft.last4}
              />
            </label>
            <label className="compact-filter-field">
              <span>{t("finance.treasury.account.issuer", { defaultValue: "Emisor" })}</span>
              <input
                className="field-input"
                onChange={(event) => setDraft((d) => ({ ...d, issuer: event.target.value }))}
                placeholder="Visa, Mastercard..."
                value={draft.issuer}
              />
            </label>
          </>
        ) : null}
        {isBankAccount ? (
          <label className="compact-filter-field">
            <span>{t("finance.treasury.account.masked", { defaultValue: "Número visible" })}</span>
            <input
              className="field-input"
              onChange={(event) => setDraft((d) => ({ ...d, accountNumberMasked: event.target.value }))}
              placeholder="•••• 1234"
              value={draft.accountNumberMasked}
            />
          </label>
        ) : null}
        {isCreditCard ? (
          <>
            <label className="compact-filter-field">
              <span>{t("finance.treasury.account.statementCycleDay", { defaultValue: "Día de corte" })}</span>
              <input
                className="field-input"
                max={31}
                min={1}
                onChange={(event) => setDraft((d) => ({ ...d, statementCycleDay: parseDay(event.target.value) }))}
                placeholder={t("common.required", { defaultValue: "Requerido" })}
                type="number"
                value={dayValue(draft.statementCycleDay)}
              />
            </label>
            <label className="compact-filter-field">
              <span>{t("finance.treasury.account.paymentDueDay", { defaultValue: "Día de pago" })}</span>
              <input
                className="field-input"
                max={31}
                min={1}
                onChange={(event) => setDraft((d) => ({ ...d, paymentDueDay: parseDay(event.target.value) }))}
                placeholder={t("common.required", { defaultValue: "Requerido" })}
                type="number"
                value={dayValue(draft.paymentDueDay)}
              />
            </label>
            {needsReminderUser ? (
              <label className="compact-filter-field">
                <span>{t("finance.treasury.account.reminderUserId", { defaultValue: "Recordatorio para" })}</span>
                <CompactSelect<string>
                  ariaLabel={t("finance.treasury.account.reminderUserId", { defaultValue: "Recordatorio para" })}
                  onChange={(reminderUserId) => setDraft((d) => ({ ...d, reminderUserId }))}
                  options={resolvedUserOptions}
                  value={draft.reminderUserId}
                />
              </label>
            ) : null}
          </>
        ) : null}
        <label className="compact-filter-field">
          <span>{t("finance.treasury.account.openingBalance")}</span>
          <input
            className="field-input"
            onChange={(event) => setDraft((d) => ({ ...d, openingBalance: Number(event.target.value) || 0 }))}
            type="number"
            value={draft.openingBalance}
          />
        </label>
        <label className="compact-filter-field treasury-account-notes-field">
          <span>{t("finance.treasury.account.notes", { defaultValue: "Notas" })}</span>
          <input
            className="field-input"
            onChange={(event) => setDraft((d) => ({ ...d, notes: event.target.value }))}
            value={draft.notes}
          />
        </label>
        <div className="treasury-account-form-actions">
          <button
            className="ghost-control treasury-action-save"
            disabled={!canSave}
            onClick={() => onSave(draft)}
            type="button"
          >
            <Check size={13} />
            {t("common.save", { defaultValue: "Save" })}
          </button>
          <button className="ghost-control treasury-action-cancel" onClick={onCancel} type="button">
            <X size={13} />
            {t("common.cancel", { defaultValue: "Cancel" })}
          </button>
        </div>
      </div>
    </SurfaceCard>
  );
};

const ReviewRow = ({
  row,
  onApply,
  missingNcf = false,
  t,
}: {
  row: ReviewQueueRow;
  onApply: (row: ReviewQueueRow, deductible: number, fiscalDraft: FiscalReviewDraft) => void;
  missingNcf?: boolean;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) => {
  // The deductible can never exceed the expense itself (DGII can only accept up
  // to the claimed amount) and is never negative — clamp on entry.
  const clampDeductible = (value: number) => Math.min(Math.max(value, 0), row.amount);
  // Display the deductible with thousands separators (consistent with the rest
  // of the app) while keeping a numeric source of truth. A bare number input
  // can't render commas, so we use a text input with parse/format.
  const formatDeductible = (value: number) =>
    value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const parseDeductible = (text: string) => {
    const cleaned = text.replace(/[^0-9.]/g, "");
    const value = Number.parseFloat(cleaned);
    return Number.isFinite(value) ? value : 0;
  };
  const [deductible, setDeductible] = useState<number>(clampDeductible(row.deductibleAmount ?? row.amount));
  const [deductibleText, setDeductibleText] = useState<string>(() =>
    formatDeductible(clampDeductible(row.deductibleAmount ?? row.amount)),
  );
  const [fiscalDraft, setFiscalDraft] = useState<FiscalReviewDraft>({
    supplierNcf: row.supplierNcf ?? "",
    dgiiExpenseType: normalizeDgiiCode(row.dgiiExpenseType),
    withholdingType: normalizeDgiiCode(row.withholdingType),
    withholdingRate: row.withholdingRate == null ? "" : String(row.withholdingRate),
    withholdingAmount: row.withholdingAmount == null ? "" : String(row.withholdingAmount),
    fiscalPeriod: row.fiscalPeriod ?? row.txnDate.slice(0, 7),
  });
  const [recentExpenseTypes, setRecentExpenseTypes] = useState<string[]>(() => readRecentDgiiOptions(recentDgiiExpenseTypeKey));
  const [recentWithholdingTypes, setRecentWithholdingTypes] = useState<string[]>(() =>
    readRecentDgiiOptions(recentDgiiWithholdingTypeKey),
  );
  const baseExpenseValues = useMemo(() => new Set(dgiiExpenseTypeOptions.map((option) => option.value)), []);
  const baseWithholdingValues = useMemo(() => new Set(dgiiWithholdingTypeOptions.map((option) => option.value)), []);
  const [manualExpenseType, setManualExpenseType] = useState(() =>
    Boolean(fiscalDraft.dgiiExpenseType && !baseExpenseValues.has(fiscalDraft.dgiiExpenseType)),
  );
  const [manualWithholdingType, setManualWithholdingType] = useState(() =>
    Boolean(fiscalDraft.withholdingType && !baseWithholdingValues.has(fiscalDraft.withholdingType)),
  );
  const currentValueLabel = t("finance.treasury.review.currentValue", { defaultValue: "valor actual" });
  const recentValueLabel = t("finance.treasury.review.recentValue", { defaultValue: "Usado recientemente" });
  const expenseTypeOptions = buildDgiiOptions(
    dgiiExpenseTypeOptions,
    recentExpenseTypes,
    fiscalDraft.dgiiExpenseType,
    currentValueLabel,
    t("finance.treasury.review.otherManual", { defaultValue: "Otros · escribir manualmente" }),
    recentValueLabel,
  );
  const withholdingTypeOptions = buildDgiiOptions(
    dgiiWithholdingTypeOptions,
    recentWithholdingTypes,
    fiscalDraft.withholdingType,
    currentValueLabel,
    t("finance.treasury.review.otherManual", { defaultValue: "Otros · escribir manualmente" }),
    recentValueLabel,
  );
  const updateFiscalDraft = (patch: Partial<FiscalReviewDraft>) => setFiscalDraft((current) => ({ ...current, ...patch }));
  const rememberDgiiSelection = (kind: "expense" | "withholding", value: string) => {
    const key = kind === "expense" ? recentDgiiExpenseTypeKey : recentDgiiWithholdingTypeKey;
    pushRecentDgiiOption(key, value);
    const next = readRecentDgiiOptions(key);
    if (kind === "expense") setRecentExpenseTypes(next);
    else setRecentWithholdingTypes(next);
  };
  const handleApply = (nextDeductible: number) => {
    rememberDgiiSelection("expense", fiscalDraft.dgiiExpenseType);
    rememberDgiiSelection("withholding", fiscalDraft.withholdingType);
    onApply(row, nextDeductible, fiscalDraft);
  };
  const hasFiscalData = Boolean(
    row.supplierNcf || row.withholdingType || row.withholdingAmount != null || row.dgiiExpenseType,
  );
  const [fiscalOpen, setFiscalOpen] = useState(hasFiscalData);
  const hasConcept = Boolean(row.concept && row.rawDescription && row.concept !== row.rawDescription);
  const resultTone = deductible >= row.amount ? "success" : deductible > 0 ? "warning" : "critical";
  const resultLabel =
    deductible >= row.amount
      ? t("finance.treasury.review.statusAccepted")
      : deductible > 0
        ? t("finance.treasury.review.statusPartial")
        : t("finance.treasury.review.statusRejected");
  const deductiblePct = row.amount > 0 ? Math.round((deductible / row.amount) * 100) : 0;
  const rejected = Math.max(Math.round((row.amount - deductible + Number.EPSILON) * 100) / 100, 0);
  return (
    <div className={`treasury-review-row is-${resultTone}`}>
      <div className="treasury-review-row-head">
        <div className="treasury-review-row-main">
          <div className="treasury-review-row-title">
            <strong>{row.concept || row.rawDescription || "—"}</strong>
            <StatusBadge tone={resultTone}>{resultLabel}</StatusBadge>
            {missingNcf && deductible > 0 ? (
              <span className="treasury-review-missing-ncf">
                {t("finance.treasury.review.missingNcfFlag", { defaultValue: "Missing NCF" })}
              </span>
            ) : null}
          </div>
          <small className="text-muted">
            {row.txnDate} · {row.bankAccountLabel}
            {row.counterparty ? ` · ${row.counterparty}` : ""}
          </small>
          {hasConcept ? <small className="text-muted treasury-review-raw">{row.rawDescription}</small> : null}
          <div
            aria-hidden="true"
            className="treasury-review-ratio"
            title={t("finance.treasury.review.ratioHint", { pct: deductiblePct })}
          >
            <span className={`treasury-review-ratio-fill is-${resultTone}`} style={{ width: `${deductiblePct}%` }} />
          </div>
          <div className="treasury-review-ratio-legend">
            <span>
              {t("finance.treasury.review.claimed")} <strong>{formatTreasuryMoney(row.amount, row.currency)}</strong>
            </span>
            <span className="is-deductible">
              {t("finance.treasury.review.deductible")} <strong>{formatTreasuryMoney(deductible, row.currency)}</strong> · {deductiblePct}%
            </span>
            {rejected > 0 ? (
              <span className="is-rejected">
                {t("finance.treasury.review.rejected")} <strong>{formatTreasuryMoney(rejected, row.currency)}</strong>
              </span>
            ) : null}
          </div>
        </div>
        <div className="treasury-review-row-edit">
          <label className="compact-filter-field treasury-review-deductible">
            <span>
              {t("finance.treasury.review.deductible")} · {currencySuffix(row.currency)}
            </span>
            <input
              className="field-input"
              inputMode="decimal"
              onChange={(event) => {
                setDeductibleText(event.target.value);
                setDeductible(clampDeductible(parseDeductible(event.target.value)));
              }}
              onBlur={() => setDeductibleText(formatDeductible(clampDeductible(parseDeductible(deductibleText))))}
              onFocus={(event) => event.target.select()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  const value = clampDeductible(parseDeductible(deductibleText));
                  setDeductible(value);
                  setDeductibleText(formatDeductible(value));
                  handleApply(value);
                }
              }}
              title={t("finance.treasury.review.saveHint", { defaultValue: "Press Enter to save" })}
              type="text"
              value={deductibleText}
            />
          </label>
          <div className="treasury-review-row-actions">
            <button
              aria-label={t("finance.treasury.review.acceptRowHint", { defaultValue: "Aceptar esta fila al 100%" })}
              className="ghost-control treasury-review-row-action is-accept"
              onClick={() => {
                setDeductible(row.amount);
                setDeductibleText(formatDeductible(row.amount));
                handleApply(row.amount);
              }}
              title={t("finance.treasury.review.acceptRowHint", { defaultValue: "Aceptar esta fila al 100%" })}
              type="button"
            >
              <Check size={13} />
              {t("finance.treasury.review.acceptFull")}
            </button>
            <button
              className="ghost-control treasury-review-row-action is-reject"
              onClick={() => {
                setDeductible(0);
                setDeductibleText(formatDeductible(0));
                handleApply(0);
              }}
              type="button"
            >
              <X size={13} />
              {t("finance.treasury.review.reject")}
            </button>
            <button className="ghost-control treasury-review-row-action is-save" onClick={() => handleApply(deductible)} type="button">
              <Check size={13} />
              {t("finance.treasury.review.apply")}
            </button>
          </div>
        </div>
      </div>

      <div className={`treasury-review-fiscal${fiscalOpen ? " is-open" : ""}`}>
        <button
          aria-expanded={fiscalOpen}
          className="treasury-review-fiscal-toggle"
          onClick={() => setFiscalOpen((value) => !value)}
          type="button"
        >
          <ChevronDown size={14} />
          <span>{t("finance.treasury.review.fiscalSection", { defaultValue: "DGII fiscal data" })}</span>
          {!fiscalOpen && fiscalDraft.supplierNcf ? (
            <small className="treasury-review-fiscal-hint">{fiscalDraft.supplierNcf}</small>
          ) : null}
          {!fiscalOpen && Number(fiscalDraft.withholdingAmount) > 0 ? (
            <small className="treasury-review-fiscal-hint">
              {t("finance.treasury.review.withholdingShort", { defaultValue: "withholding" })}
            </small>
          ) : null}
        </button>
        {fiscalOpen ? (
          <div className="treasury-review-fiscal-grid">
            <label className="compact-filter-field treasury-review-fiscal-field">
              <span>{t("finance.treasury.review.ncf", { defaultValue: "Supplier NCF" })}</span>
              <input
                className="field-input"
                onChange={(event) => updateFiscalDraft({ supplierNcf: event.target.value })}
                placeholder="B0100000000"
                value={fiscalDraft.supplierNcf}
              />
            </label>
            <label className="compact-filter-field treasury-review-fiscal-field">
              <span>{t("finance.treasury.review.dgiiType", { defaultValue: "DGII expense type" })}</span>
              {manualExpenseType ? (
                <div className="treasury-review-manual-field">
                  <input
                    className="field-input"
                    onChange={(event) => updateFiscalDraft({ dgiiExpenseType: event.target.value })}
                    placeholder={t("finance.treasury.review.manualTypePlaceholder", { defaultValue: "Escribir tipo" })}
                    value={fiscalDraft.dgiiExpenseType}
                  />
                  <button
                    className="ghost-control treasury-review-manual-toggle"
                    onClick={() => {
                      setManualExpenseType(false);
                      updateFiscalDraft({ dgiiExpenseType: "" });
                    }}
                    type="button"
                  >
                    {t("finance.treasury.review.useList", { defaultValue: "Lista" })}
                  </button>
                </div>
              ) : (
                <CompactSelect<string>
                  ariaLabel={t("finance.treasury.review.dgiiType", { defaultValue: "DGII expense type" })}
                  onChange={(value) => {
                    if (value === DGII_OTHER_OPTION) {
                      setManualExpenseType(true);
                      updateFiscalDraft({ dgiiExpenseType: "" });
                      return;
                    }
                    rememberDgiiSelection("expense", value);
                    updateFiscalDraft({ dgiiExpenseType: value });
                  }}
                  options={expenseTypeOptions}
                  popupMinWidth={360}
                  value={fiscalDraft.dgiiExpenseType}
                />
              )}
            </label>
            <label className="compact-filter-field treasury-review-fiscal-field">
              <span>{t("finance.treasury.review.period", { defaultValue: "Period" })}</span>
              <input
                className="field-input"
                onChange={(event) => updateFiscalDraft({ fiscalPeriod: event.target.value })}
                placeholder="2026-05"
                value={fiscalDraft.fiscalPeriod}
              />
            </label>
            <label className="compact-filter-field treasury-review-fiscal-field">
              <span>{t("finance.treasury.review.withholdingType", { defaultValue: "Withholding type" })}</span>
              {manualWithholdingType ? (
                <div className="treasury-review-manual-field">
                  <input
                    className="field-input"
                    onChange={(event) => updateFiscalDraft({ withholdingType: event.target.value })}
                    placeholder={t("finance.treasury.review.manualTypePlaceholder", { defaultValue: "Escribir tipo" })}
                    value={fiscalDraft.withholdingType}
                  />
                  <button
                    className="ghost-control treasury-review-manual-toggle"
                    onClick={() => {
                      setManualWithholdingType(false);
                      updateFiscalDraft({ withholdingType: "" });
                    }}
                    type="button"
                  >
                    {t("finance.treasury.review.useList", { defaultValue: "Lista" })}
                  </button>
                </div>
              ) : (
                <CompactSelect<string>
                  ariaLabel={t("finance.treasury.review.withholdingType", { defaultValue: "Withholding type" })}
                  onChange={(value) => {
                    if (value === DGII_OTHER_OPTION) {
                      setManualWithholdingType(true);
                      updateFiscalDraft({ withholdingType: "" });
                      return;
                    }
                    rememberDgiiSelection("withholding", value);
                    updateFiscalDraft({ withholdingType: value });
                  }}
                  options={withholdingTypeOptions}
                  popupMinWidth={420}
                  value={fiscalDraft.withholdingType}
                />
              )}
            </label>
            <label className="compact-filter-field treasury-review-fiscal-field">
              <span>{t("finance.treasury.review.withholdingRate", { defaultValue: "Withholding %" })}</span>
              <input
                className="field-input"
                min={0}
                onChange={(event) => updateFiscalDraft({ withholdingRate: event.target.value })}
                type="number"
                value={fiscalDraft.withholdingRate}
              />
            </label>
            <label className="compact-filter-field treasury-review-fiscal-field">
              <span>{t("finance.treasury.review.withholdingAmount", { defaultValue: "Withholding amount" })}</span>
              <input
                className="field-input"
                min={0}
                onChange={(event) => updateFiscalDraft({ withholdingAmount: event.target.value })}
                type="number"
                value={fiscalDraft.withholdingAmount}
              />
            </label>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default TreasuryPage;
