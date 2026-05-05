import type { AIGatewayToolContext } from "@contracts";

import type { createIncidentMutationService } from "../data/incidentMutationService";
import type { createPackingMutationService } from "../data/packingMutationService";
import type { createRmaMutationService } from "../data/rmaMutationService";
import type { createProjectMutationService } from "../data/projectMutationService";
import type { createAssetMutationService } from "../data/assetMutationService";
import type { createFinanceMutationService } from "../data/financeMutationService";

export type AgentWriteServices = {
  packing: ReturnType<typeof createPackingMutationService>;
  projects: ReturnType<typeof createProjectMutationService>;
  incidents: ReturnType<typeof createIncidentMutationService>;
  rma: ReturnType<typeof createRmaMutationService>;
  assets: ReturnType<typeof createAssetMutationService>;
  finance: ReturnType<typeof createFinanceMutationService>;
};

type WriteToolExecutionResult = {
  payload: Record<string, unknown>;
  summary: string;
};

export type WriteToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  requiresApproval: boolean;
  execute: (args: Record<string, unknown>, context: AIGatewayToolContext) => WriteToolExecutionResult;
};

const asString = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const asOptionalString = (value: unknown) => {
  const next = asString(value);
  return next || undefined;
};
const asNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

const newCommandId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const requireWorkspaceId = (context: AIGatewayToolContext): string => {
  const workspaceId = context.workspaceId;
  if (!workspaceId) {
    throw new Error("Tool requires an active workspace. Ask the user to select one before retrying.");
  }
  return workspaceId;
};

