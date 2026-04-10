export type MetricTone = "neutral" | "info" | "warning" | "critical" | "success";

export type OverviewMetric = {
  label: string;
  value: string;
  tone: MetricTone;
};

export type RecentMovementRow = {
  asset: string;
  code: string;
  from: string;
  to: string;
  actor: string;
  timestamp: string;
};

export type ScheduleTimelineRange = "30d" | "90d" | "6m";
export type ScheduleTimelineScale = "week";

export type ScheduleTimelineMarker = {
  key: string;
  label: string;
  startDate: string;
  endDate: string;
};

export type ScheduleTimelineUnitLane = {
  id: string;
  code: string;
  name: string;
  status: string;
  statusSource: "derived" | "manual_override";
  colorKey: string | null;
  startDate: string | null;
  endDate: string | null;
  sortOrder: number;
};

export type ScheduleTimelineProjectLane = {
  id: string;
  code: string;
  name: string;
  client: string;
  status: string;
  colorKey: string | null;
  startDate: string | null;
  endDate: string | null;
  activeUnitCount: number;
  units: ScheduleTimelineUnitLane[];
};

export type ScheduleTimelineUnscheduledRow = {
  id: string;
  code: string;
  name: string;
  client: string;
  status: string;
  colorKey: string | null;
  activeUnitCount: number;
};

export type ScheduleTimelineSnapshot = {
  range: ScheduleTimelineRange;
  scale: ScheduleTimelineScale;
  rangeStart: string;
  rangeEnd: string;
  markers: ScheduleTimelineMarker[];
  projects: ScheduleTimelineProjectLane[];
  unscheduled: ScheduleTimelineUnscheduledRow[];
};

export type OverviewSnapshot = {
  metrics: OverviewMetric[];
  recentMovements: RecentMovementRow[];
};
