import { useEffect, useState } from "react";

import type { ScheduleTimelineRange, ScheduleTimelineScale } from "@contracts";
import { OverviewScheduleTimeline } from "@features/overview/OverviewScheduleTimeline";
import { useOverviewTimeline } from "@features/overview/useOverviewSnapshot";
import { DataTable } from "@shared/components/DataTable";
import { SectionHeader } from "@shared/components/SectionHeader";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { readStringPreference, uiPreferenceKeys, writePreference } from "@shared/lib/preferences";

import { useAssetsOverview } from "./useAssetsData";

const timelinePageSize = 24;

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

export const AssetsOverviewPage = () => {
  const { data, error } = useAssetsOverview();
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
  );

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
  }, [timelineRange, timelineScale, timelineAnchorDate]);

  const overviewCards = [
    {
      label: "Total assets",
      value: data.totalAssets,
      subtitle: "Registered inventory across warehouse, set and active workflows.",
      tone: "info" as const,
    },
    {
      label: "Assigned assets",
      value: data.assignedAssets,
      subtitle: "Assets currently assigned to a project, unit or responsible owner.",
      tone: "info" as const,
    },
    data.cards.overdueReturns,
    data.cards.openPackingSlips,
    data.cards.activeIncidents,
    data.cards.maintenanceWatch,
  ];

  return (
    <div className="page-stack">
      <SectionHeader title="Overview" titleTone="accent" />

      {error ? <div className="empty-state">Assets overview unavailable: {error}</div> : null}

      <div className="overview-operational-grid overview-operational-grid-assets">
        {overviewCards.map((card) => (
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

      <SurfaceCard title="Recent movements">
        <DataTable
          columns={[
            {
              key: "asset",
              label: "Asset",
              render: (row) => (
                <div className="identity-cell">
                  <span className="identity-title">{row.asset}</span>
                  <span className="identity-meta">{row.code}</span>
                </div>
              ),
            },
            { key: "from", label: "From", render: (row) => row.from },
            { key: "to", label: "To", render: (row) => row.to },
            { key: "actor", label: "Handled by", render: (row) => row.actor },
            { key: "time", label: "Time", align: "right", render: (row) => row.timestamp },
          ]}
          maxHeight="min(44vh, 420px)"
          persistKey="assets-overview-recent-movements"
          rows={data.recentMovements}
        />
      </SurfaceCard>
    </div>
  );
};
