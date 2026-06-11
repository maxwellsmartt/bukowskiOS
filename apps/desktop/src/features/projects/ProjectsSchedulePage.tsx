import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ScheduleTimelineRange, ScheduleTimelineScale } from "@contracts";
import { OverviewScheduleTimeline } from "@features/overview/OverviewScheduleTimeline";
import { useOverviewTimeline } from "@features/overview/useOverviewSnapshot";
import { SectionHeader } from "@shared/components/SectionHeader";
import { useShellContext } from "@shared/hooks/useShellContext";
import { readStringPreference, uiPreferenceKeys, writePreference } from "@shared/lib/preferences";
import { useProjectTimelinePreferences } from "./useProjectTimelinePreferences";

const timelinePageSize = 24;

const todayDateOnly = () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = `${today.getMonth() + 1}`.padStart(2, "0");
  const day = `${today.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const isTimelineRange = (value: string | null): value is ScheduleTimelineRange =>
  value === "30d" || value === "90d" || value === "6m";

const isTimelineScale = (value: string | null): value is ScheduleTimelineScale =>
  value === "day" || value === "week" || value === "month";

export const ProjectsSchedulePage = () => {
  const { t } = useTranslation();
  const { activeWorkspaceId, projectDataVersion } = useShellContext();
  const { hiddenProjectIds, order, setProjectOrder } = useProjectTimelinePreferences(activeWorkspaceId);
  const [timelineRange, setTimelineRange] = useState<ScheduleTimelineRange>(() => {
    const storedValue = readStringPreference(uiPreferenceKeys.overviewTimelineRange, "90d");
    return isTimelineRange(storedValue) ? storedValue : "90d";
  });
  const [timelineScale, setTimelineScale] = useState<ScheduleTimelineScale>(() => {
    const storedValue = readStringPreference(uiPreferenceKeys.overviewTimelineScale, "week");
    return isTimelineScale(storedValue) ? storedValue : "week";
  });
  const [timelineAnchorDate, setTimelineAnchorDate] = useState(() =>
    readStringPreference(uiPreferenceKeys.overviewTimelineAnchorDate, todayDateOnly()) ?? todayDateOnly(),
  );
  const [timelineProjectLimit, setTimelineProjectLimit] = useState(timelinePageSize);
  const { data: timelineSnapshot, isLoading: timelineLoading } = useOverviewTimeline(
    timelineRange,
    timelineScale,
    timelineAnchorDate,
    { workspaceId: activeWorkspaceId, pagination: { limit: timelineProjectLimit, offset: 0 } },
    projectDataVersion,
  );

  useEffect(() => {
    writePreference(uiPreferenceKeys.overviewTimelineRange, timelineRange);
  }, [timelineRange]);

  useEffect(() => {
    writePreference(uiPreferenceKeys.overviewTimelineScale, timelineScale);
  }, [timelineScale]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      writePreference(uiPreferenceKeys.overviewTimelineAnchorDate, timelineAnchorDate);
    }, 140);

    return () => window.clearTimeout(timer);
  }, [timelineAnchorDate]);

  useEffect(() => {
    setTimelineProjectLimit(timelinePageSize);
  }, [timelineRange, timelineScale]);

  return (
    <div className="page-stack page-stack--fill projects-schedule-page-stack">
      <SectionHeader title={t("projects.schedule.title")} />

      <OverviewScheduleTimeline
        anchorDate={timelineAnchorDate}
        isLoading={timelineLoading}
        onAnchorDateChange={setTimelineAnchorDate}
        onLoadMoreProjects={() => setTimelineProjectLimit((current) => current + timelinePageSize)}
        onProjectOrderChange={(nextOrder) => void setProjectOrder(nextOrder)}
        onRangeChange={setTimelineRange}
        onScaleChange={setTimelineScale}
        projectOrder={order}
        range={timelineRange}
        scale={timelineScale}
        hiddenProjectIds={hiddenProjectIds}
        snapshot={timelineSnapshot}
      />
    </div>
  );
};
