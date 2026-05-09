import type {
  AIGatewayToolContext,
  CommandSourceChannel,
  QuoteItemDurationUnit,
  QuoteItemTaxBehavior,
  QuoteTaxProfile,
} from "@contracts";

import type { createIncidentMutationService } from "../data/incidentMutationService";
import type { createPackingMutationService } from "../data/packingMutationService";
import type { createRmaMutationService } from "../data/rmaMutationService";
import type { createProjectMutationService } from "../data/projectMutationService";
import type { createAssetMutationService } from "../data/assetMutationService";
import type { createFinanceMutationService } from "../data/financeMutationService";
import type { createQuoteMutationService } from "../data/quoteMutationService";

type ProjectLookupService = {
  findByCode(workspaceId: string, code: string): { id: string; code: string; name: string; status: string } | null;
  findByIdentifier?(workspaceId: string, identifier: string): { id: string; code: string; name: string; status: string } | null;
};

export type AgentWriteServices = {
  packing: ReturnType<typeof createPackingMutationService>;
  projects: ReturnType<typeof createProjectMutationService>;
  incidents: ReturnType<typeof createIncidentMutationService>;
  rma: ReturnType<typeof createRmaMutationService>;
  assets: ReturnType<typeof createAssetMutationService>;
  finance: ReturnType<typeof createFinanceMutationService>;
  quotes: ReturnType<typeof createQuoteMutationService>;
  projectLookup?: ProjectLookupService;
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
const asBoolean = (value: unknown) => (typeof value === "boolean" ? value : undefined);
const asPriority = (value: unknown) => {
  const nextValue = asNumber(value);
  if (nextValue === undefined) {
    return 0;
  }
  return Math.max(0, Math.min(3, Math.floor(nextValue)));
};

const newCommandId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const currentDateOnly = () => new Date().toISOString().slice(0, 10);

const resolveSourceChannel = (context: AIGatewayToolContext): CommandSourceChannel => {
  const connectorKey = context.sourceConnectorKey?.toLowerCase();
  if (connectorKey === "telegram" || connectorKey === "whatsapp") {
    return connectorKey;
  }
  return "desktop";
};

const normalizeProjectCode = (name: string, explicitCode?: string) => {
  const directCode = explicitCode?.trim();
  if (directCode) {
    return directCode.toUpperCase();
  }

  const tokens = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-zA-Z0-9]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const fallback = tokens.length > 1 ? tokens.slice(0, 4).map((token) => token[0]).join("") : tokens[0]?.slice(0, 6);
  return (fallback || "PRJ").replace(/[^a-zA-Z0-9]+/g, "").toUpperCase();
};

const normalizeQuoteTaxProfile = (value: unknown): QuoteTaxProfile => {
  const next = asString(value);
  return next === "film_law_exempt" || next === "standard_itbis" || next === "mixed" || next === "manual"
    ? next
    : "standard_itbis";
};

const normalizeQuoteTaxBehavior = (value: unknown): QuoteItemTaxBehavior => {
  const next = asString(value);
  return next === "follows_quote" || next === "taxable" || next === "exempt" || next === "show_only" || next === "included"
    ? next
    : "follows_quote";
};

const normalizeQuoteDurationUnit = (value: unknown): QuoteItemDurationUnit | null => {
  const next = asString(value);
  return next === "day" || next === "week" || next === "month" || next === "unit" || next === "flat" ? next : null;
};

const lookupProjectByCode = (services: AgentWriteServices, workspaceId: string, code: string) =>
  services.projectLookup?.findByCode(workspaceId, code) ?? null;

const buildProjectIdentifierCandidates = (identifier: string) => {
  const normalizedIdentifier = identifier.trim();
  const candidates = new Set<string>();

  if (!normalizedIdentifier) {
    return [];
  }

  candidates.add(normalizedIdentifier);

  normalizedIdentifier
    .split(/\s*(?:\/|\||·|—|–|-)\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => candidates.add(part));

  const codeMatch = normalizedIdentifier.match(/\b[A-Z0-9]{2,8}\b/);
  if (codeMatch?.[0]) {
    candidates.add(codeMatch[0]);
  }

  return Array.from(candidates);
};

