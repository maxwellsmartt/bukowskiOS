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
const asInteger = (value: unknown, fallback: number) => {
  const nextValue = asNumber(value);
  return nextValue === null ? fallback : Math.max(1, Math.floor(nextValue));
};

const truncate = (value: string, max = 120) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value);

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
