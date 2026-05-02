import { Download } from "lucide-react";
import { useMemo, useState } from "react";
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

import type { FinanceOverviewPeriodPreset, FinanceOverviewQuery } from "@contracts";
import { useToast } from "@app/providers/ToastProvider";
import { DataTable } from "@shared/components/DataTable";
import { GuidedEmptyState } from "@shared/components/GuidedEmptyState";
import { HelpHint } from "@shared/components/HelpHint";
import { ResizableSideRailLayout } from "@shared/components/ResizableSideRailLayout";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { TableSkeleton } from "@shared/components/TableSkeleton";
import { getUserFacingErrorMessage } from "@shared/lib/errors";

import { exportFinanceReportPdf, useFinanceOverview } from "./useFinanceData";

const periodOptions: Array<{ label: string; value: FinanceOverviewPeriodPreset }> = [
  { label: "Month", value: "month" },
  { label: "Quarter", value: "quarter" },
  { label: "Year", value: "year" },
  { label: "Custom", value: "custom" },
];

const chartPalette = ["#d6b37a", "#7eb7b2", "#92a7c1", "#c88d7f", "#a29cd8", "#8ca772"];

const formatAxisCurrency = (value: number) => {
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }

  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(0)}k`;
  }

  return `$${Math.round(value)}`;
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
  const toast = useToast();
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [period, setPeriod] = useState<FinanceOverviewPeriodPreset>("month");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const [exportError, setExportError] = useState<string | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const isCustomRangeReady = period !== "custom" || (Boolean(customStartDate) && Boolean(customEndDate));

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
    : [{ category: "No tracked spend", amount: "$0", amountValue: 0, percentage: 100 }];

  const handleExportPdf = async () => {
    try {
      setIsExportingPdf(true);
      const result = await exportFinanceReportPdf(overviewQuery);
      setExportError(null);
      toast.success("Report exported", result.summary);
    } catch (nextError) {
      setExportError(getUserFacingErrorMessage(nextError, "Unable to export finance report PDF."));
    } finally {
      setIsExportingPdf(false);
    }
  };

  return (
    <div className="page-stack">
      <SectionHeader title="Finance" />

      {error ? <div className="empty-state">Finance overview unavailable: {error}</div> : null}
      {exportError ? <div className="action-feedback action-feedback-error">{exportError}</div> : null}

      <SurfaceCard
        title="Period"
        aside={
          <div className="finance-overview-aside">
            <StatusBadge tone="info">{data.activePeriodLabel}</StatusBadge>
            <button className="ghost-control" disabled={isExportingPdf} onClick={() => void handleExportPdf()} type="button">
              <Download size={14} />
              <span>{isExportingPdf ? "Exporting PDF..." : "Export PDF"}</span>
            </button>
          </div>
        }
      >
        <div className="finance-period-toolbar">
          {periodOptions.map((option) => (
            <button
              key={option.value}
              className={`ghost-control finance-period-chip${period === option.value ? " is-active" : ""}`}
              onClick={() => setPeriod(option.value)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>

        {period === "custom" ? (
          <>
            <div className="action-form-grid finance-period-grid">
              <label className="action-field">
                <span className="action-field-label">Start date</span>
                <input
                  className="action-field-control"
                  onChange={(event) => setCustomStartDate(event.target.value)}
                  type="date"
                  value={customStartDate}
                />
              </label>
              <label className="action-field">
                <span className="action-field-label">End date</span>
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
                Pick both dates to apply a custom finance window.
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

      <div className="finance-dashboard-grid">
        <SurfaceCard
          title="Exposure by project"
          aside={
            <HelpHint
              body="Exposure is the total estimated cost of open incidents and reserves on each project — money you might still owe if everything resolves badly."
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
              title="No exposure yet"
              body="Once incidents and reserves start landing, this chart will show which projects are carrying the most pressure."
            />
          )}
        </SurfaceCard>

        <SurfaceCard
          title="Monthly burn"
          aside={
            <HelpHint
              body="Burn is how much money flowed out of the workspace each month, summed across all projects."
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

        <SurfaceCard title="Category Mix">
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
        <SurfaceCard title="Exposure Table">
          <DataTable
            getRowId={(row) => row.project}
            maxHeight="min(46vh, 520px)"
            persistKey="finance-project-exposure"
            columns={[
              { key: "project", label: "Project", render: (row) => row.project },
              { key: "exposure", label: "Exposure", render: (row) => row.exposure },
              { key: "assetsOut", label: "Assets out", render: (row) => row.assetsOut },
              { key: "incidentCount", label: "Incidents", align: "right", render: (row) => row.incidentCount },
            ]}
            rows={data.exposureByProject}
            selectable
            selectedRowIds={selectedRowIds}
            onSelectedRowIdsChange={setSelectedRowIds}
          />
        </SurfaceCard>

        <SurfaceCard title="Review Queue">
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
