import type { AIGatewayToolContext, AIGatewayToolCallTrace } from "@contracts";
import type { AgentRunRow } from "@contracts";

import type { FoundationReadService } from "../data/foundationReadService";

type ToolExecutionResult = {
  payload: Record<string, unknown>;
  summary: string;
};

type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>, context: AIGatewayToolContext) => ToolExecutionResult;
};

const asString = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const asNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const asOptionalString = (value: unknown) => {
  const nextValue = asString(value);
  return nextValue || null;
};
const asStringArray = (value: unknown) =>
  Array.isArray(value) ? value.map((item) => asString(item)).filter(Boolean) : [];
const asInteger = (value: unknown, fallback: number) => {
  const nextValue = asNumber(value);
  return nextValue === null ? fallback : Math.max(1, Math.floor(nextValue));
};

const truncate = (value: string, max = 120) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value);
const resolveDraftLanguage = (value: unknown) => {
  const nextValue = asString(value).toLowerCase();
  return nextValue.startsWith("es") || nextValue.includes("spanish") ? "es" : "en";
};

const inferProjectIdFromContext = (context: AIGatewayToolContext) => {
  if (context.activeProjectId) {
    return context.activeProjectId;
  }

  const match = context.activePath?.match(/^\/projects\/([^/]+)/);
  return match?.[1] ?? null;
};

const compactProject = (
  row: {
    id: string;
    code: string;
    name: string;
    status: string;
    client?: string;
    exposure?: string;
    activeUnitCount?: number;
  },
) => ({
  id: row.id,
  code: row.code,
  name: row.name,
  status: row.status,
  client: row.client ?? "—",
  exposure: row.exposure ?? "—",
  activeUnitCount: row.activeUnitCount ?? 0,
});

