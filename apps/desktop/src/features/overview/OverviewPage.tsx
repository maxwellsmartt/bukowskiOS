import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ScheduleTimelineRange, ScheduleTimelineScale } from "@contracts";
import { DataTable } from "@shared/components/DataTable";
import { SectionHeader } from "@shared/components/SectionHeader";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { useShellContext } from "@shared/hooks/useShellContext";
import { readStringPreference, uiPreferenceKeys, writePreference } from "@shared/lib/preferences";

import { OverviewScheduleTimeline } from "./OverviewScheduleTimeline";
import { useOverviewSnapshot, useOverviewTimeline } from "./useOverviewSnapshot";

const timelinePageSize = 24;

export const OverviewPage = () => (
  <OverviewContent />
);

const todayDateOnly = () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = `${today.getMonth() + 1}`.padStart(2, "0");
  const day = `${today.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const isTimelineRange = (value: string | null): value is ScheduleTimelineRange =>
  value === "30d" || value === "90d" || value === "6m";

const isTimelineScale = (value: string | null): value is ScheduleTimelineScale =>
  value === "day" || value === "week" || value === "month";

const OverviewContent = () => {
  const { t } = useTranslation();
  const { projectDataVersion } = useShellContext();
  const { data, error } = useOverviewSnapshot(projectDataVersion);
  const [timelineRange, setTimelineRange] = useState<ScheduleTimelineRange>(() => {
    const storedValue = readStringPreference(uiPreferenceKeys.overviewTimelineRange, "90d");
    return isTimelineRange(storedValue) ? storedValue : "90d";
  });
  const [timelineScale, setTimelineScale] = useState<ScheduleTimelineScale>(() => {
    const storedValue = readStringPreference(uiPreferenceKeys.overviewTimelineScale, "week");
    return isTimelineScale(storedValue) ? storedValue : "week";
  });
  const [timelineAnchorDate, setTimelineAnchorDate] = useState(() =>
    readStringPreference(uiPreferenceKeys.overviewTimelineAnchorDate, todayDateOnly()) ?? todayDateOnly(),
  );
  const [timelineProjectLimit, setTimelineProjectLimit] = useState(timelinePageSize);
  const { data: timelineSnapshot, isLoading: timelineLoading } = useOverviewTimeline(
    timelineRange,
    timelineScale,
    timelineAnchorDate,
    { limit: timelineProjectLimit, offset: 0 },
    projectDataVersion,
  );
  const operationalCards = [
    data.cards.overdueReturns,
    data.cards.openPackingSlips,
    data.cards.activeIncidents,
    data.cards.maintenanceWatch,
  ].map((card) => {
    const keyByLabel: Record<string, string> = {
      "Overdue returns": "overdueReturns",
      "Open packing slips": "openPackingSlips",
      "Active incidents": "activeIncidents",
      "Maintenance watch": "maintenanceWatch",
    };
    const key = keyByLabel[card.label];
    return key
      ? {
          ...card,
          label: t(`overview.cards.${key}.label`),
          subtitle: t(`overview.cards.${key}.subtitle`),
        }
      : card;
  });

  useEffect(() => {
    writePreference(uiPreferenceKeys.overviewTimelineRange, timelineRange);
  }, [timelineRange]);

  useEffect(() => {
    writePreference(uiPreferenceKeys.overviewTimelineScale, timelineScale);
  }, [timelineScale]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      writePreference(uiPreferenceKeys.overviewTimelineAnchorDate, timelineAnchorDate);
    }, 140);

    return () => window.clearTimeout(timer);
  }, [timelineAnchorDate]);

  useEffect(() => {
    setTimelineProjectLimit(timelinePageSize);
  }, [timelineRange, timelineScale]);

  return (
    <div className="page-stack">
      <SectionHeader title={t("overview.title")} titleTone="accent" />

      {error ? <div className="empty-state">{t("overview.unavailable", { error })}</div> : null}

      <div className="overview-operational-grid">
        {operationalCards.map((card) => (
          <SurfaceCard key={card.label} className="overview-operational-card" title={card.label}>
            <span className={`overview-operational-value metric-tone-${card.tone}`}>{card.value}</span>
            <p className="overview-operational-subtitle">{card.subtitle}</p>
          </SurfaceCard>
        ))}
      </div>

      <OverviewScheduleTimeline
        anchorDate={timelineAnchorDate}
        isLoading={timelineLoading}
        onAnchorDateChange={setTimelineAnchorDate}
        onLoadMoreProjects={() => setTimelineProjectLimit((current) => current + timelinePageSize)}
        onRangeChange={setTimelineRange}
        onScaleChange={setTimelineScale}
        range={timelineRange}
        scale={timelineScale}
        snapshot={timelineSnapshot}
      />

      <SurfaceCard title={t("overview.recentMovements.title")}>
        <DataTable
          columns={[
            {
              key: "asset",
              label: t("overview.recentMovements.columns.asset"),
              render: (row) => (
                <div className="identity-cell">
                  <span className="identity-title">{row.asset}</span>
                  <span className="identity-meta">{row.code}</span>
                </div>
              ),
            },
            { key: "from", label: t("overview.recentMovements.columns.from"), render: (row) => row.from },
            { key: "to", label: t("overview.recentMovements.columns.to"), render: (row) => row.to },
            { key: "actor", label: t("overview.recentMovements.columns.actor"), render: (row) => row.actor },
            { key: "time", label: t("overview.recentMovements.columns.time"), align: "right", render: (row) => row.timestamp },
          ]}
          maxHeight="min(44vh, 420px)"
          persistKey="overview-recent-movements"
          rows={data.recentMovements}
        />
      </SurfaceCard>
    </div>
  );
};
