import { ArrowUpRight, ShieldAlert, Wrench } from "lucide-react";
import { useEffect, useState } from "react";

import type { ScheduleTimelineRange, ScheduleTimelineScale } from "@contracts";
import { DataTable } from "@shared/components/DataTable";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { useSectionScopeLabel } from "@shared/hooks/useSectionScopeLabel";
import { readStringPreference, uiPreferenceKeys, writePreference } from "@shared/lib/preferences";

import { OverviewScheduleTimeline } from "./OverviewScheduleTimeline";
import { useOverviewSnapshot, useOverviewTimeline } from "./useOverviewSnapshot";

const queueCards = [
  {
    title: "Overdue returns",
    subtitle: "Slips nearing or past due return need review.",
    icon: ArrowUpRight,
    tone: "warning" as const,
  },
  {
    title: "Active incidents",
    subtitle: "Open issues with pending follow-up or missing estimates.",
    icon: ShieldAlert,
    tone: "critical" as const,
  },
  {
    title: "Maintenance watch",
    subtitle: "Assets flagged for bench review or spare-part follow-up.",
    icon: Wrench,
    tone: "success" as const,
  },
];

export const OverviewPage = () => (
  <OverviewContent />
);

const todayDateOnly = () => new Date().toISOString().slice(0, 10);

const isTimelineRange = (value: string | null): value is ScheduleTimelineRange =>
  value === "30d" || value === "90d" || value === "6m";

const isTimelineScale = (value: string | null): value is ScheduleTimelineScale =>
  value === "day" || value === "week" || value === "month";

const OverviewContent = () => {
  const sectionScopeLabel = useSectionScopeLabel();
  const { data, error, isLoading } = useOverviewSnapshot();
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
  const { data: timelineSnapshot, isLoading: timelineLoading } = useOverviewTimeline(
    timelineRange,
    timelineScale,
    timelineAnchorDate,
  );

  useEffect(() => {
    writePreference(uiPreferenceKeys.overviewTimelineRange, timelineRange);
  }, [timelineRange]);

  useEffect(() => {
    writePreference(uiPreferenceKeys.overviewTimelineScale, timelineScale);
  }, [timelineScale]);

  useEffect(() => {
    writePreference(uiPreferenceKeys.overviewTimelineAnchorDate, timelineAnchorDate);
  }, [timelineAnchorDate]);

  return (
    <div className="page-stack">
      <SectionHeader
        eyebrow="Operations"
        title="Today at a glance"
        body="Availability, incidents, maintenance pressure and recent movement across warehouse and set."
        contextLabel={sectionScopeLabel}
      />

      {error ? <div className="empty-state">Overview unavailable: {error}</div> : null}

      <div className="metric-grid">
        {data.metrics.map((metric) => (
          <SurfaceCard key={metric.label}>
            <span className={`metric-value metric-tone-${metric.tone}`}>{metric.value}</span>
            <p className="metric-label">{metric.label}</p>
          </SurfaceCard>
        ))}
        {!data.metrics.length && isLoading ? (
          <SurfaceCard>
            <p className="metric-label">Loading local workspace metrics...</p>
          </SurfaceCard>
        ) : null}
      </div>

      <div className="queue-grid">
        {queueCards.map((card) => {
          const Icon = card.icon;
          return (
            <SurfaceCard key={card.title} title={card.title} subtitle={card.subtitle} aside={<Icon size={16} />}>
              <StatusBadge tone={card.tone}>{card.tone}</StatusBadge>
            </SurfaceCard>
          );
        })}
      </div>

      <OverviewScheduleTimeline
        anchorDate={timelineAnchorDate}
        isLoading={timelineLoading}
        onAnchorDateChange={setTimelineAnchorDate}
        onRangeChange={setTimelineRange}
        onScaleChange={setTimelineScale}
        range={timelineRange}
        scale={timelineScale}
        snapshot={timelineSnapshot}
      />

      <SurfaceCard
        title="Recent movements"
        subtitle="Latest operational activity across locations, projects and responsible teams."
      >
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
          persistKey="overview-recent-movements"
          rows={data.recentMovements}
        />
      </SurfaceCard>
    </div>
  );
};
