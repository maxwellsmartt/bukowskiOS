import type {
  OverviewSnapshot,
  ScheduleTimelineRange,
  ScheduleTimelineScale,
  ScheduleTimelineSnapshot,
} from "@contracts";
import { useAsyncValue } from "@shared/hooks/useAsyncValue";

const emptySnapshot: OverviewSnapshot = {
  metrics: [],
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

export const useOverviewTimeline = (range: ScheduleTimelineRange, scale: ScheduleTimelineScale, anchorDate?: string | null) =>
  useAsyncValue(
    async () => {
      if (!window.bukowskiOverview) {
        return { ...emptyTimeline, range, scale, anchorDate: anchorDate ?? "" };
      }

      return window.bukowskiOverview.getTimeline(range, scale, anchorDate ?? undefined);
    },
    { ...emptyTimeline, range, scale, anchorDate: anchorDate ?? "" },
    [range, scale, anchorDate],
  );
