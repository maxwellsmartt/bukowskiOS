import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";

import type {
  ScheduleTimelineProjectLane,
  ScheduleTimelineRange,
  ScheduleTimelineSnapshot,
  ScheduleTimelineUnitLane,
} from "@contracts";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";

const dayInMilliseconds = 1000 * 60 * 60 * 24;

const colorMap: Record<string, { solid: string; muted: string }> = {
  ice: { solid: "#9fbad8", muted: "rgba(159, 186, 216, 0.22)" },
  steel: { solid: "#8f99a7", muted: "rgba(143, 153, 167, 0.22)" },
  teal: { solid: "#5f9b96", muted: "rgba(95, 155, 150, 0.22)" },
  moss: { solid: "#708f6d", muted: "rgba(112, 143, 109, 0.22)" },
  amber: { solid: "#c89a56", muted: "rgba(200, 154, 86, 0.24)" },
  coral: { solid: "#ca7d6a", muted: "rgba(202, 125, 106, 0.24)" },
  rose: { solid: "#bf7288", muted: "rgba(191, 114, 136, 0.24)" },
  copper: { solid: "#af7d5f", muted: "rgba(175, 125, 95, 0.24)" },
  violet: { solid: "#8d83bb", muted: "rgba(141, 131, 187, 0.24)" },
  slate: { solid: "#708196", muted: "rgba(112, 129, 150, 0.24)" },
};

const parseDateOnly = (value: string) => new Date(`${value}T00:00:00.000Z`);

const diffDays = (start: string, end: string) =>
  Math.round((parseDateOnly(end).getTime() - parseDateOnly(start).getTime()) / dayInMilliseconds);

const clampDate = (value: string, min: string, max: string) => {
  if (value < min) {
    return min;
  }

  if (value > max) {
    return max;
  }

  return value;
};

const formatDateLabel = (value: string | null) => {
  if (!value) {
    return "Unscheduled";
  }

  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(parseDateOnly(value));
};

const resolveStatusTone = (status: string) => {
  const normalized = status.toLowerCase();

  if (normalized === "cancelled") {
    return "critical" as const;
  }

  if (normalized === "active") {
    return "info" as const;
  }

  if (normalized === "planned" || normalized === "prep") {
    return "warning" as const;
  }

  if (normalized === "wrapped") {
    return "success" as const;
  }

  return "neutral" as const;
};

const resolveProjectBar = (
  row: Pick<ScheduleTimelineProjectLane | ScheduleTimelineUnitLane, "startDate" | "endDate" | "colorKey">,
  rangeStart: string,
  rangeEnd: string,
) => {
  const totalDays = Math.max(diffDays(rangeStart, rangeEnd) + 1, 1);
  const startDate = row.startDate ?? rangeStart;
  const endDate = row.endDate ?? rangeEnd;

  if (endDate < rangeStart || startDate > rangeEnd) {
    return null;
  }

  const clampedStart = clampDate(startDate, rangeStart, rangeEnd);
  const clampedEnd = clampDate(endDate, rangeStart, rangeEnd);
  const leftDays = diffDays(rangeStart, clampedStart);
  const visibleDays = Math.max(diffDays(clampedStart, clampedEnd) + 1, 1);
  const palette = colorMap[row.colorKey ?? "slate"] ?? colorMap.slate;

  return {
    style: {
      left: `${(leftDays / totalDays) * 100}%`,
      width: `${Math.max((visibleDays / totalDays) * 100, 1.5)}%`,
      background: `linear-gradient(90deg, ${palette.solid} 0%, ${palette.muted} 100%)`,
      borderColor: palette.solid,
      boxShadow: `0 0 0 1px ${palette.muted} inset`,
    } as CSSProperties,
    solidColor: palette.solid,
  };
};

const rangeLabelMap: Record<ScheduleTimelineRange, string> = {
  "30d": "30D",
  "90d": "90D",
  "6m": "6M",
};

type OverviewScheduleTimelineProps = {
  isLoading: boolean;
  onRangeChange: (range: ScheduleTimelineRange) => void;
  range: ScheduleTimelineRange;
  snapshot: ScheduleTimelineSnapshot;
};

