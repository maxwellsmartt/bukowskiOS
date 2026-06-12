import { RefreshCw, Upload } from "lucide-react";
import type { TFunction } from "i18next";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useChartAnimationsEnabled } from "@shared/hooks/useChartAnimations";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type {
  CurrencyRateSource,
  ExchangeRateRow,
  FinanceOverviewPeriodPreset,
  FinanceOverviewQuery,
  TreasuryOverviewQuery,
} from "@contracts";
import { useToast } from "@app/providers/ToastProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { GuidedEmptyState } from "@shared/components/GuidedEmptyState";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { TableSkeleton } from "@shared/components/TableSkeleton";
import { useLocale } from "@shared/hooks/useLocale";
import { usePersistentState } from "@shared/hooks/usePersistentState";
import { getUserFacingErrorMessage } from "@shared/lib/errors";
import { notifyExportResult } from "@shared/lib/exportNotifications";
import bancoCentralLogo from "@shared/assets/inbox/logos/banco-central-logo.png";
import bancoPopularLogo from "@shared/assets/inbox/logos/banco popular dominicano-logo.jpg";
import bancoSantaCruzLogo from "@shared/assets/inbox/logos/banco santa cruz-logo.png";

import { exportFinanceReportPdf, useCollaboratorFeeSummary, useFinanceOverview } from "./useFinanceData";
import { useTreasuryOverview } from "./useTreasuryData";
import { refreshCurrencyRates, useCurrencyRateProviderStatus, useExchangeRates } from "./useCurrencyData";
import { newCommandId } from "./quoteHelpers";

const periodOptions: Array<{ labelKey: string; value: FinanceOverviewPeriodPreset }> = [
  { labelKey: "finance.overview.periods.month", value: "month" },
  { labelKey: "finance.overview.periods.quarter", value: "quarter" },
  { labelKey: "finance.overview.periods.year", value: "year" },
  { labelKey: "finance.overview.periods.custom", value: "custom" },
];

const chartPalette = ["#d6b37a", "#7eb7b2", "#92a7c1", "#c88d7f", "#a29cd8", "#8ca772"];
const fxRefreshIntervalMs = 30 * 60 * 1000;
const isTasaRealAuthError = (message: string) =>
  /TasaReal API key is invalid|no longer authorized|TasaReal refresh failed \((?:401|403)\)/i.test(message);
const exchangeRateInstitutions: Array<{ label: string; logo: string; source: CurrencyRateSource }> = [
  { label: "Banco Popular", logo: bancoPopularLogo, source: "banco_popular" },
  { label: "Banco Central", logo: bancoCentralLogo, source: "banco_central" },
  { label: "Banco Santa Cruz", logo: bancoSantaCruzLogo, source: "banco_santa_cruz" },
];

const formatAxisCurrency = (value: number, currency = "$") => {
  const prefix = currency === "$" ? "$" : `${currency} `;
  if (value >= 1_000_000) {
    return `${prefix}${(value / 1_000_000).toFixed(1)}M`;
  }

  if (value >= 1_000) {
    return `${prefix}${(value / 1_000).toFixed(0)}k`;
  }

  return `${prefix}${Math.round(value)}`;
};

const normalizeCategoryKey = (value: string) => value.trim().replace(/\s+/g, "_").toLowerCase();

const formatRateValue = (value: number | null) => (typeof value === "number" ? value.toFixed(2) : "—");

const formatSummaryMoney = (value: number, currency: string) =>
  `${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`;

const RATE_TIMESTAMP_FORMAT: Intl.DateTimeFormatOptions = {
  dateStyle: "medium",
  timeStyle: "short",
};

const RATE_TREND_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: "short",
  month: "short",
  day: "numeric",
};

const dayBucketIso = (value: number) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
};

const nextLocalMidnightIso = () => {
  const next = new Date();
  next.setDate(next.getDate() + 1);
  next.setHours(0, 0, 0, 0);
  return next.toISOString();
};

const readRateLimitBlock = (key: string) => {
  const saved = window.localStorage.getItem(key);
  if (!saved) return null;
  const blockedUntilMs = new Date(saved).getTime();
  if (!blockedUntilMs || blockedUntilMs <= Date.now()) {
    window.localStorage.removeItem(key);
    return null;
  }
  return saved;
};

const findLatestRate = (
  rows: ExchangeRateRow[],
  source: CurrencyRateSource,
  rateType: ExchangeRateRow["rateType"],
  baseCurrency: string,
) =>
  rows.find(
    (row) =>
      row.source === source &&
      row.baseCurrency === baseCurrency &&
      row.quoteCurrency === "DOP" &&
      row.rateType === rateType,
  ) ?? null;

const findDecisionRate = (rows: ExchangeRateRow[], source: CurrencyRateSource, baseCurrency: string) =>
  findLatestRate(rows, source, "buy", baseCurrency) ??
  findLatestRate(rows, source, "average", baseCurrency) ??
  findLatestRate(rows, source, "manual", baseCurrency) ??
  rows.find((row) => row.source === source && row.baseCurrency === baseCurrency && row.quoteCurrency === "DOP") ??
  null;

