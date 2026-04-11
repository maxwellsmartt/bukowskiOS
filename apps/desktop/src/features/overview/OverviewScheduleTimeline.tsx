import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Crosshair,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";

import type {
  ScheduleTimelineProjectLane,
  ScheduleTimelineRange,
  ScheduleTimelineScale,
  ScheduleTimelineSnapshot,
  ScheduleTimelineUnitLane,
} from "@contracts";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { readJsonPreference, uiPreferenceKeys, writeJsonPreference } from "@shared/lib/preferences";

const dayInMilliseconds = 1000 * 60 * 60 * 24;

const rangeLabelMap: Record<ScheduleTimelineRange, string> = {
  "30d": "30D",
  "90d": "90D",
  "6m": "6M",
};

const scaleLabelMap: Record<ScheduleTimelineScale, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
};

const zoomScaleOrder: ScheduleTimelineScale[] = ["month", "week", "day"];

const colorMap: Record<
  string,
  {
    projectFill: string;
    unitFill: string;
    border: string;
    focusRing: string;
  }
> = {
  ice: {
    projectFill: "rgba(153, 176, 201, 0.82)",
    unitFill: "rgba(153, 176, 201, 0.62)",
    border: "rgba(179, 203, 228, 0.34)",
    focusRing: "rgba(153, 176, 201, 0.18)",
  },
  steel: {
    projectFill: "rgba(136, 146, 160, 0.84)",
    unitFill: "rgba(136, 146, 160, 0.64)",
    border: "rgba(166, 176, 191, 0.32)",
    focusRing: "rgba(136, 146, 160, 0.18)",
  },
  teal: {
    projectFill: "rgba(92, 141, 138, 0.84)",
    unitFill: "rgba(92, 141, 138, 0.64)",
    border: "rgba(123, 171, 168, 0.32)",
    focusRing: "rgba(92, 141, 138, 0.18)",
  },
  moss: {
    projectFill: "rgba(112, 136, 101, 0.84)",
    unitFill: "rgba(112, 136, 101, 0.64)",
    border: "rgba(149, 170, 138, 0.32)",
    focusRing: "rgba(112, 136, 101, 0.18)",
  },
  amber: {
    projectFill: "rgba(190, 146, 88, 0.84)",
    unitFill: "rgba(190, 146, 88, 0.64)",
    border: "rgba(222, 180, 127, 0.34)",
    focusRing: "rgba(190, 146, 88, 0.18)",
  },
  coral: {
    projectFill: "rgba(190, 120, 103, 0.84)",
    unitFill: "rgba(190, 120, 103, 0.64)",
    border: "rgba(220, 151, 135, 0.34)",
    focusRing: "rgba(190, 120, 103, 0.18)",
  },
  rose: {
    projectFill: "rgba(184, 115, 135, 0.84)",
    unitFill: "rgba(184, 115, 135, 0.64)",
    border: "rgba(214, 147, 166, 0.34)",
    focusRing: "rgba(184, 115, 135, 0.18)",
  },
  copper: {
    projectFill: "rgba(168, 125, 96, 0.84)",
    unitFill: "rgba(168, 125, 96, 0.64)",
    border: "rgba(199, 157, 128, 0.34)",
    focusRing: "rgba(168, 125, 96, 0.18)",
  },
  violet: {
    projectFill: "rgba(129, 123, 169, 0.82)",
    unitFill: "rgba(129, 123, 169, 0.62)",
    border: "rgba(160, 154, 201, 0.32)",
    focusRing: "rgba(129, 123, 169, 0.18)",
  },
  slate: {
    projectFill: "rgba(111, 126, 146, 0.82)",
    unitFill: "rgba(111, 126, 146, 0.62)",
    border: "rgba(143, 158, 179, 0.32)",
    focusRing: "rgba(111, 126, 146, 0.18)",
  },
};

const emptyBands = {
  days: [] as TimelineBand[],
  header: [] as TimelineBand[],
  months: [] as TimelineBand[],
  weeks: [] as TimelineBand[],
};

