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

export const useOverviewTimeline = (range: ScheduleTimelineRange, scale: ScheduleTimelineScale) =>
  useAsyncValue(
    async () => {
      if (!window.bukowskiOverview) {
        return { ...emptyTimeline, range, scale };
      }

      return window.bukowskiOverview.getTimeline(range, scale);
    },
    { ...emptyTimeline, range, scale },
    [range, scale],
  );
