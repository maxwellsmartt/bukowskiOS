import type { DatabaseSync } from "node:sqlite";

import type {
  ListSortDirection,
  OverviewMetric,
  ProjectCardRow,
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

        projectEntry.units.push({
          id: row.unit_id,
          code: row.unit_code ?? "UNIT",
          name: row.unit_name ?? "Project unit",
          status: resolvedStatus.status,
          statusSource: resolvedStatus.statusSource,
          colorKey: row.unit_color_key,
          startDate: row.unit_start_date,
          endDate: row.unit_end_date,
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
            projects.status,
            projects.start_date,
            projects.end_date,
            projects.color_key,
            COALESCE(projects.description, '—') AS description,
            COALESCE((
              SELECT group_concat(name, ', ')
              FROM (
                SELECT DISTINCT departments.name AS name
                FROM asset_assignments
                JOIN departments ON departments.id = asset_assignments.department_id
                WHERE asset_assignments.project_id = projects.id
                ORDER BY departments.name
              )
            ), '—') AS departments,
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
                AND project_units.status = 'active'
            ), 0) AS active_unit_count
          FROM projects
          LEFT JOIN clients ON clients.id = projects.client_id
        `,
      )
      .all() as Array<{
      id: string;
      code: string;
      name: string;
      client_id: string | null;
      client_name: string;
      status: string;
      start_date: string | null;
      end_date: string | null;
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
        status: row.status,
        startDate: row.start_date,
        endDate: row.end_date,
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
            projects.status,
            projects.start_date,
            projects.end_date,
            projects.color_key,
            COALESCE(projects.description, '—') AS description,
            COALESCE((
              SELECT group_concat(name, ', ')
              FROM (
                SELECT DISTINCT departments.name AS name
                FROM asset_assignments
                JOIN departments ON departments.id = asset_assignments.department_id
                WHERE asset_assignments.project_id = projects.id
                ORDER BY departments.name
              )
            ), '—') AS departments,
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
          status: string;
          start_date: string | null;
          end_date: string | null;
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
      assignment_id: string | null;
      crew_member_id: string | null;
      crew_full_name: string;
      linked_user_id: string | null;
      role_label: string;
      assignment_start_date: string | null;
      assignment_end_date: string | null;
      assignment_notes: string;
    }>;
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
        status: project.status,
        startDate: project.start_date,
        endDate: project.end_date,
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