type TimelineBand = {
  endDate: string;
  key: string;
  label: string;
  left: number;
  startDate: string;
  width: number;
};

type TimelineTooltipState = {
  label: string;
  left: number;
  status: string;
  subtitle: string;
  top: number;
};

type TimelineInteractionHandlers = {
  onClick: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: () => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onWheel: (event: ReactWheelEvent<HTMLDivElement>) => void;
};

type TimelineGridProps = {
  bands: {
    days: TimelineBand[];
    header: TimelineBand[];
    months: TimelineBand[];
    weeks: TimelineBand[];
  };
  scale: ScheduleTimelineScale;
};

type TimelineBarGeometry = {
  left: number;
  palette: (typeof colorMap)[keyof typeof colorMap];
  width: number;
};

type TimelineBarRow = Pick<ScheduleTimelineProjectLane | ScheduleTimelineUnitLane, "colorKey" | "endDate" | "startDate">;

type DragState = {
  anchorDate: string;
  axis: "horizontal" | "vertical" | null;
  panelWidth: number;
  pointerId: number | null;
  startX: number;
  startY: number;
  target: HTMLDivElement | null;
};

const shortDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

const monthLabelFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
});

const todayDateOnly = () => new Date().toISOString().slice(0, 10);

const parseDateOnly = (value: string) => new Date(`${value}T00:00:00.000Z`);

const addDays = (date: string, offset: number) => {
  const nextDate = parseDateOnly(date);
  nextDate.setUTCDate(nextDate.getUTCDate() + offset);
  return nextDate.toISOString().slice(0, 10);
};

const startOfWeek = (date: string) => {
  const nextDate = parseDateOnly(date);
  const day = nextDate.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  nextDate.setUTCDate(nextDate.getUTCDate() + offset);
  return nextDate.toISOString().slice(0, 10);
};

const startOfMonth = (date: string) => {
  const nextDate = parseDateOnly(date);
  nextDate.setUTCDate(1);
  return nextDate.toISOString().slice(0, 10);
};

const resolveTimelineRangeLength = (range: ScheduleTimelineRange) => {
  if (range === "30d") {
    return 30;
  }

  if (range === "6m") {
    return 182;
  }

  return 90;
};

const resolveTimelineWindow = (range: ScheduleTimelineRange, scale: ScheduleTimelineScale, anchorDate: string) => {
  const totalDays = resolveTimelineRangeLength(range);
  const lookbackDays = Math.max(1, Math.floor(totalDays * 0.2));
  const rawStart = addDays(anchorDate, -lookbackDays);
  const alignedStart = scale === "month" ? startOfMonth(rawStart) : scale === "week" ? startOfWeek(rawStart) : rawStart;

  return {
    end: addDays(alignedStart, totalDays - 1),
    start: alignedStart,
  };
};

const diffDays = (start: string, end: string) =>
  Math.round((parseDateOnly(end).getTime() - parseDateOnly(start).getTime()) / dayInMilliseconds);

const diffDaysInclusive = (start: string, end: string) => Math.max(diffDays(start, end) + 1, 1);

const clampDate = (value: string, min: string, max: string) => {
  if (value < min) {
    return min;
  }

  if (value > max) {
    return max;
  }

  return value;
};

const formatRangeLabel = (startDate: string | null, endDate: string | null) => {
  if (!startDate && !endDate) {
    return "Dates pending";
  }

  if (startDate && endDate) {
    return `${shortDateFormatter.format(parseDateOnly(startDate))} – ${shortDateFormatter.format(parseDateOnly(endDate))}`;
  }

  if (startDate) {
    return `From ${shortDateFormatter.format(parseDateOnly(startDate))}`;
  }

  return `Until ${shortDateFormatter.format(parseDateOnly(endDate ?? ""))}`;
};

const formatPlayheadLabel = (value: string) => (value === todayDateOnly() ? "Today" : shortDateFormatter.format(parseDateOnly(value)));

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

