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

export type OverviewSnapshot = {
  metrics: OverviewMetric[];
  recentMovements: RecentMovementRow[];
};