const lookupProjectByIdentifier = (services: AgentWriteServices, workspaceId: string, identifier: string) => {
  for (const candidate of buildProjectIdentifierCandidates(identifier)) {
    const project =
      services.projectLookup?.findByIdentifier?.(workspaceId, candidate) ??
      services.projectLookup?.findByCode(workspaceId, candidate) ??
      null;

    if (project) {
      return project;
    }
  }

  return null;
};

const resolveRequiredProjectId = (services: AgentWriteServices, workspaceId: string, identifier: unknown) => {
  const projectIdentifier = asString(identifier);
  if (!projectIdentifier) {
    throw new Error("Project is required before this action can continue.");
  }

  const project = lookupProjectByIdentifier(services, workspaceId, projectIdentifier);
  return project?.id ?? projectIdentifier;
};

const resolveOptionalProjectId = (services: AgentWriteServices, workspaceId: string, identifier: unknown) => {
  const projectIdentifier = asOptionalString(identifier);
  if (!projectIdentifier) {
    return null;
  }

  const project = lookupProjectByIdentifier(services, workspaceId, projectIdentifier);
  return project?.id ?? projectIdentifier;
};

const requireWorkspaceId = (context: AIGatewayToolContext): string => {
  const workspaceId = context.workspaceId;
  if (!workspaceId) {
    throw new Error("Tool requires an active workspace. Ask the user to select one before retrying.");
  }
  return workspaceId;
};