const rateSourceLabel = (source: CurrencyRateSource) =>
  exchangeRateInstitutions.find((institution) => institution.source === source)?.label ?? source;

const rateSourceColor = (source: CurrencyRateSource) => {
  if (source === "banco_popular") return "#7eb7b2";
  if (source === "banco_central") return "#d6b37a";
  if (source === "banco_santa_cruz") return "#92a7c1";
  return "#c88d7f";
};

const getRateDisplayCopy = (source: CurrencyRateSource, baseCurrency: "USD" | "EUR", t: TFunction) => {
  if (source === "banco_central" && baseCurrency === "EUR") {
    return {
      buyLabel: t("finance.overview.exchange.reference"),
      sellLabel: t("finance.overview.exchange.sell"),
      missingSellLabel: t("finance.overview.exchange.notPublished"),
      meta: t("finance.overview.exchange.bcrdEurNote"),
    };
  }

  return {
    buyLabel: t("finance.overview.exchange.buy"),
    sellLabel: t("finance.overview.exchange.sell"),
    missingSellLabel: "—",
    meta: null,
  };
};

const RateChartTooltip = ({
  active,
  label,
  payload,
}: {
  active?: boolean;
  label?: string;
  payload?: Array<{ color?: string; dataKey?: string; value?: number | string }>;
}) => {
  if (!active || !payload?.length) return null;

  return (
    <div className="finance-chart-tooltip">
      {label ? <strong>{label}</strong> : null}
      {payload.map((entry) => (
        <div key={`${entry.dataKey}-${entry.color}`} className="finance-chart-tooltip-row">
          <span className="finance-chart-tooltip-dot" style={{ background: entry.color ?? "rgba(255,255,255,0.6)" }} />
          <span>
            {rateSourceLabel(entry.dataKey as CurrencyRateSource)} ·{" "}
            {typeof entry.value === "number" ? entry.value.toFixed(2) : String(entry.value ?? "—")}
          </span>
        </div>
      ))}
    </div>
  );
};

const ChartTooltip = ({
  active,
  currency,
  label,
  payload,
}: {
  active?: boolean;
  label?: string;
  currency?: string;
  payload?: Array<{ color?: string; dataKey?: string; value?: number | string; payload?: Record<string, unknown> }>;
}) => {
  if (!active || !payload?.length) {
    return null;
  }

  return (
    <div className="finance-chart-tooltip">
      {label ? <strong>{label}</strong> : null}
      {payload.map((entry) => (
        <div key={`${entry.dataKey}-${entry.color}`} className="finance-chart-tooltip-row">
          <span className="finance-chart-tooltip-dot" style={{ background: entry.color ?? "rgba(255,255,255,0.6)" }} />
          <span>{typeof entry.value === "number" ? formatAxisCurrency(entry.value, currency) : String(entry.value ?? "—")}</span>
        </div>
      ))}
    </div>
  );
};

