import type { DatabaseSync } from "node:sqlite";

import type {
  CreateProjectBlueprintInput,
  ListSortDirection,
  OverviewMetric,
  ProjectCardRow,
  ProjectCreationConflictsSnapshot,
  ProjectDetailAssetRow,
  ProjectDetailIncidentRow,
  ProjectDetailSnapshot,
  ProjectListQuery,
  ProjectResponsibleRow,
  ProjectSortField,
  ScheduleTimelinePagination,
  ProjectUnitRow,
  ScheduleTimelineRange,
  ScheduleTimelineScale,
  ScheduleTimelineSnapshot,
  StagingPackingSlipRow,
} from "@contracts";

type SortRows = <T>(rows: T[], comparator: (left: T, right: T) => number) => T[];

type ProjectReadDeps = {
  defaultProjectListQuery: ProjectListQuery;
  formatCurrency: (amount: number | null | undefined) => string;
  matchesSearch: (query: string | undefined, values: Array<string | null | undefined>) => boolean;
  resolveProjectComparator: (sortBy: ProjectSortField, direction: ListSortDirection) => (left: any, right: any) => number;
  resolveTimelineWindow: (
    range: ScheduleTimelineRange,
    scale: ScheduleTimelineScale,
    anchorDate?: string,
  ) => { start: string; end: string; anchorDate: string };
  compareDateOnly: (left: string | null, right: string | null) => number;
  compareProjectStatus: (status: string) => number;
  buildTimelineMarkers: (start: string, end: string, scale: ScheduleTimelineScale) => ScheduleTimelineSnapshot["markers"];
  deriveProjectUnitStatus: (
    startDate: string | null,
    endDate: string | null,
    status: string | null,
    statusSource: string | null,
  ) => { status: ProjectUnitRow["status"]; statusSource: ProjectUnitRow["statusSource"] };
  mapAssetStatus: (operationalStatus: string, custodyStatus: string) => string;
  resolveScheduleWindowLabel: (startDate: string | null, endDate: string | null) => string;
  sortRows: SortRows;
  toIsoDate: (value?: string | null) => string;
  addDays: (date: string, days: number) => string;
};

type CrewAssignmentConflictRow = {
  assignmentId: string;
  crewMemberId: string;
  crewMemberName: string;
  projectId: string;
  projectName: string;
  unitId: string;
  unitName: string;
  startDate: string | null;
  endDate: string | null;
  unitStartDate: string | null;
  unitEndDate: string | null;
};

type UnitConflictSnapshot = {
  conflictCount: number;
  crewConflictCount: number;
  assetConflictCount: number;
  conflictSummary: string | null;
};

type ProjectBlueprintResolvedBucket = {
  unitName: string;
  departmentId: string;
  departmentName: string;
  windows: Array<{
    startDate: string | null;
    endDate: string | null;
  }>;
  assetIds: string[];
  crewAssignments: Array<{
    crewMemberId: string;
    crewMemberName: string;
    windows: Array<{
      startDate: string | null;
      endDate: string | null;
    }>;
  }>;
};

type ProjectBlueprintResolvedUnit = {
  name: string;
  windows: Array<{
    startDate: string | null;
    endDate: string | null;
  }>;
  departments: string[];
  buckets: ProjectBlueprintResolvedBucket[];
};

const uniqueStrings = (values: Array<string | null | undefined>) =>
  [...new Set(values.filter((value): value is string => Boolean(value?.trim())))];

const resolveWindowBounds = (
  startDate: string | null,
  endDate: string | null,
  fallbackStartDate: string | null,
  fallbackEndDate: string | null,
) => ({
  end: endDate ?? fallbackEndDate,
  start: startDate ?? fallbackStartDate,
});

const datesOverlap = (
  leftStartDate: string | null,
  leftEndDate: string | null,
  rightStartDate: string | null,
  rightEndDate: string | null,
) => {
  if (!leftStartDate || !leftEndDate || !rightStartDate || !rightEndDate) {
    return false;
  }

  return leftStartDate <= rightEndDate && rightStartDate <= leftEndDate;
};

const summarizeUnitConflicts = (crewConflictCount: number, assetConflictCount: number) => {
  const parts: string[] = [];

  if (crewConflictCount > 0) {
    parts.push(`${crewConflictCount} crew overlap${crewConflictCount === 1 ? "" : "s"}`);
  }

  if (assetConflictCount > 0) {
    parts.push(`${assetConflictCount} asset overlap${assetConflictCount === 1 ? "" : "s"}`);
  }

  return {
    assetConflictCount,
    conflictCount: crewConflictCount + assetConflictCount,
    conflictSummary: parts.length ? `Attention required: ${parts.join(" · ")}.` : null,
    crewConflictCount,
  } satisfies UnitConflictSnapshot;
};

const activeProjectStatuses = new Set(["Prep", "Active", "On hold"]);

const resolveBlueprintWindowBounds = (
  startDate: string | undefined,
  endDate: string | undefined,
  fallbackStartDate: string | undefined,
  fallbackEndDate: string | undefined,
) => ({
  start: startDate ?? fallbackStartDate ?? null,
  end: endDate ?? fallbackEndDate ?? null,
});

const windowsOverlap = (
  leftWindows: Array<{ startDate: string | null; endDate: string | null }>,
  rightWindows: Array<{ startDate: string | null; endDate: string | null }>,
) =>
  leftWindows.some((leftWindow) =>
    rightWindows.some((rightWindow) => datesOverlap(leftWindow.startDate, leftWindow.endDate, rightWindow.startDate, rightWindow.endDate)),
  );

const overlapWindow = (
  leftWindows: Array<{ startDate: string | null; endDate: string | null }>,
  rightWindows: Array<{ startDate: string | null; endDate: string | null }>,
) =>
  leftWindows.flatMap((leftWindow) =>
    rightWindows
      .filter((rightWindow) => datesOverlap(leftWindow.startDate, leftWindow.endDate, rightWindow.startDate, rightWindow.endDate))
      .map((rightWindow) => ({
        startDate:
          leftWindow.startDate && rightWindow.startDate && leftWindow.startDate > rightWindow.startDate
            ? leftWindow.startDate
            : rightWindow.startDate ?? leftWindow.startDate ?? "",
        endDate:
          leftWindow.endDate && rightWindow.endDate && leftWindow.endDate < rightWindow.endDate
            ? leftWindow.endDate
            : rightWindow.endDate ?? leftWindow.endDate ?? "",
      })),
  )[0] ?? { startDate: "", endDate: "" };

const buildCrewConflictMap = (rows: CrewAssignmentConflictRow[]) => {
  const conflicts = new Map<string, Set<string>>();

  for (let index = 0; index < rows.length; index += 1) {
    for (let nextIndex = index + 1; nextIndex < rows.length; nextIndex += 1) {
      const left = rows[index];
      const right = rows[nextIndex];

      if (left.crewMemberId !== right.crewMemberId) {
        continue;
      }

      if (left.assignmentId === right.assignmentId) {
        continue;
      }

      const leftWindow = resolveWindowBounds(left.startDate, left.endDate, left.unitStartDate, left.unitEndDate);
      const rightWindow = resolveWindowBounds(right.startDate, right.endDate, right.unitStartDate, right.unitEndDate);

      if (!datesOverlap(leftWindow.start, leftWindow.end, rightWindow.start, rightWindow.end)) {
        continue;
      }

      const summary = `${left.crewMemberName} overlaps with ${right.projectName} / ${right.unitName}.`;
      const reverseSummary = `${right.crewMemberName} overlaps with ${left.projectName} / ${left.unitName}.`;

      const leftConflicts = conflicts.get(left.unitId) ?? new Set<string>();
      leftConflicts.add(summary);
      conflicts.set(left.unitId, leftConflicts);

      const rightConflicts = conflicts.get(right.unitId) ?? new Set<string>();
      rightConflicts.add(reverseSummary);
      conflicts.set(right.unitId, rightConflicts);
    }
  }

  return conflicts;
};

