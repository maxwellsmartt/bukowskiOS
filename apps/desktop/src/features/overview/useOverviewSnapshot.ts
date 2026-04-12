import type { OverviewSnapshot, ScheduleTimelineRange, ScheduleTimelineScale, ScheduleTimelineSnapshot } from "@contracts";
import { useAsyncValue } from "@shared/hooks/useAsyncValue";

const emptySnapshot: OverviewSnapshot = {
  cards: {
    overdueReturns: {
      label: "Overdue returns",
      value: "—",
      subtitle: "Slips nearing or past due return need review.",
      tone: "warning",
    },
    openPackingSlips: {
      label: "Open packing slips",
      value: "—",
      subtitle: "Issued slips still active across warehouse and set.",
      tone: "warning",
    },
    activeIncidents: {
      label: "Active incidents",
      value: "—",
      subtitle: "Open issues with pending follow-up or missing estimates.",
      tone: "critical",
    },
    maintenanceWatch: {
      label: "Maintenance watch",
      value: "—",
      subtitle: "Assets flagged for bench review or spare-part follow-up.",
      tone: "success",
    },
  },
  recentMovements: [],
};

const emptyTimeline: ScheduleTimelineSnapshot = {
  range: "90d",
  scale: "week",
  anchorDate: "",
  rangeStart: "",
  rangeEnd: "",
  markers: [],
  projects: [],
  unscheduled: [],
};

export const useOverviewSnapshot = () =>
  useAsyncValue(
    async () => {
      if (!window.bukowskiOverview) {
        return emptySnapshot;
      }

      return window.bukowskiOverview.getSnapshot();
    },
    emptySnapshot,
    [],
  );

export const useOverviewTimeline = (
  range: ScheduleTimelineRange = "90d",
  scale: ScheduleTimelineScale = "week",
  anchorDate?: string,
) =>
  useAsyncValue(
    async () => {
      if (!window.bukowskiOverview) {
        return emptyTimeline;
      }

      return window.bukowskiOverview.getTimeline(range, scale, anchorDate);
    },
    emptyTimeline,
    [range, scale, anchorDate ?? ""],
  );