const TimelineLane = ({
  isExpanded,
  onToggle,
  project,
  rangeEnd,
  rangeStart,
}: {
  isExpanded: boolean;
  onToggle: () => void;
  project: ScheduleTimelineProjectLane;
  rangeEnd: string;
  rangeStart: string;
}) => {
  const bar = resolveProjectBar(project, rangeStart, rangeEnd);

  return (
    <div className="timeline-lane-block">
      <div className="timeline-lane-row">
        <div className="timeline-lane-meta">
          <button
            className={`timeline-lane-toggle${project.units.length ? "" : " is-static"}`}
            disabled={!project.units.length}
            onClick={onToggle}
            type="button"
          >
            {project.units.length ? (isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : <span />}
          </button>

          <div className="timeline-lane-copy">
            <div className="timeline-lane-title-row">
              <span className="timeline-project-code">{project.code}</span>
              <strong className="timeline-lane-title">{project.name}</strong>
              <StatusBadge tone={resolveStatusTone(project.status)}>{project.status}</StatusBadge>
            </div>
            <span className="timeline-lane-subtitle">
              {project.client} · {formatDateLabel(project.startDate)} - {formatDateLabel(project.endDate)}
              {project.units.length ? ` · ${project.units.length} units` : ""}
            </span>
          </div>
        </div>

        <div className="timeline-track">
          <div className="timeline-track-grid">
            {bar ? <div className="timeline-bar" style={bar.style} /> : null}
          </div>
        </div>
      </div>

      {isExpanded && project.units.length ? (
        <div className="timeline-unit-list">
          {project.units.map((unit) => {
            const unitBar = resolveProjectBar(unit, rangeStart, rangeEnd);

            return (
              <div key={unit.id} className="timeline-lane-row timeline-lane-row-unit">
                <div className="timeline-lane-meta timeline-lane-meta-unit">
                  <div className="timeline-lane-copy">
                    <div className="timeline-lane-title-row">
                      <span className="timeline-project-code">{unit.code}</span>
                      <strong className="timeline-lane-title">{unit.name}</strong>
                      <StatusBadge tone={resolveStatusTone(unit.status)}>{unit.status}</StatusBadge>
                    </div>
                    <span className="timeline-lane-subtitle">
                      {formatDateLabel(unit.startDate)} - {formatDateLabel(unit.endDate)}
                    </span>
                  </div>
                </div>

                <div className="timeline-track">
                  <div className="timeline-track-grid">
                    {unitBar ? <div className="timeline-bar timeline-bar-unit" style={unitBar.style} /> : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};

export const OverviewScheduleTimeline = ({
  isLoading,
  onRangeChange,
  range,
  snapshot,
}: OverviewScheduleTimelineProps) => {
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>([]);

  const markerTemplateColumns = useMemo(
    () => `repeat(${Math.max(snapshot.markers.length, 1)}, minmax(88px, 1fr))`,
    [snapshot.markers.length],
  );

  return (
    <SurfaceCard
      className="timeline-surface"
      title="Workspace schedule"
      subtitle="Parallel projects and project units on one operational timeline. Global first, project detail second."
      aside={
        <div className="timeline-range-controls">
          {(Object.entries(rangeLabelMap) as Array<[ScheduleTimelineRange, string]>).map(([value, label]) => (
            <button
              key={value}
              className={`timeline-range-button${range === value ? " active" : ""}`}
              onClick={() => onRangeChange(value)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      }
    >
      {isLoading ? <div className="empty-state">Loading workspace timeline...</div> : null}

      <div className="timeline-layout">
        <div className="timeline-header-row">
          <div className="timeline-header-copy">
            <span className="timeline-header-label">Projects / units</span>
          </div>
          <div className="timeline-markers" style={{ gridTemplateColumns: markerTemplateColumns }}>
            {snapshot.markers.map((marker) => (
              <div key={marker.key} className="timeline-marker">
                <span className="timeline-marker-label">{marker.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="timeline-lanes">
          {snapshot.projects.map((project) => (
            <TimelineLane
              key={project.id}
              isExpanded={expandedProjectIds.includes(project.id)}
              onToggle={() =>
                setExpandedProjectIds((current) =>
                  current.includes(project.id)
                    ? current.filter((value) => value !== project.id)
                    : [...current, project.id],
                )
              }
              project={project}
              rangeEnd={snapshot.rangeEnd}
              rangeStart={snapshot.rangeStart}
            />
          ))}
        </div>

        {snapshot.unscheduled.length ? (
          <div className="timeline-unscheduled">
            <div className="timeline-unscheduled-header">
              <strong>Unscheduled</strong>
              <span>Projects without confirmed dates stay visible here until their schedule is defined.</span>
            </div>

            <div className="timeline-unscheduled-list">
              {snapshot.unscheduled.map((project) => (
                <div key={project.id} className="timeline-unscheduled-item">
                  <div className="timeline-lane-title-row">
                    <span className="timeline-project-code">{project.code}</span>
                    <strong className="timeline-lane-title">{project.name}</strong>
                  </div>
                  <span className="timeline-lane-subtitle">{project.client}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </SurfaceCard>
  );
};