export const createProjectReadService = (db: DatabaseSync, deps: ProjectReadDeps) => ({
  getScheduleTimeline(
    range: ScheduleTimelineRange,
    scale: ScheduleTimelineScale,
    anchorDate?: string,
    pagination?: ScheduleTimelinePagination,
  ): ScheduleTimelineSnapshot {
    const window = deps.resolveTimelineWindow(range, scale, anchorDate);
    const rows = db
      .prepare(
        `
          SELECT
            projects.id AS project_id,
            projects.code AS project_code,
            projects.name AS project_name,
            COALESCE(clients.name, projects.client_name, '—') AS client_name,
            projects.status AS project_status,
            projects.color_key AS project_color_key,
            projects.start_date AS project_start_date,
            projects.end_date AS project_end_date,
            projects.has_preproduction AS project_has_preproduction,
            projects.preproduction_start_date AS project_preproduction_start_date,
            projects.preproduction_end_date AS project_preproduction_end_date,
            project_units.id AS unit_id,
            project_units.code AS unit_code,
            project_units.name AS unit_name,
            project_units.sort_order AS unit_sort_order,
            project_units.status AS unit_status,
            project_units.status_source AS unit_status_source,
            project_units.color_key AS unit_color_key,
            project_units.start_date AS unit_start_date,
            project_units.end_date AS unit_end_date
          FROM projects
          LEFT JOIN clients ON clients.id = projects.client_id
          LEFT JOIN project_units ON project_units.project_id = projects.id
            AND COALESCE(project_units.is_primary, 0) = 0
          ORDER BY projects.name, project_units.sort_order, project_units.start_date, project_units.name
        `,
      )
      .all() as Array<{
      project_id: string;
      project_code: string;
      project_name: string;
      client_name: string;
      project_status: string;
      project_color_key: string | null;
      project_start_date: string | null;
      project_end_date: string | null;
      project_has_preproduction: number;
      project_preproduction_start_date: string | null;
      project_preproduction_end_date: string | null;
      unit_id: string | null;
      unit_code: string | null;
      unit_name: string | null;
      unit_sort_order: number | null;
      unit_status: string | null;
      unit_status_source: string | null;
      unit_color_key: string | null;
      unit_start_date: string | null;
      unit_end_date: string | null;
    }>;

    const unitWindows = db
      .prepare(
        `
          SELECT
            id,
            project_unit_id,
            start_date,
            end_date,
            sort_order,
            label
          FROM project_unit_windows
          ORDER BY project_unit_id, sort_order, start_date, end_date
        `,
      )
      .all() as Array<{
      id: string;
      project_unit_id: string;
      start_date: string | null;
      end_date: string | null;
      sort_order: number;
      label: string | null;
    }>;
    const unitWindowsByUnitId = new Map<string, typeof unitWindows>();
    unitWindows.forEach((row) => {
      const list = unitWindowsByUnitId.get(row.project_unit_id) ?? [];
      list.push(row);
      unitWindowsByUnitId.set(row.project_unit_id, list);
    });

    const projectMap = new Map<
      string,
      {
        id: string;
        code: string;
        name: string;
        client: string;
        status: string;
        colorKey: string | null;
        startDate: string | null;
        endDate: string | null;
        segments: ScheduleTimelineSnapshot["projects"][number]["segments"];
        activeUnitCount: number;
        activeIncidentCount: number;
        assignedAssetCount: number;
        crewAssignmentCount: number;
        conflictCount: number;
        crewConflictCount: number;
        assetConflictCount: number;
        incidentMarkers: ScheduleTimelineSnapshot["projects"][number]["incidentMarkers"];
        units: ScheduleTimelineSnapshot["projects"][number]["units"];
      }
    >();

    rows.forEach((row) => {
      const projectEntry: ScheduleTimelineSnapshot["projects"][number] =
        projectMap.get(row.project_id) ??
        {
          id: row.project_id,
          code: row.project_code,
          name: row.project_name,
          client: row.client_name,
          status: row.project_status,
          colorKey: row.project_color_key,
          startDate: row.project_start_date,
          endDate: row.project_end_date,
          segments: [
            {
              id: `${row.project_id}-main`,
              startDate: row.project_start_date,
              endDate: row.project_end_date,
              kind: "project_main",
              label: null,
            },
            ...(row.project_has_preproduction && row.project_preproduction_start_date && row.project_preproduction_end_date
              ? [
                  {
                    id: `${row.project_id}-pre`,
                    startDate: row.project_preproduction_start_date,
                    endDate: row.project_preproduction_end_date,
                    kind: "preproduction" as const,
                    label: "Pre",
                  },
                ]
              : []),
          ],
          activeUnitCount: 0,
          activeIncidentCount: 0,
          assignedAssetCount: 0,
          crewAssignmentCount: 0,
          conflictCount: 0,
          crewConflictCount: 0,
          assetConflictCount: 0,
          incidentMarkers: [],
          units: [],
        };

      if (!projectMap.has(row.project_id)) {
        projectMap.set(row.project_id, projectEntry);
      }

      if (row.unit_id) {
        const resolvedStatus = deps.deriveProjectUnitStatus(
          row.unit_start_date,
          row.unit_end_date,
          row.unit_status,
          row.unit_status_source,
        );

        if (resolvedStatus.status === "active") {
          projectEntry.activeUnitCount += 1;
        }

        const unitSegments =
          (unitWindowsByUnitId.get(row.unit_id) ?? []).map((window) => ({
            id: window.id,
            startDate: window.start_date,
            endDate: window.end_date,
            kind: "unit_window" as const,
            label: window.label,
          })) ||
          [];

        projectEntry.units.push({
          id: row.unit_id,
          code: row.unit_code ?? "UNIT",
          name: row.unit_name ?? "Project unit",
          status: resolvedStatus.status,
          statusSource: resolvedStatus.statusSource,
          colorKey: row.unit_color_key,
          startDate: row.unit_start_date,
          endDate: row.unit_end_date,
          segments:
            unitSegments.length > 0
              ? unitSegments
              : [
                  {
                    id: `${row.unit_id}-legacy-window`,
                    startDate: row.unit_start_date,
                    endDate: row.unit_end_date,
                    kind: "unit_window" as const,
                    label: null,
                  },
                ],
          sortOrder: row.unit_sort_order ?? 0,
          activeIncidentCount: 0,
          assignedAssetCount: 0,
          crewAssignmentCount: 0,
          conflictCount: 0,
          crewConflictCount: 0,
          assetConflictCount: 0,
          incidentMarkers: [],
        });
      }
    });

    const markers = deps.buildTimelineMarkers(window.start, window.end, scale);

    const scheduledProjects: ScheduleTimelineSnapshot["projects"] = [];
    const unscheduled: ScheduleTimelineSnapshot["unscheduled"] = [];

    projectMap.forEach((project) => {
      project.units.sort((left, right) => {
        const sortOrderDelta = left.sortOrder - right.sortOrder;
        if (sortOrderDelta !== 0) {
          return sortOrderDelta;
        }

        const dateDelta = deps.compareDateOnly(left.startDate, right.startDate);
        if (dateDelta !== 0) {
          return dateDelta;
        }

        return left.name.localeCompare(right.name);
      });

      if (!project.startDate && !project.endDate) {
        unscheduled.push({
          id: project.id,
          code: project.code,
          name: project.name,
          client: project.client,
          status: project.status,
          colorKey: project.colorKey,
          activeUnitCount: project.activeUnitCount,
        });
        return;
      }

      scheduledProjects.push(project);
    });

    scheduledProjects.sort((left, right) => {
      const statusDelta = deps.compareProjectStatus(left.status) - deps.compareProjectStatus(right.status);
      if (statusDelta !== 0) {
        return statusDelta;
      }

      const dateDelta = deps.compareDateOnly(left.startDate, right.startDate);
      if (dateDelta !== 0) {
        return dateDelta;
      }

      return left.code.localeCompare(right.code);
    });

    unscheduled.sort((left, right) => left.code.localeCompare(right.code));

    const offset = Math.max(0, pagination?.offset ?? 0);
    const limit = Math.max(1, pagination?.limit ?? 24);
    const pagedProjects = scheduledProjects.slice(offset, offset + limit);

    if (pagedProjects.length) {
      const pagedProjectIds = pagedProjects.map((project) => project.id);
      const pagedUnitIds = pagedProjects.flatMap((project) => project.units.map((unit) => unit.id));
      const projectIdPlaceholders = pagedProjectIds.map(() => "?").join(", ");
      const allCrewAssignmentRows = db
        .prepare(
          `
              SELECT
              project_unit_crew_assignments.id AS assignmentId,
              project_unit_crew_assignments.crew_member_id AS crewMemberId,
              COALESCE(crew_members.full_name, 'Crew') AS crewMemberName,
              project_units.project_id AS projectId,
              projects.name AS projectName,
              project_units.id AS unitId,
              project_units.name AS unitName,
              project_unit_crew_assignments.start_date AS startDate,
              project_unit_crew_assignments.end_date AS endDate,
              project_units.start_date AS unitStartDate,
              project_units.end_date AS unitEndDate
            FROM project_unit_crew_assignments
            JOIN project_units ON project_units.id = project_unit_crew_assignments.project_unit_id
            JOIN projects ON projects.id = project_units.project_id
            LEFT JOIN crew_members ON crew_members.id = project_unit_crew_assignments.crew_member_id
            ORDER BY project_units.project_id, project_units.sort_order, crew_members.full_name
          `,
        )
        .all() as CrewAssignmentConflictRow[];
      const crewConflictMap = buildCrewConflictMap(allCrewAssignmentRows);

      const projectAssetCounts = db
        .prepare(
          `
            SELECT current_project_id AS project_id, COUNT(*) AS asset_count
            FROM asset_current_state
            WHERE current_project_id IN (${projectIdPlaceholders})
            GROUP BY current_project_id
          `,
        )
        .all(...pagedProjectIds) as Array<{ project_id: string; asset_count: number }>;

      const projectCrewCounts = db
        .prepare(
          `
            SELECT project_units.project_id, COUNT(DISTINCT project_unit_crew_assignments.crew_member_id) AS crew_count
            FROM project_unit_crew_assignments
            JOIN project_units ON project_units.id = project_unit_crew_assignments.project_unit_id
            WHERE project_units.project_id IN (${projectIdPlaceholders})
            GROUP BY project_units.project_id
          `,
        )
        .all(...pagedProjectIds) as Array<{ project_id: string; crew_count: number }>;

      const activeIncidentRows = db
        .prepare(
          `
            SELECT
              id,
              project_id,
              project_unit_id,
              title,
              severity,
              reported_at
            FROM incidents
            WHERE project_id IN (${projectIdPlaceholders})
              AND status != 'Resolved'
            ORDER BY reported_at DESC
          `,
        )
        .all(...pagedProjectIds) as Array<{
        id: string;
        project_id: string;
        project_unit_id: string | null;
        title: string;
        severity: string;
        reported_at: string;
      }>;

      const unitAssetCounts = pagedUnitIds.length
        ? (db
            .prepare(
              `
                SELECT project_unit_id, COUNT(*) AS asset_count
                FROM asset_current_state
                WHERE project_unit_id IN (${pagedUnitIds.map(() => "?").join(", ")})
                GROUP BY project_unit_id
              `,
            )
            .all(...pagedUnitIds) as Array<{ project_unit_id: string; asset_count: number }>)
        : [];

      const unitCrewCounts = pagedUnitIds.length
        ? (db
            .prepare(
              `
                SELECT project_unit_id, COUNT(DISTINCT crew_member_id) AS crew_count
                FROM project_unit_crew_assignments
                WHERE project_unit_id IN (${pagedUnitIds.map(() => "?").join(", ")})
                GROUP BY project_unit_id
              `,
            )
            .all(...pagedUnitIds) as Array<{ project_unit_id: string; crew_count: number }>)
        : [];

      const projectAssetCountMap = new Map(projectAssetCounts.map((row) => [row.project_id, row.asset_count]));
      const projectCrewCountMap = new Map(projectCrewCounts.map((row) => [row.project_id, row.crew_count]));
      const unitAssetCountMap = new Map(unitAssetCounts.map((row) => [row.project_unit_id, row.asset_count]));
      const unitCrewCountMap = new Map(unitCrewCounts.map((row) => [row.project_unit_id, row.crew_count]));
      const incidentsByProject = new Map<string, typeof activeIncidentRows>();
      const incidentsByUnit = new Map<string, typeof activeIncidentRows>();

      activeIncidentRows.forEach((row) => {
        const projectList = incidentsByProject.get(row.project_id) ?? [];
        projectList.push(row);
        incidentsByProject.set(row.project_id, projectList);

        if (row.project_unit_id) {
          const unitList = incidentsByUnit.get(row.project_unit_id) ?? [];
          unitList.push(row);
          incidentsByUnit.set(row.project_unit_id, unitList);
        }
      });

      pagedProjects.forEach((project) => {
        const projectIncidents = incidentsByProject.get(project.id) ?? [];
        project.assignedAssetCount = projectAssetCountMap.get(project.id) ?? 0;
        project.crewAssignmentCount = projectCrewCountMap.get(project.id) ?? 0;
        project.activeIncidentCount = projectIncidents.length;
        project.incidentMarkers = projectIncidents.slice(0, 3).map((incident) => ({
          id: incident.id,
          title: incident.title,
          severity: incident.severity,
          reportedAt: incident.reported_at.slice(0, 10),
        }));

        project.units.forEach((unit) => {
          const unitIncidents = incidentsByUnit.get(unit.id) ?? [];
          const unitConflict = summarizeUnitConflicts(crewConflictMap.get(unit.id)?.size ?? 0, 0);
          unit.assignedAssetCount = unitAssetCountMap.get(unit.id) ?? 0;
          unit.crewAssignmentCount = unitCrewCountMap.get(unit.id) ?? 0;
          unit.activeIncidentCount = unitIncidents.length;
          unit.conflictCount = unitConflict.conflictCount;
          unit.crewConflictCount = unitConflict.crewConflictCount;
          unit.assetConflictCount = unitConflict.assetConflictCount;
          unit.incidentMarkers = unitIncidents.slice(0, 2).map((incident) => ({
            id: incident.id,
            title: incident.title,
            severity: incident.severity,
            reportedAt: incident.reported_at.slice(0, 10),
          }));
        });

        project.crewConflictCount = project.units.reduce((sum, unit) => sum + unit.crewConflictCount, 0);
        project.assetConflictCount = project.units.reduce((sum, unit) => sum + unit.assetConflictCount, 0);
        project.conflictCount = project.units.reduce((sum, unit) => sum + unit.conflictCount, 0);
      });
    }

    return {
      range,
      scale,
      anchorDate: window.anchorDate,
      rangeStart: window.start,
      rangeEnd: window.end,
      limit,
      offset,
      totalProjects: scheduledProjects.length,
      visibleProjects: pagedProjects.length,
      hasMoreProjects: offset + pagedProjects.length < scheduledProjects.length,
      markers,
      projects: pagedProjects,
      unscheduled,
    };
  },

  getProjects(query: ProjectListQuery = deps.defaultProjectListQuery): ProjectCardRow[] {
    const rows = db
      .prepare(
        `
          SELECT
            projects.id,
            projects.code,
            projects.name,
            projects.client_id,
            COALESCE(clients.name, projects.client_name, '—') AS client_name,
            projects.production_company_id,
            COALESCE(production_companies.name, projects.production_company_name, '—') AS production_company_name,
            projects.status,
            projects.start_date,
            projects.end_date,
            projects.has_preproduction,
            projects.preproduction_start_date,
            projects.preproduction_end_date,
            projects.color_key,
            COALESCE(projects.description, '—') AS description,
            COALESCE((
              SELECT group_concat(name, ', ')
              FROM (
                SELECT DISTINCT departments.name AS name
                FROM project_departments
                JOIN departments ON departments.id = project_departments.department_id
                WHERE project_departments.project_id = projects.id
                ORDER BY departments.name
              )
            ), COALESCE((
              SELECT group_concat(name, ', ')
              FROM (
                SELECT DISTINCT departments.name AS name
                FROM asset_assignments
                JOIN departments ON departments.id = asset_assignments.department_id
                WHERE asset_assignments.project_id = projects.id
                ORDER BY departments.name
              )
            ), '—')) AS departments,
            COALESCE((
              SELECT SUM(cost_estimate)
              FROM incidents
              WHERE incidents.project_id = projects.id
            ), 0) AS exposure,
            projects.created_at,
            projects.updated_at,
            COALESCE((
              SELECT COUNT(*)
              FROM asset_current_state
              WHERE asset_current_state.current_project_id = projects.id
            ), 0) AS asset_count,
            COALESCE((
              SELECT COUNT(*)
              FROM incidents
              WHERE incidents.project_id = projects.id
            ), 0) AS incident_count
            ,
            COALESCE((
              SELECT COUNT(*)
              FROM project_units
              WHERE project_units.project_id = projects.id
                AND COALESCE(project_units.is_primary, 0) = 0
                AND project_units.status = 'active'
            ), 0) AS active_unit_count
          FROM projects
          LEFT JOIN clients ON clients.id = projects.client_id
          LEFT JOIN production_companies ON production_companies.id = projects.production_company_id
        `,
      )
      .all() as Array<{
      id: string;
      code: string;
      name: string;
      client_id: string | null;
      client_name: string;
      production_company_id: string | null;
      production_company_name: string;
      status: string;
      start_date: string | null;
      end_date: string | null;
      has_preproduction: number;
      preproduction_start_date: string | null;
      preproduction_end_date: string | null;
      color_key: string | null;
      description: string;
      departments: string;
      exposure: number;
      created_at: string | null;
      updated_at: string | null;
      asset_count: number;
      incident_count: number;
      active_unit_count: number;
    }>;

    const mappedRows = rows
      .map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        clientId: row.client_id,
        client: row.client_name,
        productionCompanyId: row.production_company_id,
        productionCompany: row.production_company_name,
        status: row.status,
        startDate: row.start_date,
        endDate: row.end_date,
        hasPreproduction: Boolean(row.has_preproduction),
        preproductionStartDate: row.preproduction_start_date,
        preproductionEndDate: row.preproduction_end_date,
        colorKey: row.color_key,
        departments: row.departments,
        exposure: deps.formatCurrency(row.exposure),
        assetCount: row.asset_count,
        incidentCount: row.incident_count,
        activeUnitCount: row.active_unit_count,
        description: row.description,
        exposureValue: row.exposure,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }))
      .filter((row) =>
        deps.matchesSearch(query.search, [row.code, row.name, row.client, row.status, row.departments, row.description]),
      );

    return deps.sortRows(
      mappedRows,
      deps.resolveProjectComparator(query.sortBy ?? deps.defaultProjectListQuery.sortBy, query.sortDirection ?? deps.defaultProjectListQuery.sortDirection),
    ).map(({ exposureValue: _exposureValue, createdAt: _createdAt, updatedAt: _updatedAt, ...row }) => row);
  },

  getProjectDetail(projectId: string): ProjectDetailSnapshot {
    const project = db
      .prepare(
        `
          SELECT
            projects.id,
            projects.code,
            projects.name,
            projects.client_id,
            COALESCE(clients.name, projects.client_name, '—') AS client_name,
            projects.production_company_id,
            COALESCE(production_companies.name, projects.production_company_name, '—') AS production_company_name,
            projects.status,
            projects.start_date,
            projects.end_date,
            projects.has_preproduction,
            projects.preproduction_start_date,
            projects.preproduction_end_date,
            projects.color_key,
            COALESCE(projects.description, '—') AS description,
            COALESCE((
              SELECT group_concat(name, ', ')
              FROM (
                SELECT DISTINCT departments.name AS name
                FROM project_departments
                JOIN departments ON departments.id = project_departments.department_id
                WHERE project_departments.project_id = projects.id
                ORDER BY departments.name
              )
            ), COALESCE((
              SELECT group_concat(name, ', ')
              FROM (
                SELECT DISTINCT departments.name AS name
                FROM asset_assignments
                JOIN departments ON departments.id = asset_assignments.department_id
                WHERE asset_assignments.project_id = projects.id
                ORDER BY departments.name
              )
            ), '—')) AS departments,
            COALESCE((
              SELECT SUM(cost_estimate)
              FROM incidents
              WHERE incidents.project_id = projects.id
            ), 0) AS exposure,
            COALESCE((
              SELECT COUNT(*)
              FROM asset_current_state
              WHERE asset_current_state.current_project_id = projects.id
            ), 0) AS asset_count,
            COALESCE((
              SELECT COUNT(*)
              FROM incidents
              WHERE incidents.project_id = projects.id
            ), 0) AS incident_count,
            COALESCE((
              SELECT SUM(assets.replacement_value)
              FROM asset_current_state
              JOIN assets ON assets.id = asset_current_state.asset_id
              WHERE asset_current_state.current_project_id = projects.id
            ), 0) AS replacement_at_risk
          FROM projects
          LEFT JOIN clients ON clients.id = projects.client_id
          LEFT JOIN production_companies ON production_companies.id = projects.production_company_id
          WHERE projects.id = ?
          LIMIT 1
        `,
      )
      .get(projectId) as
      | {
          id: string;
          code: string;
          name: string;
          client_id: string | null;
          client_name: string;
          production_company_id: string | null;
          production_company_name: string;
          status: string;
          start_date: string | null;
          end_date: string | null;
          has_preproduction: number;
          preproduction_start_date: string | null;
          preproduction_end_date: string | null;
          color_key: string | null;
          description: string;
          departments: string;
          exposure: number;
          asset_count: number;
          incident_count: number;
          replacement_at_risk: number;
        }
      | undefined;

    if (!project) {
      return {
        project: null,
        schedule: null,
        units: [],
        timelineSummary: null,
        metrics: [],
        assets: [],
        incidents: [],
        responsibles: [],
        budget: {
          totalEntries: deps.formatCurrency(0),
          reserve: deps.formatCurrency(0),
          exposure: deps.formatCurrency(0),
          status: "No project selected",
          note: "Select a project from the sidebar or registry to inspect operational detail.",
        },
      };
    }

    const assets = db
      .prepare(
        `
          SELECT
            assets.id,
            assets.name,
            COALESCE(legacy_rentman_items.legacy_code, assets.internal_code) AS code,
            asset_current_state.operational_status,
            asset_current_state.custody_status,
            asset_current_state.condition_status,
            COALESCE(locations.name, '—') AS location,
            COALESCE(users.full_name, '—') AS responsible,
            assets.replacement_value,
            asset_current_state.project_unit_id,
            COALESCE(project_units.name, '—') AS project_unit
          FROM asset_current_state
          JOIN assets ON assets.id = asset_current_state.asset_id
          LEFT JOIN legacy_rentman_asset_links ON legacy_rentman_asset_links.asset_id = assets.id
          LEFT JOIN legacy_rentman_items ON legacy_rentman_items.id = legacy_rentman_asset_links.legacy_item_id
          LEFT JOIN locations ON locations.id = asset_current_state.current_location_id
          LEFT JOIN project_units ON project_units.id = asset_current_state.project_unit_id
          LEFT JOIN users ON users.id = asset_current_state.current_responsible_user_id
          WHERE asset_current_state.current_project_id = ?
          ORDER BY users.full_name IS NULL, users.full_name, assets.name
        `,
      )
      .all(projectId) as Array<{
      id: string;
      name: string;
      code: string;
      operational_status: string;
      custody_status: string;
      condition_status: string;
      location: string;
      responsible: string;
      replacement_value: number | null;
      project_unit_id: string | null;
      project_unit: string;
    }>;

    const incidents = db
      .prepare(
        `
          SELECT
            incidents.id,
            incidents.title,
            COALESCE(assets.internal_code, '—') AS asset_code,
            COALESCE(users.full_name, '—') AS responsible,
            incidents.severity,
            incidents.cost_estimate,
            incidents.status,
            incidents.project_unit_id,
            COALESCE(project_units.name, '—') AS project_unit
          FROM incidents
          LEFT JOIN assets ON assets.id = incidents.asset_id
          LEFT JOIN project_units ON project_units.id = incidents.project_unit_id
          LEFT JOIN users ON users.id = incidents.responsible_user_id
          WHERE incidents.project_id = ?
          ORDER BY CASE incidents.status
            WHEN 'Open' THEN 0
            WHEN 'In review' THEN 1
            ELSE 2
          END, incidents.reported_at DESC
        `,
      )
      .all(projectId) as Array<{
      id: string;
      title: string;
      asset_code: string;
      responsible: string;
      severity: string;
      cost_estimate: number | null;
      status: string;
      project_unit_id: string | null;
      project_unit: string;
    }>;

    const responsibles = db
      .prepare(
        `
          SELECT
            users.full_name AS name,
            COALESCE((
              SELECT COUNT(*)
              FROM asset_current_state
              WHERE asset_current_state.current_project_id = ?
                AND asset_current_state.current_responsible_user_id = users.id
            ), 0) AS asset_count,
            COALESCE((
              SELECT COUNT(*)
              FROM incidents
              WHERE incidents.project_id = ?
                AND incidents.responsible_user_id = users.id
                AND incidents.status IN ('Open', 'In review')
            ), 0) AS incident_count
          FROM users
          WHERE EXISTS (
            SELECT 1
            FROM asset_current_state
            WHERE asset_current_state.current_project_id = ?
              AND asset_current_state.current_responsible_user_id = users.id
          )
          OR EXISTS (
            SELECT 1
            FROM incidents
            WHERE incidents.project_id = ?
              AND incidents.responsible_user_id = users.id
          )
          ORDER BY asset_count DESC, incident_count DESC, users.full_name
        `,
      )
      .all(projectId, projectId, projectId, projectId) as Array<{
      name: string;
      asset_count: number;
      incident_count: number;
    }>;

    const budgetRow = db
      .prepare(
        `
          SELECT
            COALESCE(SUM(amount), 0) AS total_entries,
            COALESCE(SUM(CASE WHEN entry_type = 'reserve' THEN amount ELSE 0 END), 0) AS reserve_amount,
            COALESCE(SUM(CASE WHEN status IN ('Approved', 'Linked', 'Booked', 'Paid') THEN amount ELSE 0 END), 0) AS committed_amount
          FROM financial_entries
          WHERE project_id = ?
        `,
      )
      .get(projectId) as {
      total_entries: number;
      reserve_amount: number;
      committed_amount: number;
    };

    const unitRows = db
      .prepare(
        `
          SELECT
            project_units.id,
            project_units.code,
            project_units.name,
            project_units.sort_order,
            project_units.status,
            project_units.status_source,
            project_units.color_key,
            project_units.start_date,
            project_units.end_date,
            COALESCE(project_units.notes, '') AS notes,
            COALESCE((
              SELECT group_concat(name, ', ')
              FROM (
                SELECT DISTINCT departments.name AS name
                FROM project_unit_departments
                JOIN departments ON departments.id = project_unit_departments.department_id
                WHERE project_unit_departments.project_unit_id = project_units.id
                ORDER BY departments.name
              )
            ), COALESCE((
              SELECT group_concat(name, ', ')
              FROM (
                SELECT DISTINCT departments.name AS name
                FROM asset_assignments
                JOIN departments ON departments.id = asset_assignments.department_id
                WHERE asset_assignments.project_unit_id = project_units.id
                ORDER BY departments.name
              )
            ), '—')) AS departments,
            project_unit_crew_assignments.id AS assignment_id,
            project_unit_crew_assignments.crew_member_id,
            COALESCE(crew_members.full_name, '—') AS crew_full_name,
            crew_members.linked_user_id,
            COALESCE(project_unit_crew_assignments.role_label, COALESCE(crew_members.role_label, 'Crew')) AS role_label,
            project_unit_crew_assignments.start_date AS assignment_start_date,
            project_unit_crew_assignments.end_date AS assignment_end_date,
            COALESCE(project_unit_crew_assignments.notes, '') AS assignment_notes
          FROM project_units
          LEFT JOIN project_unit_crew_assignments ON project_unit_crew_assignments.project_unit_id = project_units.id
          LEFT JOIN crew_members ON crew_members.id = project_unit_crew_assignments.crew_member_id
          WHERE project_units.project_id = ?
            AND COALESCE(project_units.is_primary, 0) = 0
          ORDER BY project_units.sort_order, project_units.start_date, project_units.name, crew_members.full_name
        `,
      )
      .all(projectId) as Array<{
      id: string;
      code: string;
      name: string;
      sort_order: number;
      status: string;
      status_source: "derived" | "manual_override";
      color_key: string | null;
      start_date: string | null;
      end_date: string | null;
      notes: string;
      departments: string;
      assignment_id: string | null;
      crew_member_id: string | null;
      crew_full_name: string;
      linked_user_id: string | null;
      role_label: string;
      assignment_start_date: string | null;
      assignment_end_date: string | null;
      assignment_notes: string;
    }>;
    const unitWindowRows = db
      .prepare(
        `
          SELECT
            id,
            project_unit_id,
            start_date,
            end_date,
            sort_order,
            label
          FROM project_unit_windows
          WHERE project_unit_id IN (
            SELECT id
            FROM project_units
            WHERE project_id = ?
              AND COALESCE(is_primary, 0) = 0
          )
          ORDER BY project_unit_id, sort_order, start_date, end_date
        `,
      )
      .all(projectId) as Array<{
      id: string;
      project_unit_id: string;
      start_date: string | null;
      end_date: string | null;
      sort_order: number;
      label: string | null;
    }>;
    const unitWindowsByUnitId = new Map<string, typeof unitWindowRows>();
    unitWindowRows.forEach((row) => {
      const list = unitWindowsByUnitId.get(row.project_unit_id) ?? [];
      list.push(row);
      unitWindowsByUnitId.set(row.project_unit_id, list);
    });
    const projectUnitIds = uniqueStrings(unitRows.map((row) => row.id));
    const allCrewAssignmentRows = db
      .prepare(
        `
          SELECT
            project_unit_crew_assignments.id AS assignmentId,
            project_unit_crew_assignments.crew_member_id AS crewMemberId,
            COALESCE(crew_members.full_name, 'Crew') AS crewMemberName,
            project_units.project_id AS projectId,
            projects.name AS projectName,
            project_units.id AS unitId,
            project_units.name AS unitName,
            project_unit_crew_assignments.start_date AS startDate,
            project_unit_crew_assignments.end_date AS endDate,
            project_units.start_date AS unitStartDate,
            project_units.end_date AS unitEndDate
          FROM project_unit_crew_assignments
          JOIN project_units ON project_units.id = project_unit_crew_assignments.project_unit_id
          JOIN projects ON projects.id = project_units.project_id
          LEFT JOIN crew_members ON crew_members.id = project_unit_crew_assignments.crew_member_id
          ORDER BY projects.name, project_units.sort_order, crew_members.full_name
        `,
      )
      .all() as CrewAssignmentConflictRow[];
    const crewConflictMap = buildCrewConflictMap(allCrewAssignmentRows);

    const detailMetrics: OverviewMetric[] = [
      { label: "Assigned assets", value: String(project.asset_count), tone: "info" },
      { label: "Open incidents", value: String(incidents.filter((row) => row.status !== "Closed").length), tone: "critical" },
      { label: "Incident exposure", value: deps.formatCurrency(project.exposure), tone: "warning" },
      { label: "Replacement at risk", value: deps.formatCurrency(project.replacement_at_risk), tone: "neutral" },
    ];

    const assetRows: ProjectDetailAssetRow[] = assets.map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code,
      status: deps.mapAssetStatus(row.operational_status, row.custody_status),
      location: row.location,
      responsible: row.responsible,
      condition: row.condition_status,
      replacementValue: deps.formatCurrency(row.replacement_value),
      projectUnitId: row.project_unit_id,
      projectUnit: row.project_unit,
    }));

    const incidentRows: ProjectDetailIncidentRow[] = incidents.map((row) => ({
      id: row.id,
      title: row.title,
      asset: row.asset_code,
      responsible: row.responsible,
      severity: row.severity,
      costEstimate: deps.formatCurrency(row.cost_estimate),
      status: row.status,
      projectUnitId: row.project_unit_id,
      projectUnit: row.project_unit,
    }));

    const responsibleRows: ProjectResponsibleRow[] = responsibles.map((row) => ({
      name: row.name,
      assetCount: row.asset_count,
      incidentCount: row.incident_count,
    }));

    const unitsMap = new Map<string, ProjectUnitRow>();

    unitRows.forEach((row) => {
      const derived = deps.deriveProjectUnitStatus(row.start_date, row.end_date, row.status, row.status_source);
      const unit =
        unitsMap.get(row.id) ??
        {
          id: row.id,
          code: row.code,
          name: row.name,
          sortOrder: row.sort_order,
          status: derived.status,
          statusSource: derived.statusSource,
          colorKey: row.color_key,
          startDate: row.start_date,
          endDate: row.end_date,
          windows: (unitWindowsByUnitId.get(row.id) ?? []).map((window) => ({
            id: window.id,
            startDate: window.start_date,
            endDate: window.end_date,
            sortOrder: window.sort_order,
            label: window.label,
          })),
          departments: row.departments === "—" ? [] : row.departments.split(", ").filter(Boolean),
          notes: row.notes,
          conflictCount: 0,
          crewConflictCount: 0,
          assetConflictCount: 0,
          conflictSummary: null,
          crewAssignments: [],
        };

      if (!unitsMap.has(row.id)) {
        unitsMap.set(row.id, unit);
      }

      if (row.assignment_id && row.crew_member_id) {
        unit.crewAssignments.push({
          id: row.assignment_id,
          crewMemberId: row.crew_member_id,
          fullName: row.crew_full_name,
          linkedUserId: row.linked_user_id,
          roleLabel: row.role_label,
          startDate: row.assignment_start_date,
          endDate: row.assignment_end_date,
          notes: row.assignment_notes,
        });
      }
    });

    const units = Array.from(unitsMap.values());
    units.forEach((unit) => {
      if (!unit.windows.length) {
        unit.windows = [
          {
            id: `${unit.id}-legacy-window`,
            startDate: unit.startDate,
            endDate: unit.endDate,
            sortOrder: 0,
            label: null,
          },
        ];
      }
    });
    units.forEach((unit) => {
      if (!projectUnitIds.includes(unit.id)) {
        return;
      }

      const conflictSummary = summarizeUnitConflicts(crewConflictMap.get(unit.id)?.size ?? 0, 0);
      unit.conflictCount = conflictSummary.conflictCount;
      unit.crewConflictCount = conflictSummary.crewConflictCount;
      unit.assetConflictCount = conflictSummary.assetConflictCount;
      unit.conflictSummary = conflictSummary.conflictSummary;
    });
    const timelineSummary = {
      activeUnits: units.filter((unit) => unit.status === "active").length,
      plannedUnits: units.filter((unit) => unit.status === "planned").length,
      wrappedUnits: units.filter((unit) => unit.status === "wrapped").length,
      cancelledUnits: units.filter((unit) => unit.status === "cancelled").length,
    };

    const hasBudgetEntries = budgetRow.total_entries > 0;

    return {
      project: {
        id: project.id,
        code: project.code,
        name: project.name,
        clientId: project.client_id,
        client: project.client_name,
        productionCompanyId: project.production_company_id,
        productionCompany: project.production_company_name,
        status: project.status,
        startDate: project.start_date,
        endDate: project.end_date,
        hasPreproduction: Boolean(project.has_preproduction),
        preproductionStartDate: project.preproduction_start_date,
        preproductionEndDate: project.preproduction_end_date,
        colorKey: project.color_key,
        departments: project.departments,
        exposure: deps.formatCurrency(project.exposure),
        assetCount: project.asset_count,
        incidentCount: project.incident_count,
        activeUnitCount: timelineSummary.activeUnits,
        description: project.description,
      },
      schedule: {
        startDate: project.start_date,
        endDate: project.end_date,
        colorKey: project.color_key,
        status: project.status,
        windowLabel: deps.resolveScheduleWindowLabel(project.start_date, project.end_date),
      },
      units,
      timelineSummary,
      metrics: detailMetrics,
      assets: assetRows,
      incidents: incidentRows,
      responsibles: responsibleRows,
      budget: {
        totalEntries: deps.formatCurrency(budgetRow.total_entries),
        reserve: deps.formatCurrency(budgetRow.reserve_amount),
        exposure: deps.formatCurrency(project.exposure),
        status: hasBudgetEntries ? "Finance hooks linked" : "No finance entries yet",
        note: hasBudgetEntries
          ? `Committed foundation entries: ${deps.formatCurrency(budgetRow.committed_amount)}.`
          : "This project is ready for budget, reserve and actual tracking once Finance flows are expanded.",
      },
    };
  },

  getProjectConflicts(input?: { projectId?: string | null; rangeStart?: string | null; rangeEnd?: string | null }) {
    const rangeStart = deps.toIsoDate(input?.rangeStart);
    const rangeEnd = deps.toIsoDate(input?.rangeEnd ?? deps.addDays(rangeStart, 30));
    const rows = db
      .prepare(
        `
          SELECT
            project_units.id,
            project_units.project_id,
            project_units.name,
            project_units.start_date,
            project_units.end_date,
            projects.name AS project_name
          FROM project_units
          JOIN projects ON projects.id = project_units.project_id
          WHERE project_units.start_date IS NOT NULL
            AND project_units.end_date IS NOT NULL
            AND project_units.end_date >= ?
            AND project_units.start_date <= ?
            AND (? IS NULL OR project_units.project_id = ?)
          ORDER BY project_units.start_date, project_units.name
        `,
      )
      .all(rangeStart, rangeEnd, input?.projectId ?? null, input?.projectId ?? null) as Array<{
      id: string;
      project_id: string;
      name: string;
      start_date: string;
      end_date: string;
      project_name: string;
    }>;

    const conflicts: Array<{
      type: "unit_window_overlap" | "crew_overlap";
      leftProjectId: string;
      leftProject: string;
      leftUnitId: string;
      leftUnit: string;
      rightProjectId: string;
      rightProject: string;
      rightUnitId: string;
      rightUnit: string;
      overlapStart: string;
      overlapEnd: string;
      crewMemberId?: string;
      crewMemberName?: string;
    }> = [];

    for (let index = 0; index < rows.length; index += 1) {
      for (let nextIndex = index + 1; nextIndex < rows.length; nextIndex += 1) {
        const left = rows[index];
        const right = rows[nextIndex];

        if (left.project_id === right.project_id && left.id === right.id) {
          continue;
        }

        const overlaps = left.start_date <= right.end_date && right.start_date <= left.end_date;

        if (!overlaps) {
          continue;
        }

        conflicts.push({
          type: "unit_window_overlap",
          leftProjectId: left.project_id,
          leftProject: left.project_name,
          leftUnitId: left.id,
          leftUnit: left.name,
          rightProjectId: right.project_id,
          rightProject: right.project_name,
          rightUnitId: right.id,
          rightUnit: right.name,
          overlapStart: left.start_date > right.start_date ? left.start_date : right.start_date,
          overlapEnd: left.end_date < right.end_date ? left.end_date : right.end_date,
        });
      }
    }

    const crewRows = db
      .prepare(
        `
          SELECT
            project_unit_crew_assignments.id AS assignmentId,
            project_unit_crew_assignments.crew_member_id AS crewMemberId,
            COALESCE(crew_members.full_name, 'Crew') AS crewMemberName,
            project_units.project_id AS projectId,
            projects.name AS projectName,
            project_units.id AS unitId,
            project_units.name AS unitName,
            project_unit_crew_assignments.start_date AS startDate,
            project_unit_crew_assignments.end_date AS endDate,
            project_units.start_date AS unitStartDate,
            project_units.end_date AS unitEndDate
          FROM project_unit_crew_assignments
          JOIN project_units ON project_units.id = project_unit_crew_assignments.project_unit_id
          JOIN projects ON projects.id = project_units.project_id
          LEFT JOIN crew_members ON crew_members.id = project_unit_crew_assignments.crew_member_id
          WHERE (? IS NULL OR project_units.project_id = ?)
             OR crew_member_id IN (
               SELECT DISTINCT project_unit_crew_assignments.crew_member_id
               FROM project_unit_crew_assignments
               JOIN project_units ON project_units.id = project_unit_crew_assignments.project_unit_id
               WHERE (? IS NULL OR project_units.project_id = ?)
             )
          ORDER BY projects.name, project_units.name
        `,
      )
      .all(
        input?.projectId ?? null,
        input?.projectId ?? null,
        input?.projectId ?? null,
        input?.projectId ?? null,
      ) as CrewAssignmentConflictRow[];

    for (let index = 0; index < crewRows.length; index += 1) {
      for (let nextIndex = index + 1; nextIndex < crewRows.length; nextIndex += 1) {
        const left = crewRows[index];
        const right = crewRows[nextIndex];

        if (left.crewMemberId !== right.crewMemberId || left.assignmentId === right.assignmentId) {
          continue;
        }

        const leftWindow = resolveWindowBounds(left.startDate, left.endDate, left.unitStartDate, left.unitEndDate);
        const rightWindow = resolveWindowBounds(right.startDate, right.endDate, right.unitStartDate, right.unitEndDate);
        const overlapStart =
          leftWindow.start && rightWindow.start && leftWindow.start > rightWindow.start ? leftWindow.start : rightWindow.start;
        const overlapEnd = leftWindow.end && rightWindow.end && leftWindow.end < rightWindow.end ? leftWindow.end : rightWindow.end;

        if (!datesOverlap(leftWindow.start, leftWindow.end, rightWindow.start, rightWindow.end)) {
          continue;
        }

        if (!overlapStart || !overlapEnd || overlapEnd < rangeStart || overlapStart > rangeEnd) {
          continue;
        }

        conflicts.push({
          type: "crew_overlap",
          leftProjectId: left.projectId,
          leftProject: left.projectName,
          leftUnitId: left.unitId,
          leftUnit: left.unitName,
          rightProjectId: right.projectId,
          rightProject: right.projectName,
          rightUnitId: right.unitId,
          rightUnit: right.unitName,
          overlapStart,
          overlapEnd,
          crewMemberId: left.crewMemberId,
          crewMemberName: left.crewMemberName,
        });
      }
    }

    return conflicts;
  },

  getStagingPackingSlips(): StagingPackingSlipRow[] {
    const rows = db
      .prepare(
        `
          SELECT
            packing_slips.id,
            COALESCE(users.full_name, '—') AS responsible,
            COALESCE(departments.name, '—') AS department,
            COALESCE(packing_slips.notes, '') AS notes,
            packing_slips.updated_at,
            COUNT(packing_slip_items.id) AS item_count
          FROM packing_slips
          LEFT JOIN users ON users.id = packing_slips.responsible_user_id
          LEFT JOIN departments ON departments.id = packing_slips.department_id
          LEFT JOIN packing_slip_items ON packing_slip_items.packing_slip_id = packing_slips.id
          WHERE COALESCE(packing_slips.lifecycle_state, 'operational') = 'staging'
          GROUP BY packing_slips.id, users.full_name, departments.name, packing_slips.notes, packing_slips.updated_at
          ORDER BY packing_slips.updated_at DESC, packing_slips.id DESC
        `,
      )
      .all() as Array<{
      id: string;
      responsible: string;
      department: string;
      notes: string;
      updated_at: string;
      item_count: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      number: row.id.replace("packing-", "PS-"),
      itemCount: row.item_count,
      responsible: row.responsible,
      department: row.department,
      notes: row.notes,
      updatedAt: row.updated_at,
    }));
  },

  getProjectCreationConflicts(input: CreateProjectBlueprintInput): ProjectCreationConflictsSnapshot {
    const mainWindowStart = input.generalInfo.startDate?.trim() || null;
    const mainWindowEnd = input.generalInfo.endDate?.trim() || null;
    const crewMembers = db
      .prepare("SELECT id, full_name FROM crew_members WHERE workspace_id = ?")
      .all("workspace-default") as Array<{ id: string; full_name: string }>;
    const crewNameMap = new Map(crewMembers.map((row) => [row.id, row.full_name] as const));
    const departmentRows = db
      .prepare("SELECT id, name FROM departments WHERE workspace_id = ?")
      .all("workspace-default") as Array<{ id: string; name: string }>;
    const departmentNameMap = new Map(departmentRows.map((row) => [row.id, row.name] as const));
    const assetLabelRows = db
      .prepare("SELECT id, name FROM assets WHERE workspace_id = ?")
      .all("workspace-default") as Array<{ id: string; name: string }>;
    const assetLabelMap = new Map(assetLabelRows.map((row) => [row.id, row.name] as const));

    const resolveUnitWindows = (
      unit: CreateProjectBlueprintInput["mainUnit"] | CreateProjectBlueprintInput["additionalUnits"][number],
      fallbackName: string,
    ) => {
      const resolvedWindows = (unit.windows ?? []).map((window) =>
        resolveBlueprintWindowBounds(window.startDate, window.endDate, input.generalInfo.startDate, input.generalInfo.endDate),
      );
      return resolvedWindows.length
        ? resolvedWindows.map((window) => ({ startDate: window.start, endDate: window.end }))
        : [{ startDate: mainWindowStart, endDate: mainWindowEnd }];
    };

    const resolveCrewWindows = (
      assignment: CreateProjectBlueprintInput["mainUnit"]["unitDepartments"][number]["crewAssignments"][number],
      fallbackWindows: Array<{ startDate: string | null; endDate: string | null }>,
    ) =>
      assignment.startDate || assignment.endDate
        ? [
            resolveBlueprintWindowBounds(
              assignment.startDate,
              assignment.endDate,
              fallbackWindows[0]?.startDate ?? input.generalInfo.startDate,
              fallbackWindows[0]?.endDate ?? input.generalInfo.endDate,
            ),
          ].map((window) => ({ startDate: window.start, endDate: window.end }))
        : fallbackWindows;

    const resolvedUnits: ProjectBlueprintResolvedUnit[] = [
      {
        name: "Main Unit",
        windows: [{ startDate: mainWindowStart, endDate: mainWindowEnd }],
        departments: input.mainUnit.departmentIds ?? [],
        buckets: (input.mainUnit.unitDepartments ?? []).map((bucket) => ({
          unitName: "Main Unit",
          departmentId: bucket.departmentId,
          departmentName: departmentNameMap.get(bucket.departmentId) ?? "Department",
          windows: [{ startDate: mainWindowStart, endDate: mainWindowEnd }],
          assetIds: [...new Set(bucket.assetIds ?? [])],
          crewAssignments: (bucket.crewAssignments ?? [])
            .filter((assignment) => assignment.crewMemberId?.trim())
            .map((assignment) => ({
              crewMemberId: assignment.crewMemberId,
              crewMemberName: crewNameMap.get(assignment.crewMemberId) ?? "Crew member",
              windows: resolveCrewWindows(assignment, [{ startDate: mainWindowStart, endDate: mainWindowEnd }]),
            })),
        })),
      },
      ...input.additionalUnits.map((unit, index) => {
        const unitName = unit.name || `Additional Unit ${index + 1}`;
        const unitWindows = resolveUnitWindows(unit, unitName);

        return {
          name: unitName,
          windows: unitWindows,
          departments: unit.departmentIds ?? [],
          buckets: (unit.unitDepartments ?? []).map((bucket) => ({
            unitName,
            departmentId: bucket.departmentId,
            departmentName: departmentNameMap.get(bucket.departmentId) ?? "Department",
            windows: unitWindows,
            assetIds: [...new Set(bucket.assetIds ?? [])],
            crewAssignments: (bucket.crewAssignments ?? [])
              .filter((assignment) => assignment.crewMemberId?.trim())
              .map((assignment) => ({
                crewMemberId: assignment.crewMemberId,
                crewMemberName: crewNameMap.get(assignment.crewMemberId) ?? "Crew member",
                windows: resolveCrewWindows(assignment, unitWindows),
              })),
          })),
        };
      }),
    ];

    const resolvedBuckets = resolvedUnits.flatMap((unit) => unit.buckets);

    const assetConflicts: ProjectCreationConflictsSnapshot["groups"][number]["items"] = [];
    const crewConflicts: ProjectCreationConflictsSnapshot["groups"][number]["items"] = [];
    const uniqueAssetIds = [...new Set(resolvedBuckets.flatMap((bucket) => bucket.assetIds))];

    if (uniqueAssetIds.length) {
      resolvedBuckets.forEach((bucket, bucketIndex) => {
        resolvedBuckets.forEach((otherBucket, otherBucketIndex) => {
          if (otherBucketIndex <= bucketIndex) {
            return;
          }

          bucket.assetIds.forEach((assetId) => {
            if (!otherBucket.assetIds.includes(assetId)) {
              return;
            }

            if (!windowsOverlap(bucket.windows, otherBucket.windows)) {
              return;
            }

            const currentOverlapWindow = overlapWindow(bucket.windows, otherBucket.windows);

            assetConflicts.push({
              resourceId: assetId,
              resourceLabel: assetLabelMap.get(assetId) ?? "Asset",
              conflictingProjectId: "draft",
              conflictingProject: "This setup",
              conflictingUnitId: null,
              conflictingUnit: otherBucket.unitName,
              conflictingDepartmentId: otherBucket.departmentId,
              conflictingDepartment: otherBucket.departmentName,
              overlapStart: currentOverlapWindow.startDate,
              overlapEnd: currentOverlapWindow.endDate,
            });

            assetConflicts.push({
              resourceId: assetId,
              resourceLabel: assetLabelMap.get(assetId) ?? "Asset",
              conflictingProjectId: "draft",
              conflictingProject: "This setup",
              conflictingUnitId: null,
              conflictingUnit: bucket.unitName,
              conflictingDepartmentId: bucket.departmentId,
              conflictingDepartment: bucket.departmentName,
              overlapStart: currentOverlapWindow.startDate,
              overlapEnd: currentOverlapWindow.endDate,
            });
          });
        });
      });

      const placeholders = uniqueAssetIds.map(() => "?").join(", ");
      const rows = db
        .prepare(
          `
            SELECT
              asset_current_state.asset_id,
              assets.name AS asset_name,
              projects.id AS project_id,
              projects.name AS project_name,
              projects.status AS project_status,
              project_units.id AS unit_id,
              COALESCE(project_units.name, 'Main Unit') AS unit_name,
              COALESCE(project_units.status, 'active') AS unit_status,
              departments.id AS department_id,
              departments.name AS department_name,
              COALESCE(project_units.start_date, projects.start_date) AS unit_start_date,
              COALESCE(project_units.end_date, projects.end_date) AS unit_end_date
            FROM asset_current_state
            JOIN assets ON assets.id = asset_current_state.asset_id
            LEFT JOIN projects ON projects.id = asset_current_state.current_project_id
            LEFT JOIN project_units ON project_units.id = asset_current_state.project_unit_id
            LEFT JOIN departments ON departments.id = asset_current_state.current_department_id
            WHERE asset_current_state.asset_id IN (${placeholders})
              AND asset_current_state.current_project_id IS NOT NULL
          `,
        )
        .all(...uniqueAssetIds) as Array<{
        asset_id: string;
        asset_name: string;
        project_id: string | null;
        project_name: string | null;
        project_status: string | null;
        unit_id: string | null;
        unit_name: string;
        unit_status: string;
        department_id: string | null;
        department_name: string | null;
        unit_start_date: string | null;
        unit_end_date: string | null;
      }>;

      rows.forEach((row) => {
        if (!row.project_id || !row.project_name || !row.project_status || !activeProjectStatuses.has(row.project_status)) {
          return;
        }

        if (row.unit_status === "cancelled" || row.unit_status === "wrapped") {
          return;
        }

        resolvedBuckets.forEach((bucket) => {
          if (!bucket.assetIds.includes(row.asset_id)) {
            return;
          }

          if (!windowsOverlap(bucket.windows, [{ startDate: row.unit_start_date, endDate: row.unit_end_date }])) {
            return;
          }

          const currentOverlapWindow = overlapWindow(bucket.windows, [{ startDate: row.unit_start_date, endDate: row.unit_end_date }]);
          assetConflicts.push({
            resourceId: row.asset_id,
            resourceLabel: row.asset_name,
            conflictingProjectId: row.project_id!,
            conflictingProject: row.project_name!,
            conflictingUnitId: row.unit_id,
            conflictingUnit: row.unit_name,
            conflictingDepartmentId: row.department_id,
            conflictingDepartment: row.department_name,
            overlapStart: currentOverlapWindow.startDate,
            overlapEnd: currentOverlapWindow.endDate,
          });
        });
      });
    }

    const uniqueCrewIds = [...new Set(resolvedBuckets.flatMap((bucket) => bucket.crewAssignments.map((assignment) => assignment.crewMemberId)))];

    if (uniqueCrewIds.length) {
      resolvedBuckets.forEach((bucket, bucketIndex) => {
        resolvedBuckets.forEach((otherBucket, otherBucketIndex) => {
          if (otherBucketIndex <= bucketIndex) {
            return;
          }

          bucket.crewAssignments.forEach((assignment) => {
            otherBucket.crewAssignments.forEach((otherAssignment) => {
              if (assignment.crewMemberId !== otherAssignment.crewMemberId) {
                return;
              }

              if (!windowsOverlap(assignment.windows, otherAssignment.windows)) {
                return;
              }

              const currentOverlapWindow = overlapWindow(assignment.windows, otherAssignment.windows);

              crewConflicts.push({
                resourceId: assignment.crewMemberId,
                resourceLabel: assignment.crewMemberName,
                conflictingProjectId: "draft",
                conflictingProject: "This setup",
                conflictingUnitId: null,
                conflictingUnit: otherBucket.unitName,
                conflictingDepartmentId: otherBucket.departmentId,
                conflictingDepartment: otherBucket.departmentName,
                overlapStart: currentOverlapWindow.startDate,
                overlapEnd: currentOverlapWindow.endDate,
              });

              crewConflicts.push({
                resourceId: otherAssignment.crewMemberId,
                resourceLabel: otherAssignment.crewMemberName,
                conflictingProjectId: "draft",
                conflictingProject: "This setup",
                conflictingUnitId: null,
                conflictingUnit: bucket.unitName,
                conflictingDepartmentId: bucket.departmentId,
                conflictingDepartment: bucket.departmentName,
                overlapStart: currentOverlapWindow.startDate,
                overlapEnd: currentOverlapWindow.endDate,
              });
            });
          });
        });
      });

      const placeholders = uniqueCrewIds.map(() => "?").join(", ");
      const rows = db
        .prepare(
          `
            SELECT
              project_unit_crew_assignments.crew_member_id,
              COALESCE(crew_members.full_name, 'Crew member') AS crew_name,
              projects.id AS project_id,
              projects.name AS project_name,
              projects.status AS project_status,
              project_units.id AS unit_id,
              project_units.name AS unit_name,
              project_units.status AS unit_status,
              departments.id AS department_id,
              departments.name AS department_name,
              COALESCE(project_unit_crew_assignments.start_date, project_units.start_date, projects.start_date) AS assignment_start_date,
              COALESCE(project_unit_crew_assignments.end_date, project_units.end_date, projects.end_date) AS assignment_end_date
            FROM project_unit_crew_assignments
            JOIN project_units ON project_units.id = project_unit_crew_assignments.project_unit_id
            JOIN projects ON projects.id = project_units.project_id
            LEFT JOIN crew_members ON crew_members.id = project_unit_crew_assignments.crew_member_id
            LEFT JOIN departments ON departments.id = project_unit_crew_assignments.department_id
            WHERE project_unit_crew_assignments.crew_member_id IN (${placeholders})
          `,
        )
        .all(...uniqueCrewIds) as Array<{
        crew_member_id: string;
        crew_name: string;
        project_id: string;
        project_name: string;
        project_status: string;
        unit_id: string;
        unit_name: string;
        unit_status: string;
        department_id: string | null;
        department_name: string | null;
        assignment_start_date: string | null;
        assignment_end_date: string | null;
      }>;

      rows.forEach((row) => {
        if (!activeProjectStatuses.has(row.project_status)) {
          return;
        }

        if (row.unit_status === "cancelled" || row.unit_status === "wrapped") {
          return;
        }

        resolvedBuckets.forEach((bucket) => {
          bucket.crewAssignments.forEach((assignment) => {
            if (assignment.crewMemberId !== row.crew_member_id) {
              return;
            }

            if (!windowsOverlap(assignment.windows, [{ startDate: row.assignment_start_date, endDate: row.assignment_end_date }])) {
              return;
            }

            crewConflicts.push({
              resourceId: row.crew_member_id,
              resourceLabel: assignment.crewMemberName,
              conflictingProjectId: row.project_id,
              conflictingProject: row.project_name,
              conflictingUnitId: row.unit_id,
              conflictingUnit: row.unit_name,
              conflictingDepartmentId: row.department_id,
              conflictingDepartment: row.department_name,
              overlapStart: overlapWindow(assignment.windows, [{ startDate: row.assignment_start_date, endDate: row.assignment_end_date }]).startDate,
              overlapEnd: overlapWindow(assignment.windows, [{ startDate: row.assignment_start_date, endDate: row.assignment_end_date }]).endDate,
            });
          });
        });
      });
    }

    const groups = [
      { type: "crew" as const, label: "Crew conflicts", items: crewConflicts },
      { type: "asset" as const, label: "Asset conflicts", items: assetConflicts },
    ].filter((group) => group.items.length > 0);

    return {
      hasConflicts: groups.length > 0,
      groups,
    };
  },

  getProjectCrewAllocations(projectId: string) {
    const detail = this.getProjectDetail(projectId);

    if (!detail.project) {
      return {
        project: null,
        units: [],
      };
    }

    return {
      project: {
        id: detail.project.id,
        name: detail.project.name,
      },
      units: detail.units.map((unit) => ({
        id: unit.id,
        name: unit.name,
        status: unit.status,
        startDate: unit.startDate,
        endDate: unit.endDate,
        crewAssignments: unit.crewAssignments.map((assignment) => ({
          id: assignment.id,
          crewMemberId: assignment.crewMemberId,
          fullName: assignment.fullName,
          roleLabel: assignment.roleLabel,
          startDate: assignment.startDate,
          endDate: assignment.endDate,
        })),
      })),
    };
  },
});