const resolveTimelinePalette = (colorKey: string | null) => colorMap[colorKey ?? "slate"] ?? colorMap.slate;

const resolveDateLeft = (date: string, rangeStart: string, rangeEnd: string) => {
  const totalDays = Math.max(diffDays(rangeStart, rangeEnd), 1);
  return (diffDays(rangeStart, clampDate(date, rangeStart, rangeEnd)) / totalDays) * 100;
};

const resolveBarGeometry = (row: TimelineBarRow, rangeStart: string, rangeEnd: string): TimelineBarGeometry | null => {
  const totalDays = Math.max(diffDaysInclusive(rangeStart, rangeEnd), 1);
  const startDate = row.startDate ?? rangeStart;
  const endDate = row.endDate ?? rangeEnd;

  if (endDate < rangeStart || startDate > rangeEnd) {
    return null;
  }

  const clampedStart = clampDate(startDate, rangeStart, rangeEnd);
  const clampedEnd = clampDate(endDate, rangeStart, rangeEnd);
  const leftDays = diffDays(rangeStart, clampedStart);
  const visibleDays = Math.max(diffDaysInclusive(clampedStart, clampedEnd), 1);

  return {
    left: (leftDays / totalDays) * 100,
    palette: resolveTimelinePalette(row.colorKey),
    width: Math.max((visibleDays / totalDays) * 100, 0.9),
  };
};

const resolveBand = (startDate: string, endDate: string, rangeStart: string, rangeEnd: string, label: string): TimelineBand => {
  const totalDays = Math.max(diffDaysInclusive(rangeStart, rangeEnd), 1);
  const clampedStart = clampDate(startDate, rangeStart, rangeEnd);
  const clampedEnd = clampDate(endDate, rangeStart, rangeEnd);
  const leftDays = diffDays(rangeStart, clampedStart);
  const visibleDays = Math.max(diffDaysInclusive(clampedStart, clampedEnd), 1);

  return {
    endDate: clampedEnd,
    key: `${clampedStart}-${clampedEnd}-${label}`,
    label,
    left: (leftDays / totalDays) * 100,
    startDate: clampedStart,
    width: (visibleDays / totalDays) * 100,
  };
};

const buildMonthBands = (rangeStart: string, rangeEnd: string) => {
  const bands: TimelineBand[] = [];
  let cursor = startOfMonth(rangeStart);

  while (cursor <= rangeEnd) {
    const nextCursor = startOfMonth(addDays(cursor, 32));
    const monthEnd = addDays(nextCursor, -1);

    if (monthEnd >= rangeStart) {
      bands.push(resolveBand(cursor, monthEnd, rangeStart, rangeEnd, monthLabelFormatter.format(parseDateOnly(cursor)).toUpperCase()));
    }

    cursor = nextCursor;
  }

  return bands;
};

const buildWeekBands = (rangeStart: string, rangeEnd: string) => {
  const bands: TimelineBand[] = [];
  let cursor = startOfWeek(rangeStart);

  while (cursor <= rangeEnd) {
    const weekEnd = addDays(cursor, 6);

    if (weekEnd >= rangeStart) {
      bands.push(resolveBand(cursor, weekEnd, rangeStart, rangeEnd, shortDateFormatter.format(parseDateOnly(clampDate(cursor, rangeStart, rangeEnd)))));
    }

    cursor = addDays(cursor, 7);
  }

  return bands;
};

const buildDayBands = (rangeStart: string, rangeEnd: string) => {
  const totalDays = diffDaysInclusive(rangeStart, rangeEnd);

  return Array.from({ length: totalDays }, (_, index) => {
    const date = addDays(rangeStart, index);
    return resolveBand(date, date, rangeStart, rangeEnd, new Intl.DateTimeFormat("en-US", { day: "numeric" }).format(parseDateOnly(date)));
  });
};

