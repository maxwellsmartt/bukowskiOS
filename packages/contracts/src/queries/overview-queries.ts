export type MetricTone = "neutral" | "info" | "warning" | "critical" | "success";

export type OverviewMetric = {
  label: string;
  value: string;
  tone: MetricTone;
};

export type OverviewOperationalCard = {
  label: string;
  value: string;
  subtitle: string;
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
export type ScheduleTimelineScale = "day" | "week" | "month";

export type ScheduleTimelinePagination = {
  limit?: number;
  offset?: number;
};

export type ScheduleTimelineMarker = {
  key: string;
  label: string;
  startDate: string;
  endDate: string;
};

export type ScheduleTimelineSegment = {
  id: string;
  startDate: string | null;
  endDate: string | null;
  kind: "project_main" | "preproduction" | "unit_window";
  label?: string | null;
};

export type ScheduleTimelineSignalDetailItem = {
  id: string;
  label: string;
  meta?: string | null;
};

export type ScheduleTimelineSignalDetails = {
  assets: ScheduleTimelineSignalDetailItem[];
  crew: ScheduleTimelineSignalDetailItem[];
  conflicts: ScheduleTimelineSignalDetailItem[];
  incidents: ScheduleTimelineSignalDetailItem[];
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
  segments: ScheduleTimelineSegment[];
  sortOrder: number;
  activeIncidentCount: number;
  assignedAssetCount: number;
  crewAssignmentCount: number;
  conflictCount: number;
  crewConflictCount: number;
  assetConflictCount: number;
  incidentMarkers: Array<{
    id: string;
    title: string;
    severity: string;
    reportedAt: string;
  }>;
  signalDetails: ScheduleTimelineSignalDetails;
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
  segments: ScheduleTimelineSegment[];
  activeUnitCount: number;
  activeIncidentCount: number;
  assignedAssetCount: number;
  crewAssignmentCount: number;
  conflictCount: number;
  crewConflictCount: number;
  assetConflictCount: number;
  incidentMarkers: Array<{
    id: string;
    title: string;
    severity: string;
    reportedAt: string;
  }>;
  signalDetails: ScheduleTimelineSignalDetails;
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
  anchorDate: string;
  rangeStart: string;
  rangeEnd: string;
  limit: number;
  offset: number;
  totalProjects: number;
  visibleProjects: number;
  hasMoreProjects: boolean;
  markers: ScheduleTimelineMarker[];
  projects: ScheduleTimelineProjectLane[];
  unscheduled: ScheduleTimelineUnscheduledRow[];
};

export type OverviewSnapshot = {
  cards: {
    overdueReturns: OverviewOperationalCard;
    openPackingSlips: OverviewOperationalCard;
    activeIncidents: OverviewOperationalCard;
    maintenanceWatch: OverviewOperationalCard;
  };
  recentMovements: RecentMovementRow[];
};