export const buildWriteToolDefinitions = (services: AgentWriteServices): WriteToolDefinition[] => [
  {
    name: "create_notification",
    description:
      "Create a personal in-app notification for the current user in the active workspace. Use for explicit reminders, operational handoffs, or agent completion notices the user asked to receive.",
    requiresApproval: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["title"],
      properties: {
        title: { type: "string", description: "Short notification title." },
        body: { type: "string", description: "Optional supporting detail." },
        kind: { type: "string", description: "Defaults to operation." },
        link_to: { type: "string", description: "Internal app route to open when clicked." },
        notify_now: { type: "boolean", description: "Whether to show toast/native notification immediately. Defaults to true." },
      },
    },
    execute: (args, context) => {
      requireWorkspaceId(context);
      const title = asString(args.title);
      if (!title) {
        throw new Error("Notification title is required.");
      }

      return {
        summary: `Notification queued: ${title}`,
        payload: {
          notificationIntent: {
            type: "create_notification",
            title,
            body: asOptionalString(args.body) ?? null,
            kind: asOptionalString(args.kind) ?? "operation",
            linkTo: asOptionalString(args.link_to) ?? context.activePath ?? null,
            notifyNow: asBoolean(args.notify_now) ?? true,
            sourceRef: {
              tool: "create_notification",
              correlationId: context.correlationId ?? null,
            },
          },
        },
      };
    },
  },

  {
    name: "create_todo",
    description:
      "Create a personal todo for the current user in the active workspace. Use when the user asks to track a follow-up task.",
    requiresApproval: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["title"],
      properties: {
        title: { type: "string" },
        notes: { type: "string" },
        due_at: { type: "string", description: "ISO timestamp or date string when the todo is due." },
        recurrence_rule: { type: "string", description: "Optional basic RRULE, e.g. FREQ=DAILY, FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR, FREQ=WEEKLY." },
        priority: { type: "number", description: "0 low/default, 1 normal, 2 high, 3 urgent." },
      },
    },
    execute: (args, context) => {
      requireWorkspaceId(context);
      const title = asString(args.title);
      if (!title) {
        throw new Error("Todo title is required.");
      }

      return {
        summary: `Todo queued: ${title}`,
        payload: {
          notificationIntent: {
            type: "create_todo",
            title,
            notes: asOptionalString(args.notes) ?? null,
            dueAt: asOptionalString(args.due_at) ?? null,
            recurrenceRule: asOptionalString(args.recurrence_rule) ?? null,
            priority: asPriority(args.priority),
            sourceRef: {
              tool: "create_todo",
              correlationId: context.correlationId ?? null,
            },
          },
        },
      };
    },
  },

  {
    name: "create_reminder",
    description:
      "Create a personal reminder for the current user in the active workspace. Use when the user asks to be reminded at a specific time.",
    requiresApproval: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["title", "remind_at"],
      properties: {
        title: { type: "string" },
        body: { type: "string" },
        remind_at: { type: "string", description: "ISO timestamp for when the reminder should fire." },
        recurrence_rule: { type: "string", description: "Optional basic RRULE, e.g. FREQ=DAILY, FREQ=WEEKLY, FREQ=MONTHLY." },
      },
    },
    execute: (args, context) => {
      requireWorkspaceId(context);
      const title = asString(args.title);
      const remindAt = asString(args.remind_at);
      const parsedRemindAt = Date.parse(remindAt);
      if (!title) {
        throw new Error("Reminder title is required.");
      }
      if (!remindAt || !Number.isFinite(parsedRemindAt)) {
        throw new Error("Reminder remind_at must be a valid ISO timestamp.");
      }

      return {
        summary: `Reminder queued: ${title}`,
        payload: {
          notificationIntent: {
            type: "create_reminder",
            title,
            body: asOptionalString(args.body) ?? null,
            remindAt: new Date(parsedRemindAt).toISOString(),
            recurrenceRule: asOptionalString(args.recurrence_rule) ?? null,
            sourceRef: {
              tool: "create_reminder",
              correlationId: context.correlationId ?? null,
            },
          },
        },
      };
    },
  },

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
        projectId: resolveOptionalProjectId(services, workspaceId, args.project_id) ?? undefined,
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
        sourceChannel: resolveSourceChannel(context),
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
        sourceChannel: resolveSourceChannel(context),
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
        sourceChannel: resolveSourceChannel(context),
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
      const projectId = resolveRequiredProjectId(services, workspaceId, args.project_id);
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
        projectId,
        projectUnitId: asOptionalString(args.project_unit_id),
        departmentId: asOptionalString(args.department_id),
        responsibleUserId: asOptionalString(args.responsible_user_id),
        returnDueAt: asOptionalString(args.return_due_at),
        notes: asOptionalString(args.notes),
        actorType: "agent",
        sourceChannel: resolveSourceChannel(context),
      });
      return {
        summary: result.summary,
        payload: {
          packingSlipId: result.packingSlipId,
          projectId,
          repeated: result.repeated,
          slipNumber: result.slipNumber,
        },
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
        sourceChannel: resolveSourceChannel(context),
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
    name: "create_project",
    description:
      "Create a new project with basic schedule, client and production context. Requires approval. Use after gathering at least the project name and preferably a short code.",
    requiresApproval: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["name"],
      properties: {
        name: { type: "string" },
        code: { type: "string", description: "Short project code, e.g. ATB. If omitted, the tool derives one from the name." },
        client_name: { type: "string" },
        client_id: { type: "string" },
        production_company_name: { type: "string" },
        production_company_id: { type: "string" },
        status: { type: "string", description: "Prep, Active, Wrapped, Cancelled, etc." },
        description: { type: "string" },
        start_date: { type: "string", description: "YYYY-MM-DD." },
        end_date: { type: "string", description: "YYYY-MM-DD." },
        has_preproduction: { type: "boolean" },
        preproduction_start_date: { type: "string", description: "YYYY-MM-DD." },
        preproduction_end_date: { type: "string", description: "YYYY-MM-DD." },
        color_key: { type: "string" },
      },
    },
    execute: (args, context) => {
      const workspaceId = requireWorkspaceId(context);
      const name = asString(args.name);
      const code = normalizeProjectCode(name, asOptionalString(args.code));

      try {
        services.projects.createProject({
          workspaceId,
          code,
          name,
          clientId: asOptionalString(args.client_id),
          clientName: asOptionalString(args.client_name),
          productionCompanyId: asOptionalString(args.production_company_id),
          productionCompanyName: asOptionalString(args.production_company_name),
          status: asOptionalString(args.status) ?? "Prep",
          description: asOptionalString(args.description),
          startDate: asOptionalString(args.start_date),
          endDate: asOptionalString(args.end_date),
          hasPreproduction: asBoolean(args.has_preproduction),
          preproductionStartDate: asOptionalString(args.preproduction_start_date),
          preproductionEndDate: asOptionalString(args.preproduction_end_date),
          colorKey: asOptionalString(args.color_key),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Project creation failed.";
        const existingProject = message.includes("already in use") ? lookupProjectByCode(services, workspaceId, code) : null;

        if (!existingProject) {
          throw error;
        }

        return {
          summary: `Project ${existingProject.code} · ${existingProject.name} already exists.`,
          payload: {
            projectId: existingProject.id,
            code: existingProject.code,
            name: existingProject.name,
            status: existingProject.status,
            created: false,
          },
        };
      }

      const project = lookupProjectByCode(services, workspaceId, code);

      return {
        summary: `Project ${code} · ${name} created.`,
        payload: {
          projectId: project?.id ?? null,
          code: project?.code ?? code,
          name: project?.name ?? name,
          status: project?.status ?? asOptionalString(args.status) ?? "Prep",
          created: true,
        },
      };
    },
  },

  {
    name: "update_project",
    description:
      "Update an existing project's core details or schedule. Requires approval. Use get_project_detail first so unchanged required fields like code and name are preserved.",
    requiresApproval: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["project_id", "code", "name"],
      properties: {
        project_id: { type: "string" },
        code: { type: "string" },
        name: { type: "string" },
        client_name: { type: "string" },
        client_id: { type: "string" },
        production_company_name: { type: "string" },
        production_company_id: { type: "string" },
        status: { type: "string" },
        description: { type: "string" },
        start_date: { type: "string", description: "YYYY-MM-DD." },
        end_date: { type: "string", description: "YYYY-MM-DD." },
        has_preproduction: { type: "boolean" },
        preproduction_start_date: { type: "string", description: "YYYY-MM-DD." },
        preproduction_end_date: { type: "string", description: "YYYY-MM-DD." },
        color_key: { type: "string" },
      },
    },
    execute: (args, context) => {
      const workspaceId = requireWorkspaceId(context);
      const projectId = resolveRequiredProjectId(services, workspaceId, args.project_id);
      const code = asString(args.code);
      const name = asString(args.name);

      services.projects.updateProject({
        projectId,
        code,
        name,
        clientId: asOptionalString(args.client_id),
        clientName: asOptionalString(args.client_name),
        productionCompanyId: asOptionalString(args.production_company_id),
        productionCompanyName: asOptionalString(args.production_company_name),
        status: asOptionalString(args.status),
        description: asOptionalString(args.description),
        startDate: asOptionalString(args.start_date),
        endDate: asOptionalString(args.end_date),
        hasPreproduction: asBoolean(args.has_preproduction),
        preproductionStartDate: asOptionalString(args.preproduction_start_date),
        preproductionEndDate: asOptionalString(args.preproduction_end_date),
        colorKey: asOptionalString(args.color_key),
      });

      return {
        summary: `Project ${code} · ${name} updated.`,
        payload: { projectId, code, name },
      };
    },
  },

  {
    name: "create_project_unit",
    description:
      "Create a project unit or shoot unit inside an existing project. Requires approval. Use for second unit, main unit refinements, shoot blocks or production phases.",
    requiresApproval: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["project_id", "code", "name"],
      properties: {
        project_id: { type: "string" },
        code: { type: "string" },
        name: { type: "string" },
        sort_order: { type: "number" },
        color_key: { type: "string" },
        start_date: { type: "string", description: "YYYY-MM-DD." },
        end_date: { type: "string", description: "YYYY-MM-DD." },
        notes: { type: "string" },
      },
    },
    execute: (args, context) => {
      const workspaceId = requireWorkspaceId(context);
      const projectId = resolveRequiredProjectId(services, workspaceId, args.project_id);
      const code = asString(args.code).toUpperCase();
      const name = asString(args.name);

      services.projects.createProjectUnit({
        projectId,
        code,
        name,
        sortOrder: asNumber(args.sort_order),
        colorKey: asOptionalString(args.color_key),
        startDate: asOptionalString(args.start_date),
        endDate: asOptionalString(args.end_date),
        notes: asOptionalString(args.notes),
      });

      return {
        summary: `Unit ${code} · ${name} created.`,
        payload: { projectId, code, name },
      };
    },
  },

  {
    name: "create_quote",
    description:
      "Create a saved draft quote with client, project, package and line items so it appears in Quotes. Requires approval. Use this whenever the user asks to create, prepare, save, or draft a quote unless they explicitly ask for a non-saved outline.",
    requiresApproval: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["client_name", "items"],
      properties: {
        quote_date: { type: "string", description: "YYYY-MM-DD. Defaults to today." },
        validity_days: { type: "number" },
        client_id: { type: "string" },
        client_name: { type: "string" },
        client_rnc: { type: "string" },
        production_company_id: { type: "string" },
        production_company_name: { type: "string" },
        production_pur: { type: "string" },
        workspace_sirecine: { type: "string" },
        attention_name: { type: "string" },
        attention_phone: { type: "string" },
        project_id: { type: "string" },
        project_name: { type: "string" },
        production_name: { type: "string" },
        description: { type: "string" },
        package_title: { type: "string" },
        currency: { type: "string", description: "Defaults to DOP." },
        base_currency: { type: "string", description: "Defaults to currency." },
        exchange_rate: { type: "number", description: "Defaults to 1." },
        tax_profile: { type: "string", enum: ["film_law_exempt", "standard_itbis", "mixed", "manual"] },
        itbis_rate: { type: "number", description: "Defaults to 0.18." },
        tax_added_to_total: { type: "boolean", description: "Defaults to true." },
        tax_notes: { type: "string" },
        discount_rate: { type: "number" },
        discount_amount: { type: "number" },
        observations: { type: "string" },
        items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["title", "quantity", "unit_price"],
            properties: {
              title: { type: "string" },
              description: { type: "string" },
              quantity: { type: "number" },
              unit_price: { type: "number" },
              duration_value: { type: "number" },
              duration_unit: { type: "string", enum: ["day", "week", "month", "unit", "flat"] },
              discount_rate: { type: "number" },
              discount_amount: { type: "number" },
              tax_behavior: { type: "string", enum: ["follows_quote", "taxable", "exempt", "show_only", "included"] },
              tax_rate: { type: "number" },
              notes: { type: "string" },
            },
          },
        },
      },
    },
    execute: (args, context) => {
      const workspaceId = requireWorkspaceId(context);
      const currency = (asOptionalString(args.currency) ?? "DOP").toUpperCase();
      const baseCurrency = (asOptionalString(args.base_currency) ?? currency).toUpperCase();
      const rawItems = Array.isArray(args.items) ? args.items : [];
      const items = rawItems.map((entry, index) => {
        const item = entry as Record<string, unknown>;
        return {
          sortOrder: index,
          quantity: asNumber(item.quantity) ?? 1,
          title: asString(item.title),
          description: asOptionalString(item.description) ?? null,
          durationValue: asNumber(item.duration_value) ?? null,
          durationUnit: normalizeQuoteDurationUnit(item.duration_unit),
          unitPrice: asNumber(item.unit_price) ?? 0,
          discountRate: asNumber(item.discount_rate) ?? null,
          discountAmount: asNumber(item.discount_amount) ?? null,
          taxBehavior: normalizeQuoteTaxBehavior(item.tax_behavior),
          taxRate: asNumber(item.tax_rate) ?? null,
          notes: asOptionalString(item.notes) ?? null,
        };
      });

      const result = services.quotes.createQuote({
        commandId: newCommandId("agent-quote"),
        workspaceId,
        actorType: "agent",
        sourceChannel: resolveSourceChannel(context),
        quoteDate: asOptionalString(args.quote_date) ?? currentDateOnly(),
        validityDays: Math.max(1, Math.floor(asNumber(args.validity_days) ?? 30)),
        clientId: asOptionalString(args.client_id) ?? null,
        clientNameSnapshot: asString(args.client_name),
        clientRncSnapshot: asOptionalString(args.client_rnc) ?? null,
        productionCompanyId: asOptionalString(args.production_company_id) ?? null,
        productionCompanyNameSnapshot: asOptionalString(args.production_company_name) ?? null,
        productionPurSnapshot: asOptionalString(args.production_pur) ?? null,
        workspaceSirecineSnapshot: asOptionalString(args.workspace_sirecine) ?? null,
        attentionName: asOptionalString(args.attention_name) ?? null,
        attentionPhone: asOptionalString(args.attention_phone) ?? null,
        projectId: resolveOptionalProjectId(services, workspaceId, args.project_id),
        projectNameSnapshot: asOptionalString(args.project_name) ?? null,
        productionName: asOptionalString(args.production_name) ?? null,
        description: asOptionalString(args.description) ?? null,
        packageTitle: asOptionalString(args.package_title) ?? null,
        currency,
        baseCurrency,
        exchangeRate: asNumber(args.exchange_rate) ?? 1,
        exchangeRateSource: "manual",
        exchangeRateType: "manual",
        exchangeRateEffectiveDate: null,
        taxProfile: normalizeQuoteTaxProfile(args.tax_profile),
        itbisRate: asNumber(args.itbis_rate) ?? 0.18,
        taxAddedToTotal: asBoolean(args.tax_added_to_total) ?? true,
        taxNotes: asOptionalString(args.tax_notes) ?? null,
        discountRate: asNumber(args.discount_rate) ?? null,
        discountAmount: asNumber(args.discount_amount) ?? null,
        observations: asOptionalString(args.observations) ?? null,
        items,
      });

      return {
        summary: result.summary,
        payload: { quoteId: result.quoteId, quoteNumber: result.quoteNumber, repeated: result.repeated },
      };
    },
  },

  {
    name: "set_quote_status",
    description:
      "Move a quote to sent, approved, rejected or cancelled. Requires approval. Cancelling an approved quote needs a reason.",
    requiresApproval: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["quote_id", "status"],
      properties: {
        quote_id: { type: "string" },
        status: { type: "string", enum: ["sent", "approved", "rejected", "cancelled"] },
        reason: { type: "string" },
      },
    },
    execute: (args, context) => {
      const workspaceId = requireWorkspaceId(context);
      const status = asString(args.status);
      if (status !== "sent" && status !== "approved" && status !== "rejected" && status !== "cancelled") {
        throw new Error("Quote status must be sent, approved, rejected or cancelled.");
      }

      const result = services.quotes.setStatus({
        commandId: newCommandId("agent-quote-status"),
        workspaceId,
        actorType: "agent",
        sourceChannel: resolveSourceChannel(context),
        quoteId: asString(args.quote_id),
        status,
        reason: asOptionalString(args.reason) ?? null,
      });

      return {
        summary: result.summary,
        payload: { quoteId: result.quoteId, quoteNumber: result.quoteNumber, repeated: result.repeated },
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
