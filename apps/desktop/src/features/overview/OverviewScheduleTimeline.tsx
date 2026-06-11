import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Crosshair,
  GripVertical,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { useTranslation } from "react-i18next";

import type {
  ScheduleTimelineProjectLane,
  ScheduleTimelineRange,
  ScheduleTimelineScale,
  ScheduleTimelineSegment,
  ScheduleTimelineSignalDetailItem,
  ScheduleTimelineSignalDetails,
  ScheduleTimelineSnapshot,
  ScheduleTimelineUnitLane,
} from "@contracts";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { useLocale } from "@shared/hooks/useLocale";
import { readJsonPreference, uiPreferenceKeys, writeJsonPreference } from "@shared/lib/preferences";

const dayInMilliseconds = 1000 * 60 * 60 * 24;

const rangeLabelMap: Record<ScheduleTimelineRange, string> = {
  "30d": "30D",
  "90d": "90D",
  "6m": "6M",
};

const scaleLabelMap: Record<ScheduleTimelineScale, string> = {
  day: "overview.timeline.scale.day",
  week: "overview.timeline.scale.week",
  month: "overview.timeline.scale.month",
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

type TimelineGridDensity = "compact" | "balanced" | "expanded";

type TimelineTooltipState = {
  label: string;
  left: number;
  status: string;
  subtitle: string;
  top: number;
};

type TimelineSignalPopoverState = {
  items: ScheduleTimelineSignalDetailItem[];
  left: number;
  remainingCount: number;
  title: string;
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
  density: TimelineGridDensity;
  scale: ScheduleTimelineScale;
};

type TimelineBarGeometry = {
  isCompactLabel: boolean;
  left: number;
  segment: ScheduleTimelineSegment;
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

const SHORT_DATE_OPTS: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
};

const MONTH_LABEL_OPTS: Intl.DateTimeFormatOptions = {
  month: "short",
  timeZone: "UTC",
};

const DAY_LABEL_OPTS: Intl.DateTimeFormatOptions = {
  day: "numeric",
  timeZone: "UTC",
};

// Cached locale-aware formatters. Keyed by `${language}|${opts}` so each
// (locale, option) pair builds exactly one `Intl.DateTimeFormat`.
const timelineFormatterCache = new Map<string, Intl.DateTimeFormat>();
const getTimelineFormatter = (language: string, opts: Intl.DateTimeFormatOptions) => {
  const key = `${language}|${JSON.stringify(opts)}`;
  let f = timelineFormatterCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(language, opts);
    timelineFormatterCache.set(key, f);
  }
  return f;
};
const formatShortDate = (date: Date, language: string) =>
  getTimelineFormatter(language, SHORT_DATE_OPTS).format(date);
const formatMonthLabel = (date: Date, language: string) =>
  getTimelineFormatter(language, MONTH_LABEL_OPTS).format(date);
const formatDayLabel = (date: Date, language: string) =>
  getTimelineFormatter(language, DAY_LABEL_OPTS).format(date);

const getIsoWeekNumber = (value: string) => {
  const date = parseDateOnly(value);
  const dayNumber = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / dayInMilliseconds) + 1) / 7);
};

const formatLocalDateOnly = (value = new Date()) => {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getMillisecondsUntilNextLocalDay = () => {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 1, 0);
  return Math.max(next.getTime() - now.getTime(), 1_000);
};

const todayDateOnly = () => formatLocalDateOnly();

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

