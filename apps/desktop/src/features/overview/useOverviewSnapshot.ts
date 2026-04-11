import type {
  OverviewSnapshot,
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

export const useOverviewTimeline = () =>
  useAsyncValue(
    async () => {
      if (!window.bukowskiOverview) {
        return emptyTimeline;
      }

      return window.bukowskiOverview.getTimeline("90d", "week");
    },
    emptyTimeline,
    [],
  );