export const buildWriteToolDefinitions = (services: AgentWriteServices): WriteToolDefinition[] => [
  {
    name: "create_incident",
    description:
      "Open a new incident on an asset or project. Use when a user reports damage, loss or a problem that should be tracked. Requires human approval before persisting.",
    requiresApproval: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["title", "description", "incident_type", "severity"],
      properties: {
        title: { type: "string", description: "Short headline for the incident." },
        description: { type: "string", description: "What happened, observed by who, when." },
        incident_type: { type: "string", description: "e.g. damage, loss, malfunction." },
        severity: { type: "string", enum: ["Low", "Medium", "High", "Critical"] },
        asset_id: { type: "string" },
        project_id: { type: "string" },
        project_unit_id: { type: "string" },
        department_id: { type: "string" },
        responsible_user_id: { type: "string" },
        cost_estimate: { type: "number" },
        notes: { type: "string" },
      },
    },
    execute: (args, context) => {
      const workspaceId = requireWorkspaceId(context);
      const result = services.incidents.reportIncident({
        commandId: newCommandId("agent-incident"),
        workspaceId,
        actorUserId: context.sourceActorUserId ?? undefined,
        assetId: asOptionalString(args.asset_id),
        projectId: asOptionalString(args.project_id),
        projectUnitId: asOptionalString(args.project_unit_id),
        departmentId: asOptionalString(args.department_id),
        responsibleUserId: asOptionalString(args.responsible_user_id),
        incidentType: asString(args.incident_type) || "issue",
        severity: asString(args.severity) || "Medium",
        title: asString(args.title),
        description: asString(args.description),
        costEstimate: asNumber(args.cost_estimate),
        notes: asOptionalString(args.notes),
        actorType: "agent",
        sourceChannel: "desktop",
      });
      return {
        summary: result.summary,
        payload: { incidentId: result.incidentId, repeated: result.repeated },
      };
    },
  },

  {
    name: "update_incident",
    description:
      "Update an existing incident — change status, severity, owner or cost estimate. Use status='Resolved' to close. Requires approval.",
    requiresApproval: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["incident_id"],
      properties: {
        incident_id: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        severity: { type: "string" },
        status: { type: "string" },
        responsible_user_id: { type: "string" },
        cost_estimate: { type: "number" },
        notes: { type: "string" },
      },
    },
    execute: (args, context) => {
      const workspaceId = requireWorkspaceId(context);
      const result = services.incidents.updateIncident({
        commandId: newCommandId("agent-incident-update"),
        workspaceId,
        actorUserId: context.sourceActorUserId ?? undefined,
        incidentId: asString(args.incident_id),
        title: asOptionalString(args.title),
        description: asOptionalString(args.description),
        severity: asOptionalString(args.severity),
        status: asOptionalString(args.status),
        responsibleUserId: asOptionalString(args.responsible_user_id),
        costEstimate: asNumber(args.cost_estimate),
        notes: asOptionalString(args.notes),
        actorType: "agent",
        sourceChannel: "desktop",
      });
      return { summary: result.summary, payload: { incidentId: result.incidentId } };
    },
  },

  {
    name: "create_rma",
    description:
      "Open a new RMA (repair/return) case for one or more damaged assets. Requires approval. Use when an incident escalates to a manufacturer-tracked repair. The manufacturer must already exist in the catalog.",
    requiresApproval: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["title", "manufacturer_id", "problem_summary", "asset_items"],
      properties: {
        title: { type: "string" },
        manufacturer_id: { type: "string", description: "ID of the manufacturer record. Search the catalog first." },
        support_email: { type: "string" },
        problem_summary: { type: "string" },
        notes: { type: "string" },
        asset_items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["asset_id", "issue_summary"],
            properties: {
              asset_id: { type: "string" },
              issue_summary: { type: "string" },
              equipment_year: { type: "string" },
            },
          },
        },
      },
    },
    execute: (args, context) => {
      const workspaceId = requireWorkspaceId(context);
      const rawAssets = Array.isArray(args.asset_items) ? args.asset_items : [];
      const assetItems = rawAssets.map((item) => {
        const entry = item as Record<string, unknown>;
        return {
          assetId: asString(entry.asset_id),
          issueSummary: asString(entry.issue_summary),
          equipmentYear: asOptionalString(entry.equipment_year),
        };
      });

      const result = services.rma.createRmaCase({
        commandId: newCommandId("agent-rma"),
        workspaceId,
        actorUserId: context.sourceActorUserId ?? undefined,
        title: asString(args.title),
        manufacturerId: asString(args.manufacturer_id),
        supportEmail: asOptionalString(args.support_email),
        problemSummary: asString(args.problem_summary),
        notes: asOptionalString(args.notes),
        assetItems,
        actorType: "agent",
        sourceChannel: "desktop",
      });
      return { summary: result.summary, payload: { rmaCaseId: result.rmaCaseId } };
    },
  },

  {
    name: "create_packing_slip",
    description:
      "Create a packing slip handing equipment to a project unit. Requires approval. Use when a user asks to issue gear for a shoot day.",
    requiresApproval: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["project_id", "asset_ids"],
      properties: {
        project_id: { type: "string" },
        project_unit_id: { type: "string" },
        department_id: { type: "string" },
        responsible_user_id: { type: "string" },
        return_due_at: { type: "string", description: "ISO date for return." },
        notes: { type: "string" },
        asset_ids: {
          type: "array",
          items: { type: "string" },
          description: "Asset IDs to include in the slip.",
        },
        asset_selections: {
          type: "array",
          description: "Optional per-asset quantity selections; defaults to 1 per asset_id when omitted.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["asset_id", "quantity"],
            properties: {
              asset_id: { type: "string" },
              quantity: { type: "number" },
            },
          },
        },
      },
    },
    execute: (args, context) => {
      const workspaceId = requireWorkspaceId(context);
      const assetIds = Array.isArray(args.asset_ids)
        ? (args.asset_ids as unknown[]).map((value) => asString(value)).filter(Boolean)
        : [];
      const rawSelections = Array.isArray(args.asset_selections) ? args.asset_selections : [];
      const assetSelections = rawSelections.map((entry) => {
        const item = entry as Record<string, unknown>;
        return {
          assetId: asString(item.asset_id),
          quantity: asNumber(item.quantity) ?? 1,
        };
      });

      const result = services.packing.createPackingSlip({
        commandId: newCommandId("agent-packing"),
        workspaceId,
        actorUserId: context.sourceActorUserId ?? undefined,
        assetIds,
        assetSelections: assetSelections.length ? assetSelections : undefined,
        projectId: asString(args.project_id),
        projectUnitId: asOptionalString(args.project_unit_id),
        departmentId: asOptionalString(args.department_id),
        responsibleUserId: asOptionalString(args.responsible_user_id),
        returnDueAt: asOptionalString(args.return_due_at),
        notes: asOptionalString(args.notes),
        actorType: "agent",
        sourceChannel: "desktop",
      });
      return {
        summary: result.summary,
        payload: { packingSlipId: result.packingSlipId, repeated: result.repeated, slipNumber: result.slipNumber },
      };
    },
  },

  {
    name: "return_packing_items",
    description:
      "Close a packing slip — mark gear as returned. Use when the crew brings equipment back at end of day. Requires approval.",
    requiresApproval: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["packing_slip_id"],
      properties: {
        packing_slip_id: { type: "string" },
        asset_ids: {
          type: "array",
          items: { type: "string" },
          description: "Optional subset of asset IDs to mark as returned. Omit to return everything on the slip.",
        },
        condition_in: { type: "string", description: "Optional condition note (e.g. 'Good', 'Damaged')." },
        notes: { type: "string" },
      },
    },
    execute: (args, context) => {
      const workspaceId = requireWorkspaceId(context);
      const assetIds = Array.isArray(args.asset_ids)
        ? (args.asset_ids as unknown[]).map((value) => asString(value)).filter(Boolean)
        : undefined;

      const result = services.packing.returnPackingSlipItems({
        commandId: newCommandId("agent-packing-return"),
        workspaceId,
        actorUserId: context.sourceActorUserId ?? undefined,
        packingSlipId: asString(args.packing_slip_id),
        assetIds,
        conditionIn: asOptionalString(args.condition_in),
        notes: asOptionalString(args.notes),
        actorType: "agent",
        sourceChannel: "desktop",
      });
      return {
        summary: result.summary,
        payload: {
          packingSlipId: result.packingSlipId,
          slipStatus: result.slipStatus,
          processedAssetIds: result.processedAssetIds,
        },
      };
    },
  },

  {
    name: "delegate_to_agent",
    description:
      "Hand off to a more specialized agent. Supervisor only. Use when a request clearly fits another agent's domain (assets, finance, repairs, planning). The chosen agent picks up the next turn — this tool just records the routing intent.",
    requiresApproval: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["target_agent_key", "intent"],
      properties: {
        target_agent_key: {
          type: "string",
          description: "Key of the target agent — e.g. assets-agent, finance-agent, incidents-maintenance-agent, projects-scheduling-agent, communications-agent.",
        },
        intent: { type: "string", description: "Short summary of what the target agent should handle." },
        context_summary: { type: "string", description: "Brief context already gathered, to avoid asking the user twice." },
      },
    },
    execute: (args) => {
      const target = asString(args.target_agent_key);
      const intent = asString(args.intent);
      const summary = `Routing to ${target || "specialist"}: ${intent || "no intent provided"}`;
      return {
        summary,
        payload: {
          targetAgentKey: target,
          intent,
          contextSummary: asOptionalString(args.context_summary),
        },
      };
    },
  },
];
