import type { AIGatewayToolContext, AIGatewayToolCallTrace } from "@contracts";
import type { AgentRunRow } from "@contracts";

import type { FoundationReadService } from "../data/foundationReadService";
import type { CurrencyReadService } from "../data/currencyReadService";
import type { QuoteReadService } from "../data/quoteReadService";
import type { TreasuryReadService } from "../data/treasuryReadService";
import { buildWriteToolDefinitions, type AgentWriteServices } from "./agentWriteTools";

type ToolExecutionResult = {
  payload: Record<string, unknown>;
  summary: string;
};

type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  requiresApproval?: boolean;
  requiredPermission?: string;
  execute: (args: Record<string, unknown>, context: AIGatewayToolContext) => ToolExecutionResult;
};

type ToolPolicyOptions = {
  allowedToolNames?: readonly string[] | null;
};

const isToolAllowed = (toolName: string, toolNames: readonly string[] | null | undefined) => {
  if (toolNames === undefined || toolNames === null) {
    return true;
  }
  return toolNames.includes(toolName);
};

const hasUserPermission = (context: AIGatewayToolContext, permission: string) => {
  const permissions = context.userPermissions ?? [];
  return permissions.includes("*") || permissions.includes(permission);
};

const assertToolPermission = (tool: ToolDefinition, context: AIGatewayToolContext) => {
  if (!tool.requiredPermission) {
    return;
  }

  if (!hasUserPermission(context, tool.requiredPermission)) {
    throw new Error(`Tool ${tool.name} requires ${tool.requiredPermission}.`);
  }
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
const addDays = (date: string, offset: number) => {
  const nextDate = new Date(`${date}T00:00:00.000Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + offset);
  return nextDate.toISOString().slice(0, 10);
};
const normalizeLookupText = (value: string | null | undefined) =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const tokenizeLookupText = (value: string | null | undefined) =>
  normalizeLookupText(value)
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
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

const resolveProjectIdFromReadTools = (
  foundationReads: FoundationReadService,
  context: AIGatewayToolContext,
  identifier: unknown,
) => {
  const candidate = asOptionalString(identifier) ?? inferProjectIdFromContext(context);
  if (!candidate) return null;
  if (candidate.startsWith("project-")) return candidate;

  const rows = foundationReads.getProjects({
    workspaceId: context.workspaceId,
    search: candidate,
    sortBy: "name",
    sortDirection: "asc",
  });
  const normalizedCandidate = normalizeLookupText(candidate);
  const exact =
    rows.find(
      (row) =>
        normalizeLookupText(row.id) === normalizedCandidate ||
        normalizeLookupText(row.code) === normalizedCandidate ||
        normalizeLookupText(row.name) === normalizedCandidate,
    ) ?? null;

  return (exact ?? rows[0] ?? null)?.id ?? candidate;
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

const compactAsset = (row: {
  id: string;
  code: string;
  name: string;
  category?: string;
  quantity: number;
  totalQuantity?: number;
  assignedQuantity?: number;
  checkedOutQuantity?: number;
  status: string;
  location: string;
  project: string;
  projectUnit?: string;
  responsible: string;
  serialNumber?: string;
  incidentsOpen: number;
}) => ({
  id: row.id,
  code: row.code,
  name: row.name,
  category: row.category ?? "—",
  status: row.status,
  availableQuantity: row.quantity,
  totalQuantity: row.totalQuantity ?? row.quantity,
  assignedQuantity: row.assignedQuantity ?? 0,
  checkedOutQuantity: row.checkedOutQuantity ?? 0,
  location: row.location,
  project: row.project,
  projectUnit: row.projectUnit ?? "—",
  responsible: row.responsible,
  serialNumber: row.serialNumber ?? "—",
  incidentsOpen: row.incidentsOpen,
});

const compactExchangeRate = (row: {
  id: string;
  baseCurrency: string;
  quoteCurrency: string;
  rate: number;
  rateType: string;
  source: string;
  sourceLabel: string | null;
  effectiveDate: string;
  fetchedAt: string | null;
  notes: string | null;
}) => ({
  id: row.id,
  pair: `${row.baseCurrency}/${row.quoteCurrency}`,
  rate: row.rate,
  rateType: row.rateType,
  source: row.source,
  sourceLabel: row.sourceLabel ?? row.source,
  effectiveDate: row.effectiveDate,
  fetchedAt: row.fetchedAt,
  sourceProof: row.notes?.includes("tasareal.com") ? "https://tasareal.com" : null,
});

const scoreAssetAlternative = (
  row: {
    code: string;
    name: string;
    category?: string;
    location: string;
    responsible: string;
    serialNumber?: string;
  },
  tokens: string[],
) => {
  const searchable = normalizeLookupText(
    [row.name, row.code, row.category, row.location, row.responsible, row.serialNumber].filter(Boolean).join(" "),
  );

  return tokens.reduce((score, token) => score + (searchable.includes(token) ? 1 : 0), 0);
};

export const createAgentToolRegistry = (
  foundationReads: FoundationReadService,
  options: {
    getRunsList: () => AgentRunRow[];
    currencyReads?: CurrencyReadService;
    quoteReads?: QuoteReadService;
    treasuryReads?: TreasuryReadService;
    writeServices?: AgentWriteServices;
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
      execute: (args, context) => {
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
      execute: (args, context) => {
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
      name: "get_exchange_rates",
      description:
        "Return saved USD/DOP or EUR/DOP exchange rates from the workspace, including buy, sell, source proof and fetched timestamps. Use this before answering questions about current bank rates.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          base_currency: { type: "string", description: "USD or EUR. Defaults to USD." },
          quote_currency: { type: "string", description: "Defaults to DOP." },
          limit: { type: "number" },
        },
      },
      execute: (args, context) => {
        if (!options.currencyReads) {
          return {
            summary: "Exchange-rate tools are not available on this device.",
            payload: { items: [] },
          };
        }
        const baseCurrency = (asOptionalString(args.base_currency) ?? "USD").toUpperCase();
        const quoteCurrency = (asOptionalString(args.quote_currency) ?? "DOP").toUpperCase();
        const rows = options.currencyReads
          .listRates(context.workspaceId, {
            baseCurrency,
            quoteCurrency,
            limit: asInteger(args.limit, 24),
          })
          .map(compactExchangeRate);

        return {
          summary: rows.length
            ? `Loaded ${rows.length} saved ${baseCurrency}/${quoteCurrency} exchange-rate snapshots.`
            : `No saved ${baseCurrency}/${quoteCurrency} exchange rates found.`,
          payload: {
            pair: `${baseCurrency}/${quoteCurrency}`,
            count: rows.length,
            items: rows,
          },
        };
      },
    },
    {
      name: "compare_exchange_rates",
      description:
        "Compare the latest buy and sell rates by bank for USD/DOP or EUR/DOP. Use buy when Metadata sells foreign currency to receive DOP; use sell when Metadata buys foreign currency with DOP.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          base_currency: { type: "string", description: "USD or EUR. Defaults to USD." },
          quote_currency: { type: "string", description: "Defaults to DOP." },
          amount: { type: "number", description: "Optional foreign-currency amount to compare." },
        },
      },
      execute: (args, context) => {
        if (!options.currencyReads) {
          return {
            summary: "Exchange-rate comparison is not available on this device.",
            payload: { items: [] },
          };
        }
        const baseCurrency = (asOptionalString(args.base_currency) ?? "USD").toUpperCase();
        const quoteCurrency = (asOptionalString(args.quote_currency) ?? "DOP").toUpperCase();
        const amount = asNumber(args.amount);
        const rows = options.currencyReads.listRates(context.workspaceId, { baseCurrency, quoteCurrency, limit: 80 });
        const sources = Array.from(new Set(rows.map((row) => row.source)));
        const items = sources.map((source) => {
          const sourceRows = rows.filter((row) => row.source === source);
          const buy = sourceRows.find((row) => row.rateType === "buy") ?? sourceRows.find((row) => row.rateType === "average") ?? null;
          const sell = sourceRows.find((row) => row.rateType === "sell") ?? null;
          return {
            source,
            sourceLabel: buy?.sourceLabel ?? sell?.sourceLabel ?? source,
            buy: buy ? compactExchangeRate(buy) : null,
            sell: sell ? compactExchangeRate(sell) : null,
            receiveDopIfSellingForeign: amount && buy ? amount * buy.rate : null,
            payDopIfBuyingForeign: amount && sell ? amount * sell.rate : null,
          };
        });
        const bestBuy = items
          .filter((item) => item.buy)
          .sort((left, right) => (right.buy?.rate ?? 0) - (left.buy?.rate ?? 0))[0];
        const bestSell = items
          .filter((item) => item.sell)
          .sort((left, right) => (left.sell?.rate ?? Number.POSITIVE_INFINITY) - (right.sell?.rate ?? Number.POSITIVE_INFINITY))[0];

        return {
          summary: items.length
            ? `Compared ${items.length} banks for ${baseCurrency}/${quoteCurrency}. Best buy: ${
                bestBuy?.sourceLabel ?? "n/a"
              }. Best sell: ${bestSell?.sourceLabel ?? "n/a"}.`
            : `No saved ${baseCurrency}/${quoteCurrency} rates available to compare.`,
          payload: {
            pair: `${baseCurrency}/${quoteCurrency}`,
            amount: amount ?? null,
            bestBuySource: bestBuy?.sourceLabel ?? null,
            bestSellSource: bestSell?.sourceLabel ?? null,
            items,
          },
        };
      },
    },
    {
      name: "get_exchange_rate_history",
      description:
        "Return the saved 24-hour exchange-rate history by fetchedAt timestamp for USD/DOP or EUR/DOP. This is the local verified snapshot history used by the Finance chart.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          base_currency: { type: "string", description: "USD or EUR. Defaults to USD." },
          quote_currency: { type: "string", description: "Defaults to DOP." },
          hours: { type: "number", description: "Defaults to 24." },
        },
      },
      execute: (args, context) => {
        if (!options.currencyReads) {
          return {
            summary: "Exchange-rate history is not available on this device.",
            payload: { items: [] },
          };
        }
        const baseCurrency = (asOptionalString(args.base_currency) ?? "USD").toUpperCase();
        const quoteCurrency = (asOptionalString(args.quote_currency) ?? "DOP").toUpperCase();
        const hours = Math.min(168, asInteger(args.hours, 24));
        const cutoffMs = Date.now() - hours * 60 * 60 * 1000;
        const rows = options.currencyReads
          .listRates(context.workspaceId, { baseCurrency, quoteCurrency, limit: 200 })
          .filter((row) => row.fetchedAt && new Date(row.fetchedAt).getTime() >= cutoffMs)
          .map(compactExchangeRate);

        return {
          summary: rows.length
            ? `Loaded ${rows.length} ${baseCurrency}/${quoteCurrency} snapshots from the last ${hours} hours.`
            : `No saved ${baseCurrency}/${quoteCurrency} snapshots found in the last ${hours} hours.`,
          payload: {
            pair: `${baseCurrency}/${quoteCurrency}`,
            hours,
            count: rows.length,
            items: rows,
          },
        };
      },
    },
    {
      name: "search_active_projects",
      requiredPermission: "projects.read",
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
      execute: (args, context) => {
        const rows = foundationReads
          .getProjects({
            workspaceId: context.workspaceId,
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
      requiredPermission: "assets.read",
      description:
        "Search assets using compact registry, assignment and location data. Defaults to the full workspace inventory, which is the correct scope for availability checks and packing slip creation. Pass scope='project' or project_id only when the user explicitly asks for assets already tied to a project. If a specific query returns no available asset for a user request, call this again with a broader query or an empty query plus status='Available' to propose close alternatives.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string" },
          project_id: { type: "string" },
          scope: { type: "string", enum: ["workspace", "project"] },
          status: { type: "string" },
          limit: { type: "number" },
        },
        required: ["query"],
      },
      execute: (args, context) => {
        const requestedScope = asOptionalString(args.scope);
        const explicitProjectId = asOptionalString(args.project_id);
        const scopedProjectId = explicitProjectId ?? (requestedScope === "project" ? inferProjectIdFromContext(context) : null);
        const requestedStatus = asOptionalString(args.status);
        const requestedQuery = asString(args.query);
        const rows = foundationReads
          .getAssets({
            workspaceId: context.workspaceId,
            search: requestedQuery,
            scopeProjectId: scopedProjectId ?? undefined,
            sortBy: "name",
            sortDirection: "asc",
          })
          .filter((row) => !requestedStatus || row.status.toLowerCase() === requestedStatus.toLowerCase())
          .slice(0, asInteger(args.limit, 5));
        const fallbackRows =
          rows.length || scopedProjectId || !requestedQuery
            ? []
            : foundationReads
                .getAssets({
                  workspaceId: context.workspaceId,
                  search: "",
                  sortBy: "name",
                  sortDirection: "asc",
                })
                .filter((row) => !requestedStatus || row.status.toLowerCase() === requestedStatus.toLowerCase())
                .map((row) => ({
                  row,
                  score: scoreAssetAlternative(row, tokenizeLookupText(requestedQuery)),
                }))
                .filter((entry) => entry.score > 0)
                .sort((left, right) => right.score - left.score || left.row.name.localeCompare(right.row.name))
                .slice(0, asInteger(args.limit, 5))
                .map((entry) => entry.row);

        return {
          summary: rows.length
            ? `Found ${rows.length} matching assets.`
            : fallbackRows.length
              ? `No exact asset matches found. Returned ${fallbackRows.length} available alternatives from the workspace.`
              : "No matching assets found.",
          payload: {
            scope: scopedProjectId ? "project" : "workspace",
            projectId: scopedProjectId,
            count: rows.length || fallbackRows.length,
            exactMatch: rows.length > 0,
            fallbackQuery: fallbackRows.length ? requestedQuery : null,
            items: (rows.length ? rows : fallbackRows).map(compactAsset),
          },
        };
      },
    },
    {
      name: "get_asset_detail",
      requiredPermission: "assets.read",
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
      requiredPermission: "assets.read",
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
      requiredPermission: "assets.read",
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
      requiredPermission: "assets.read",
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
      requiredPermission: "assets.read",
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
      requiredPermission: "assets.read",
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
      requiredPermission: "projects.read",
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
      execute: (args, context) => {
        const rows = foundationReads
          .getProjects({
            workspaceId: context.workspaceId,
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
      requiredPermission: "projects.read",
      description: "Return detailed project, schedule, budget, units, assets and incident context.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          project_id: { type: "string" },
        },
        required: ["project_id"],
      },
      execute: (args, context) => {
        const projectId = resolveProjectIdFromReadTools(foundationReads, context, args.project_id);
        const detail = foundationReads.getProjectDetail(projectId ?? asString(args.project_id));

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
      requiredPermission: "projects.read",
      description: "Get compact schedule details for a project.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          projectId: { type: "string" },
        },
        required: ["projectId"],
      },
      execute: (args, context) => {
        const projectId = resolveProjectIdFromReadTools(foundationReads, context, args.projectId);
        const detail = foundationReads.getProjectDetail(projectId ?? asString(args.projectId));

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
      requiredPermission: "projects.read",
      description: "Get project units with compact crew and date details.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          projectId: { type: "string" },
        },
        required: ["projectId"],
      },
      execute: (args, context) => {
        const projectId = resolveProjectIdFromReadTools(foundationReads, context, args.projectId);
        const detail = foundationReads.getProjectDetail(projectId ?? asString(args.projectId));

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
      requiredPermission: "projects.read",
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
          projectId: resolveProjectIdFromReadTools(foundationReads, context, args.project_id),
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
      requiredPermission: "projects.read",
      description: "Return crew allocations grouped by project unit.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          project_id: { type: "string" },
        },
        required: ["project_id"],
      },
      execute: (args, context) => {
        const projectId = resolveProjectIdFromReadTools(foundationReads, context, args.project_id);
        const payload = foundationReads.getProjectCrewAllocations(projectId ?? asString(args.project_id));

        return {
          summary: payload.project ? `Loaded crew allocations for ${payload.project.name}.` : "Project was not found.",
          payload,
        };
      },
    },
    {
      name: "get_open_incidents",
      requiredPermission: "incidents.read",
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
      requiredPermission: "incidents.read",
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
            scopeProjectId: resolveProjectIdFromReadTools(foundationReads, context, args.project_id) ?? undefined,
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
      requiredPermission: "incidents.read",
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
        const incident = payload.incident;

        return {
          summary: incident ? `Loaded incident detail for ${incident.title}.` : "Incident was not found.",
          payload: {
            incident,
          },
        };
      },
    },
    {
      name: "get_incident_timeline",
      requiredPermission: "incidents.read",
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
      requiredPermission: "incidents.read",
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
          projectId: resolveProjectIdFromReadTools(foundationReads, context, args.project_id),
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
      requiredPermission: "assets.read",
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
      requiredPermission: "assets.read",
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
      requiredPermission: "incidents.read",
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
      requiredPermission: "finance.read",
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
      name: "get_budget_vs_actual",
      requiredPermission: "finance.read",
      description: "Return project spend, reserve and exposure against the current finance baseline.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          project_id: { type: "string" },
        },
        required: ["project_id"],
      },
      execute: (args, context) => {
        const projectId = resolveProjectIdFromReadTools(foundationReads, context, args.project_id);
        const payload = foundationReads.getBudgetVsActual(projectId ?? asString(args.project_id));

        return {
          summary: payload.project ? `Loaded budget versus actual context for ${payload.project.name}.` : "Project budget context was not found.",
          payload,
        };
      },
    },
    {
      name: "get_monthly_burn_rate",
      requiredPermission: "finance.read",
      description: "Return monthly spend rhythm and average burn rate for the workspace or one project.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          project_id: { type: "string" },
          months: { type: "number" },
        },
      },
      execute: (args, context) => {
        const payload = foundationReads.getMonthlyBurnRate({
          projectId: resolveProjectIdFromReadTools(foundationReads, context, args.project_id),
          months: asInteger(args.months, 6),
        });

        return {
          summary: `Loaded ${payload.months} months of burn-rate context.`,
          payload,
        };
      },
    },
    {
      name: "get_expense_breakdown",
      requiredPermission: "finance.read",
      description: "Return category-level expense distribution for the workspace or one project.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          project_id: { type: "string" },
          period: { type: "string" },
        },
      },
      execute: (args, context) => {
        const period = asOptionalString(args.period);
        const payload = foundationReads.getExpenseBreakdown({
          projectId: resolveProjectIdFromReadTools(foundationReads, context, args.project_id),
          query: period ? { period: ["month", "quarter", "year", "custom"].includes(period) ? (period as "month" | "quarter" | "year" | "custom") : "month" } : undefined,
        });

        return {
          summary: payload.items.length ? `Loaded ${payload.items.length} expense categories.` : "No expense breakdown rows were found.",
          payload,
        };
      },
    },
    {
      name: "get_financial_health",
      requiredPermission: "finance.read",
      description: "Return a compact financial health summary for the workspace or one project.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          project_id: { type: "string" },
          period: { type: "string" },
        },
      },
      execute: (args, context) => {
        const period = asOptionalString(args.period);
        const payload = foundationReads.getFinancialHealth({
          projectId: resolveProjectIdFromReadTools(foundationReads, context, args.project_id),
          query: period ? { period: ["month", "quarter", "year", "custom"].includes(period) ? (period as "month" | "quarter" | "year" | "custom") : "month" } : undefined,
        });

        return {
          summary: "Loaded a compact financial health summary.",
          payload,
        };
      },
    },
    {
      name: "get_schedule_conflicts",
      requiredPermission: "projects.read",
      description: "Return overlapping unit windows and crew scheduling conflicts in the next 30 days.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          days: { type: "number" },
        },
      },
      execute: (args) => {
        const days = asInteger(args.days, 30);
        const rangeStart = new Date().toISOString().slice(0, 10);
        const conflicts = foundationReads.getProjectConflicts({
          rangeStart,
          rangeEnd: addDays(rangeStart, days),
        });

        return {
          summary: conflicts.length ? `Detected ${conflicts.length} scheduling conflicts.` : "No scheduling conflicts detected.",
          payload: {
            count: conflicts.length,
            items: conflicts.slice(0, 8),
          },
        };
      },
    },
    {
      name: "get_overdue_returns",
      requiredPermission: "packing-slips.read",
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
          projectId: resolveProjectIdFromReadTools(foundationReads, context, args.project_id),
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
          projectId: resolveProjectIdFromReadTools(foundationReads, context, args.project_id),
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
      requiredPermission: "finance.read",
      description: "Return budget, reserve and recent financial entries for one project.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          project_id: { type: "string" },
        },
        required: ["project_id"],
      },
      execute: (args, context) => {
        const projectId = resolveProjectIdFromReadTools(foundationReads, context, args.project_id);
        const payload = foundationReads.getProjectFinancials(projectId ?? asString(args.project_id));

        return {
          summary: payload.project ? `Loaded project financials for ${payload.project.name}.` : "Project was not found.",
          payload,
        };
      },
    },
    {
      name: "get_incident_costs",
      requiredPermission: "finance.read",
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
          projectId: resolveProjectIdFromReadTools(foundationReads, context, args.project_id),
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
      requiredPermission: "finance.read",
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
      requiredPermission: "finance.read",
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
      requiredPermission: "finance.read",
      description: "Return current reserve entries and total reserve amount.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          project_id: { type: "string" },
        },
      },
      execute: (args, context) => {
        const payload = foundationReads.getReservesStatus(resolveProjectIdFromReadTools(foundationReads, context, args.project_id));

        return {
          summary: payload.items.length ? "Loaded reserve status." : "No reserve entries found.",
          payload,
        };
      },
    },
    // Universal clarification tool — every agent can use this to ask the user
    // a single multiple-choice question when read tools genuinely can't
    // resolve a critical field. The renderer detects `kind:"choice"` payloads
    // and renders clickable option buttons in the chat (no free-text reply
    // needed). Use sparingly; prefer search_assets / search_projects first.
    {
      name: "ask_user_choice",
      description:
        "Ask the user to pick one option from a small predefined set when a critical field can't be resolved by other tools. Use sparingly: prefer search_assets / search_projects / etc. first. Returns immediately to the chat as a multiple-choice card.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["prompt", "options"],
        properties: {
          prompt: {
            type: "string",
            description: "Plain-language question to show the user above the options.",
          },
          context: {
            type: "string",
            description: "Optional one-line note explaining why the question is needed (shown smaller below the prompt).",
          },
          options: {
            type: "array",
            minItems: 2,
            maxItems: 6,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["value", "label"],
              properties: {
                value: { type: "string", description: "Machine-readable value the user's choice will resolve to." },
                label: { type: "string", description: "Short human label rendered on the button." },
                hint: { type: "string", description: "Optional secondary line under the label." },
              },
            },
          },
        },
      },
      execute: (args) => {
        const prompt = asString(args.prompt);
        const context = asOptionalString(args.context);
        const rawOptions = Array.isArray(args.options) ? args.options : [];
        const options = rawOptions
          .map((option) => {
            const o = option as Record<string, unknown>;
            return {
              value: asString(o.value),
              label: asString(o.label),
              hint: asOptionalString(o.hint),
            };
          })
          .filter((option) => option.value && option.label);
        return {
          summary: prompt
            ? `Asking the user: ${truncate(prompt, 80)}`
            : "Asking the user a clarification question.",
          payload: {
            kind: "choice",
            prompt,
            context: context ?? null,
            options,
          },
        };
      },
    },
    {
      name: "get_treasury_overview",
      requiredPermission: "treasury.transactions.read",
      description:
        "Treasury cash overview for a period: real income, expense, net, deductible expense, unclassified count, and per-account balances. Use for questions about cash position, spending, or how much is fiscally deductible.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          period: { type: "string", enum: ["month", "quarter", "year", "fiscal", "all"], description: "Defaults to fiscal." },
        },
      },
      execute: (args, context) => {
        if (!options.treasuryReads) {
          return { summary: "Treasury tools are not available on this device.", payload: { available: false } };
        }
        const period = (asOptionalString(args.period) ?? "fiscal") as
          | "month"
          | "quarter"
          | "year"
          | "fiscal"
          | "all";
        const snapshot = options.treasuryReads.getOverview({ workspaceId: context.workspaceId, period });
        return {
          summary: `Treasury ${snapshot.activePeriodLabel}: income ${snapshot.totalIncome}, expense ${snapshot.totalExpense}, net ${snapshot.net}, deductible ${snapshot.totalDeductibleExpense} (${snapshot.unclassifiedCount} unclassified).`,
          payload: {
            period: snapshot.activePeriodLabel,
            reportCurrency: snapshot.reportCurrency,
            totalIncome: snapshot.totalIncome,
            totalExpense: snapshot.totalExpense,
            net: snapshot.net,
            totalDeductibleExpense: snapshot.totalDeductibleExpense,
            unclassifiedCount: snapshot.unclassifiedCount,
            pendingReviewCount: snapshot.pendingReviewCount,
            monthly: snapshot.monthly,
            expenseByCategory: snapshot.expenseByCategory,
            accounts: snapshot.accounts.map((account) => ({
              id: account.id,
              label: account.accountLabel,
              currency: account.currency,
              bank: account.bankName,
              balance: account.currentBalance ?? account.openingBalance,
              movements: account.transactionCount,
            })),
          },
        };
      },
    },
    {
      name: "list_bank_accounts",
      requiredPermission: "treasury.transactions.read",
      description: "List treasury bank accounts with currency, bank, balance and movement count.",
      parameters: { type: "object", additionalProperties: false, properties: {} },
      execute: (_args, context) => {
        if (!options.treasuryReads) {
          return { summary: "Treasury tools are not available on this device.", payload: { items: [] } };
        }
        const accounts = options.treasuryReads.getAccounts(context.workspaceId).map((account) => ({
          id: account.id,
          label: account.accountLabel,
          bank: account.bankName,
          currency: account.currency,
          balance: account.currentBalance ?? account.openingBalance,
          movements: account.transactionCount,
        }));
        return {
          summary: accounts.length ? `Found ${accounts.length} bank account(s).` : "No bank accounts yet.",
          payload: { count: accounts.length, items: accounts },
        };
      },
    },
    {
      name: "list_bank_movements",
      requiredPermission: "treasury.transactions.read",
      description:
        "List bank movements (transactions) with filters. Use unclassified_only to find movements that still need classification.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          bank_account_id: { type: "string" },
          date_from: { type: "string", description: "YYYY-MM-DD" },
          date_to: { type: "string", description: "YYYY-MM-DD" },
          unclassified_only: { type: "boolean" },
          search: { type: "string", description: "Match raw description, concept or counterparty." },
          limit: { type: "number", description: "Defaults to 50, max 200." },
        },
      },
      execute: (args, context) => {
        if (!options.treasuryReads) {
          return { summary: "Treasury tools are not available on this device.", payload: { items: [] } };
        }
        const rows = options.treasuryReads.listTransactions({
          workspaceId: context.workspaceId,
          bankAccountId: asOptionalString(args.bank_account_id) ?? undefined,
          dateFrom: asOptionalString(args.date_from) ?? undefined,
          dateTo: asOptionalString(args.date_to) ?? undefined,
          unclassifiedOnly: args.unclassified_only === true || undefined,
          search: asOptionalString(args.search) ?? undefined,
          limit: Math.min(asInteger(args.limit, 50), 200),
        });
        const items = rows.map((row) => ({
          id: row.id,
          date: row.txnDate,
          account: row.bankAccountLabel,
          description: row.annotation?.concept || row.rawDescription,
          counterparty: row.annotation?.counterparty ?? null,
          amount: row.amount,
          direction: row.direction,
          currency: row.currency,
          kind: row.annotation?.txnKind ?? null,
          category: row.annotation?.expenseCategory ?? null,
          excludedFromTotals: row.excludedFromTotals,
        }));
        return {
          summary: `Found ${items.length} movement(s).`,
          payload: { count: items.length, items },
        };
      },
    },
    {
      name: "get_treasury_review_queue",
      requiredPermission: "treasury.transactions.read",
      description:
        "List reimbursements/expenses pending DGII deductible review (Jeannette's queue): claimed vs deductible amount and fiscal status.",
      parameters: { type: "object", additionalProperties: false, properties: {} },
      execute: (_args, context) => {
        if (!options.treasuryReads) {
          return { summary: "Treasury tools are not available on this device.", payload: { items: [] } };
        }
        const rows = options.treasuryReads.getReviewQueue(context.workspaceId).map((row) => ({
          transactionId: row.transactionId,
          date: row.txnDate,
          account: row.bankAccountLabel,
          concept: row.concept || row.rawDescription,
          counterparty: row.counterparty ?? null,
          amount: row.amount,
          currency: row.currency,
          deductibleAmount: row.deductibleAmount,
          fiscalStatus: row.fiscalStatus,
        }));
        return {
          summary: `${rows.length} movement(s) pending deductible review.`,
          payload: { count: rows.length, items: rows },
        };
      },
    },
    {
      name: "get_deductible_ledger",
      requiredPermission: "treasury.transactions.read",
      description:
        "Deductible expense ledger for a period (supplier, RNC, NCF, claimed, deductible, fiscal status). Use for DGII 606-style questions and totals.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          period: { type: "string", enum: ["month", "quarter", "year", "fiscal", "all"], description: "Defaults to fiscal." },
        },
      },
      execute: (args, context) => {
        if (!options.treasuryReads) {
          return { summary: "Treasury tools are not available on this device.", payload: { items: [] } };
        }
        const period = (asOptionalString(args.period) ?? "fiscal") as
          | "month"
          | "quarter"
          | "year"
          | "fiscal"
          | "all";
        const ledger = options.treasuryReads.getDeductibleLedger({ workspaceId: context.workspaceId, period });
        return {
          summary: `${ledger.rows.length} deductible expense row(s) for ${ledger.activePeriodLabel}.`,
          payload: {
            period: ledger.activePeriodLabel,
            count: ledger.rows.length,
            totalsByCurrency: ledger.totalsByCurrency,
            sample: ledger.rows.slice(0, 25).map((row) => ({
              date: row.txnDate,
              supplier: row.counterparty,
              rnc: row.counterpartyRnc,
              ncf: row.supplierNcf,
              claimed: row.claimedAmount,
              deductible: row.deductibleAmount,
              fiscalStatus: row.fiscalStatus,
              currency: row.currency,
            })),
          },
        };
      },
    },
    {
      name: "get_dgii_report",
      requiredPermission: "treasury.transactions.read",
      description: "Build a DGII fiscal report: 606 (purchases), 607 (sales) or 608 (voided). Returns totals and a sample of rows.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["report"],
        properties: {
          report: { type: "string", enum: ["606", "607", "608"] },
          period: { type: "string", enum: ["month", "quarter", "year", "fiscal", "all"], description: "Defaults to fiscal." },
        },
      },
      execute: (args, context) => {
        if (!options.treasuryReads) {
          return { summary: "Treasury tools are not available on this device.", payload: { rows: [] } };
        }
        const report = (asOptionalString(args.report) ?? "606") as "606" | "607" | "608";
        const period = (asOptionalString(args.period) ?? "fiscal") as
          | "month"
          | "quarter"
          | "year"
          | "fiscal"
          | "all";
        const result = options.treasuryReads.getDgiiReport({ workspaceId: context.workspaceId, report, period });
        return {
          summary: `${result.title} (${result.activePeriodLabel}): ${result.rowCount} row(s).`,
          payload: {
            kind: result.kind,
            period: result.activePeriodLabel,
            rowCount: result.rowCount,
            totals: result.totals,
            columns: result.columns.map((column) => column.label),
            sample: result.rows.slice(0, 25),
          },
        };
      },
    },
    {
      name: "get_project_pnl",
      requiredPermission: "treasury.transactions.read",
      description: "Per-project profit and loss from treasury allocations (income, expense, net, margin).",
      parameters: { type: "object", additionalProperties: false, properties: {} },
      execute: (_args, context) => {
        if (!options.treasuryReads) {
          return { summary: "Treasury tools are not available on this device.", payload: { items: [] } };
        }
        const rows = options.treasuryReads.getProjectPnl(context.workspaceId);
        return {
          summary: `P&L for ${rows.length} project(s).`,
          payload: { count: rows.length, items: rows },
        };
      },
    },
    {
      name: "read_attached_document",
      description:
        "Read a document attached to the current chat message (CSV, XLSX, PDF or text) and return its extracted content so you can understand, summarize, classify or import it. Images are already visible to you directly — read them from the message. Omit 'name' when there is a single attachment.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", description: "Attachment file name. Omit to use the only/first document." },
        },
      },
      execute: (args, context) => {
        const documents = context.attachedDocuments ?? [];
        if (!documents.length) {
          return { summary: "No documents are attached to this message.", payload: { documents: [] } };
        }
        const name = asOptionalString(args.name);
        const target = name
          ? documents.find((doc) => doc.name.toLowerCase() === name.toLowerCase()) ??
            documents.find((doc) => doc.name.toLowerCase().includes(name.toLowerCase()))
          : documents.length === 1
            ? documents[0]
            : null;
        if (!target) {
          return {
            summary: `Attached: ${documents.map((doc) => doc.name).join(", ")}. Specify which document to read.`,
            payload: { documents: documents.map((doc) => ({ name: doc.name, kind: doc.kind })) },
          };
        }
        if (target.kind === "image") {
          return {
            summary: `"${target.name}" is an image already visible to you in this message — read it directly.`,
            payload: { name: target.name, kind: "image" },
          };
        }
        return {
          summary: `Read ${target.kind.toUpperCase()} "${target.name}" (${target.rowCount} rows${target.truncated ? ", truncated" : ""}).`,
          payload: {
            name: target.name,
            kind: target.kind,
            rowCount: target.rowCount,
            truncated: target.truncated,
            text: target.text,
          },
        };
      },
    },
  ];

  // Quote read tools (FinanceOps Quotes v1, FQ6) — read-only. The agent cannot
  // create or update quotes; it can only inspect, summarise, and prepare a
  // draft shape that the user explicitly turns into a real quote.
  if (options.quoteReads) {
    const quoteReads = options.quoteReads;

    definitions.push({
      name: "search_quotes",
      description:
        "List quotes for a workspace, optionally filtered by status, client, project, currency or free-text search. Returns the most recent matches first.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          workspace_id: { type: "string" },
          status: { type: "string", enum: ["draft", "sent", "approved", "rejected", "expired", "cancelled"] },
          client_id: { type: "string" },
          project_id: { type: "string" },
          currency: { type: "string" },
          date_from: { type: "string" },
          date_to: { type: "string" },
          search: { type: "string" },
          limit: { type: "number" },
        },
      },
      execute: (args, context) => {
        const workspaceId = asString(args.workspace_id) || context.workspaceId;
        const rows = quoteReads.listQuotes({
          workspaceId,
          status: asOptionalString(args.status) as
            | "draft"
            | "sent"
            | "approved"
            | "rejected"
            | "expired"
            | "cancelled"
            | undefined,
          clientId: asOptionalString(args.client_id) ?? undefined,
          projectId: asOptionalString(args.project_id) ?? undefined,
          currency: asOptionalString(args.currency) ?? undefined,
          dateFrom: asOptionalString(args.date_from) ?? undefined,
          dateTo: asOptionalString(args.date_to) ?? undefined,
          search: asOptionalString(args.search) ?? undefined,
          limit: asInteger(args.limit, 20),
        });
        return {
          summary: rows.length
            ? `Found ${rows.length} quote${rows.length === 1 ? "" : "s"}.`
            : "No quotes match those filters.",
          payload: {
            count: rows.length,
            items: rows.map((row) => ({
              quoteId: row.id,
              quoteNumber: row.quoteNumber,
              status: row.status,
              quoteDate: row.quoteDate,
              validUntil: row.validUntil,
              client: row.clientNameSnapshot,
              project: row.projectNameSnapshot,
              packageTitle: row.packageTitle,
              currency: row.currency,
              total: row.totalAmount,
              taxProfile: row.taxProfile,
              taxAddedToTotal: row.taxAddedToTotal,
            })),
          },
        };
      },
    });

    definitions.push({
      name: "get_quote_detail",
      description:
        "Return the full detail of a single quote (header, items, totals and version snapshot data).",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["quote_id"],
        properties: {
          workspace_id: { type: "string" },
          quote_id: { type: "string" },
        },
      },
      execute: (args, context) => {
        const workspaceId = asString(args.workspace_id) || context.workspaceId;
        const quoteId = asString(args.quote_id);
        if (!quoteId) {
          return { summary: "Missing quote_id.", payload: { found: false } };
        }
        const detail = quoteReads.getQuoteDetail(workspaceId, quoteId);
        if (!detail) {
          return { summary: "Quote not found.", payload: { found: false } };
        }
        return {
          summary: `Loaded quote ${detail.quoteNumber} (${detail.status}, ${detail.currency} ${detail.totalAmount.toFixed(
            2,
          )}).`,
          payload: {
            found: true,
            quote: detail,
          },
        };
      },
    });

    definitions.push({
      name: "explain_quote_total",
      description:
        "Produce a human-readable breakdown of a quote's totals: subtotal, discounts, ITBIS treatment and final amount.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["quote_id"],
        properties: {
          workspace_id: { type: "string" },
          quote_id: { type: "string" },
        },
      },
      execute: (args, context) => {
        const workspaceId = asString(args.workspace_id) || context.workspaceId;
        const quoteId = asString(args.quote_id);
        if (!quoteId) {
          return { summary: "Missing quote_id.", payload: { found: false } };
        }
        const detail = quoteReads.getQuoteDetail(workspaceId, quoteId);
        if (!detail) {
          return { summary: "Quote not found.", payload: { found: false } };
        }
        const lines: string[] = [];
        lines.push(`Subtotal: ${detail.currency} ${detail.subtotalAmount.toFixed(2)}`);
        if (detail.discountAmount > 0) {
          const ratePart =
            detail.discountRate && detail.discountRate > 0 ? ` (${(detail.discountRate * 100).toFixed(2)}%)` : "";
          lines.push(
            `Discount${ratePart}: −${detail.currency} ${detail.discountAmount.toFixed(2)}`,
          );
        }
        const itbisLine = `ITBIS at ${(detail.itbisRate * 100).toFixed(2)}%: ${detail.currency} ${detail.taxAmount.toFixed(
          2,
        )}${detail.taxAddedToTotal ? " (added to total)" : " (shown but NOT added — Ley de Cine)"}`;
        lines.push(itbisLine);
        lines.push(`Total: ${detail.currency} ${detail.totalAmount.toFixed(2)}`);
        if (detail.currency !== detail.baseCurrency) {
          lines.push(
            `Equivalent in ${detail.baseCurrency} (rate ${detail.exchangeRate}): ${detail.baseCurrency} ${detail.baseCurrencyTotalAmount.toFixed(
              2,
            )}`,
          );
        }
        return {
          summary: `Quote ${detail.quoteNumber} totals breakdown ready.`,
          payload: {
            quoteId: detail.id,
            quoteNumber: detail.quoteNumber,
            taxProfile: detail.taxProfile,
            currency: detail.currency,
            breakdownLines: lines,
            subtotal: detail.subtotalAmount,
            discount: detail.discountAmount,
            tax: detail.taxAmount,
            total: detail.totalAmount,
            taxAddedToTotal: detail.taxAddedToTotal,
          },
        };
      },
    });

    definitions.push({
      name: "prepare_quote_draft",
      description:
        "Non-persistent quote sketch only. Use this only when the user explicitly asks for a rough quote outline that should NOT be saved. If the user asks to create, prepare, save, or draft a quote they can see in the app, use create_quote instead.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          client_name: { type: "string" },
          project_name: { type: "string" },
          package_title: { type: "string" },
          currency: { type: "string" },
          tax_profile: {
            type: "string",
            enum: ["film_law_exempt", "standard_itbis", "mixed", "manual"],
          },
          items: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                title: { type: "string" },
                description: { type: "string" },
                quantity: { type: "number" },
                unit_price: { type: "number" },
                duration_value: { type: "number" },
                duration_unit: { type: "string", enum: ["day", "week", "month", "unit", "flat"] },
              },
            },
          },
        },
      },
      execute: (args) => {
        const items = Array.isArray(args.items) ? args.items : [];
        const draft = {
          clientNameSnapshot: asOptionalString(args.client_name) ?? "",
          projectNameSnapshot: asOptionalString(args.project_name) ?? "",
          packageTitle: asOptionalString(args.package_title) ?? "",
          currency: asOptionalString(args.currency) ?? "DOP",
          taxProfile: (asOptionalString(args.tax_profile) ?? "standard_itbis") as
            | "film_law_exempt"
            | "standard_itbis"
            | "mixed"
            | "manual",
          items: items.map((raw, index) => {
            const item = raw as Record<string, unknown>;
            return {
              sortOrder: index + 1,
              title: asString(item.title),
              description: asOptionalString(item.description),
              quantity: asNumber(item.quantity) ?? 1,
              unitPrice: asNumber(item.unit_price) ?? 0,
              durationValue: asNumber(item.duration_value),
              durationUnit: asOptionalString(item.duration_unit) as
                | "day"
                | "week"
                | "month"
                | "unit"
                | "flat"
                | null,
              taxBehavior: "follows_quote" as const,
            };
          }),
        };
        return {
          summary: `Prepared a draft with ${draft.items.length} item${draft.items.length === 1 ? "" : "s"}. The user must open the Quotes editor to review and save it.`,
          payload: { draft, requiresHumanApproval: true },
        };
      },
    });
  }

  if (options.writeServices) {
    for (const writeTool of buildWriteToolDefinitions(options.writeServices)) {
      definitions.push(writeTool as ToolDefinition);
    }
  }

  const toolMap = new Map(definitions.map((tool) => [tool.name, tool]));

  return {
    definitions: definitions.map((tool) => ({
      type: "function" as const,
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      ...(tool.requiresApproval ? { requiresApproval: true } : {}),
    })),
    definitionsFor(
      toolNames: readonly string[] | null | undefined,
      userPermissions?: readonly string[] | null,
    ) {
      // When permissions are provided we hide tools the acting user could never
      // run, so the model never proposes a blocked action (and never surfaces a
      // permission error the user can't act on). `undefined`/`null` keeps the
      // legacy behaviour of exposing every agent-allowed tool.
      const canUse = (tool: ToolDefinition) => {
        if (!tool.requiredPermission || !userPermissions) {
          return true;
        }
        return userPermissions.includes("*") || userPermissions.includes(tool.requiredPermission);
      };

      return definitions
        .filter((tool) => isToolAllowed(tool.name, toolNames) && canUse(tool))
        .map((tool) => ({
          type: "function" as const,
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          ...(tool.requiresApproval ? { requiresApproval: true } : {}),
        }));
    },
    requiresApproval(name: string): boolean {
      const tool = toolMap.get(name);
      return Boolean(tool?.requiresApproval);
    },
    requiredPermissionFor(name: string): string | null {
      return toolMap.get(name)?.requiredPermission ?? null;
    },
    isAllowed(name: string, toolNames: readonly string[] | null | undefined) {
      return isToolAllowed(name, toolNames);
    },
    execute(name: string, rawArguments: string, context: AIGatewayToolContext, policy?: ToolPolicyOptions) {
      if (!isToolAllowed(name, policy?.allowedToolNames)) {
        throw new Error(`Tool ${name} is not allowed for this agent.`);
      }

      const tool = toolMap.get(name);

      if (!tool) {
        throw new Error(`Tool ${name} is not allowed.`);
      }

      assertToolPermission(tool, context);

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