const resolveRenderedTimelineWindow = (
  range: ScheduleTimelineRange,
  scale: ScheduleTimelineScale,
  anchorDate: string,
  density: TimelineGridDensity,
) => {
  const totalDays = resolveTimelineRangeLength(range);
  const densityFactor = density === "compact" ? 1 : density === "expanded" ? 0.62 : 0.82;
  const visibleDays = Math.max(Math.round(totalDays * densityFactor), scale === "month" ? 28 : 14);
  const lookbackDays = Math.max(1, Math.floor(visibleDays * 0.2));
  const rawStart = addDays(anchorDate, -lookbackDays);
  const alignedStart = scale === "month" ? startOfMonth(rawStart) : scale === "week" ? startOfWeek(rawStart) : rawStart;

  return {
    end: addDays(alignedStart, visibleDays - 1),
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

const formatRangeLabel = (startDate: string | null, endDate: string | null, language: string) => {
  const isSpanish = language.toLowerCase().startsWith("es");

  if (!startDate && !endDate) {
    return isSpanish ? "Fechas pendientes" : "Dates pending";
  }

  if (startDate && endDate) {
    return `${formatShortDate(parseDateOnly(startDate), language)} – ${formatShortDate(parseDateOnly(endDate), language)}`;
  }

  if (startDate) {
    return `${isSpanish ? "Desde" : "From"} ${formatShortDate(parseDateOnly(startDate), language)}`;
  }

  return `${isSpanish ? "Hasta" : "Until"} ${formatShortDate(parseDateOnly(endDate ?? ""), language)}`;
};

const formatPlayheadDisplayLabel = (value: string, language: string, todayLabel: string) =>
  value === todayDateOnly()
    ? `${todayLabel} · ${formatShortDate(parseDateOnly(value), language)}`
    : formatShortDate(parseDateOnly(value), language);

const extractRgb = (color: string) => {
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);

  if (!match) {
    return null;
  }

  return [Number.parseInt(match[1] ?? "0", 10), Number.parseInt(match[2] ?? "0", 10), Number.parseInt(match[3] ?? "0", 10)] as const;
};

const withAlpha = (color: string, alpha: number) => {
  const rgb = extractRgb(color);

  if (!rgb) {
    return color;
  }

  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
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

const resolveIncidentTone = (severity: string) => {
  const normalized = severity.toLowerCase();

  if (normalized === "high") {
    return "critical" as const;
  }

  if (normalized === "medium") {
    return "warning" as const;
  }

  return "info" as const;
};

const resolveTimelinePalette = (colorKey: string | null) => colorMap[colorKey ?? "slate"] ?? colorMap.slate;

const resolveDateLeft = (date: string, rangeStart: string, rangeEnd: string) => {
  const totalDays = Math.max(diffDays(rangeStart, rangeEnd), 1);
  return (diffDays(rangeStart, clampDate(date, rangeStart, rangeEnd)) / totalDays) * 100;
};

const resolveBarGeometry = (
  row: TimelineBarRow,
  rangeStart: string,
  rangeEnd: string,
  paletteOverride?: (typeof colorMap)[keyof typeof colorMap],
  segment?: ScheduleTimelineSegment,
): TimelineBarGeometry | null => {
  const totalDays = Math.max(diffDaysInclusive(rangeStart, rangeEnd), 1);
  const startDate = segment?.startDate ?? row.startDate ?? rangeStart;
  const endDate = segment?.endDate ?? row.endDate ?? rangeEnd;

  if (endDate < rangeStart || startDate > rangeEnd) {
    return null;
  }

  const clampedStart = clampDate(startDate, rangeStart, rangeEnd);
  const clampedEnd = clampDate(endDate, rangeStart, rangeEnd);
  const leftDays = diffDays(rangeStart, clampedStart);
  const visibleDays = Math.max(diffDaysInclusive(clampedStart, clampedEnd), 1);

  return {
    isCompactLabel: (segment?.kind === "preproduction" ? Math.max((visibleDays / totalDays) * 100, 0.9) : 0) < 3.8,
    left: (leftDays / totalDays) * 100,
    segment:
      segment ??
      ({
        id: `${startDate}-${endDate}`,
        startDate,
        endDate,
        kind: "project_main",
        label: null,
      } satisfies ScheduleTimelineSegment),
    palette: paletteOverride ?? resolveTimelinePalette(row.colorKey),
    width: Math.max((visibleDays / totalDays) * 100, 0.9),
  };
};

const resolveSegmentGeometries = (
  row: TimelineBarRow & { segments?: ScheduleTimelineSegment[] },
  rangeStart: string,
  rangeEnd: string,
  paletteOverride?: (typeof colorMap)[keyof typeof colorMap],
) => {
  const segments = row.segments?.length
    ? row.segments
    : [
        {
          id: `${row.startDate ?? "open"}-${row.endDate ?? "open"}`,
          startDate: row.startDate,
          endDate: row.endDate,
          kind: "project_main" as const,
          label: null,
        },
      ];

  return segments
    .map((segment) => resolveBarGeometry(row, rangeStart, rangeEnd, paletteOverride, segment))
    .filter((geometry): geometry is TimelineBarGeometry => Boolean(geometry));
};

const resolveWindowSegments = (segments: ScheduleTimelineSegment[]) =>
  segments
    .filter((segment) => segment.startDate || segment.endDate)
    .sort((left, right) => {
      if (left.kind === "preproduction" && right.kind !== "preproduction") {
        return -1;
      }

      if (right.kind === "preproduction" && left.kind !== "preproduction") {
        return 1;
      }

      const leftStart = left.startDate ?? "";
      const rightStart = right.startDate ?? "";
      return leftStart.localeCompare(rightStart);
    });

const orderTimelineProjects = (projects: ScheduleTimelineProjectLane[], order: string[]) => {
  if (!order.length) {
    return projects;
  }

  const orderIndex = new Map(order.map((projectId, index) => [projectId, index]));
  return projects
    .map((project, originalIndex) => ({ originalIndex, project }))
    .sort((left, right) => {
      const leftOrder = orderIndex.get(left.project.id) ?? Number.POSITIVE_INFINITY;
      const rightOrder = orderIndex.get(right.project.id) ?? Number.POSITIVE_INFINITY;
      return leftOrder - rightOrder || left.originalIndex - right.originalIndex;
    })
    .map(({ project }) => project);
};

const moveProjectInOrder = (
  projects: ScheduleTimelineProjectLane[],
  existingOrder: string[],
  sourceProjectId: string,
  targetProjectId: string,
) => {
  if (sourceProjectId === targetProjectId) {
    return existingOrder;
  }

  const visibleIds = projects.map((project) => project.id);
  const sourceIndex = visibleIds.indexOf(sourceProjectId);
  const targetIndex = visibleIds.indexOf(targetProjectId);

  if (sourceIndex < 0 || targetIndex < 0) {
    return existingOrder;
  }

  const nextVisibleIds = [...visibleIds];
  const [movedProjectId] = nextVisibleIds.splice(sourceIndex, 1);
  nextVisibleIds.splice(targetIndex, 0, movedProjectId);

  return [
    ...nextVisibleIds,
    ...existingOrder.filter((projectId) => !nextVisibleIds.includes(projectId)),
  ];
};

const formatWindowSegmentChip = (segment: ScheduleTimelineSegment, language: string) => {
  const baseLabel = formatRangeLabel(segment.startDate, segment.endDate, language);
  return segment.kind === "preproduction" ? `${language.toLowerCase().startsWith("es") ? "Pre" : "Pre"} · ${baseLabel}` : baseLabel;
};

const isHeaderBandVisible = (
  band: TimelineBand,
  density: TimelineGridDensity,
  tier: "month" | "secondary" | "day",
  scale: ScheduleTimelineScale,
) => {
  const threshold =
    tier === "month"
      ? density === "compact"
        ? 9
        : density === "expanded"
          ? 5
          : 7
      : tier === "day"
        ? density === "compact"
          ? 1.35
          : density === "expanded"
            ? 0.72
            : 0.98
      : scale === "day"
        ? density === "compact"
          ? 5.6
          : density === "expanded"
            ? 2.4
            : 3.6
        : density === "compact"
          ? 6.2
          : density === "expanded"
            ? 3.4
            : 4.4;

  return band.width >= threshold;
};

const filterHeaderBandsForDisplay = (
  bands: TimelineBand[],
  density: TimelineGridDensity,
  tier: "month" | "secondary" | "day",
  scale: ScheduleTimelineScale,
) => {
  const minGap =
    tier === "month"
      ? density === "compact"
        ? 1.8
        : density === "expanded"
          ? 0.8
          : 1.2
      : tier === "day"
        ? density === "compact"
          ? 0.95
          : density === "expanded"
            ? 0.2
            : 0.55
      : scale === "day"
        ? density === "compact"
          ? 1.5
          : density === "expanded"
            ? 0.6
            : 0.9
        : density === "compact"
          ? 1.8
          : density === "expanded"
            ? 0.8
            : 1.1;

  let lastRight = -Infinity;

  return bands.filter((band) => {
    if (!isHeaderBandVisible(band, density, tier, scale)) {
      return false;
    }

    const left = band.left;
    const right = band.left + band.width;
    if (left - lastRight < minGap) {
      return false;
    }

    lastRight = right;
    return true;
  });
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

const buildMonthBands = (rangeStart: string, rangeEnd: string, language: string) => {
  const bands: TimelineBand[] = [];
  let cursor = startOfMonth(rangeStart);

  while (cursor <= rangeEnd) {
    const nextCursor = startOfMonth(addDays(cursor, 32));
    const monthEnd = addDays(nextCursor, -1);

    if (monthEnd >= rangeStart) {
      bands.push(
        resolveBand(
          cursor,
          monthEnd,
          rangeStart,
          rangeEnd,
          formatMonthLabel(parseDateOnly(cursor), language).toUpperCase(),
        ),
      );
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
      bands.push(resolveBand(cursor, weekEnd, rangeStart, rangeEnd, `W${getIsoWeekNumber(cursor)}`));
    }

    cursor = addDays(cursor, 7);
  }

  return bands;
};

const buildDayBands = (rangeStart: string, rangeEnd: string, language: string) => {
  const totalDays = diffDaysInclusive(rangeStart, rangeEnd);

  return Array.from({ length: totalDays }, (_, index) => {
    const date = addDays(rangeStart, index);
    return resolveBand(date, date, rangeStart, rangeEnd, formatDayLabel(parseDateOnly(date), language));
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

const buildTimelineBands = (
  rangeStart: string,
  rangeEnd: string,
  scale: ScheduleTimelineScale,
  density: TimelineGridDensity,
  language: string,
) => {
  const months = buildMonthBands(rangeStart, rangeEnd, language);
  const weeks = buildWeekBands(rangeStart, rangeEnd);
  const days = buildDayBands(rangeStart, rangeEnd, language);

  if (scale === "day") {
    const baseDayStride = days.length > 150 ? 6 : days.length > 120 ? 5 : days.length > 90 ? 3 : days.length > 60 ? 2 : 1;
    const dayStride =
      density === "compact" ? Math.max(baseDayStride + 1, 2) : density === "expanded" ? Math.max(baseDayStride - 1, 1) : baseDayStride;
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
      days: density === "expanded" ? days : [],
      header: [],
      months,
      weeks,
    };
  }

  const baseWeekStride = weeks.length > 18 ? 2 : 1;
  const weekStride =
    density === "compact" ? Math.max(baseWeekStride + 1, 2) : density === "expanded" ? Math.max(baseWeekStride - 1, 1) : baseWeekStride;
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

const clampFloatingLayerPosition = (
  left: number,
  top: number,
  containerRect: DOMRect,
  estimatedWidth: number,
  estimatedHeight: number,
) => ({
  left: Math.min(Math.max(left, 12), Math.max(containerRect.width - estimatedWidth - 12, 12)),
  top: Math.min(Math.max(top, 12), Math.max(containerRect.height - estimatedHeight - 12, 12)),
});

const deriveUnitPalette = (
  projectPalette: (typeof colorMap)[keyof typeof colorMap],
  unitIndex: number,
) => {
  const alphaVariants = [0.68, 0.56, 0.46, 0.38];
  const alpha = alphaVariants[unitIndex % alphaVariants.length] ?? 0.56;

  return {
    ...projectPalette,
    border: withAlpha(projectPalette.projectFill, Math.max(0.2, alpha * 0.58)),
    focusRing: withAlpha(projectPalette.projectFill, Math.max(0.14, alpha * 0.34)),
    unitFill: withAlpha(projectPalette.projectFill, alpha),
  };
};

const TimelineGrid = ({
  bands,
  density,
  scale,
}: TimelineGridProps) => {
  const monthBoundaryDates = new Set(bands.months.map((band) => band.startDate));
  const weekBoundaryDates = new Set(bands.weeks.map((band) => band.startDate).filter((date) => !monthBoundaryDates.has(date)));
  const dayBands = bands.days.filter((band) => !monthBoundaryDates.has(band.startDate) && !weekBoundaryDates.has(band.startDate));

  return (
  <div className={`timeline-grid-shell timeline-grid-shell-${scale} timeline-grid-shell-density-${density}`}>
    {dayBands.map((band) => (
      <span
        key={`day-${band.key}`}
        className="timeline-grid-line timeline-grid-line-day"
        style={{ left: `${band.left}%` }}
      />
    ))}
    {bands.weeks
      .filter((band) => !monthBoundaryDates.has(band.startDate))
      .map((band) => (
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
};

const TimelineSignalRow = ({
  details,
  incidents,
  assets,
  crew,
  conflicts,
  onChipHover,
  onChipLeave,
}: {
  details: ScheduleTimelineSignalDetails;
  incidents: number;
  assets: number;
  crew: number;
  conflicts: number;
  onChipHover: (
    event: ReactPointerEvent<HTMLButtonElement>,
    title: string,
    items: ScheduleTimelineSignalDetailItem[],
    total: number,
  ) => void;
  onChipLeave: () => void;
}) => {
  const { t } = useTranslation();

  return (
  <div className="timeline-signal-row">
    {conflicts ? (
      <button
        className="timeline-signal-chip is-warning"
        onPointerEnter={(event) => onChipHover(event, t("overview.timeline.signals.conflictsTitle"), details.conflicts, conflicts)}
        onPointerLeave={onChipLeave}
        onPointerMove={(event) => onChipHover(event, t("overview.timeline.signals.conflictsTitle"), details.conflicts, conflicts)}
        type="button"
      >
        {t("overview.timeline.signals.conflicts", { count: conflicts })}
      </button>
    ) : null}
    {incidents ? (
      <button
        className="timeline-signal-chip is-critical"
        onPointerEnter={(event) => onChipHover(event, t("overview.timeline.signals.incidentsTitle"), details.incidents, incidents)}
        onPointerLeave={onChipLeave}
        onPointerMove={(event) => onChipHover(event, t("overview.timeline.signals.incidentsTitle"), details.incidents, incidents)}
        type="button"
      >
        {t("overview.timeline.signals.incidents", { count: incidents })}
      </button>
    ) : null}
    {assets ? (
      <button
        className="timeline-signal-chip"
        onPointerEnter={(event) => onChipHover(event, t("overview.timeline.signals.assetsTitle"), details.assets, assets)}
        onPointerLeave={onChipLeave}
        onPointerMove={(event) => onChipHover(event, t("overview.timeline.signals.assetsTitle"), details.assets, assets)}
        type="button"
      >
        {t("overview.timeline.signals.assets", { count: assets })}
      </button>
    ) : null}
    {crew ? (
      <button
        className="timeline-signal-chip is-info"
        onPointerEnter={(event) => onChipHover(event, t("overview.timeline.signals.crewTitle"), details.crew, crew)}
        onPointerLeave={onChipLeave}
        onPointerMove={(event) => onChipHover(event, t("overview.timeline.signals.crewTitle"), details.crew, crew)}
        type="button"
      >
        {t("overview.timeline.signals.crew", { count: crew })}
      </button>
    ) : null}
    {!conflicts && !incidents && !assets && !crew ? <span className="timeline-signal-chip is-muted">{t("overview.timeline.signals.noLoad")}</span> : null}
  </div>
  );
};

const TimelineWindowPills = ({
  segments,
  language,
}: {
  segments: ScheduleTimelineSegment[];
  language: string;
}) => {
  const { t } = useTranslation();
  const visibleSegments = resolveWindowSegments(segments);

  if (!visibleSegments.length) {
    return <span className="timeline-lane-subtitle">{t("overview.timeline.datesPending")}</span>;
  }

  return (
    <div className={`timeline-window-pill-row${visibleSegments.length > 1 ? " is-multi" : ""}`}>
      {visibleSegments.map((segment, index) => (
        <span
          key={segment.id}
          className={`timeline-window-pill${segment.kind === "preproduction" ? " is-preproduction" : ""}`}
          style={
            segment.kind === "preproduction"
              ? undefined
              : ({
                  background: `hsla(${(index * 41 + 212) % 360} 72% 58% / 0.12)`,
                  borderColor: `hsla(${(index * 41 + 212) % 360} 72% 68% / 0.28)`,
                  color: `hsla(${(index * 41 + 212) % 360} 76% 82% / 0.98)`,
                } as CSSProperties)
          }
        >
          {formatWindowSegmentChip(segment, language)}
        </span>
      ))}
    </div>
  );
};

const TimelineIncidentMarkers = ({
  markers,
  onHover,
  onLeave,
  rangeEnd,
  rangeStart,
}: {
  markers: Array<{ id: string; title: string; severity: string; reportedAt: string }>;
  onHover: (event: ReactPointerEvent<HTMLDivElement>, title: string, severity: string, reportedAt: string) => void;
  onLeave: () => void;
  rangeEnd: string;
  rangeStart: string;
}) => (
  <>
    {markers.map((marker) => (
      <div
        key={marker.id}
        className={`timeline-incident-marker timeline-incident-marker-${marker.severity.toLowerCase()}`}
        onPointerEnter={(event) => onHover(event, marker.title, marker.severity, marker.reportedAt)}
        onPointerLeave={onLeave}
        onPointerMove={(event) => onHover(event, marker.title, marker.severity, marker.reportedAt)}
        style={{ left: `${resolveDateLeft(marker.reportedAt, rangeStart, rangeEnd)}%` }}
      />
    ))}
  </>
);

const TimelineLane = ({
  bands,
  dragOverProjectId,
  draggingProjectId,
  isExpanded,
  onProjectDragEnd,
  onProjectDragOver,
  onProjectDragStart,
  onProjectDrop,
  onBarHover,
  onBarLeave,
  onSignalHover,
  onSignalLeave,
  onToggle,
  project,
  rangeEnd,
  rangeStart,
  density,
  scale,
  language,
}: {
  bands: ReturnType<typeof buildTimelineBands>;
  dragOverProjectId: string | null;
  draggingProjectId: string | null;
  isExpanded: boolean;
  onProjectDragEnd: () => void;
  onProjectDragOver: (event: ReactDragEvent<HTMLDivElement>, projectId: string) => void;
  onProjectDragStart: (event: ReactDragEvent<HTMLButtonElement>, projectId: string) => void;
  onProjectDrop: (event: ReactDragEvent<HTMLDivElement>, projectId: string) => void;
  onBarHover: (
    event: ReactPointerEvent<HTMLDivElement>,
    row: ScheduleTimelineProjectLane | ScheduleTimelineUnitLane,
    parentName?: string,
  ) => void;
  onBarLeave: () => void;
  onSignalHover: (
    event: ReactPointerEvent<HTMLButtonElement>,
    title: string,
    items: ScheduleTimelineSignalDetailItem[],
    total: number,
  ) => void;
  onSignalLeave: () => void;
  onToggle: () => void;
  project: ScheduleTimelineProjectLane;
  rangeEnd: string;
  rangeStart: string;
  density: TimelineGridDensity;
  scale: ScheduleTimelineScale;
  language: string;
}) => {
  const { t } = useTranslation();
  const projectPalette = resolveTimelinePalette(project.colorKey);
  const projectBars = resolveSegmentGeometries(project, rangeStart, rangeEnd, projectPalette);
  const isDragging = draggingProjectId === project.id;
  const isDragTarget = dragOverProjectId === project.id && draggingProjectId !== project.id;

  return (
    <div
      className={`timeline-lane-block${isDragging ? " is-dragging" : ""}${isDragTarget ? " is-drag-target" : ""}`}
      onDragOver={(event) => onProjectDragOver(event, project.id)}
      onDrop={(event) => onProjectDrop(event, project.id)}
    >
      <div className="timeline-lane-row">
        <div className="timeline-lane-meta">
          <button
            aria-label={t("overview.timeline.reorderProject", { name: project.name })}
            className="timeline-lane-reorder-handle"
            draggable
            onDragEnd={onProjectDragEnd}
            onDragStart={(event) => onProjectDragStart(event, project.id)}
            title={t("overview.timeline.reorderProject", { name: project.name })}
            type="button"
          >
            <GripVertical size={14} />
          </button>
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
                      <span className="timeline-status-badge">
                        <StatusBadge tone={resolveStatusTone(project.status)}>{project.status}</StatusBadge>
                      </span>
                    </div>
                    <div className="timeline-lane-subtitle-group">
                      <TimelineWindowPills segments={project.segments} language={language} />
                      {project.units.length ? (
                        <span className="timeline-lane-subtitle-accent">{t("overview.timeline.unitsCount", { count: project.units.length })}</span>
                      ) : null}
                    </div>
                    <TimelineSignalRow
                      assets={project.assignedAssetCount}
                      conflicts={project.conflictCount}
                      crew={project.crewAssignmentCount}
                      details={project.signalDetails}
                      incidents={project.activeIncidentCount}
                      onChipHover={onSignalHover}
                      onChipLeave={onSignalLeave}
                    />
                  </div>
                </div>

        <div className="timeline-track">
          <div className="timeline-track-grid">
            <TimelineGrid
              bands={bands}
              density={density}
              scale={scale}
            />
            {projectBars.map((projectBar) => (
              <div
                key={projectBar.segment.id}
                className={`timeline-bar${project.conflictCount ? " timeline-bar-conflict" : ""}${projectBar.segment.kind === "preproduction" ? " timeline-bar-preproduction" : ""}${projectBar.isCompactLabel ? " timeline-bar-preproduction-compact" : ""}`}
                onPointerEnter={(event) =>
                  onBarHover(
                    event,
                    {
                      ...project,
                      startDate: projectBar.segment.startDate,
                      endDate: projectBar.segment.endDate,
                      status: projectBar.segment.kind === "preproduction" ? "Pre-production" : project.status,
                    },
                    projectBar.segment.label ?? undefined,
                  )
                }
                onPointerLeave={onBarLeave}
                onPointerMove={(event) =>
                  onBarHover(
                    event,
                    {
                      ...project,
                      startDate: projectBar.segment.startDate,
                      endDate: projectBar.segment.endDate,
                      status: projectBar.segment.kind === "preproduction" ? "Pre-production" : project.status,
                    },
                    projectBar.segment.label ?? undefined,
                  )
                }
                style={
                  {
                    "--timeline-bar-fill": projectBar.segment.kind === "preproduction" ? withAlpha(projectBar.palette.projectFill, 0.55) : projectBar.palette.projectFill,
                    "--timeline-bar-focus-ring": projectBar.palette.focusRing,
                    left: `${projectBar.left}%`,
                    width: `${projectBar.width}%`,
                  } as CSSProperties
                }
              >
                {projectBar.segment.label ? <span className="timeline-bar-label">{projectBar.isCompactLabel ? "P" : projectBar.segment.label}</span> : null}
              </div>
            ))}
            <TimelineIncidentMarkers
              markers={project.incidentMarkers}
              onHover={(event, title, severity, reportedAt) =>
                onBarHover(
                  event,
                  {
                    ...project,
                    name: title,
                    status: severity,
                    startDate: reportedAt,
                    endDate: reportedAt,
                  },
                  t("overview.timeline.incident"),
                )
              }
              onLeave={onBarLeave}
              rangeEnd={rangeEnd}
              rangeStart={rangeStart}
            />
          </div>
        </div>
      </div>

      {isExpanded && project.units.length ? (
        <div className="timeline-unit-list">
          {project.units.map((unit, unitIndex) => {
            const unitPalette = deriveUnitPalette(projectPalette, unitIndex);
            const unitBars = resolveSegmentGeometries(unit, rangeStart, rangeEnd, unitPalette);

            return (
              <div key={unit.id} className="timeline-lane-row timeline-lane-row-unit">
                <div className="timeline-lane-meta timeline-lane-meta-unit">
                  <div className="timeline-lane-copy">
                    <div className="timeline-lane-title-row">
                      <span
                        className="timeline-unit-code"
                        style={
                          {
                            "--timeline-unit-chip-bg": withAlpha(unitPalette.unitFill, 0.22),
                            "--timeline-unit-chip-border": unitPalette.border,
                            "--timeline-unit-chip-text": withAlpha(projectPalette.projectFill, 0.94),
                          } as CSSProperties
                        }
                      >
                        {unit.code}
                      </span>
                      <strong className="timeline-lane-title">{unit.name}</strong>
                      <StatusBadge tone={resolveStatusTone(unit.status)}>{unit.status}</StatusBadge>
                    </div>
                    <div className="timeline-lane-subtitle-group">
                      <TimelineWindowPills segments={unit.segments} language={language} />
                    </div>
                    <TimelineSignalRow
                      assets={unit.assignedAssetCount}
                      conflicts={unit.conflictCount}
                      crew={unit.crewAssignmentCount}
                      details={unit.signalDetails}
                      incidents={unit.activeIncidentCount}
                      onChipHover={onSignalHover}
                      onChipLeave={onSignalLeave}
                    />
                  </div>
                </div>

                <div className="timeline-track">
                  <div className="timeline-track-grid">
                    <TimelineGrid
                      bands={bands}
                      density={density}
                      scale={scale}
                    />
                    {unitBars.map((unitBar) => (
                      <div
                        key={unitBar.segment.id}
                        className={`timeline-bar timeline-bar-unit${unit.conflictCount ? " timeline-bar-conflict" : ""}`}
                        onPointerEnter={(event) =>
                          onBarHover(
                            event,
                            {
                              ...unit,
                              startDate: unitBar.segment.startDate,
                              endDate: unitBar.segment.endDate,
                            },
                            project.name,
                          )
                        }
                        onPointerLeave={onBarLeave}
                        onPointerMove={(event) =>
                          onBarHover(
                            event,
                            {
                              ...unit,
                              startDate: unitBar.segment.startDate,
                              endDate: unitBar.segment.endDate,
                            },
                            project.name,
                          )
                        }
                        style={
                          {
                            "--timeline-bar-fill": unitBar.palette.unitFill,
                            "--timeline-bar-focus-ring": unitBar.palette.focusRing,
                            left: `${unitBar.left}%`,
                            width: `${unitBar.width}%`,
                          } as CSSProperties
                        }
                      />
                    ))}
                    <TimelineIncidentMarkers
                      markers={unit.incidentMarkers}
                      onHover={(event, title, severity, reportedAt) =>
                        onBarHover(
                          event,
                          {
                            ...unit,
                            name: title,
                            status: severity,
                            startDate: reportedAt,
                            endDate: reportedAt,
                          },
                          `${project.name} · incident`,
                        )
                      }
                      onLeave={onBarLeave}
                      rangeEnd={rangeEnd}
                      rangeStart={rangeStart}
                    />
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
  hiddenProjectIds?: string[];
  isLoading: boolean;
  onAnchorDateChange: (anchorDate: string) => void;
  onLoadMoreProjects: () => void;
  onProjectOrderChange?: (order: string[]) => void | Promise<void>;
  onRangeChange: (range: ScheduleTimelineRange) => void;
  onScaleChange: (scale: ScheduleTimelineScale) => void;
  projectOrder?: string[];
  range: ScheduleTimelineRange;
  scale: ScheduleTimelineScale;
  snapshot: ScheduleTimelineSnapshot;
};

export const OverviewScheduleTimeline = ({
  anchorDate,
  hiddenProjectIds = [],
  isLoading,
  onAnchorDateChange,
  onLoadMoreProjects,
  onProjectOrderChange,
  onRangeChange,
  onScaleChange,
  projectOrder = [],
  range,
  scale,
  snapshot,
}: OverviewScheduleTimelineProps) => {
  const { t } = useTranslation();
  const { language } = useLocale();
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
  const [gridDensity, setGridDensity] = useState<TimelineGridDensity>(() =>
    readJsonPreference<TimelineGridDensity>(uiPreferenceKeys.overviewTimelineGridDensity, "balanced"),
  );
  const [isPanning, setIsPanning] = useState(false);
  const [isAdjustingGridDensity, setIsAdjustingGridDensity] = useState(false);
  const [currentDate, setCurrentDate] = useState(todayDateOnly());
  const [previewAnchorDate, setPreviewAnchorDate] = useState(anchorDate || todayDateOnly());
  const [tooltip, setTooltip] = useState<TimelineTooltipState | null>(null);
  const [signalPopover, setSignalPopover] = useState<TimelineSignalPopoverState | null>(null);
  const [draggingProjectId, setDraggingProjectId] = useState<string | null>(null);
  const [dragOverProjectId, setDragOverProjectId] = useState<string | null>(null);

  useEffect(() => {
    writeJsonPreference(uiPreferenceKeys.overviewTimelineExpandedProjects, expandedProjectIds);
  }, [expandedProjectIds]);

  useEffect(() => {
    writeJsonPreference(uiPreferenceKeys.overviewTimelineGridDensity, gridDensity);
  }, [gridDensity]);

  useEffect(() => {
    if (!isPanning && !isAdjustingGridDensity) {
      return;
    }

    setTooltip(null);
    setSignalPopover(null);
  }, [isAdjustingGridDensity, isPanning]);

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

  useEffect(() => {
    setExpandedProjectIds((current) => current.filter((projectId) => snapshot.projects.some((project) => project.id === projectId)));
  }, [snapshot.projects]);

  useEffect(() => {
    let timeoutId = 0;

    const syncCurrentDate = () => {
      const nextDate = todayDateOnly();
      setCurrentDate((previousDate) => (previousDate === nextDate ? previousDate : nextDate));
    };

    const scheduleNextSync = () => {
      timeoutId = window.setTimeout(() => {
        syncCurrentDate();
        scheduleNextSync();
      }, getMillisecondsUntilNextLocalDay());
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        syncCurrentDate();
      }
    };

    syncCurrentDate();
    scheduleNextSync();
    window.addEventListener("focus", syncCurrentDate);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener("focus", syncCurrentDate);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const effectiveAnchorDate = previewAnchorDate || anchorDate || todayDateOnly();
  const hiddenProjectIdSet = useMemo(() => new Set(hiddenProjectIds), [hiddenProjectIds]);
  const visibleProjects = useMemo(
    () => orderTimelineProjects(snapshot.projects.filter((project) => !hiddenProjectIdSet.has(project.id)), projectOrder),
    [hiddenProjectIdSet, projectOrder, snapshot.projects],
  );
  const visibleUnscheduled = useMemo(
    () => snapshot.unscheduled.filter((project) => !hiddenProjectIdSet.has(project.id)),
    [hiddenProjectIdSet, snapshot.unscheduled],
  );
  const visibleWindow = useMemo(
    () => resolveRenderedTimelineWindow(range, scale, effectiveAnchorDate, gridDensity),
    [effectiveAnchorDate, gridDensity, range, scale],
  );
  const visibleWindowDays = diffDaysInclusive(visibleWindow.start, visibleWindow.end);
  const timelineSummary = useMemo(() => {
    const loadedProjects = visibleProjects.length;
    const visibleUnits = visibleProjects.reduce((total, project) => total + project.units.length, 0);
    const conflicts = visibleProjects.reduce((total, project) => total + project.conflictCount, 0);
    const incidents = visibleProjects.reduce((total, project) => total + project.activeIncidentCount, 0);
    const activeSignals = conflicts + incidents;

    return {
      activeSignals,
      conflicts,
      incidents,
      loadedProjects,
      unscheduled: visibleUnscheduled.length,
      visibleUnits,
    };
  }, [visibleProjects, visibleUnscheduled.length]);
  const hasTimelineData = timelineSummary.loadedProjects > 0 || timelineSummary.unscheduled > 0;
  const clampedPlayheadDate =
    visibleWindow.start && visibleWindow.end
      ? clampDate(currentDate, visibleWindow.start, visibleWindow.end)
      : currentDate;
  const playheadLeft =
    visibleWindow.start && visibleWindow.end
      ? resolveDateLeft(clampedPlayheadDate, visibleWindow.start, visibleWindow.end)
      : 0;
  const renderedPlayheadLeft = Math.min(99.2, Math.max(0.8, playheadLeft));
  const playheadLabel = formatPlayheadDisplayLabel(currentDate, language, t("overview.timeline.today"));
  const bands = useMemo(() => {
    if (!visibleWindow.start || !visibleWindow.end) {
      return emptyBands;
    }

    return buildTimelineBands(visibleWindow.start, visibleWindow.end, scale, gridDensity, language);
  }, [gridDensity, scale, visibleWindow.end, visibleWindow.start, language]);
  const visibleMonthBands = useMemo(
    () => filterHeaderBandsForDisplay(bands.months, gridDensity, "month", scale),
    [bands.months, gridDensity, scale],
  );
  const visibleSecondaryBands = useMemo(
    () => filterHeaderBandsForDisplay(bands.header, gridDensity, "secondary", scale),
    [bands.header, gridDensity, scale],
  );
  const visibleDayBands = useMemo(
    () => filterHeaderBandsForDisplay(bands.days, gridDensity, "day", scale),
    [bands.days, gridDensity, scale],
  );

  const sharedPlayheadStyle = useMemo(
    () => ({
      left: `calc(var(--timeline-meta-width) + var(--timeline-column-gap) + ((100% - var(--timeline-meta-width) - var(--timeline-column-gap)) * ${
        renderedPlayheadLeft / 100
      }))`,
    }),
    [renderedPlayheadLeft],
  );

  const setTodayAnchor = () => {
    setPreviewAnchorDate(currentDate);
    previewAnchorDateRef.current = currentDate;
    onAnchorDateChange(currentDate);
  };

  const shiftWindow = (direction: -1 | 1) => {
    const nextAnchorDate = shiftAnchorDate(effectiveAnchorDate, direction * visibleWindowDays);
    setPreviewAnchorDate(nextAnchorDate);
    previewAnchorDateRef.current = nextAnchorDate;
    onAnchorDateChange(nextAnchorDate);
  };

  const gridDensityValue = gridDensity === "compact" ? 0 : gridDensity === "expanded" ? 2 : 1;
  const isTimelineInteracting = isPanning || isAdjustingGridDensity;

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
    const position = clampFloatingLayerPosition(
      event.clientX - containerRect.left + 14,
      event.clientY - containerRect.top - 18,
      containerRect,
      280,
      92,
    );
    setTooltip({
      label: title,
      left: position.left,
      status: row.status,
      subtitle: formatRangeLabel(row.startDate, row.endDate, language),
      top: position.top,
    });
  };

  const clearTooltip = () => setTooltip(null);

  const updateSignalPopover = (
    event: ReactPointerEvent<HTMLButtonElement>,
    title: string,
    items: ScheduleTimelineSignalDetailItem[],
    total: number,
  ) => {
    const containerRect = timelineRootRef.current?.getBoundingClientRect();
    if (!containerRect) {
      return;
    }

    const position = clampFloatingLayerPosition(
      event.clientX - containerRect.left + 14,
      event.clientY - containerRect.top + 14,
      containerRect,
      332,
      220,
    );
    setSignalPopover({
      items:
        items.length > 0
          ? items
          : [
              {
                id: `${title.toLowerCase().replace(/\s+/g, "-")}-empty`,
                label: t("overview.timeline.detailsUnavailable"),
                meta: null,
              },
            ],
      left: position.left,
      remainingCount: Math.max(total - items.length, 0),
      title,
      top: position.top,
    });
  };

  const clearSignalPopover = () => setSignalPopover(null);

  const handleProjectDragStart = (event: ReactDragEvent<HTMLButtonElement>, projectId: string) => {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", projectId);
    setDraggingProjectId(projectId);
    setDragOverProjectId(projectId);
    setTooltip(null);
    setSignalPopover(null);
  };

  const handleProjectDragOver = (event: ReactDragEvent<HTMLDivElement>, projectId: string) => {
    if (!draggingProjectId || draggingProjectId === projectId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOverProjectId(projectId);
  };

  const handleProjectDrop = (event: ReactDragEvent<HTMLDivElement>, targetProjectId: string) => {
    event.preventDefault();
    event.stopPropagation();
    const sourceProjectId = event.dataTransfer.getData("text/plain") || draggingProjectId;

    setDraggingProjectId(null);
    setDragOverProjectId(null);

    if (!sourceProjectId || sourceProjectId === targetProjectId) {
      return;
    }

    const nextOrder = moveProjectInOrder(visibleProjects, projectOrder, sourceProjectId, targetProjectId);
    void onProjectOrderChange?.(nextOrder);
  };

  const handleProjectDragEnd = () => {
    setDraggingProjectId(null);
    setDragOverProjectId(null);
  };

  const handleTrackPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    const interactiveTarget = (event.target as HTMLElement | null)?.closest("button, input, a, select, textarea, [role='button']");
    if (interactiveTarget) {
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

  const handleTrackClick = (_event: ReactPointerEvent<HTMLDivElement>) => {
    if (ignoreNextClickRef.current) {
      ignoreNextClickRef.current = false;
    }
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
      className="surface-card--fill timeline-surface"
      title={t("overview.timeline.title")}
      aside={
        <div className="timeline-toolbar">
          <div className="timeline-window-indicator" aria-label={t("overview.timeline.summary.window")}>
            <span>{t("overview.timeline.summary.window")}</span>
            <strong>{formatRangeLabel(visibleWindow.start, visibleWindow.end, language)}</strong>
          </div>

          <div className="timeline-toolbar-cluster">
            <span className="timeline-toolbar-label">{t("overview.timeline.controls.view")}</span>
            <div className="timeline-control-group">
              {(Object.entries(scaleLabelMap) as Array<[ScheduleTimelineScale, string]>).map(([value, label]) => (
                <button
                  key={value}
                  className={`timeline-control-button${scale === value ? " active" : ""}`}
                  onClick={() => onScaleChange(value)}
                  title={t(label)}
                  type="button"
                >
                  {t(label)}
                </button>
              ))}
            </div>
          </div>

          <div className="timeline-toolbar-cluster">
            <span className="timeline-toolbar-label">{t("overview.timeline.controls.range")}</span>
            <div className="timeline-control-group">
              {(Object.entries(rangeLabelMap) as Array<[ScheduleTimelineRange, string]>).map(([value, label]) => (
                <button
                  key={value}
                  className={`timeline-control-button${range === value ? " active" : ""}`}
                  onClick={() => onRangeChange(value)}
                  title={label}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="timeline-toolbar-cluster">
            <span className="timeline-toolbar-label">{t("overview.timeline.controls.move")}</span>
            <div className="timeline-control-group">
              <button
                aria-label={t("overview.timeline.previousWindow")}
                className="timeline-icon-button"
                onClick={() => shiftWindow(-1)}
                title={t("overview.timeline.previousWindow")}
                type="button"
              >
                <ArrowLeft size={14} />
              </button>
              <button
                aria-label={t("overview.timeline.today")}
                className="timeline-icon-button"
                onClick={setTodayAnchor}
                title={t("overview.timeline.today")}
                type="button"
              >
                <Crosshair size={14} />
                <span>{t("overview.timeline.today")}</span>
              </button>
              <button
                aria-label={t("overview.timeline.nextWindow")}
                className="timeline-icon-button"
                onClick={() => shiftWindow(1)}
                title={t("overview.timeline.nextWindow")}
                type="button"
              >
                <ArrowRight size={14} />
              </button>
            </div>
          </div>

          <div className="timeline-toolbar-cluster timeline-toolbar-cluster-density">
            <span className="timeline-toolbar-label">{t("overview.timeline.controls.density")}</span>
            <div className="timeline-control-group timeline-control-group-grid">
              <span className="timeline-density-caption">{t(`overview.timeline.density.${gridDensity}`)}</span>
              <input
                aria-label={t("overview.timeline.gridDensity")}
                className="timeline-grid-density-slider"
                max={2}
                min={0}
                onPointerCancel={() => setIsAdjustingGridDensity(false)}
                onPointerDown={() => setIsAdjustingGridDensity(true)}
                onPointerUp={() => setIsAdjustingGridDensity(false)}
                onChange={(event) => {
                  const nextValue = Number.parseInt(event.target.value, 10);
                  setGridDensity(nextValue <= 0 ? "compact" : nextValue >= 2 ? "expanded" : "balanced");
                }}
                step={1}
                title={t("overview.timeline.gridDensity")}
                type="range"
                value={gridDensityValue}
              />
            </div>
          </div>
        </div>
      }
    >
      {isLoading && !snapshot.projects.length && !snapshot.unscheduled.length ? <div className="empty-state">{t("overview.timeline.loading")}</div> : null}

      {!isLoading && !hasTimelineData ? (
        <div className="timeline-empty-panel">
          <strong>{t("overview.timeline.empty.title")}</strong>
          <span>{t("overview.timeline.empty.body")}</span>
        </div>
      ) : null}

      <div
        className={`timeline-layout${isTimelineInteracting ? " is-interacting" : ""}${hasTimelineData ? "" : " is-empty"}`}
        onClick={interactionHandlers.onClick}
        onPointerCancel={interactionHandlers.onPointerCancel}
        onPointerDown={interactionHandlers.onPointerDown}
        onPointerMove={interactionHandlers.onPointerMove}
        onPointerUp={interactionHandlers.onPointerUp}
        onWheel={interactionHandlers.onWheel}
        ref={timelineRootRef}
      >
        <div className="timeline-main">
          <div className="timeline-header-row">
            <div className="timeline-sticky-playhead-line" style={sharedPlayheadStyle} />
            <div className="timeline-sticky-playhead-marker" style={sharedPlayheadStyle} />
            <div className="timeline-sticky-playhead-chip" style={sharedPlayheadStyle}>
              {playheadLabel}
            </div>
            <div className="timeline-header-copy">
              <span className="timeline-header-label">{t("overview.timeline.projectsUnits")}</span>
            </div>

            <div className="timeline-header-panel">
              <div className="timeline-header-bands timeline-header-bands-months">
                {visibleMonthBands.map((band) => (
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
                  {visibleSecondaryBands.map((band) => (
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

              {scale !== "month" ? (
                <div className="timeline-header-bands timeline-header-bands-tertiary">
                  {visibleDayBands.map((band) => (
                    <div
                      key={`header-day-${band.key}`}
                      className="timeline-header-band timeline-header-band-day"
                      style={{ left: `${band.left}%`, width: `${band.width}%` }}
                    >
                      {band.label}
                    </div>
                  ))}
                </div>
              ) : null}

              <TimelineGrid bands={bands} density={gridDensity} scale={scale} />
            </div>
          </div>

          <div className="timeline-lanes">
            {visibleProjects.map((project) => (
              <TimelineLane
                key={project.id}
                bands={bands}
                dragOverProjectId={dragOverProjectId}
                draggingProjectId={draggingProjectId}
                isExpanded={expandedProjectIds.includes(project.id)}
                onBarHover={updateTooltip}
                onBarLeave={clearTooltip}
                onProjectDragEnd={handleProjectDragEnd}
                onProjectDragOver={handleProjectDragOver}
                onProjectDragStart={handleProjectDragStart}
                onProjectDrop={handleProjectDrop}
                onSignalHover={updateSignalPopover}
                onSignalLeave={clearSignalPopover}
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
                density={gridDensity}
                scale={scale}
                language={language}
              />
            ))}
          </div>

          {snapshot.hasMoreProjects ? (
            <div className="timeline-load-more-row">
              <button
                className="timeline-load-more-button"
                onClick={onLoadMoreProjects}
                type="button"
              >
                {t("overview.timeline.showMore")}
              </button>
            </div>
          ) : null}
        </div>

        {visibleUnscheduled.length ? (
          <div className="timeline-unscheduled">
            <div className="timeline-unscheduled-header">
              <strong>{t("overview.timeline.unscheduled.title")}</strong>
              <span>{t("overview.timeline.unscheduled.body")}</span>
            </div>

            <div className="timeline-unscheduled-list">
              {visibleUnscheduled.map((project) => (
                <div key={project.id} className="timeline-unscheduled-item">
                  <div className="timeline-lane-title-row">
                    <strong className="timeline-lane-title">{project.name}</strong>
                    <span className="timeline-status-badge">
                      <StatusBadge tone={resolveStatusTone(project.status)}>{project.status}</StatusBadge>
                    </span>
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

        {signalPopover ? (
          <div className="timeline-signal-popover" style={{ left: `${signalPopover.left}px`, top: `${signalPopover.top}px` }}>
            <strong>{signalPopover.title}</strong>
            <div className="timeline-signal-popover-list">
              {signalPopover.items.map((item) => (
                <div key={item.id} className="timeline-signal-popover-item">
                  <span className="timeline-signal-popover-label">{item.label}</span>
                  {item.meta ? <span className="timeline-signal-popover-meta">{item.meta}</span> : null}
                </div>
              ))}
            </div>
            {signalPopover.remainingCount ? (
              <span className="timeline-signal-popover-more">{t("overview.timeline.more", { count: signalPopover.remainingCount })}</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </SurfaceCard>
  );
};