const buildSparseHeaderBands = (
  source: TimelineBand[],
  stride: number,
  rangeStart: string,
  rangeEnd: string,
  includeBand: (band: TimelineBand, index: number) => boolean,
) => {
  if (!source.length) {
    return [];
  }

  const selectedIndices = source.reduce<number[]>((indices, band, index) => {
    if (index === 0 || index % stride === 0 || includeBand(band, index)) {
      indices.push(index);
    }

    return indices;
  }, []);

  return selectedIndices.map((index, position) => {
    const band = source[index];
    const nextBand = source[selectedIndices[position + 1]];
    const endDate = nextBand ? addDays(nextBand.startDate, -1) : rangeEnd;

    return resolveBand(band.startDate, endDate, rangeStart, rangeEnd, band.label);
  });
};

const buildTimelineBands = (rangeStart: string, rangeEnd: string, scale: ScheduleTimelineScale) => {
  const months = buildMonthBands(rangeStart, rangeEnd);
  const weeks = buildWeekBands(rangeStart, rangeEnd);
  const days = scale === "day" ? buildDayBands(rangeStart, rangeEnd) : [];

  if (scale === "day") {
    const dayStride = days.length > 150 ? 6 : days.length > 120 ? 5 : days.length > 90 ? 3 : days.length > 60 ? 2 : 1;
    return {
      days,
      header: buildSparseHeaderBands(
        days,
        dayStride,
        rangeStart,
        rangeEnd,
        (band) => band.startDate.endsWith("-01"),
      ),
      months,
      weeks,
    };
  }

  if (scale === "month") {
    return {
      days,
      header: [],
      months,
      weeks,
    };
  }

  const weekStride = weeks.length > 18 ? 2 : 1;
  return {
    days,
    header: weeks.filter((_, index) => index % weekStride === 0),
    months,
    weeks,
  };
};

const resolveDateFromClientX = (clientX: number, rect: DOMRect, rangeStart: string, rangeEnd: string) => {
  const totalDays = Math.max(diffDays(rangeStart, rangeEnd), 1);
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  return addDays(rangeStart, Math.round(ratio * totalDays));
};

const shiftAnchorDate = (anchorDate: string, deltaDays: number) => addDays(anchorDate, deltaDays);

const TimelineGrid = ({
  bands,
  scale,
}: TimelineGridProps) => (
  <div className={`timeline-grid-shell timeline-grid-shell-${scale}`}>
    {bands.days.map((band) => (
      <span
        key={`day-${band.key}`}
        className="timeline-grid-line timeline-grid-line-day"
        style={{ left: `${band.left}%` }}
      />
    ))}
    {bands.weeks.map((band) => (
      <span
        key={`week-${band.key}`}
        className="timeline-grid-line timeline-grid-line-week"
        style={{ left: `${band.left}%` }}
      />
    ))}
    {bands.months.map((band) => (
      <span
        key={`month-${band.key}`}
        className="timeline-grid-line timeline-grid-line-month"
        style={{ left: `${band.left}%` }}
      />
    ))}
  </div>
);