export const createAgentToolRegistry = (
  foundationReads: FoundationReadService,
  options: {
    getRunsList: () => AgentRunRow[];
  },
) => {
  const definitions: ToolDefinition[] = [
    {
      name: "list_agent_capabilities",
      description: "List agent capabilities, approvals, domains and configured tools.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          agent_key: { type: "string" },
          limit: { type: "number" },
        },
      },
      execute: (args) => {
        const agentKey = asOptionalString(args.agent_key);
        const rows = foundationReads
          .getAgentCapabilitiesSnapshot()
          .filter((row) => !agentKey || row.agentKey === agentKey)
          .slice(0, asInteger(args.limit, 8));

        return {
          summary: rows.length ? `Loaded capability profile for ${rows.length} agents.` : "No matching agent capabilities found.",
          payload: {
            count: rows.length,
            items: rows.map((row) => ({
              agentKey: row.agentKey,
              displayName: row.displayName,
              status: row.status,
              approvalMode: row.approvalMode,
              providerKey: row.providerKey,
              modelLabel: row.modelLabel,
              toolCount: row.toolCount,
              tools: row.tools,
              domains: row.domains,
              isSupervisor: row.isSupervisor,
            })),
          },
        };
      },
    },
    {
      name: "get_pending_approvals",
      description: "Return supervised draft runs that are still waiting for approval.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          limit: { type: "number" },
        },
      },
      execute: (args) => {
        const rows = foundationReads.getPendingApprovals(asInteger(args.limit, 6));

        return {
          summary: rows.length ? `Found ${rows.length} pending approvals.` : "No pending approvals found.",
          payload: {
            count: rows.length,
            items: rows,
          },
        };
      },
    },
    {
      name: "get_runs_by_agent",
      description: "Return recent runs for a specific agent or status.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          agent_key: { type: "string" },
          status: { type: "string" },
          limit: { type: "number" },
        },
      },
      execute: (args) => {
        const rows = foundationReads.getAgentRunsSnapshot(
          asOptionalString(args.agent_key),
          asOptionalString(args.status),
          asInteger(args.limit, 8),
        );

        return {
          summary: rows.length ? `Loaded ${rows.length} runs for review.` : "No matching runs found.",
          payload: {
            count: rows.length,
            items: rows,
          },
        };
      },
    },
    {
      name: "get_agent_health_status",
      description: "Return current provider health, active agents and approval pressure.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      execute: () => {
        const snapshot = foundationReads.getAgentHealthStatus();

        return {
          summary: "Loaded current agent and provider health status.",
          payload: snapshot,
        };
      },
    },
    {
      name: "get_tool_coverage_snapshot",
      description: "Return which tools are available overall and how they are distributed across agents.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      execute: () => {
        const capabilities = foundationReads.getAgentCapabilitiesSnapshot();
        const availableTools = Array.from(new Set(definitions.map((tool) => tool.name))).sort((left, right) => left.localeCompare(right));

        return {
          summary: "Loaded a compact tool coverage snapshot.",
          payload: {
            totalTools: availableTools.length,
            availableTools,
            agentCoverage: capabilities.map((row) => ({
              agentKey: row.agentKey,
              displayName: row.displayName,
              toolCount: row.toolCount,
              tools: row.tools,
            })),
          },
        };
      },
    },
    {
      name: "search_active_projects",
      description: "Search active or prep projects with compact operational detail.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string" },
          limit: { type: "number" },
        },
        required: ["query"],
      },
      execute: (args) => {
        const rows = foundationReads
          .getProjects({
            search: asString(args.query),
            sortBy: "name",
            sortDirection: "asc",
          })
          .filter((row) => row.status === "Active" || row.status === "Prep")
          .slice(0, asInteger(args.limit, 6));

        return {
          summary: rows.length ? `Found ${rows.length} active project matches.` : "No active project matches found.",
          payload: {
            count: rows.length,
            items: rows.map(compactProject),
          },
        };
      },
    },
    {
      name: "search_assets",
      description: "Search assets using compact registry, assignment and location data.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string" },
          project_id: { type: "string" },
          status: { type: "string" },
          limit: { type: "number" },
        },
        required: ["query"],
      },
      execute: (args, context) => {
        const rows = foundationReads
          .getAssets({
            search: asString(args.query),
            scopeProjectId: asOptionalString(args.project_id) ?? inferProjectIdFromContext(context) ?? undefined,
            sortBy: "name",
            sortDirection: "asc",
          })
          .filter((row) => !asOptionalString(args.status) || row.status.toLowerCase() === asString(args.status).toLowerCase())
          .slice(0, asInteger(args.limit, 5));

        return {
          summary: rows.length ? `Found ${rows.length} matching assets.` : "No matching assets found.",
          payload: {
            count: rows.length,
            items: rows.map((row) => ({
              id: row.id,
              code: row.code,
              name: row.name,
              status: row.status,
              location: row.location,
              project: row.project,
              projectUnit: row.projectUnit,
              responsible: row.responsible,
              incidentsOpen: row.incidentsOpen,
            })),
          },
        };
      },
    },
    {
      name: "get_asset_detail",
      description: "Get a compact operational summary for a specific asset.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          assetId: { type: "string" },
        },
        required: ["assetId"],
      },
      execute: (args) => {
        const detail = foundationReads.getAssetDetail(asString(args.assetId));

        return {
          summary: detail.asset ? `Loaded asset detail for ${detail.asset.name}.` : "Asset was not found.",
          payload: detail.asset
            ? {
                asset: detail.asset,
                linkedIncidents: detail.linkedIncidents.slice(0, 3),
                latestTimeline: detail.timeline.slice(0, 3),
              }
            : { asset: null },
        };
      },
    },
    {
      name: "get_asset_availability",
      description: "Return asset availability and reservation pressure for a date window.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          asset_id: { type: "string" },
          query: { type: "string" },
          range_start: { type: "string" },
          range_end: { type: "string" },
          limit: { type: "number" },
        },
      },
      execute: (args) => {
        const items = foundationReads.getAssetAvailability({
          assetId: asOptionalString(args.asset_id),
          query: asOptionalString(args.query),
          rangeStart: asOptionalString(args.range_start),
          rangeEnd: asOptionalString(args.range_end),
          limit: asInteger(args.limit, 6),
        });

        return {
          summary: items.length ? `Loaded availability for ${items.length} assets.` : "No asset availability matches found.",
          payload: {
            count: items.length,
            items,
          },
        };
      },
    },
    {
      name: "get_asset_location",
      description: "Return current location, custody and responsibility for one asset.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          asset_id: { type: "string" },
        },
        required: ["asset_id"],
      },
      execute: (args) => {
        const payload = foundationReads.getAssetLocation(asString(args.asset_id));

        return {
          summary: payload.asset ? `Loaded current location for ${payload.asset.name}.` : "Asset was not found.",
          payload,
        };
      },
    },
    {
      name: "get_asset_movements",
      description: "Return recent asset movements and operational events.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          asset_id: { type: "string" },
          limit: { type: "number" },
        },
        required: ["asset_id"],
      },
      execute: (args) => {
        const items = foundationReads.getAssetMovements(asString(args.asset_id), asInteger(args.limit, 8));

        return {
          summary: items.length ? `Loaded ${items.length} recent asset movements.` : "No asset movements found.",
          payload: {
            count: items.length,
            items,
          },
        };
      },
    },
    {
      name: "get_asset_reservations",
      description: "Return reservations, assignments or checkouts linked to assets in a window.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          asset_id: { type: "string" },
          query: { type: "string" },
          range_start: { type: "string" },
          range_end: { type: "string" },
          limit: { type: "number" },
        },
      },
      execute: (args) => {
        const items = foundationReads.getAssetReservations({
          assetId: asOptionalString(args.asset_id),
          query: asOptionalString(args.query),
          rangeStart: asOptionalString(args.range_start),
          rangeEnd: asOptionalString(args.range_end),
          limit: asInteger(args.limit, 8),
        });

        return {
          summary: items.length ? `Loaded ${items.length} asset reservations or active assignments.` : "No asset reservations found.",
          payload: {
            count: items.length,
            items,
          },
        };
      },
    },
    {
      name: "get_kit_contents",
      description: "Return active kits and the assets currently linked to them.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          kit_id: { type: "string" },
          query: { type: "string" },
          limit: { type: "number" },
        },
      },
      execute: (args) => {
        const items = foundationReads.getKitContents({
          kitId: asOptionalString(args.kit_id),
          query: asOptionalString(args.query),
          limit: asInteger(args.limit, 6),
        });

        return {
          summary: items.length ? `Loaded ${items.length} kits with linked contents.` : "No matching kits found.",
          payload: {
            count: items.length,
            items,
          },
        };
      },
    },
    {
      name: "search_projects",
      description: "Search projects using compact project summary data.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string" },
          limit: { type: "number" },
        },
        required: ["query"],
      },
      execute: (args) => {
        const rows = foundationReads
          .getProjects({
            search: asString(args.query),
            sortBy: "name",
            sortDirection: "asc",
          })
          .slice(0, asInteger(args.limit, 5));

        return {
          summary: rows.length ? `Found ${rows.length} matching projects.` : "No matching projects found.",
          payload: {
            count: rows.length,
            items: rows.map((row) => ({
              id: row.id,
              code: row.code,
              name: row.name,
              status: row.status,
              client: row.client,
              exposure: row.exposure,
              activeUnitCount: row.activeUnitCount,
            })),
          },
        };
      },
    },
    {
      name: "get_project_detail",
      description: "Return detailed project, schedule, budget, units, assets and incident context.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          project_id: { type: "string" },
        },
        required: ["project_id"],
      },
      execute: (args) => {
        const detail = foundationReads.getProjectDetail(asString(args.project_id));

        return {
          summary: detail.project ? `Loaded detailed project context for ${detail.project.name}.` : "Project was not found.",
          payload: detail.project
            ? {
                project: detail.project,
                schedule: detail.schedule,
                timelineSummary: detail.timelineSummary,
                budget: detail.budget,
                metrics: detail.metrics,
                units: detail.units.slice(0, 8).map((unit) => ({
                  id: unit.id,
                  name: unit.name,
                  status: unit.status,
                  startDate: unit.startDate,
                  endDate: unit.endDate,
                  crewCount: unit.crewAssignments.length,
                })),
                assetCount: detail.assets.length,
                incidentCount: detail.incidents.length,
              }
            : { project: null },
        };
      },
    },
    {
      name: "get_project_schedule",
      description: "Get compact schedule details for a project.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          projectId: { type: "string" },
        },
        required: ["projectId"],
      },
      execute: (args) => {
        const detail = foundationReads.getProjectDetail(asString(args.projectId));

        return {
          summary: detail.project ? `Loaded schedule for ${detail.project.name}.` : "Project was not found.",
          payload: detail.project
            ? {
                project: {
                  id: detail.project.id,
                  name: detail.project.name,
                  status: detail.project.status,
                },
                schedule: detail.schedule,
                units: detail.units.map((unit) => ({
                  id: unit.id,
                  code: unit.code,
                  name: unit.name,
                  status: unit.status,
                  startDate: unit.startDate,
                  endDate: unit.endDate,
                })),
              }
            : { project: null },
        };
      },
    },
    {
      name: "get_project_units",
      description: "Get project units with compact crew and date details.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          projectId: { type: "string" },
        },
        required: ["projectId"],
      },
      execute: (args) => {
        const detail = foundationReads.getProjectDetail(asString(args.projectId));

        return {
          summary: detail.project ? `Loaded ${detail.units.length} units for ${detail.project.name}.` : "Project was not found.",
          payload: detail.project
            ? {
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
                  crewCount: unit.crewAssignments.length,
                })),
              }
            : { project: null },
        };
      },
    },
    {
      name: "get_project_conflicts",
      description: "Return overlapping project-unit windows inside a date range.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          project_id: { type: "string" },
          range_start: { type: "string" },
          range_end: { type: "string" },
        },
      },
      execute: (args, context) => {
        const items = foundationReads.getProjectConflicts({
          projectId: asOptionalString(args.project_id) ?? inferProjectIdFromContext(context),
          rangeStart: asOptionalString(args.range_start),
          rangeEnd: asOptionalString(args.range_end),
        });

        return {
          summary: items.length ? `Detected ${items.length} project schedule conflicts.` : "No project schedule conflicts detected.",
          payload: {
            count: items.length,
            items: items.slice(0, 8),
          },
        };
      },
    },
    {
      name: "get_project_crew_allocations",
      description: "Return crew allocations grouped by project unit.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          project_id: { type: "string" },
        },
        required: ["project_id"],
      },
      execute: (args) => {
        const payload = foundationReads.getProjectCrewAllocations(asString(args.project_id));

        return {
          summary: payload.project ? `Loaded crew allocations for ${payload.project.name}.` : "Project was not found.",
          payload,
        };
      },
    },
    {
      name: "get_open_incidents",
      description: "Return open or in-review incidents with compact fields.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          search: { type: "string" },
          limit: { type: "number" },
        },
      },
      execute: (args, context) => {
        const rows = foundationReads
          .getIncidents({
            search: asString(args.search) || undefined,
            scopeProjectId: inferProjectIdFromContext(context) ?? undefined,
            sortBy: "reportedAt",
            sortDirection: "desc",
          })
          .filter((row) => row.status === "Open" || row.status === "In review")
          .slice(0, asInteger(args.limit, 6));

        return {
          summary: rows.length ? `Loaded ${rows.length} open incidents.` : "No open incidents found.",
          payload: {
            count: rows.length,
            items: rows.map((row) => ({
              id: row.id,
              title: row.title,
              project: row.project,
              severity: row.severity,
              status: row.status,
              costEstimate: row.costEstimate,
            })),
          },
        };
      },
    },
    {
      name: "search_incidents",
      description: "Search incidents with compact ownership, severity and estimate fields.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string" },
          project_id: { type: "string" },
          limit: { type: "number" },
        },
      },
      execute: (args, context) => {
        const rows = foundationReads
          .getIncidents({
            search: asOptionalString(args.query) ?? undefined,
            scopeProjectId: asOptionalString(args.project_id) ?? inferProjectIdFromContext(context) ?? undefined,
            sortBy: "reportedAt",
            sortDirection: "desc",
          })
          .slice(0, asInteger(args.limit, 8));

        return {
          summary: rows.length ? `Found ${rows.length} incident matches.` : "No incident matches found.",
          payload: {
            count: rows.length,
            items: rows.map((row) => ({
              id: row.id,
              title: row.title,
              asset: row.asset,
              project: row.project,
              responsible: row.responsible,
              severity: row.severity,
              status: row.status,
              costEstimate: row.costEstimate,
            })),
          },
        };
      },
    },
    {
      name: "get_incident_detail",
      description: "Return detailed incident context with owner, project, asset and cost fields.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          incident_id: { type: "string" },
        },
        required: ["incident_id"],
      },
      execute: (args) => {
        const payload = foundationReads.getIncidentDetail(asString(args.incident_id));

        return {
          summary: payload ? `Loaded incident detail for ${payload.title}.` : "Incident was not found.",
          payload: {
            incident: payload,
          },
        };
      },
    },
    {
      name: "get_incident_timeline",
      description: "Return the reported/resolved lifecycle and linked operational events for an incident.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          incident_id: { type: "string" },
          limit: { type: "number" },
        },
        required: ["incident_id"],
      },
      execute: (args) => {
        const items = foundationReads.getIncidentTimeline(asString(args.incident_id), asInteger(args.limit, 8));

        return {
          summary: items.length ? `Loaded ${items.length} incident timeline events.` : "No incident timeline events found.",
          payload: {
            count: items.length,
            items,
          },
        };
      },
    },
    {
      name: "get_incident_estimates",
      description: "Return incident estimates and whether each incident still needs financial estimation.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          incident_id: { type: "string" },
          project_id: { type: "string" },
          limit: { type: "number" },
        },
      },
      execute: (args, context) => {
        const items = foundationReads.getIncidentEstimates({
          incidentId: asOptionalString(args.incident_id),
          projectId: asOptionalString(args.project_id) ?? inferProjectIdFromContext(context),
          limit: asInteger(args.limit, 8),
        });

        return {
          summary: items.length ? `Loaded ${items.length} incident estimate records.` : "No incident estimate records found.",
          payload: {
            count: items.length,
            items,
          },
        };
      },
    },
    {
      name: "get_maintenance_queue",
      description: "Return assets currently in maintenance with latest linked incident context.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          limit: { type: "number" },
        },
      },
      execute: (args) => {
        const items = foundationReads.getMaintenanceQueue(asInteger(args.limit, 8));

        return {
          summary: items.length ? `Loaded ${items.length} assets in maintenance.` : "No maintenance queue items found.",
          payload: {
            count: items.length,
            items,
          },
        };
      },
    },
    {
      name: "get_asset_maintenance_history",
      description: "Return maintenance events and related incidents for one asset.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          asset_id: { type: "string" },
          limit: { type: "number" },
        },
        required: ["asset_id"],
      },
      execute: (args) => {
        const payload = foundationReads.getAssetMaintenanceHistory(asString(args.asset_id), asInteger(args.limit, 8));

        return {
          summary:
            payload.events.length || payload.incidents.length
              ? "Loaded maintenance history for this asset."
              : "No maintenance history found for this asset.",
          payload,
        };
      },
    },
    {
      name: "get_incidents_missing_cost_estimate",
      description: "Return incidents that still do not have a cost estimate.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          limit: { type: "number" },
        },
      },
      execute: (_args, context) => {
        const rows = foundationReads
          .getIncidents({
            search: undefined,
            scopeProjectId: inferProjectIdFromContext(context) ?? undefined,
            sortBy: "reportedAt",
            sortDirection: "desc",
          })
          .filter((row) => row.status === "Open" || row.status === "In review")
          .filter((row) => row.costEstimate === "Pending")
          .slice(0, 6);

        return {
          summary: rows.length ? `Found ${rows.length} incidents missing estimates.` : "No incidents are missing cost estimates.",
          payload: {
            count: rows.length,
            items: rows.map((row) => ({
              id: row.id,
              title: row.title,
              project: row.project,
              severity: row.severity,
              status: row.status,
            })),
          },
        };
      },
    },
    {
      name: "get_financial_exposure_summary",
      description: "Return a compact finance exposure summary by project.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          topN: { type: "number" },
        },
      },
      execute: (args) => {
        const overview = foundationReads.getFinanceOverview();
        const topN = asInteger(args.topN, 5);

        return {
          summary: "Loaded current operational exposure by project.",
          payload: {
            metrics: overview.metrics,
            topProjects: overview.exposureByProject.slice(0, topN),
            topCostLinks: overview.costLinks.slice(0, 4),
          },
        };
      },
    },
    {
      name: "get_schedule_conflicts",
      description: "Return overlapping project units in the next 30 days.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          days: { type: "number" },
        },
      },
      execute: (args) => {
        const days = asInteger(args.days, 30);
        const timeline = foundationReads.getScheduleTimeline(days <= 30 ? "30d" : "90d", "day");
        const units = timeline.projects.flatMap((project) =>
          project.units.map((unit) => ({
            projectId: project.id,
            projectName: project.name,
            unitId: unit.id,
            unitName: unit.name,
            startDate: unit.startDate,
            endDate: unit.endDate,
          })),
        );
        const conflicts: Array<Record<string, string>> = [];

        for (let index = 0; index < units.length; index += 1) {
          for (let nextIndex = index + 1; nextIndex < units.length; nextIndex += 1) {
            const left = units[index];
            const right = units[nextIndex];

            if (!left.startDate || !left.endDate || !right.startDate || !right.endDate) {
              continue;
            }

            if (left.projectId === right.projectId && left.unitId === right.unitId) {
              continue;
            }

            const overlaps = left.startDate <= right.endDate && right.startDate <= left.endDate;

            if (overlaps) {
              conflicts.push({
                leftProject: left.projectName,
                leftUnit: left.unitName,
                rightProject: right.projectName,
                rightUnit: right.unitName,
                overlapWindow: `${left.startDate} → ${left.endDate} / ${right.startDate} → ${right.endDate}`,
              });
            }
          }
        }

        return {
          summary: conflicts.length ? `Detected ${conflicts.length} overlapping unit windows.` : "No overlapping project units detected.",
          payload: {
            count: conflicts.length,
            items: conflicts.slice(0, 8),
          },
        };
      },
    },
    {
      name: "get_overdue_returns",
      description: "Return packing slips that are currently overdue.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          limit: { type: "number" },
        },
      },
      execute: (args) => {
        const rows = foundationReads
          .getPackingSlips({
            search: undefined,
            sortBy: "dueDate",
            sortDirection: "asc",
          })
          .filter((row) => row.status.toLowerCase().includes("overdue"))
          .slice(0, asInteger(args.limit, 5));

        return {
          summary: rows.length ? `Found ${rows.length} overdue returns.` : "No overdue returns found.",
          payload: {
            count: rows.length,
            items: rows.map((row) => ({
              id: row.id,
              slipNumber: row.number,
              project: row.project,
              department: row.department,
              dueDate: row.dueDate,
              status: row.status,
            })),
          },
        };
      },
    },
    {
      name: "list_recipients",
      description: "List compact communication targets across workspace members, crew, clients and manufacturers.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string" },
          recipient_type: { type: "string" },
          project_id: { type: "string" },
          limit: { type: "number" },
        },
      },
      execute: (args, context) => {
        const items = foundationReads.listCommunicationRecipients({
          query: asOptionalString(args.query),
          recipientType: asOptionalString(args.recipient_type),
          projectId: asOptionalString(args.project_id) ?? inferProjectIdFromContext(context),
          limit: asInteger(args.limit, 8),
        });

        return {
          summary: items.length ? `Loaded ${items.length} possible communication targets.` : "No communication targets found.",
          payload: {
            count: items.length,
            items,
          },
        };
      },
    },
    {
      name: "get_thread_context",
      description: "Return compact durable thread context for drafting or follow-up communication.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          thread_id: { type: "string" },
          limit: { type: "number" },
        },
        required: ["thread_id"],
      },
      execute: (args) => {
        const payload = foundationReads.getThreadContextSnapshot(asString(args.thread_id), asInteger(args.limit, 6));

        return {
          summary: payload.thread ? `Loaded thread context for ${payload.thread.title}.` : "Thread context was not found.",
          payload,
        };
      },
    },
    {
      name: "preview_send_targets",
      description: "Resolve reachable communication targets before preparing a supervised draft.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          recipient_ids: {
            type: "array",
            items: { type: "string" },
          },
          query: { type: "string" },
          recipient_type: { type: "string" },
          project_id: { type: "string" },
          limit: { type: "number" },
        },
      },
      execute: (args, context) => {
        const payload = foundationReads.previewCommunicationTargets({
          recipientIds: asStringArray(args.recipient_ids),
          query: asOptionalString(args.query),
          recipientType: asOptionalString(args.recipient_type),
          projectId: asOptionalString(args.project_id) ?? inferProjectIdFromContext(context),
          limit: asInteger(args.limit, 8),
        });

        return {
          summary: payload.totalTargets
            ? `Prepared a preview of ${payload.totalTargets} communication targets.`
            : "No communication targets matched this preview.",
          payload,
        };
      },
    },
    {
      name: "get_delivery_status",
      description: "Return the truthful status of communications runs. Sending is still draft-only in this phase.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          thread_id: { type: "string" },
          limit: { type: "number" },
        },
      },
      execute: (args) => {
        const payload = foundationReads.getCommunicationDeliveryStatus({
          threadId: asOptionalString(args.thread_id),
          limit: asInteger(args.limit, 8),
        });

        return {
          summary: payload.items.length
            ? `Loaded ${payload.items.length} communication draft states.`
            : "No communication delivery records found.",
          payload,
        };
      },
    },
    {
      name: "draft_message",
      description: "Prepare a draft-only operational message scaffold. This never sends anything.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          purpose: { type: "string" },
          recipient_label: { type: "string" },
          tone: { type: "string" },
          subject: { type: "string" },
          context: { type: "string" },
          key_points: {
            type: "array",
            items: { type: "string" },
          },
          call_to_action: { type: "string" },
          language: { type: "string" },
        },
        required: ["purpose"],
      },
      execute: (args) => {
        const language = resolveDraftLanguage(args.language);
        const recipientLabel = asOptionalString(args.recipient_label) ?? (language === "es" ? "equipo" : "team");
        const tone = asOptionalString(args.tone) ?? (language === "es" ? "operativo" : "operational");
        const purpose = asString(args.purpose);
        const contextSummary = asOptionalString(args.context);
        const callToAction = asOptionalString(args.call_to_action);
        const keyPoints = asStringArray(args.key_points).slice(0, 5);
        const subject =
          asOptionalString(args.subject) ??
          (language === "es" ? `Borrador: ${purpose}` : `Draft: ${purpose}`);

        const bodyLines =
          language === "es"
            ? [
                `Hola ${recipientLabel},`,
                "",
                contextSummary || `Te comparto este borrador relacionado con: ${purpose}.`,
                ...(keyPoints.length
                  ? ["", "Puntos clave:", ...keyPoints.map((point) => `- ${point}`)]
                  : []),
                ...(callToAction ? ["", `Siguiente paso sugerido: ${callToAction}`] : []),
                "",
                "Quedo atento.",
              ]
            : [
                `Hello ${recipientLabel},`,
                "",
                contextSummary || `I'm sharing this draft regarding: ${purpose}.`,
                ...(keyPoints.length ? ["", "Key points:", ...keyPoints.map((point) => `- ${point}`)] : []),
                ...(callToAction ? ["", `Suggested next step: ${callToAction}`] : []),
                "",
                "Best regards,",
              ];

        return {
          summary: "Prepared a supervised message draft scaffold.",
          payload: {
            status: "draft_only",
            deliveryEnabled: false,
            tone,
            language,
            subject,
            body: bodyLines.join("\n"),
            keyPoints,
          },
        };
      },
    },
    {
      name: "search_errors",
      description: "Search real assistant, run and provider issues across BukowskiOS.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string" },
          limit: { type: "number" },
        },
      },
      execute: (args) => {
        const items = foundationReads.searchSystemErrors({
          query: asOptionalString(args.query),
          limit: asInteger(args.limit, 8),
        });

        return {
          summary: items.length ? `Found ${items.length} system issues.` : "No matching system issues found.",
          payload: {
            count: items.length,
            items,
          },
        };
      },
    },
    {
      name: "get_error_detail",
      description: "Get detailed context for one system issue from runs, threads or provider health.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          issue_id: { type: "string" },
        },
        required: ["issue_id"],
      },
      execute: (args) => {
        const payload = foundationReads.getSystemErrorDetail(asString(args.issue_id));

        return {
          summary: payload ? `Loaded detail for ${payload.title}.` : "Issue detail was not found.",
          payload: {
            issue: payload,
          },
        };
      },
    },
    {
      name: "get_session_trace",
      description: "Return compact thread trace and related runs for a system issue or chat thread.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          thread_id: { type: "string" },
          issue_id: { type: "string" },
          limit: { type: "number" },
        },
      },
      execute: (args) => {
        const payload = foundationReads.getSessionTrace({
          threadId: asOptionalString(args.thread_id),
          issueId: asOptionalString(args.issue_id),
          limit: asInteger(args.limit, 8),
        });

        return {
          summary: payload.thread ? `Loaded session trace for ${payload.thread.title}.` : payload.note ?? "No session trace is available.",
          payload,
        };
      },
    },
    {
      name: "get_recent_deploys",
      description: "Return deploy telemetry status. In this phase BukowskiOS may report that deploy telemetry is not connected yet.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          limit: { type: "number" },
        },
      },
      execute: (args) => {
        const payload = foundationReads.getRecentDeploys(asInteger(args.limit, 5));

        return {
          summary: payload.telemetryAvailable
            ? `Loaded ${payload.items.length} recent deploy records.`
            : payload.note,
          payload,
        };
      },
    },
    {
      name: "get_agent_failures",
      description: "Return recent failures for one agent or across all agents.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          agent_key: { type: "string" },
          limit: { type: "number" },
        },
      },
      execute: (args) => {
        const payload = foundationReads.getAgentFailures({
          agentKey: asOptionalString(args.agent_key),
          limit: asInteger(args.limit, 8),
        });

        return {
          summary: payload.count ? `Loaded ${payload.count} agent failures.` : "No agent failures found.",
          payload,
        };
      },
    },
    {
      name: "draft_bug_report",
      description: "Prepare a structured bug report draft from an issue or thread trace without mutating any external system.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          issue_id: { type: "string" },
          thread_id: { type: "string" },
          audience: { type: "string" },
        },
      },
      execute: (args) => {
        const issueId = asOptionalString(args.issue_id);
        const threadId = asOptionalString(args.thread_id);
        const audience = asOptionalString(args.audience) ?? "engineering";
        const detail = issueId ? foundationReads.getSystemErrorDetail(issueId) : null;
        const trace = foundationReads.getSessionTrace({
          issueId,
          threadId: threadId ?? detail?.threadId ?? null,
          limit: 8,
        });

        const titleSeed = detail?.title ?? trace.thread?.title ?? "Unknown issue";
        const summarySeed = detail?.summary ?? trace.thread?.lastErrorSummary ?? trace.thread?.summaryText ?? "Issue summary unavailable.";
        const severity = typeof detail?.severity === "string" ? detail.severity : "medium";
        const reproduction = [
          ...(Array.isArray(trace.reproductionHints) ? trace.reproductionHints : []),
          trace.thread?.contextKey ? `Start from ${trace.thread.contextKey}.` : null,
        ].filter((value): value is string => Boolean(value));
        const relatedRuns = Array.isArray(trace.relatedRuns) ? trace.relatedRuns : [];

        return {
          summary: `Prepared a draft bug report for ${titleSeed}.`,
          payload: {
            status: "draft_only",
            audience,
            issueId: issueId ?? null,
            threadId: threadId ?? detail?.threadId ?? trace.thread?.id ?? null,
            title: `[Bug] ${truncate(titleSeed, 72)}`,
            severity,
            summary: truncate(summarySeed, 240),
            impact:
              severity === "critical"
                ? "High operational risk. This can block supervised routing or make the assistant unavailable."
                : "Operational issue present, but it still needs confirmation and prioritization.",
            reproduction,
            relatedRuns,
            suggestedChecks:
              detail && Array.isArray(detail.suggestedChecks)
                ? detail.suggestedChecks
                : ["Review the latest thread trace and confirm if the issue still reproduces."],
            ownerHint:
              audience === "product"
                ? "Product Agent should review UX impact and handoff."
                : "Bugs Agent should hand this to engineering with the trace and suggested checks.",
          },
        };
      },
    },
    {
      name: "get_user_feedback",
      description: "Return reviewed product feedback memories when available.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string" },
          limit: { type: "number" },
        },
      },
      execute: (args) => {
        const items = foundationReads.getUserFeedback({
          query: asOptionalString(args.query),
          limit: asInteger(args.limit, 8),
        });

        return {
          summary: items.length ? `Loaded ${items.length} reviewed feedback items.` : "No reviewed product feedback is available yet.",
          payload: {
            count: items.length,
            items,
          },
        };
      },
    },
    {
      name: "get_feature_usage",
      description: "Return current product usage signals from assistant surfaces.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          limit: { type: "number" },
        },
      },
      execute: (args) => {
        const payload = foundationReads.getFeatureUsage(asInteger(args.limit, 6));

        return {
          summary: payload.items.length ? "Loaded current feature usage signals." : payload.note,
          payload,
        };
      },
    },
    {
      name: "get_funnel_dropoffs",
      description: "Return assistant-thread dropoff states so product can reason about friction.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          limit: { type: "number" },
        },
      },
      execute: (args) => {
        const payload = foundationReads.getFunnelDropoffs(asInteger(args.limit, 6));

        return {
          summary: payload.items.length ? "Loaded current assistant funnel outcomes." : payload.note,
          payload,
        };
      },
    },
    {
      name: "get_backlog_items",
      description: "Return product and bugs draft backlog items already captured as runs.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          limit: { type: "number" },
        },
      },
      execute: (args) => {
        const items = foundationReads.getBacklogItems(asInteger(args.limit, 8));

        return {
          summary: items.length ? `Loaded ${items.length} backlog items.` : "No product or bugs backlog items are available yet.",
          payload: {
            count: items.length,
            items,
          },
        };
      },
    },
    {
      name: "link_feedback_to_feature",
      description: "Prepare a structured draft linking a feedback signal to a feature area. This does not mutate backlog.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          feedback: { type: "string" },
          feature_area: { type: "string" },
          hypothesis: { type: "string" },
        },
        required: ["feedback"],
      },
      execute: (args) => {
        const feedback = asString(args.feedback);
        const featureArea = asOptionalString(args.feature_area) ?? "Unassigned feature area";
        const hypothesis =
          asOptionalString(args.hypothesis) ?? "This signal may point to friction, missing visibility, or a workflow gap.";

        return {
          summary: "Prepared a draft feedback-to-feature linkage.",
          payload: {
            status: "draft_only",
            featureArea,
            feedback,
            hypothesis,
            suggestedNextStep: "Review with Product Agent and create a supervised draft backlog item if the signal repeats.",
          },
        };
      },
    },
    {
      name: "get_runs_snapshot",
      description: "Return a compact snapshot of recent agent runs.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          limit: { type: "number" },
        },
      },
      execute: (args) => {
        const rows = options.getRunsList().slice(0, asInteger(args.limit, 5));

        return {
          summary: "Loaded a compact runs snapshot.",
          payload: {
            count: rows.length,
            items: rows.map((row) => ({
              id: row.id,
              title: row.title,
              status: row.status,
              agent: row.agentDisplayName,
              summary: row.summary,
            })),
          },
        };
      },
    },
    {
      name: "get_project_financials",
      description: "Return budget, reserve and recent financial entries for one project.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          project_id: { type: "string" },
        },
        required: ["project_id"],
      },
      execute: (args) => {
        const payload = foundationReads.getProjectFinancials(asString(args.project_id));

        return {
          summary: payload.project ? `Loaded project financials for ${payload.project.name}.` : "Project was not found.",
          payload,
        };
      },
    },
    {
      name: "get_incident_costs",
      description: "Return compact incident-linked financial cost visibility.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          incident_id: { type: "string" },
          project_id: { type: "string" },
          limit: { type: "number" },
        },
      },
      execute: (args, context) => {
        const items = foundationReads.getIncidentCosts({
          incidentId: asOptionalString(args.incident_id),
          projectId: asOptionalString(args.project_id) ?? inferProjectIdFromContext(context),
          limit: asInteger(args.limit, 8),
        });

        return {
          summary: items.length ? `Loaded ${items.length} incident cost records.` : "No incident cost records found.",
          payload: {
            count: items.length,
            items,
          },
        };
      },
    },
    {
      name: "get_asset_exposure",
      description: "Return incident and finance exposure around one asset.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          asset_id: { type: "string" },
        },
        required: ["asset_id"],
      },
      execute: (args) => {
        const payload = foundationReads.getAssetExposure(asString(args.asset_id));

        return {
          summary: payload ? `Loaded exposure detail for ${payload.asset.name}.` : "Asset was not found.",
          payload: {
            assetExposure: payload,
          },
        };
      },
    },
    {
      name: "get_open_invoices",
      description: "Return open invoices or unpaid finance entries.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          limit: { type: "number" },
        },
      },
      execute: (args) => {
        const items = foundationReads.getOpenInvoices(asInteger(args.limit, 8));

        return {
          summary: items.length ? `Loaded ${items.length} open invoices.` : "No open invoices found.",
          payload: {
            count: items.length,
            items,
          },
        };
      },
    },
    {
      name: "get_reserves_status",
      description: "Return current reserve entries and total reserve amount.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          project_id: { type: "string" },
        },
      },
      execute: (args, context) => {
        const payload = foundationReads.getReservesStatus(asOptionalString(args.project_id) ?? inferProjectIdFromContext(context));

        return {
          summary: payload.items.length ? "Loaded reserve status." : "No reserve entries found.",
          payload,
        };
      },
    },
  ];

  const toolMap = new Map(definitions.map((tool) => [tool.name, tool]));

  return {
    definitions: definitions.map((tool) => ({
      type: "function" as const,
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    })),
    execute(name: string, rawArguments: string, context: AIGatewayToolContext) {
      const tool = toolMap.get(name);

      if (!tool) {
        throw new Error(`Tool ${name} is not allowed.`);
      }

      let parsedArgs: Record<string, unknown> = {};

      if (rawArguments.trim()) {
        parsedArgs = JSON.parse(rawArguments) as Record<string, unknown>;
      }

      const result = tool.execute(parsedArgs, context);
      return {
        result,
        trace: {
          toolName: name,
          status: "completed",
          summary: truncate(result.summary),
        } satisfies AIGatewayToolCallTrace,
      };
    },
  };
};

export type AgentToolRegistry = ReturnType<typeof createAgentToolRegistry>;