export const FinanceOverviewPage = () => {
  const { t } = useTranslation();
  const chartsAnimated = useChartAnimationsEnabled();
  const { activeWorkspaceId } = useWorkspace();
  const toast = useToast();
  const { formatDate } = useLocale();
  const formatRateTimestamp = (value: string | null | undefined) => {
    if (!value) return t("finance.overview.exchange.notRefreshed");
    return formatDate(value, RATE_TIMESTAMP_FORMAT) || value;
  };
  const formatRateTrendTime = (value: string) => formatDate(value, RATE_TREND_FORMAT) || value;
  // Remember the user's period choice per workspace across sessions.
  const [period, setPeriod] = usePersistentState<FinanceOverviewPeriodPreset>(
    `bukowski:finance-overview-period:${activeWorkspaceId}`,
    "month",
  );
  const [customStartDate, setCustomStartDate] = usePersistentState<string>(
    `bukowski:finance-overview-custom-start:${activeWorkspaceId}`,
    "",
  );
  const [customEndDate, setCustomEndDate] = usePersistentState<string>(
    `bukowski:finance-overview-custom-end:${activeWorkspaceId}`,
    "",
  );
  const [exportError, setExportError] = useState<string | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isRefreshingRates, setIsRefreshingRates] = useState(false);
  const [selectedFxCurrency, setSelectedFxCurrency] = usePersistentState<"USD" | "EUR">(
    `bukowski:finance-overview-fx:${activeWorkspaceId}`,
    "USD",
  );
  const [rateLimitBlockedUntil, setRateLimitBlockedUntil] = useState<string | null>(null);
  const [isTasaRealAuthBlocked, setIsTasaRealAuthBlocked] = useState(false);
  const isCustomRangeReady = period !== "custom" || (Boolean(customStartDate) && Boolean(customEndDate));
  const rateLimitStorageKey = `bukowski:fx-rate-limit:${activeWorkspaceId}:tasareal:${selectedFxCurrency}`;
  const tasaRealAuthBlockStorageKey = `bukowski:fx-auth-blocked:${activeWorkspaceId}:tasareal`;

  const overviewQuery = useMemo<FinanceOverviewQuery>(() => {
    if (period === "custom") {
      return isCustomRangeReady
        ? { period, customStartDate, customEndDate }
        : { period: "month" };
    }
    return { period };
  }, [customEndDate, customStartDate, isCustomRangeReady, period]);
  const treasuryOverviewQuery = useMemo<TreasuryOverviewQuery>(() => {
    if (period === "custom") {
      return isCustomRangeReady
        ? { workspaceId: activeWorkspaceId, period, customStartDate, customEndDate, reportCurrency: "DOP" }
        : { workspaceId: activeWorkspaceId, period: "month", reportCurrency: "DOP" };
    }
    return { workspaceId: activeWorkspaceId, period, reportCurrency: "DOP" };
  }, [activeWorkspaceId, customEndDate, customStartDate, isCustomRangeReady, period]);

  const { data, error } = useFinanceOverview(overviewQuery);
  const treasuryOverview = useTreasuryOverview(treasuryOverviewQuery);
  const collaboratorSummary = useCollaboratorFeeSummary();
  const {
    data: exchangeRates,
    error: exchangeRatesError,
    isLoading: isLoadingExchangeRates,
    refresh: reloadExchangeRates,
  } = useExchangeRates(activeWorkspaceId, { baseCurrency: selectedFxCurrency, quoteCurrency: "DOP", limit: 200 });
  const { data: providerStatus, refresh: reloadProviderStatus } = useCurrencyRateProviderStatus(activeWorkspaceId);

  const treasurySnapshot = treasuryOverview.data;
  const treasuryCurrency = treasurySnapshot?.reportCurrency && treasurySnapshot.reportCurrency !== "mixed" ? treasurySnapshot.reportCurrency : "DOP";
  const hasTreasuryFlow = Boolean(
    treasurySnapshot?.monthly.some((row) => row.income > 0 || row.expense > 0 || row.net !== 0),
  );
  const categoryChartRows = useMemo(
    () =>
      (treasurySnapshot?.expenseByCategory ?? []).map((row) => ({
        ...row,
        label: t(`finance.treasury.categories.${normalizeCategoryKey(row.category)}`, {
          defaultValue: row.category.replace(/_/g, " "),
        }),
      })),
    [t, treasurySnapshot?.expenseByCategory],
  );
  const hasCategorySpend = categoryChartRows.some((row) => row.amount > 0);
  const categorySpendTotal = categoryChartRows.reduce((total, row) => total + row.amount, 0);
  const categoryDonutGradient = useMemo(() => {
    if (categorySpendTotal <= 0) return "conic-gradient(#2f3742 0% 100%)";
    let cursor = 0;
    return `conic-gradient(${categoryChartRows
      .map((row, index) => {
        const color = chartPalette[index % chartPalette.length] ?? "#d6b37a";
        const start = cursor;
        cursor += (row.amount / categorySpendTotal) * 100;
        return `${color} ${start.toFixed(3)}% ${cursor.toFixed(3)}%`;
      })
      .join(", ")})`;
  }, [categoryChartRows, categorySpendTotal]);
  const decisionSignals = useMemo(
    () =>
      [
        {
          id: "unclassified",
          tone: (treasurySnapshot?.unclassifiedCount ?? 0) > 0 ? "warning" : "success",
          label: t("finance.overview.decisions.unclassified"),
          value: String(treasurySnapshot?.unclassifiedCount ?? 0),
          body: t("finance.overview.decisions.unclassifiedBody"),
        },
        {
          id: "review",
          tone: (treasurySnapshot?.pendingReviewCount ?? 0) > 0 ? "warning" : "success",
          label: t("finance.overview.decisions.pendingReview"),
          value: String(treasurySnapshot?.pendingReviewCount ?? 0),
          body: t("finance.overview.decisions.pendingReviewBody"),
        },
        {
          id: "crew",
          tone: collaboratorSummary.data.pendingAmount > 0 ? "critical" : "success",
          label: t("finance.overview.decisions.crewPayables"),
          value: formatSummaryMoney(collaboratorSummary.data.pendingAmount, "DOP"),
          body: t("finance.overview.decisions.crewPayablesBody", {
            count: collaboratorSummary.data.collaboratorsWithBalance,
          }),
        },
        {
          id: "conversion",
          tone: (treasurySnapshot?.conversionMissingCount ?? 0) > 0 ? "warning" : "success",
          label: t("finance.overview.decisions.conversion"),
          value: String(treasurySnapshot?.conversionMissingCount ?? 0),
          body: t("finance.overview.decisions.conversionBody"),
        },
      ] as const,
    [collaboratorSummary.data, t, treasurySnapshot],
  );

  const exchangeRateRows = useMemo(() => {
    const rows = exchangeRateInstitutions.map((institution) => {
      const decisionRate = findDecisionRate(exchangeRates, institution.source, selectedFxCurrency);
      const sellRate = findLatestRate(exchangeRates, institution.source, "sell", selectedFxCurrency);
      return {
        ...institution,
        decisionRate,
        sellRate,
      };
    });
    const bestBuy = Math.max(...rows.map((row) => row.decisionRate?.rate ?? 0));
    return rows.map((row) => ({
      ...row,
      differenceFromBest: row.decisionRate && bestBuy > 0 ? row.decisionRate.rate - bestBuy : null,
      isBest: row.decisionRate ? row.decisionRate.rate === bestBuy : false,
    }));
  }, [exchangeRates, selectedFxCurrency]);

  const rateTrendRows = useMemo(() => {
    const rowsByTimestamp = new Map<string, Record<string, number | string>>();
    const sourceMetaByDay = new Map<string, { fetchedMs: number; priority: number }>();
    const cutoffMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const trendRates = [...exchangeRates].sort((a, b) => String(a.fetchedAt ?? "").localeCompare(String(b.fetchedAt ?? "")));
    for (const rate of trendRates) {
      if (rate.rateType !== "buy" && rate.rateType !== "average" && rate.rateType !== "manual") continue;
      if (!exchangeRateInstitutions.some((institution) => institution.source === rate.source)) continue;
      if (!rate.fetchedAt) continue;
      const fetchedMs = new Date(rate.fetchedAt).getTime();
      if (Number.isNaN(fetchedMs) || fetchedMs < cutoffMs) continue;
      const bucket = dayBucketIso(fetchedMs);
      const row = rowsByTimestamp.get(bucket) ?? {
        label: formatRateTrendTime(bucket),
        timestamp: bucket,
      };
      const metaKey = `${bucket}:${rate.source}`;
      const priority = rate.rateType === "buy" ? 3 : rate.rateType === "average" ? 2 : 1;
      const currentMeta = sourceMetaByDay.get(metaKey);
      if (!currentMeta || priority > currentMeta.priority || (priority === currentMeta.priority && fetchedMs > currentMeta.fetchedMs)) {
        row[rate.source] = rate.rate;
        sourceMetaByDay.set(metaKey, { fetchedMs, priority });
      }
      rowsByTimestamp.set(bucket, row);
    }
    return Array.from(rowsByTimestamp.values()).sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  }, [exchangeRates]);

  const rateTrendDeltas = useMemo(() => {
    const deltas: Partial<Record<CurrencyRateSource, { latest: number; delta: number }>> = {};
    exchangeRateInstitutions.forEach((institution) => {
      const values = rateTrendRows
        .map((row) => row[institution.source])
        .filter((value): value is number => typeof value === "number");
      if (values.length >= 1) {
        const first = values[0]!;
        const latest = values[values.length - 1]!;
        deltas[institution.source] = { latest, delta: latest - first };
      }
    });
    return deltas;
  }, [rateTrendRows]);

  const rateTrendDomain = useMemo<[number, number]>(() => {
    const values = rateTrendRows.flatMap((row) =>
      exchangeRateInstitutions
        .map((institution) => row[institution.source])
        .filter((value): value is number => typeof value === "number"),
    );
    if (!values.length) return [0, 1];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const padding = Math.max((max - min) * 0.35, 0.08);
    return [Math.floor((min - padding) * 100) / 100, Math.ceil((max + padding) * 100) / 100];
  }, [rateTrendRows]);

  const hasExchangeRates = exchangeRateRows.some((row) => row.decisionRate);
  const exchangeRateStatus = exchangeRates.some((row) => row.fetchedAt)
    ? t("finance.overview.exchange.status.synced")
    : hasExchangeRates
      ? t("finance.overview.exchange.status.manual")
      : providerStatus?.hasApiKey
        ? t("finance.overview.exchange.status.connected")
        : t("finance.overview.exchange.status.setupNeeded");
  const exchangeRateStatusTone = hasExchangeRates || providerStatus?.hasApiKey ? "success" : "neutral";
  const isRateLimitBlocked = rateLimitBlockedUntil ? Date.now() < new Date(rateLimitBlockedUntil).getTime() : false;
  const latestVisibleRate = exchangeRates.find((row) => row.fetchedAt) ?? exchangeRates[0] ?? null;

  useEffect(() => {
    setRateLimitBlockedUntil(readRateLimitBlock(rateLimitStorageKey));
  }, [rateLimitStorageKey]);

  useEffect(() => {
    setIsTasaRealAuthBlocked(window.localStorage.getItem(tasaRealAuthBlockStorageKey) === "1");
  }, [tasaRealAuthBlockStorageKey]);

  const handleRefreshRates = useCallback(
    async ({ quiet = false }: { quiet?: boolean } = {}) => {
      if (!providerStatus?.hasApiKey || isRefreshingRates) return;
      if (isTasaRealAuthBlocked) {
        if (!quiet) {
          toast.warning(
            t("finance.overview.toasts.providerAuthTitle"),
            t("finance.overview.toasts.providerAuthBody"),
          );
        }
        return;
      }
      if (isRateLimitBlocked) {
        if (!quiet) {
          toast.warning(
            t("finance.overview.toasts.rateLimitTitle"),
            t("finance.overview.toasts.rateLimitBody", { time: formatRateTimestamp(rateLimitBlockedUntil) }),
          );
        }
        return;
      }
      setIsRefreshingRates(true);
      try {
        const result = await refreshCurrencyRates({
          commandId: newCommandId("fx-refresh"),
          workspaceId: activeWorkspaceId,
          provider: "tasareal",
          currency: selectedFxCurrency,
        });
        reloadExchangeRates();
        reloadProviderStatus();
        window.localStorage.removeItem(rateLimitStorageKey);
        window.localStorage.removeItem(tasaRealAuthBlockStorageKey);
        setRateLimitBlockedUntil(null);
        setIsTasaRealAuthBlocked(false);
        if (!quiet) {
          toast.success(t("finance.overview.toasts.ratesRefreshed"), result.summary);
        }
      } catch (nextError) {
        const errorMessage = nextError instanceof Error ? nextError.message : String(nextError);
        if (errorMessage.includes("429")) {
          const blockedUntil = nextLocalMidnightIso();
          window.localStorage.setItem(rateLimitStorageKey, blockedUntil);
          setRateLimitBlockedUntil(blockedUntil);
        }
        if (isTasaRealAuthError(errorMessage)) {
          window.localStorage.setItem(tasaRealAuthBlockStorageKey, "1");
          setIsTasaRealAuthBlocked(true);
        }
        if (!quiet) {
          toast.error(
            errorMessage.includes("429")
              ? t("finance.overview.toasts.rateLimitTitle")
              : isTasaRealAuthError(errorMessage)
                ? t("finance.overview.toasts.providerAuthTitle")
                : t("finance.overview.toasts.refreshFailed"),
            getUserFacingErrorMessage(
              nextError,
              errorMessage.includes("429")
                ? t("finance.overview.toasts.rateLimitFallback")
                : isTasaRealAuthError(errorMessage)
                  ? t("finance.overview.toasts.providerAuthBody")
                  : t("finance.overview.toasts.refreshFailedFallback"),
            ),
          );
        }
      } finally {
        setIsRefreshingRates(false);
      }
    },
    [
      activeWorkspaceId,
      isTasaRealAuthBlocked,
      isRateLimitBlocked,
      isRefreshingRates,
      providerStatus?.hasApiKey,
      rateLimitBlockedUntil,
      rateLimitStorageKey,
      reloadExchangeRates,
      reloadProviderStatus,
      selectedFxCurrency,
      tasaRealAuthBlockStorageKey,
      toast,
    ],
  );

  useEffect(() => {
    if (!providerStatus?.hasApiKey) return;
    if (isTasaRealAuthBlocked) return;
    if (isRateLimitBlocked) return;
    const lastFetchedMs = providerStatus.lastFetchedAt ? new Date(providerStatus.lastFetchedAt).getTime() : 0;
    const today = new Date().toISOString().slice(0, 10);
    const hasFreshCurrencyRates = exchangeRates.some(
      (row) => row.fetchedAt && row.baseCurrency === selectedFxCurrency && row.fetchedAt.slice(0, 10) === today,
    );
    const isStale = !lastFetchedMs || Date.now() - lastFetchedMs > fxRefreshIntervalMs;
    if (hasExchangeRates && (isStale || !hasFreshCurrencyRates)) {
      void handleRefreshRates({ quiet: true });
    }
    if (!hasExchangeRates) return;
    const interval = window.setInterval(() => {
      void handleRefreshRates({ quiet: true });
    }, fxRefreshIntervalMs);
    return () => window.clearInterval(interval);
  }, [
    exchangeRates,
    handleRefreshRates,
    hasExchangeRates,
    isTasaRealAuthBlocked,
    isRateLimitBlocked,
    providerStatus?.hasApiKey,
    providerStatus?.lastFetchedAt,
    selectedFxCurrency,
  ]);

  const handleExportPdf = async () => {
    try {
      setIsExportingPdf(true);
      const result = await exportFinanceReportPdf({ ...overviewQuery, workspaceId: activeWorkspaceId });
      setExportError(null);
      notifyExportResult(toast, result, {
        successTitle: t("finance.overview.toasts.reportExported"),
        cancelledTitle: t("common.exportCancelled"),
        cancelledBody: t("common.exportCancelledBody"),
      });
    } catch (nextError) {
      setExportError(getUserFacingErrorMessage(nextError, t("finance.overview.toasts.exportFailed")));
    } finally {
      setIsExportingPdf(false);
    }
  };

  return (
    <div className="page-stack is-dense">
      <SectionHeader title={t("finance.overview.title")} compact />

      {error ? <div className="empty-state">{t("finance.overview.unavailable", { message: error })}</div> : null}
      {exportError ? <div className="action-feedback action-feedback-error">{exportError}</div> : null}

      <SurfaceCard
        title={t("finance.overview.period")}
        aside={
          <div className="finance-overview-aside">
            <span className="finance-period-active-pill">{data.activePeriodLabel}</span>
            <button className="finance-export-button" disabled={isExportingPdf} onClick={() => void handleExportPdf()} type="button">
              <Upload size={15} />
              <span>{isExportingPdf ? t("finance.overview.actions.exportingPdf") : t("finance.overview.actions.exportPdf")}</span>
            </button>
          </div>
        }
      >
        <div className="finance-period-toolbar">
          <label className="compact-filter-field finance-period-select">
            <span>{t("finance.overview.window")}</span>
            <select
              className="compact-filter-select"
              onChange={(event) => setPeriod(event.target.value as FinanceOverviewPeriodPreset)}
              value={period}
            >
              {periodOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {period === "custom" ? (
          <>
            <div className="action-form-grid finance-period-grid">
              <label className="action-field">
                <span className="action-field-label">{t("finance.overview.startDate")}</span>
                <input
                  className="action-field-control"
                  onChange={(event) => setCustomStartDate(event.target.value)}
                  type="date"
                  value={customStartDate}
                />
              </label>
              <label className="action-field">
                <span className="action-field-label">{t("finance.overview.endDate")}</span>
                <input
                  className="action-field-control"
                  min={customStartDate || undefined}
                  onChange={(event) => setCustomEndDate(event.target.value)}
                  type="date"
                  value={customEndDate}
                />
              </label>
            </div>
            {!isCustomRangeReady ? (
              <div className="action-feedback action-feedback-warning">
                {t("finance.overview.customRangeRequired")}
              </div>
            ) : null}
          </>
        ) : null}
      </SurfaceCard>

      <div className="finance-grid">
        <SurfaceCard>
          <dl className="metric">
            <dt className="metric-label">{t("finance.overview.liveMetrics.income")}</dt>
            <dd className="metric-value metric-tone-success">
              {formatSummaryMoney(treasurySnapshot?.totalIncome ?? 0, treasuryCurrency)}
            </dd>
          </dl>
        </SurfaceCard>
        <SurfaceCard>
          <dl className="metric">
            <dt className="metric-label">{t("finance.overview.liveMetrics.expense")}</dt>
            <dd className="metric-value metric-tone-critical">
              {formatSummaryMoney(treasurySnapshot?.totalExpense ?? 0, treasuryCurrency)}
            </dd>
          </dl>
        </SurfaceCard>
        <SurfaceCard>
          <dl className="metric">
            <dt className="metric-label">{t("finance.overview.liveMetrics.net")}</dt>
            <dd className={`metric-value metric-tone-${(treasurySnapshot?.net ?? 0) >= 0 ? "warning" : "critical"}`}>
              {formatSummaryMoney(treasurySnapshot?.net ?? 0, treasuryCurrency)}
            </dd>
          </dl>
        </SurfaceCard>
        <SurfaceCard>
          <dl className="metric">
            <dt className="metric-label">{t("finance.overview.liveMetrics.deductible")}</dt>
            <dd className="metric-value metric-tone-info">
              {formatSummaryMoney(treasurySnapshot?.totalDeductibleExpense ?? 0, treasuryCurrency)}
            </dd>
          </dl>
        </SurfaceCard>
        <SurfaceCard>
          <dl className="metric">
            <dt className="metric-label">{t("finance.overview.liveMetrics.crewPending")}</dt>
            <dd className={`metric-value metric-tone-${collaboratorSummary.data.pendingAmount > 0 ? "warning" : "success"}`}>
              {formatSummaryMoney(collaboratorSummary.data.pendingAmount, "DOP")}
            </dd>
          </dl>
        </SurfaceCard>
      </div>

      <SurfaceCard title={t("finance.overview.decisionTitle")}>
        <div className="finance-decision-grid">
          {decisionSignals.map((signal) => (
            <div className={`finance-decision-tile metric-tone-${signal.tone}`} key={signal.id}>
              <span>{signal.label}</span>
              <strong>{signal.value}</strong>
              <p>{signal.body}</p>
            </div>
          ))}
        </div>
        {treasuryOverview.error ? (
          <div className="action-feedback action-feedback-warning">
            {t("finance.overview.treasuryUnavailable", { message: treasuryOverview.error })}
          </div>
        ) : null}
      </SurfaceCard>

      <SurfaceCard
        title={t("finance.overview.exchange.title")}
        aside={
          <div className="finance-overview-aside">
            <div aria-label={t("finance.overview.exchange.currency")} className="finance-fx-currency-toggle" role="group">
              <span aria-hidden="true" className={`finance-fx-currency-thumb is-${selectedFxCurrency.toLowerCase()}`} />
              {(["USD", "EUR"] as const).map((currency) => (
                <button
                  aria-pressed={selectedFxCurrency === currency}
                  className="finance-fx-currency-option"
                  key={currency}
                  onClick={() => setSelectedFxCurrency(currency)}
                  type="button"
                >
                  {currency}
                </button>
              ))}
            </div>
            <span
              aria-label={t("finance.overview.exchange.statusAria", { status: exchangeRateStatus })}
              className={`finance-fx-status-dot finance-fx-status-${exchangeRateStatusTone}`}
              title={exchangeRateStatus}
            >
              <span aria-hidden="true" />
              <span className="sr-only">{exchangeRateStatus}</span>
            </span>
            <button
              aria-label={t("finance.overview.exchange.refresh")}
              className="icon-ghost-control"
              disabled={isRefreshingRates || !providerStatus?.hasApiKey || isRateLimitBlocked || isTasaRealAuthBlocked}
              onClick={() => void handleRefreshRates()}
              title={
                isRateLimitBlocked
                  ? t("finance.overview.exchange.limitUntil", { time: formatRateTimestamp(rateLimitBlockedUntil) })
                  : isTasaRealAuthBlocked
                    ? t("finance.overview.exchange.authBlocked")
                  : providerStatus?.hasApiKey
                    ? t("finance.overview.exchange.refresh")
                    : t("finance.overview.exchange.connectTasaReal")
              }
              type="button"
            >
              <RefreshCw size={14} />
            </button>
          </div>
        }
      >
        <div className="finance-fx-grid">
          {exchangeRateRows.map((row) => (
            <div className={`finance-fx-provider-card${row.isBest ? " is-best" : ""}`} key={row.source}>
              {(() => {
                const rateCopy = getRateDisplayCopy(row.source, selectedFxCurrency, t);
                return (
                  <>
              <div className="finance-fx-provider-header">
                <span className="finance-fx-logo" aria-hidden="true">
                  <img alt="" src={row.logo} />
                </span>
                <div className="finance-fx-provider-copy">
                  <strong>{row.label}</strong>
                  <span>
                    {row.decisionRate?.fetchedAt
                      ? `TasaReal · ${formatRateTimestamp(row.decisionRate.fetchedAt)}`
                      : row.decisionRate
                        ? t("finance.overview.exchange.manualSnapshot")
                        : providerStatus?.hasApiKey
                          ? t("finance.overview.exchange.noRateYet", { currency: selectedFxCurrency })
                          : t("finance.overview.exchange.notConnected")}
                  </span>
                </div>
                {row.isBest ? <StatusBadge tone="success">{t("finance.overview.exchange.best")}</StatusBadge> : null}
              </div>
              <div className="finance-fx-rate-row">
                <span className="finance-fx-rate-buy">
                  <small>{rateCopy.buyLabel}</small>
                  <strong>{formatRateValue(row.decisionRate?.rate ?? null)}</strong>
                </span>
                <span className="finance-fx-rate-sell">
                  <small>{rateCopy.sellLabel}</small>
                  <strong>{row.sellRate ? formatRateValue(row.sellRate.rate) : rateCopy.missingSellLabel}</strong>
                </span>
                <span className="finance-fx-rate-diff">
                  <small>{t("finance.overview.exchange.diff")}</small>
                  <strong className={row.differenceFromBest === 0 ? "is-positive" : ""}>
                    {row.differenceFromBest === null ? "—" : row.differenceFromBest === 0 ? t("finance.overview.exchange.best") : row.differenceFromBest.toFixed(2)}
                  </strong>
                </span>
              </div>
              <div className="finance-fx-provider-meta">
                <span>
                  {row.decisionRate?.effectiveDate
                    ? t("finance.overview.exchange.effective", { date: row.decisionRate.effectiveDate })
                    : t("finance.overview.exchange.noRateSaved", { currency: selectedFxCurrency })}
                </span>
                {row.decisionRate?.fetchedAt ? (
                  <a href="https://tasareal.com" rel="noreferrer" target="_blank">
                    tasareal.com · {formatRateTimestamp(row.decisionRate.fetchedAt)}
                  </a>
                ) : (
                  <span>{row.decisionRate?.sourceLabel ?? row.decisionRate?.source ?? t("finance.overview.exchange.readyToRefresh")}</span>
                )}
              </div>
              {rateCopy.meta && row.decisionRate && !row.sellRate ? <div className="finance-fx-source-note">{rateCopy.meta}</div> : null}
                  </>
                );
              })()}
            </div>
          ))}
        </div>
        {exchangeRatesError ? (
          <div className="action-feedback action-feedback-warning">
            {t("finance.overview.exchange.unavailable", { message: exchangeRatesError })}
          </div>
        ) : !hasExchangeRates && !isLoadingExchangeRates ? (
          <div className="action-feedback action-feedback-info">
            {providerStatus?.hasApiKey
              ? t("finance.overview.exchange.noSavedRatesWithKey", { currency: selectedFxCurrency })
              : t("finance.overview.exchange.noSavedRatesNoKey")}
          </div>
        ) : null}
        {isRateLimitBlocked ? (
          <div className="action-feedback action-feedback-warning">
            {t("finance.overview.exchange.rateLimitNotice", { time: formatRateTimestamp(rateLimitBlockedUntil) })}
          </div>
        ) : latestVisibleRate?.fetchedAt ? (
          <div className="finance-fx-source-note">
            {t("finance.overview.exchange.sourceNote", { time: formatRateTimestamp(latestVisibleRate.fetchedAt) })}
          </div>
        ) : null}
      </SurfaceCard>

      <SurfaceCard title={t("finance.overview.exchange.trendTitle", { currency: selectedFxCurrency })}>
        {rateTrendRows.length > 0 ? (
          <div className="finance-chart-shell finance-fx-trend-chart">
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={rateTrendRows} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="label" stroke="rgba(255,255,255,0.48)" tickLine={false} axisLine={false} />
                <YAxis
                  domain={rateTrendDomain}
                  stroke="rgba(255,255,255,0.44)"
                  tickFormatter={(value) => Number(value).toFixed(2)}
                  tickLine={false}
                  axisLine={false}
                  width={58}
                />
                <Tooltip content={<RateChartTooltip />} />
                {exchangeRateInstitutions.map((institution) => (
                  <Line isAnimationActive={chartsAnimated}
                    key={institution.source}
                    type="monotone"
                    dataKey={institution.source}
                    name={institution.label}
                    stroke={rateSourceColor(institution.source)}
                    strokeWidth={2.3}
                    dot={{ r: 3, fill: rateSourceColor(institution.source) }}
                    activeDot={{ r: 5 }}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
            <div className="finance-fx-trend-legend">
              {exchangeRateInstitutions.map((institution) => (
                <span key={institution.source}>
                  <i style={{ background: rateSourceColor(institution.source) }} />
                  <strong>{institution.label}</strong>
                  {rateTrendDeltas[institution.source] ? (
                    <em className={rateTrendDeltas[institution.source]!.delta >= 0 ? "is-positive" : "is-negative"}>
                      {rateTrendDeltas[institution.source]!.latest.toFixed(2)}
                      {" · "}
                      {rateTrendDeltas[institution.source]!.delta >= 0 ? "+" : ""}
                      {rateTrendDeltas[institution.source]!.delta.toFixed(2)}
                    </em>
                  ) : null}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <GuidedEmptyState
            title={t("finance.overview.empty.noTrendTitle")}
            body={t("finance.overview.empty.noTrendBody", { currency: selectedFxCurrency })}
          />
        )}
      </SurfaceCard>

      <div className="finance-dashboard-grid">
        <SurfaceCard title={t("finance.overview.cashFlowTitle")}>
          {treasuryOverview.isLoading ? (
            <TableSkeleton rows={5} />
          ) : hasTreasuryFlow ? (
            <div className="finance-chart-shell">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={treasurySnapshot?.monthly ?? []} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="month" stroke="rgba(255,255,255,0.48)" tickLine={false} axisLine={false} />
                  <YAxis
                    stroke="rgba(255,255,255,0.44)"
                    tickFormatter={(value) => formatAxisCurrency(Number(value), treasuryCurrency)}
                    tickLine={false}
                    axisLine={false}
                    width={58}
                  />
                  <Tooltip content={<ChartTooltip currency={treasuryCurrency} />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                  <Bar isAnimationActive={chartsAnimated} dataKey="income" name={t("finance.overview.liveMetrics.income")} radius={[8, 8, 0, 0]} fill="#7eb7b2" />
                  <Bar isAnimationActive={chartsAnimated} dataKey="expense" name={t("finance.overview.liveMetrics.expense")} radius={[8, 8, 0, 0]} fill="#c88d7f" />
                  <Line isAnimationActive={chartsAnimated}
                    type="monotone"
                    dataKey="net"
                    name={t("finance.overview.liveMetrics.net")}
                    stroke="#d6b37a"
                    strokeWidth={2.4}
                    dot={{ r: 3, fill: "#d6b37a" }}
                    activeDot={{ r: 5 }}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <GuidedEmptyState
              title={t("finance.overview.empty.noTreasuryFlowTitle")}
              body={t("finance.overview.empty.noTreasuryFlowBody")}
            />
          )}
        </SurfaceCard>

        <SurfaceCard title={t("finance.overview.categoryMix")}>
          {treasuryOverview.isLoading ? (
            <TableSkeleton rows={5} />
          ) : hasCategorySpend ? (
            <div className="finance-category-layout">
              <div className="finance-donut-wrap">
                <div
                  aria-hidden="true"
                  className="finance-donut-visual"
                  style={{ background: categoryDonutGradient }}
                />
                <div className="finance-donut-center">
                  <span>{t("finance.treasury.overview.expenseTotal")}</span>
                  <strong>{formatAxisCurrency(categorySpendTotal, treasuryCurrency)}</strong>
                </div>
              </div>

              <div className="finance-pie-legend">
                {categoryChartRows.map((row, index) => (
                  <div key={row.category} className="finance-pie-legend-row">
                    <span
                      className="finance-pie-legend-swatch"
                      style={{ background: chartPalette[index % chartPalette.length] ?? "#d6b37a" }}
                    />
                    <span className="finance-pie-legend-label">{row.label}</span>
                    <span className="finance-pie-legend-amount">{formatSummaryMoney(row.amount, treasuryCurrency)}</span>
                    <span className="finance-pie-legend-percent">{row.percentage}%</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <GuidedEmptyState
              title={t("finance.overview.empty.noCategoryTitle")}
              body={t("finance.overview.empty.noCategoryBody")}
            />
          )}
        </SurfaceCard>
      </div>
    </div>
  );
};

export default FinanceOverviewPage;