const TimelineLane = ({
  bands,
  interactionHandlers,
  isExpanded,
  onBarHover,
  onBarLeave,
  onToggle,
  project,
  rangeEnd,
  rangeStart,
  scale,
}: {
  bands: ReturnType<typeof buildTimelineBands>;
  interactionHandlers: TimelineInteractionHandlers;
  isExpanded: boolean;
  onBarHover: (
    event: ReactPointerEvent<HTMLDivElement>,
    row: ScheduleTimelineProjectLane | ScheduleTimelineUnitLane,
    parentName?: string,
  ) => void;
  onBarLeave: () => void;
  onToggle: () => void;
  project: ScheduleTimelineProjectLane;
  rangeEnd: string;
  rangeStart: string;
  scale: ScheduleTimelineScale;
}) => {
  const projectBar = resolveBarGeometry(project, rangeStart, rangeEnd);

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
              <strong className="timeline-lane-title">{project.name}</strong>
              <StatusBadge tone={resolveStatusTone(project.status)}>{project.status}</StatusBadge>
            </div>
            <span className="timeline-lane-subtitle">
              {project.client} · {formatRangeLabel(project.startDate, project.endDate)}
              {project.units.length ? ` · ${project.units.length} units` : ""}
            </span>
          </div>
        </div>

        <div className="timeline-track">
          <div
            className="timeline-track-grid"
            onClick={interactionHandlers.onClick}
            onPointerCancel={interactionHandlers.onPointerCancel}
            onPointerDown={interactionHandlers.onPointerDown}
            onPointerMove={interactionHandlers.onPointerMove}
            onPointerUp={interactionHandlers.onPointerUp}
            onWheel={interactionHandlers.onWheel}
          >
            <TimelineGrid
              bands={bands}
              scale={scale}
            />
            {projectBar ? (
              <div
                className="timeline-bar"
                onPointerEnter={(event) => onBarHover(event, project)}
                onPointerLeave={onBarLeave}
                onPointerMove={(event) => onBarHover(event, project)}
                style={
                  {
                    "--timeline-bar-fill": projectBar.palette.projectFill,
                    "--timeline-bar-focus-ring": projectBar.palette.focusRing,
                    left: `${projectBar.left}%`,
                    width: `${projectBar.width}%`,
                  } as CSSProperties
                }
              />
            ) : null}
          </div>
        </div>
      </div>

      {isExpanded && project.units.length ? (
        <div className="timeline-unit-list">
          {project.units.map((unit) => {
            const unitBar = resolveBarGeometry(unit, rangeStart, rangeEnd);

            return (
              <div key={unit.id} className="timeline-lane-row timeline-lane-row-unit">
                <div className="timeline-lane-meta timeline-lane-meta-unit">
                  <div className="timeline-lane-copy">
                    <div className="timeline-lane-title-row">
                      <span className="timeline-unit-code">{unit.code}</span>
                      <strong className="timeline-lane-title">{unit.name}</strong>
                      <StatusBadge tone={resolveStatusTone(unit.status)}>{unit.status}</StatusBadge>
                    </div>
                    <span className="timeline-lane-subtitle">{formatRangeLabel(unit.startDate, unit.endDate)}</span>
                  </div>
                </div>

                <div className="timeline-track">
                  <div
                    className="timeline-track-grid"
                    onClick={interactionHandlers.onClick}
                    onPointerCancel={interactionHandlers.onPointerCancel}
                    onPointerDown={interactionHandlers.onPointerDown}
                    onPointerMove={interactionHandlers.onPointerMove}
                    onPointerUp={interactionHandlers.onPointerUp}
                    onWheel={interactionHandlers.onWheel}
                  >
                    <TimelineGrid
                      bands={bands}
                      scale={scale}
                    />
                    {unitBar ? (
                      <div
                        className="timeline-bar timeline-bar-unit"
                        onPointerEnter={(event) => onBarHover(event, unit, project.name)}
                        onPointerLeave={onBarLeave}
                        onPointerMove={(event) => onBarHover(event, unit, project.name)}
                        style={
                          {
                            "--timeline-bar-fill": unitBar.palette.unitFill,
                            "--timeline-bar-focus-ring": unitBar.palette.focusRing,
                            left: `${unitBar.left}%`,
                            width: `${unitBar.width}%`,
                          } as CSSProperties
                        }
                      />
                    ) : null}
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

type OverviewScheduleTimelineProps = {
  anchorDate: string;
  isLoading: boolean;
  onAnchorDateChange: (anchorDate: string) => void;
  onRangeChange: (range: ScheduleTimelineRange) => void;
  onScaleChange: (scale: ScheduleTimelineScale) => void;
  range: ScheduleTimelineRange;
  scale: ScheduleTimelineScale;
  snapshot: ScheduleTimelineSnapshot;
};

export const OverviewScheduleTimeline = ({
  anchorDate,
  isLoading,
  onAnchorDateChange,
  onRangeChange,
  onScaleChange,
  range,
  scale,
  snapshot,
}: OverviewScheduleTimelineProps) => {
  const timelineRootRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<DragState>({
    anchorDate,
    axis: null,
    panelWidth: 0,
    pointerId: null,
    startX: 0,
    startY: 0,
    target: null,
  });
  const ignoreNextClickRef = useRef(false);
  const previewAnchorDateRef = useRef(anchorDate || todayDateOnly());
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>(() =>
    readJsonPreference<string[]>(uiPreferenceKeys.overviewTimelineExpandedProjects, []),
  );
  const [isPanning, setIsPanning] = useState(false);
  const [playheadDate, setPlayheadDate] = useState(todayDateOnly());
  const [previewAnchorDate, setPreviewAnchorDate] = useState(anchorDate || todayDateOnly());
  const [tooltip, setTooltip] = useState<TimelineTooltipState | null>(null);

  useEffect(() => {
    writeJsonPreference(uiPreferenceKeys.overviewTimelineExpandedProjects, expandedProjectIds);
  }, [expandedProjectIds]);

  useEffect(() => {
    previewAnchorDateRef.current = previewAnchorDate;
  }, [previewAnchorDate]);

  useEffect(() => {
    if (!isPanning) {
      const nextAnchorDate = anchorDate || todayDateOnly();
      setPreviewAnchorDate(nextAnchorDate);
      previewAnchorDateRef.current = nextAnchorDate;
    }
  }, [anchorDate, isPanning]);

  const effectiveAnchorDate = previewAnchorDate || anchorDate || todayDateOnly();
  const visibleWindow = useMemo(
    () => resolveTimelineWindow(range, scale, effectiveAnchorDate),
    [effectiveAnchorDate, range, scale],
  );
  const visibleWindowDays = diffDaysInclusive(visibleWindow.start, visibleWindow.end);
  const clampedPlayheadDate =
    visibleWindow.start && visibleWindow.end
      ? clampDate(playheadDate, visibleWindow.start, visibleWindow.end)
      : playheadDate;
  const playheadLeft =
    visibleWindow.start && visibleWindow.end
      ? resolveDateLeft(clampedPlayheadDate, visibleWindow.start, visibleWindow.end)
      : 0;
  const renderedPlayheadLeft = Math.min(99.2, Math.max(0.8, playheadLeft));
  const playheadLabel = formatPlayheadLabel(playheadDate);
  const bands = useMemo(() => {
    if (!visibleWindow.start || !visibleWindow.end) {
      return emptyBands;
    }

    return buildTimelineBands(visibleWindow.start, visibleWindow.end, scale);
  }, [scale, visibleWindow.end, visibleWindow.start]);

  const sharedPlayheadStyle = useMemo(
    () => ({
      left: `calc(var(--timeline-meta-width) + var(--timeline-column-gap) + ((100% - var(--timeline-meta-width) - var(--timeline-column-gap)) * ${
        renderedPlayheadLeft / 100
      }))`,
    }),
    [renderedPlayheadLeft],
  );

  const setTodayAnchor = () => {
    const today = todayDateOnly();
    setPreviewAnchorDate(today);
    previewAnchorDateRef.current = today;
    onAnchorDateChange(today);
    setPlayheadDate(today);
  };

  const shiftWindow = (direction: -1 | 1) => {
    const nextAnchorDate = shiftAnchorDate(effectiveAnchorDate, direction * visibleWindowDays);
    setPreviewAnchorDate(nextAnchorDate);
    previewAnchorDateRef.current = nextAnchorDate;
    onAnchorDateChange(nextAnchorDate);
  };

  const updateTooltip = (
    event: ReactPointerEvent<HTMLDivElement>,
    row: ScheduleTimelineProjectLane | ScheduleTimelineUnitLane,
    parentName?: string,
  ) => {
    const containerRect = timelineRootRef.current?.getBoundingClientRect();
    if (!containerRect) {
      return;
    }

    const title = parentName ? `${parentName} · ${row.name}` : row.name;
    setTooltip({
      label: title,
      left: event.clientX - containerRect.left + 14,
      status: row.status,
      subtitle: formatRangeLabel(row.startDate, row.endDate),
      top: event.clientY - containerRect.top - 18,
    });
  };

  const clearTooltip = () => setTooltip(null);

  const handleTrackPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    setIsPanning(true);
    dragStateRef.current = {
      anchorDate: effectiveAnchorDate,
      axis: null,
      panelWidth: Math.max(target.getBoundingClientRect().width, 1),
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      target,
    };
    ignoreNextClickRef.current = false;
  };

  const handleTrackPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (dragState.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;

    if (!dragState.axis && (Math.abs(deltaX) > 6 || Math.abs(deltaY) > 6)) {
      dragState.axis = Math.abs(deltaX) > Math.abs(deltaY) ? "horizontal" : "vertical";
    }

    if (dragState.axis !== "horizontal") {
      return;
    }

    event.preventDefault();
    const deltaDays = Math.round((-deltaX / dragState.panelWidth) * visibleWindowDays);
    if (deltaDays === 0) {
      return;
    }

    ignoreNextClickRef.current = true;
    const nextAnchorDate = shiftAnchorDate(dragState.anchorDate, deltaDays);
    setPreviewAnchorDate(nextAnchorDate);
    previewAnchorDateRef.current = nextAnchorDate;
  };

  const releaseDrag = (pointerId?: number) => {
    const dragState = dragStateRef.current;
    if (dragState.target && pointerId !== undefined && dragState.target.hasPointerCapture(pointerId)) {
      dragState.target.releasePointerCapture(pointerId);
    }

    dragStateRef.current = {
      anchorDate: effectiveAnchorDate,
      axis: null,
      panelWidth: 0,
      pointerId: null,
      startX: 0,
      startY: 0,
      target: null,
    };
    setIsPanning(false);
  };

  const handleTrackPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current.axis === "horizontal") {
      onAnchorDateChange(previewAnchorDateRef.current);
    }
    releaseDrag(event.pointerId);
  };

  const handleTrackPointerCancel = () => {
    releaseDrag();
  };

  const handleTrackClick = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (ignoreNextClickRef.current) {
      ignoreNextClickRef.current = false;
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const nextDate = resolveDateFromClientX(event.clientX, rect, visibleWindow.start, visibleWindow.end);
    setPlayheadDate(nextDate);
  };

  const handleTrackWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!event.metaKey && !event.ctrlKey) {
      return;
    }

    event.preventDefault();
    const currentIndex = zoomScaleOrder.indexOf(scale);
    const direction = event.deltaY < 0 ? 1 : -1;
    const nextIndex = Math.max(0, Math.min(zoomScaleOrder.length - 1, currentIndex + direction));
    const nextScale = zoomScaleOrder[nextIndex];

    if (nextScale !== scale) {
      onScaleChange(nextScale);
    }
  };

  const interactionHandlers: TimelineInteractionHandlers = {
    onClick: handleTrackClick,
    onPointerCancel: handleTrackPointerCancel,
    onPointerDown: handleTrackPointerDown,
    onPointerMove: handleTrackPointerMove,
    onPointerUp: handleTrackPointerUp,
    onWheel: handleTrackWheel,
  };

  return (
    <SurfaceCard
      className="timeline-surface"
      title="Schedule"
      subtitle="Projects and units across the active planning window."
      aside={
        <div className="timeline-toolbar">
          <div className="timeline-control-group">
            {(Object.entries(scaleLabelMap) as Array<[ScheduleTimelineScale, string]>).map(([value, label]) => (
              <button
                key={value}
                className={`timeline-control-button${scale === value ? " active" : ""}`}
                onClick={() => onScaleChange(value)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>

          <div className="timeline-control-group">
            {(Object.entries(rangeLabelMap) as Array<[ScheduleTimelineRange, string]>).map(([value, label]) => (
              <button
                key={value}
                className={`timeline-control-button${range === value ? " active" : ""}`}
                onClick={() => onRangeChange(value)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>

          <div className="timeline-control-group">
            <button className="timeline-icon-button" onClick={() => shiftWindow(-1)} type="button">
              <ArrowLeft size={14} />
            </button>
            <button className="timeline-icon-button" onClick={setTodayAnchor} type="button">
              <Crosshair size={14} />
              <span>Today</span>
            </button>
            <button className="timeline-icon-button" onClick={() => shiftWindow(1)} type="button">
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      }
    >
      {isLoading ? <div className="empty-state">Loading schedule...</div> : null}

      <div className="timeline-layout" ref={timelineRootRef}>
        <div className="timeline-main">
          <div className="timeline-shared-playhead" style={sharedPlayheadStyle} />
          <div className="timeline-shared-playhead-chip" style={sharedPlayheadStyle}>
            {playheadLabel}
          </div>

          <div className="timeline-header-row">
            <div className="timeline-header-copy">
              <span className="timeline-header-label">Projects / units</span>
            </div>

            <div
              className="timeline-header-panel"
              onClick={interactionHandlers.onClick}
              onPointerCancel={interactionHandlers.onPointerCancel}
              onPointerDown={interactionHandlers.onPointerDown}
              onPointerMove={interactionHandlers.onPointerMove}
              onPointerUp={interactionHandlers.onPointerUp}
              onWheel={interactionHandlers.onWheel}
            >
              <div className="timeline-header-bands timeline-header-bands-months">
                {bands.months.map((band) => (
                  <div
                    key={`header-month-${band.key}`}
                    className="timeline-header-band timeline-header-band-month"
                    style={{ left: `${band.left}%`, width: `${band.width}%` }}
                  >
                    {band.label}
                  </div>
                ))}
              </div>

              {scale !== "month" ? (
                <div className="timeline-header-bands timeline-header-bands-secondary">
                  {bands.header.map((band) => (
                    <div
                      key={`header-secondary-${band.key}`}
                      className={`timeline-header-band timeline-header-band-${scale}`}
                      style={{ left: `${band.left}%`, width: `${band.width}%` }}
                    >
                      {band.label}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="timeline-header-bands timeline-header-bands-secondary is-empty" />
              )}

              <TimelineGrid bands={bands} scale={scale} />
            </div>
          </div>

          <div className="timeline-lanes">
            {snapshot.projects.map((project) => (
              <TimelineLane
                key={project.id}
                bands={bands}
                interactionHandlers={interactionHandlers}
                isExpanded={expandedProjectIds.includes(project.id)}
                onBarHover={updateTooltip}
                onBarLeave={clearTooltip}
                onToggle={() =>
                  setExpandedProjectIds((current) =>
                    current.includes(project.id)
                      ? current.filter((value) => value !== project.id)
                      : [...current, project.id],
                  )
                }
                project={project}
                rangeEnd={visibleWindow.end}
                rangeStart={visibleWindow.start}
                scale={scale}
              />
            ))}
          </div>
        </div>

        {snapshot.unscheduled.length ? (
          <div className="timeline-unscheduled">
            <div className="timeline-unscheduled-header">
              <strong>Unscheduled projects</strong>
              <span>Still visible here until dates are confirmed.</span>
            </div>

            <div className="timeline-unscheduled-list">
              {snapshot.unscheduled.map((project) => (
                <div key={project.id} className="timeline-unscheduled-item">
                  <div className="timeline-lane-title-row">
                    <strong className="timeline-lane-title">{project.name}</strong>
                    <StatusBadge tone={resolveStatusTone(project.status)}>{project.status}</StatusBadge>
                  </div>
                  <span className="timeline-lane-subtitle">{project.client}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {tooltip ? (
          <div className="timeline-tooltip" style={{ left: `${tooltip.left}px`, top: `${tooltip.top}px` }}>
            <strong>{tooltip.label}</strong>
            <span>{tooltip.subtitle}</span>
            <span>{tooltip.status}</span>
          </div>
        ) : null}
      </div>
    </SurfaceCard>
  );
};
