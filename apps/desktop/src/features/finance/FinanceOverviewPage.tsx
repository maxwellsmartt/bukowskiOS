import { RefreshCw, Upload } from "lucide-react";
import type { TFunction } from "i18next";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
  CurrencyRateSource,
  ExchangeRateRow,
  FinanceOverviewPeriodPreset,
  FinanceOverviewQuery,
} from "@contracts";
import { useToast } from "@app/providers/ToastProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { DataTable } from "@shared/components/DataTable";
import { GuidedEmptyState } from "@shared/components/GuidedEmptyState";
import { HelpHint } from "@shared/components/HelpHint";
import { ResizableSideRailLayout } from "@shared/components/ResizableSideRailLayout";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { TableSkeleton } from "@shared/components/TableSkeleton";
import { useLocale } from "@shared/hooks/useLocale";
import { getUserFacingErrorMessage } from "@shared/lib/errors";
import bancoCentralLogo from "@shared/assets/inbox/logos/banco-central-logo.png";
import bancoPopularLogo from "@shared/assets/inbox/logos/banco popular dominicano-logo.jpg";
import bancoSantaCruzLogo from "@shared/assets/inbox/logos/banco santa cruz-logo.png";

import { exportFinanceReportPdf, useFinanceOverview } from "./useFinanceData";
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
const exchangeRateInstitutions: Array<{ label: string; logo: string; source: CurrencyRateSource }> = [
  { label: "Banco Popular", logo: bancoPopularLogo, source: "banco_popular" },
  { label: "Banco Central", logo: bancoCentralLogo, source: "banco_central" },
  { label: "Banco Santa Cruz", logo: bancoSantaCruzLogo, source: "banco_santa_cruz" },
];

const formatAxisCurrency = (value: number) => {
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }

  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(0)}k`;
  }

  return `$${Math.round(value)}`;
};

const formatRateValue = (value: number | null) => (typeof value === "number" ? value.toFixed(2) : "—");

const RATE_TIMESTAMP_FORMAT: Intl.DateTimeFormatOptions = {
  dateStyle: "medium",
  timeStyle: "short",
};

const RATE_TREND_FORMAT: Intl.DateTimeFormatOptions = {
  hour: "numeric",
  minute: "2-digit",
};

const minuteBucketIso = (value: number) => new Date(Math.floor(value / 60_000) * 60_000).toISOString();

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
  label,
  payload,
}: {
  active?: boolean;
  label?: string;
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
          <span>{typeof entry.value === "number" ? formatAxisCurrency(entry.value) : String(entry.value ?? "—")}</span>
        </div>
      ))}
    </div>
  );
};

export const FinanceOverviewPage = () => {
  const { t } = useTranslation();
  const { activeWorkspaceId } = useWorkspace();
  const toast = useToast();
  const { formatDate } = useLocale();
  const formatRateTimestamp = (value: string | null | undefined) => {
    if (!value) return t("finance.overview.exchange.notRefreshed");
    return formatDate(value, RATE_TIMESTAMP_FORMAT) || value;
  };
  const formatRateTrendTime = (value: string) => formatDate(value, RATE_TREND_FORMAT) || value;
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [period, setPeriod] = useState<FinanceOverviewPeriodPreset>("month");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const [exportError, setExportError] = useState<string | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isRefreshingRates, setIsRefreshingRates] = useState(false);
  const [selectedFxCurrency, setSelectedFxCurrency] = useState<"USD" | "EUR">("USD");
  const [rateLimitBlockedUntil, setRateLimitBlockedUntil] = useState<string | null>(null);
  const isCustomRangeReady = period !== "custom" || (Boolean(customStartDate) && Boolean(customEndDate));
  const rateLimitStorageKey = `bukowski:fx-rate-limit:${activeWorkspaceId}:tasareal:${selectedFxCurrency}`;

  const overviewQuery = useMemo<FinanceOverviewQuery>(
    () =>
      period === "custom" && !isCustomRangeReady
        ? { period: "month", customStartDate: null, customEndDate: null }
        : {
            period,
            customStartDate: period === "custom" ? customStartDate || null : null,
            customEndDate: period === "custom" ? customEndDate || null : null,
          },
    [customEndDate, customStartDate, isCustomRangeReady, period],
  );

  const { data, error, isLoading } = useFinanceOverview(overviewQuery);
  const {
    data: exchangeRates,
    error: exchangeRatesError,
    isLoading: isLoadingExchangeRates,
    refresh: reloadExchangeRates,
  } = useExchangeRates(activeWorkspaceId, { baseCurrency: selectedFxCurrency, quoteCurrency: "DOP", limit: 200 });
  const { data: providerStatus, refresh: reloadProviderStatus } = useCurrencyRateProviderStatus(activeWorkspaceId);

  const exposureChartRows = useMemo(
    () =>
      data.exposureByProject.map((row) => ({
        incidentCount: row.incidentCount,
        project: row.project,
        value: row.exposureValue,
      })),
    [data.exposureByProject],
  );

  const categoryChartRows = data.categoryBreakdown.length
    ? data.categoryBreakdown
    : [{ category: t("finance.overview.empty.noTrackedSpend"), amount: "$0", amountValue: 0, percentage: 100 }];

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
    const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
    const trendRates = [...exchangeRates].sort((a, b) => String(a.fetchedAt ?? "").localeCompare(String(b.fetchedAt ?? "")));
    for (const rate of trendRates) {
      if (rate.rateType !== "buy" && rate.rateType !== "average" && rate.rateType !== "manual") continue;
      if (!exchangeRateInstitutions.some((institution) => institution.source === rate.source)) continue;
      if (!rate.fetchedAt) continue;
      const fetchedMs = new Date(rate.fetchedAt).getTime();
      if (Number.isNaN(fetchedMs) || fetchedMs < cutoffMs) continue;
      const bucket = minuteBucketIso(fetchedMs);
      const row = rowsByTimestamp.get(bucket) ?? {
        label: formatRateTrendTime(bucket),
        timestamp: bucket,
      };
      if (typeof row[rate.source] !== "number" || rate.rateType === "buy") {
        row[rate.source] = rate.rate;
      }
      rowsByTimestamp.set(bucket, row);
    }
    return Array.from(rowsByTimestamp.values()).sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  }, [exchangeRates]);

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

  const handleRefreshRates = useCallback(
    async ({ quiet = false }: { quiet?: boolean } = {}) => {
      if (!providerStatus?.hasApiKey || isRefreshingRates) return;
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
        setRateLimitBlockedUntil(null);
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
        if (!quiet) {
          toast.error(
            errorMessage.includes("429") ? t("finance.overview.toasts.rateLimitTitle") : t("finance.overview.toasts.refreshFailed"),
            getUserFacingErrorMessage(
              nextError,
              errorMessage.includes("429")
                ? t("finance.overview.toasts.rateLimitFallback")
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
      isRateLimitBlocked,
      isRefreshingRates,
      providerStatus?.hasApiKey,
      rateLimitBlockedUntil,
      rateLimitStorageKey,
      reloadExchangeRates,
      reloadProviderStatus,
      selectedFxCurrency,
      toast,
    ],
  );

  useEffect(() => {
    if (!providerStatus?.hasApiKey) return;
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
      toast.success(t("finance.overview.toasts.reportExported"), result.summary);
    } catch (nextError) {
      setExportError(getUserFacingErrorMessage(nextError, t("finance.overview.toasts.exportFailed")));
    } finally {
      setIsExportingPdf(false);
    }
  };

  return (
    <div className="page-stack">
      <SectionHeader title={t("finance.overview.title")} />

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
        {data.metrics.map((metric) => (
          <SurfaceCard key={metric.label}>
            <span className={`metric-value metric-tone-${metric.tone}`}>{metric.value}</span>
            <p className="metric-label">{metric.label}</p>
          </SurfaceCard>
        ))}
      </div>

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
              disabled={isRefreshingRates || !providerStatus?.hasApiKey || isRateLimitBlocked}
              onClick={() => void handleRefreshRates()}
              title={
                isRateLimitBlocked
                  ? t("finance.overview.exchange.limitUntil", { time: formatRateTimestamp(rateLimitBlockedUntil) })
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
                  <Line
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
                  {institution.label}
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
        <SurfaceCard
          title={t("finance.overview.exposureByProject")}
          aside={
            <HelpHint
              body={t("finance.overview.help.exposure")}
            />
          }
        >
          {isLoading ? (
            <TableSkeleton rows={5} />
          ) : exposureChartRows.length ? (
            <div className="finance-chart-shell">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={exposureChartRows} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="project" stroke="rgba(255,255,255,0.48)" tickLine={false} axisLine={false} />
                  <YAxis
                    stroke="rgba(255,255,255,0.44)"
                    tickFormatter={formatAxisCurrency}
                    tickLine={false}
                    axisLine={false}
                    width={58}
                  />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                  <Bar dataKey="value" radius={[10, 10, 0, 0]} fill="#d6b37a" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <GuidedEmptyState
              title={t("finance.overview.empty.noExposureTitle")}
              body={t("finance.overview.empty.noExposureBody")}
            />
          )}
        </SurfaceCard>

        <SurfaceCard
          title={t("finance.overview.monthlyBurn")}
          aside={
            <HelpHint
              body={t("finance.overview.help.burn")}
            />
          }
        >
          {isLoading ? (
            <TableSkeleton rows={5} />
          ) : (
            <div className="finance-chart-shell">
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={data.monthlyBurn} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="month" stroke="rgba(255,255,255,0.48)" tickLine={false} axisLine={false} />
                  <YAxis
                    stroke="rgba(255,255,255,0.44)"
                    tickFormatter={formatAxisCurrency}
                    tickLine={false}
                    axisLine={false}
                    width={58}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="amountValue"
                    stroke="#7eb7b2"
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: "#7eb7b2" }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </SurfaceCard>

        <SurfaceCard title={t("finance.overview.categoryMix")}>
          {isLoading ? (
            <TableSkeleton rows={5} />
          ) : (
            <div className="finance-chart-shell finance-chart-shell-pie">
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={categoryChartRows}
                    dataKey="amountValue"
                    innerRadius={58}
                    outerRadius={92}
                    paddingAngle={2}
                    nameKey="category"
                  >
                    {categoryChartRows.map((row, index) => (
                      <Cell key={row.category} fill={chartPalette[index % chartPalette.length] ?? "#d6b37a"} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>

              <div className="finance-pie-legend">
                {categoryChartRows.map((row, index) => (
                  <div key={row.category} className="finance-pie-legend-row">
                    <span
                      className="finance-pie-legend-swatch"
                      style={{ background: chartPalette[index % chartPalette.length] ?? "#d6b37a" }}
                    />
                    <span className="finance-pie-legend-label">{row.category}</span>
                    <span className="finance-pie-legend-meta">
                      {row.amount} · {row.percentage}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </SurfaceCard>
      </div>

      <ResizableSideRailLayout className="split-layout" defaultWidth={420} maxWidth={640} minWidth={320} storageKey="finance-overview-side-rail-width">
        <SurfaceCard title={t("finance.overview.exposureTable")}>
          <DataTable
            getRowId={(row) => row.project}
            maxHeight="min(46vh, 520px)"
            persistKey="finance-project-exposure"
            columns={[
              { key: "project", label: t("finance.overview.columns.project"), render: (row) => row.project },
              { key: "exposure", label: t("finance.overview.columns.exposure"), render: (row) => row.exposure },
              { key: "assetsOut", label: t("finance.overview.columns.assetsOut"), render: (row) => row.assetsOut },
              { key: "incidentCount", label: t("finance.overview.columns.incidents"), align: "right", render: (row) => row.incidentCount },
            ]}
            rows={data.exposureByProject}
            selectable
            selectedRowIds={selectedRowIds}
            onSelectedRowIdsChange={setSelectedRowIds}
          />
        </SurfaceCard>

        <SurfaceCard title={t("finance.overview.reviewQueue")}>
          <div className="queue-list">
            {data.costLinks.map((row) => (
              <div key={row.incident} className="queue-item">
                <div className="identity-cell">
                  <span className="identity-title">{row.incident}</span>
                  <span className="identity-meta">
                    {row.project} · {row.costEstimate}
                  </span>
                </div>
                <StatusBadge tone={row.financialStatus === "Estimate missing" ? "warning" : "info"}>
                  {row.financialStatus}
                </StatusBadge>
              </div>
            ))}
          </div>
        </SurfaceCard>
      </ResizableSideRailLayout>
    </div>
  );
};

export default FinanceOverviewPage;
