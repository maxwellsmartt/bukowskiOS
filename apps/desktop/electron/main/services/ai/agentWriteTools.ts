import type {
  AIGatewayToolContext,
  CommandSourceChannel,
  ParsedBankTransaction,
  QuoteItemDurationUnit,
  QuoteItemTaxBehavior,
  QuoteTaxProfile,
  StatementSourceFormat,
} from "@contracts";

import type { createIncidentMutationService } from "../data/incidentMutationService";
import type { createPackingMutationService } from "../data/packingMutationService";
import type { createRmaMutationService } from "../data/rmaMutationService";
import type { createProjectMutationService } from "../data/projectMutationService";
import type { createAssetMutationService } from "../data/assetMutationService";
import type { createFinanceMutationService } from "../data/financeMutationService";
import type { createQuoteMutationService } from "../data/quoteMutationService";
import type { createTreasuryMutationService } from "../data/treasuryMutationService";
import type { createNotificationLocalService } from "../data/notificationLocalService";
import type { CommunicationsSendService } from "../data/communicationsSendService";

type ProjectLookupService = {
  findByCode(workspaceId: string, code: string): { id: string; code: string; name: string; status: string } | null;
  findByIdentifier?(workspaceId: string, identifier: string): { id: string; code: string; name: string; status: string } | null;
};

type NotificationTaskToolsService = Pick<
  ReturnType<typeof createNotificationLocalService>,
  "listTodos" | "listReminders" | "updateTodo" | "updateReminder" | "deleteReminder"
>;

export type AgentWriteServices = {
  packing: ReturnType<typeof createPackingMutationService>;
  projects: ReturnType<typeof createProjectMutationService>;
  incidents: ReturnType<typeof createIncidentMutationService>;
  rma: ReturnType<typeof createRmaMutationService>;
  assets: ReturnType<typeof createAssetMutationService>;
  finance: ReturnType<typeof createFinanceMutationService>;
  quotes: ReturnType<typeof createQuoteMutationService>;
  treasury: ReturnType<typeof createTreasuryMutationService>;
  notifications?: NotificationTaskToolsService;
  communications?: CommunicationsSendService;
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
  /**
   * Workspace permission key the acting user must hold for this write to run.
   * Enforced uniformly in the tool registry (`assertToolPermission`) on the
   * initial call, on the post-approval re-execution, and on Telegram, so role
   * gating can never be bypassed by the channel. Omit for personal-scope
   * actions (todos/reminders) and internal orchestration (delegation).
   */
  requiredPermission?: string;
  execute: (args: Record<string, unknown>, context: AIGatewayToolContext) => WriteToolExecutionResult;
};

const asString = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const asOptionalString = (value: unknown) => {
  const next = asString(value);
  return next || undefined;
};
const asStringArray = (value: unknown) =>
  Array.isArray(value) ? value.map((item) => asString(item)).filter(Boolean) : [];
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

const requireActorUserId = (context: AIGatewayToolContext): string => {
  const userId = context.sourceActorUserId?.trim();
  if (!userId) {
    throw new Error("This personal task action requires an authenticated user. Ask the user to sign in before retrying.");
  }
  return userId;
};

const requireNotifications = (services: AgentWriteServices) => {
  if (!services.notifications) {
    throw new Error("Todos and reminders are not available on this device.");
  }
  return services.notifications;
};

const normalizeNonNegativeInteger = (value: unknown, fallback: number) => {
  const nextValue = asNumber(value);
  if (nextValue === undefined) {
    return fallback;
  }
  return Math.max(0, Math.floor(nextValue));
};

const buildAssetEditorInput = (args: Record<string, unknown>) => ({
  name: asString(args.name),
  internalCode: asString(args.internal_code),
  categoryId: asString(args.category_id),
  brand: asOptionalString(args.brand),
  model: asOptionalString(args.model),
  serialNumber: asOptionalString(args.serial_number),
  description: asOptionalString(args.description),
  defaultLocationId: asOptionalString(args.default_location_id),
  conditionStatus: asOptionalString(args.condition_status) ?? "Good",
  notes: asOptionalString(args.notes),
  purchasePrice: asNumber(args.purchase_price),
  additionalCosts: asNumber(args.additional_costs),
  replacementValue: asNumber(args.replacement_value),
  currentBookValue: asNumber(args.current_book_value),
  ownershipType: asOptionalString(args.ownership_type),
  qrCodeValue: asOptionalString(args.qr_code_value),
  isActive: asBoolean(args.is_active),
  totalQuantity: normalizeNonNegativeInteger(args.total_quantity, 1),
});

const buildAssetSelections = (value: unknown) =>
  Array.isArray(value)
    ? value
        .map((entry) => {
          const item = entry as Record<string, unknown>;
          return {
            assetId: asString(item.asset_id),
            quantity: Math.max(1, Math.floor(asNumber(item.quantity) ?? 1)),
          };
        })
        .filter((entry) => entry.assetId)
    : [];

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
    name: "list_todos",
    description:
      "List the current user's personal todos and reminders in the active workspace. Use this before completing todos or updating/cancelling reminders so ids are grounded.",
    requiresApproval: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: { type: "number", description: "Maximum rows per list. Defaults to 20." },
        include_completed: { type: "boolean", description: "Defaults to false." },
      },
    },
    execute: (args, context) => {
      const workspaceId = requireWorkspaceId(context);
      const userId = requireActorUserId(context);
      const notifications = requireNotifications(services);
      const limit = Math.max(1, Math.min(50, Math.floor(asNumber(args.limit) ?? 20)));
      const includeCompleted = asBoolean(args.include_completed) ?? false;
      const todos = notifications
        .listTodos({ userId, workspaceId, limit })
        .filter((todo) => includeCompleted || !todo.completedAt)
        .map((todo) => ({
          id: todo.id,
          title: todo.title,
          notes: todo.notes,
          dueAt: todo.dueAt,
          priority: todo.priority,
          completedAt: todo.completedAt,
          createdBy: todo.createdBy,
        }));
      const reminders = notifications
        .listReminders({ userId, workspaceId, limit })
        .filter((reminder) => includeCompleted || !reminder.completedAt)
        .map((reminder) => ({
          id: reminder.id,
          title: reminder.title,
          body: reminder.body,
          remindAt: reminder.remindAt,
          recurrenceRule: reminder.recurrenceRule,
          snoozedUntil: reminder.snoozedUntil,
          completedAt: reminder.completedAt,
          createdBy: reminder.createdBy,
        }));

      return {
        summary: `Loaded ${todos.length} todo(s) and ${reminders.length} reminder(s).`,
        payload: { todos, reminders },
      };
    },
  },

  {
    name: "complete_todo",
    description:
      "Mark one of the current user's personal todos as completed. Use list_todos first to resolve the todo id.",
    requiresApproval: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["todo_id"],
      properties: {
        todo_id: { type: "string" },
        completed_at: { type: "string", description: "Optional ISO timestamp. Defaults to now." },
      },
    },
    execute: (args, context) => {
      const workspaceId = requireWorkspaceId(context);
      const userId = requireActorUserId(context);
      const notifications = requireNotifications(services);
      const todoId = asString(args.todo_id);
      if (!todoId) throw new Error("todo_id is required.");
      const completedAt = asOptionalString(args.completed_at) ?? new Date().toISOString();

      notifications.updateTodo({ userId, workspaceId, id: todoId, completedAt });

      return {
        summary: `Todo ${todoId} completed.`,
        payload: { todoId, completedAt },
      };
    },
  },

  {
    name: "update_reminder",
    description:
      "Update one of the current user's personal reminders. Use list_todos first to resolve the reminder id.",
    requiresApproval: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["reminder_id"],
      properties: {
        reminder_id: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
        remind_at: { type: "string", description: "ISO timestamp." },
        recurrence_rule: { type: "string" },
        snoozed_until: { type: "string" },
        completed_at: { type: "string" },
      },
    },
    execute: (args, context) => {
      const workspaceId = requireWorkspaceId(context);
      const userId = requireActorUserId(context);
      const notifications = requireNotifications(services);
      const reminderId = asString(args.reminder_id);
      if (!reminderId) throw new Error("reminder_id is required.");

      notifications.updateReminder({
        userId,
        workspaceId,
        id: reminderId,
        title: asOptionalString(args.title),
        body: Object.prototype.hasOwnProperty.call(args, "body") ? asOptionalString(args.body) ?? null : undefined,
        remindAt: asOptionalString(args.remind_at),
        recurrenceRule: Object.prototype.hasOwnProperty.call(args, "recurrence_rule")
          ? asOptionalString(args.recurrence_rule) ?? null
          : undefined,
        snoozedUntil: Object.prototype.hasOwnProperty.call(args, "snoozed_until")
          ? asOptionalString(args.snoozed_until) ?? null
          : undefined,
        completedAt: Object.prototype.hasOwnProperty.call(args, "completed_at")
          ? asOptionalString(args.completed_at) ?? null
          : undefined,
      });

      return {
        summary: `Reminder ${reminderId} updated.`,
        payload: { reminderId },
      };
    },
  },

  {
    name: "cancel_reminder",
    description:
      "Cancel/delete one of the current user's personal reminders. Use list_todos first to resolve the reminder id.",
    requiresApproval: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["reminder_id"],
      properties: {
        reminder_id: { type: "string" },
      },
    },
    execute: (args, context) => {
      const workspaceId = requireWorkspaceId(context);
      const userId = requireActorUserId(context);
      const notifications = requireNotifications(services);
      const reminderId = asString(args.reminder_id);
      if (!reminderId) throw new Error("reminder_id is required.");

      notifications.deleteReminder({ userId, workspaceId, id: reminderId });

      return {
        summary: `Reminder ${reminderId} cancelled.`,
        payload: { reminderId },
      };
    },
  },

  {
    name: "send_message",
    requiredPermission: "communications.send",
    description:
      "Send an operational message to one or more teammates. Delivers an in-app notification to each recipient and also pushes to their Telegram when they linked it. Use recipient ids from list_recipients/preview_send_targets (e.g. 'user:...', 'crew:...'). External clients/manufacturers cannot be reached this way. Requires human approval before sending.",
    requiresApproval: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["recipient_ids", "body"],
      properties: {
        recipient_ids: {
          type: "array",
          items: { type: "string" },
          description: "Recipient keys such as 'user:<id>' or 'crew:<id>' from the recipient tools.",
        },
        subject: { type: "string", description: "Short subject/headline for the message." },
        body: { type: "string", description: "The full message to deliver." },
      },
    },
    execute: (args, context) => {
      const workspaceId = requireWorkspaceId(context);
      if (!services.communications) {
        throw new Error("Messaging is not available on this device.");
      }
      const recipientIds = asStringArray(args.recipient_ids);
      const body = asString(args.body);
      if (!recipientIds.length) {
        throw new Error("At least one recipient is required.");
      }
      if (!body) {
        throw new Error("The message body is required.");
      }

      const result = services.communications.sendToRecipients({
        workspaceId,
        recipientKeys: recipientIds,
        subject: asString(args.subject),
        body,
      });

      const deliveredLabels = result.delivered.map((entry) => entry.label);
      const summary = result.delivered.length
        ? `Sent to ${deliveredLabels.join(", ")}${result.skipped.length ? ` · ${result.skipped.length} could not be reached` : ""}.`
        : "No recipients could be reached.";

      return {
        summary,
        payload: {
          delivered: result.delivered,
          skipped: result.skipped,
          deliveredCount: result.delivered.length,
          skippedCount: result.skipped.length,
        },
      };
    },
  },

  {
    name: "create_asset",
    requiredPermission: "assets.manage",
    description:
      "Create a new asset/equipment record in inventory. Requires approval. Use only after resolving category/location ids and collecting the required profile fields.",
    requiresApproval: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["name", "internal_code", "category_id"],
      properties: {
        name: { type: "string" },
        internal_code: { type: "string", description: "Unique internal asset code, e.g. CAM-ALEXA-01." },
        category_id: { type: "string", description: "Existing asset category id." },
        brand: { type: "string" },
        model: { type: "string" },
        serial_number: { type: "string" },
        description: { type: "string" },
        default_location_id: { type: "string" },
        condition_status: { type: "string", description: "Defaults to Good." },
        notes: { type: "string" },
        purchase_price: { type: "number" },
        additional_costs: { type: "number" },
        replacement_value: { type: "number" },
        current_book_value: { type: "number" },
        ownership_type: { type: "string" },
        qr_code_value: { type: "string" },
        is_active: { type: "boolean" },
        total_quantity: { type: "number", description: "Defaults to 1." },
      },
    },
    execute: (args, context) => {
      const workspaceId = requireWorkspaceId(context);
      const input = buildAssetEditorInput(args);
      if (!input.name) throw new Error("Asset name is required.");
      if (!input.internalCode) throw new Error("Asset internal_code is required.");
      if (!input.categoryId) throw new Error("Asset category_id is required.");

      const result = services.assets.createAsset({
        commandId: newCommandId("agent-asset-create"),
        workspaceId,
        ...input,
        actorType: "agent",
        sourceChannel: resolveSourceChannel(context),
      });

      return {
        summary: result.summary,
        payload: { assetId: result.assetId, repeated: result.repeated },
      };
    },
  },

  {
    name: "update_asset",
    requiredPermission: "assets.manage",
    description:
      "Update an existing asset profile. Requires approval. Use get_asset_detail first and pass unchanged required fields such as name, internal_code and category_id.",
    requiresApproval: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["asset_id", "name", "internal_code", "category_id"],
      properties: {
        asset_id: { type: "string" },
        name: { type: "string" },
        internal_code: { type: "string" },
        category_id: { type: "string" },
        brand: { type: "string" },
        model: { type: "string" },
        serial_number: { type: "string" },
        description: { type: "string" },
        default_location_id: { type: "string" },
        condition_status: { type: "string", description: "Defaults to Good if omitted." },
        notes: { type: "string" },
        purchase_price: { type: "number" },
        additional_costs: { type: "number" },
        replacement_value: { type: "number" },
        current_book_value: { type: "number" },
        ownership_type: { type: "string" },
        qr_code_value: { type: "string" },
        is_active: { type: "boolean" },
        total_quantity: { type: "number" },
      },
    },
    execute: (args, context) => {
      const workspaceId = requireWorkspaceId(context);
      const assetId = asString(args.asset_id);
      const input = buildAssetEditorInput(args);
      if (!assetId) throw new Error("asset_id is required.");
      if (!input.name) throw new Error("Asset name is required.");
      if (!input.internalCode) throw new Error("Asset internal_code is required.");
      if (!input.categoryId) throw new Error("Asset category_id is required.");

      const result = services.assets.updateAsset({
        commandId: newCommandId("agent-asset-update"),
        workspaceId,
        assetId,
        ...input,
        actorType: "agent",
        sourceChannel: resolveSourceChannel(context),
      });

      return {
        summary: result.summary,
        payload: { assetId: result.assetId, repeated: result.repeated },
      };
    },
  },

  {
    name: "archive_asset",
    requiredPermission: "assets.manage",
    description:
      "Archive an asset from the live registry. Requires approval. The asset must not be assigned, checked out, in a kit flow, or have open incidents.",
    requiresApproval: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["asset_id"],
      properties: {
        asset_id: { type: "string" },
      },
    },
    execute: (args, context) => {
      const workspaceId = requireWorkspaceId(context);
      const assetId = asString(args.asset_id);
      if (!assetId) throw new Error("asset_id is required.");

      const result = services.assets.archiveAsset({
        commandId: newCommandId("agent-asset-archive"),
        workspaceId,
        assetId,
        actorType: "agent",
        sourceChannel: resolveSourceChannel(context),
      });

      return {
        summary: result.summary,
        payload: { assetId: result.assetId, repeated: result.repeated },
      };
    },
  },

  {
    name: "assign_move_assets",
    requiredPermission: "assets.manage",
    description:
      "Assign assets to a project/unit/department/user or move assets to another location. Requires approval. Use search_assets/get_asset_detail first to resolve ids and available quantities.",
    requiresApproval: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["asset_ids", "mode"],
      properties: {
        asset_ids: { type: "array", items: { type: "string" } },
        asset_selections: {
          type: "array",
          description: "Optional per-asset quantities; defaults to one per asset when omitted.",
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
        mode: { type: "string", enum: ["assign", "move"] },
        project_id: { type: "string" },
        project_unit_id: { type: "string" },
        department_id: { type: "string" },
        assigned_to_user_id: { type: "string" },
        target_location_id: { type: "string" },
        expected_return_at: { type: "string" },
        notes: { type: "string" },
      },
    },
    execute: (args, context) => {
      const workspaceId = requireWorkspaceId(context);
      const assetIds = asStringArray(args.asset_ids);
      const mode = asString(args.mode);
      if (!assetIds.length) throw new Error("At least one asset_id is required.");
      if (mode !== "assign" && mode !== "move") throw new Error("mode must be assign or move.");

      const result = services.assets.assignMoveAssets({
        commandId: newCommandId("agent-assets-assign-move"),
        workspaceId,
        assetIds,
        assetSelections: buildAssetSelections(args.asset_selections),
        mode,
        projectId: resolveOptionalProjectId(services, workspaceId, args.project_id) ?? undefined,
        projectUnitId: asOptionalString(args.project_unit_id),
        departmentId: asOptionalString(args.department_id),
        assignedToUserId: asOptionalString(args.assigned_to_user_id),
        targetLocationId: asOptionalString(args.target_location_id),
        expectedReturnAt: asOptionalString(args.expected_return_at),
        notes: asOptionalString(args.notes),
        actorType: "agent",
        sourceChannel: resolveSourceChannel(context),
      });

      return {
        summary: result.warningSummary ? `${result.summary} ${result.warningSummary}` : result.summary,
        payload: {
          eventType: result.eventType,
          processedAssetIds: result.processedAssetIds,
          repeated: result.repeated,
          conflictCount: result.conflictCount,
          warnings: result.warnings ?? [],
        },
      };
    },
  },

  {
    name: "create_incident",
    requiredPermission: "incidents.create",
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
    requiredPermission: "incidents.create",
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
    requiredPermission: "rma.create",
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
    requiredPermission: "packing-slips.create",
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
    requiredPermission: "packing-slips.create",
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
    requiredPermission: "projects.manage",
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
    requiredPermission: "projects.manage",
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
    requiredPermission: "projects.manage",
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
    name: "update_project_unit",
    requiredPermission: "projects.manage",
    description:
      "Update an existing project unit's label, dates, order, notes or status action. Requires approval. Use get_project_units first and pass unchanged required fields.",
    requiresApproval: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["project_id", "unit_id", "code", "name", "sort_order"],
      properties: {
        project_id: { type: "string" },
        unit_id: { type: "string" },
        code: { type: "string" },
        name: { type: "string" },
        sort_order: { type: "number" },
        color_key: { type: "string" },
        start_date: { type: "string", description: "YYYY-MM-DD." },
        end_date: { type: "string", description: "YYYY-MM-DD." },
        notes: { type: "string" },
        status_action: { type: "string", enum: ["none", "mark_wrapped", "cancel", "reactivate"] },
        cascade_crew_dates: { type: "boolean" },
      },
    },
    execute: (args, context) => {
      const workspaceId = requireWorkspaceId(context);
      const projectId = resolveRequiredProjectId(services, workspaceId, args.project_id);
      const unitId = asString(args.unit_id);
      const code = asString(args.code).toUpperCase();
      const name = asString(args.name);
      const sortOrder = asNumber(args.sort_order);
      const statusAction = asString(args.status_action);
      if (!unitId) throw new Error("unit_id is required.");
      if (!code) throw new Error("Unit code is required.");
      if (!name) throw new Error("Unit name is required.");
      if (sortOrder === undefined) throw new Error("sort_order is required.");

      services.projects.updateProjectUnit({
        projectId,
        unitId,
        code,
        name,
        sortOrder,
        colorKey: asOptionalString(args.color_key),
        startDate: asOptionalString(args.start_date),
        endDate: asOptionalString(args.end_date),
        notes: asOptionalString(args.notes),
        statusAction:
          statusAction === "mark_wrapped" || statusAction === "cancel" || statusAction === "reactivate"
            ? statusAction
            : "none",
        cascadeCrewDates: asBoolean(args.cascade_crew_dates),
      });

      return {
        summary: `Unit ${code} · ${name} updated.`,
        payload: { projectId, unitId, code, name },
      };
    },
  },

  {
    name: "delete_project_unit",
    requiredPermission: "projects.manage",
    description:
      "Delete an unused project unit. Requires approval. The main/base unit and units with linked operational records cannot be deleted.",
    requiresApproval: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["project_id", "unit_id"],
      properties: {
        project_id: { type: "string" },
        unit_id: { type: "string" },
      },
    },
    execute: (args, context) => {
      const workspaceId = requireWorkspaceId(context);
      const projectId = resolveRequiredProjectId(services, workspaceId, args.project_id);
      const unitId = asString(args.unit_id);
      if (!unitId) throw new Error("unit_id is required.");

      services.projects.deleteProjectUnit({ projectId, unitId });

      return {
        summary: `Unit ${unitId} deleted.`,
        payload: { projectId, unitId },
      };
    },
  },

  {
    name: "create_quote",
    requiredPermission: "finance.manage",
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
    requiredPermission: "finance.manage",
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
  {
    name: "classify_movement",
    requiredPermission: "treasury.transactions.classify",
    description:
      "Classify a bank movement: set its kind (income, expense, transfer, fx_exchange, salary, reimbursement, tax, tss, bank_fee, interest, owner_draw, other), concept, counterparty, RNC and expense category. Applies immediately and is reversible with Undo (Cmd+Z). Use list_bank_movements first to get the movement id.",
    requiresApproval: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["transaction_id"],
      properties: {
        transaction_id: { type: "string" },
        kind: {
          type: "string",
          enum: ["income", "expense", "transfer", "fx_exchange", "salary", "reimbursement", "tax", "tss", "bank_fee", "interest", "owner_draw", "other"],
        },
        concept: { type: "string" },
        counterparty: { type: "string" },
        counterparty_rnc: { type: "string" },
        expense_category: { type: "string" },
        is_internal_transfer: { type: "boolean" },
        notes: { type: "string" },
      },
    },
    execute: (args, context) => {
      const workspaceId = requireWorkspaceId(context);
      const transactionId = asString(args.transaction_id);
      if (!transactionId) throw new Error("transaction_id is required.");
      const result = services.treasury.annotateTransaction({
        commandId: newCommandId("agent-classify"),
        workspaceId,
        actorType: "agent",
        sourceChannel: resolveSourceChannel(context),
        transactionId,
        txnKind: (asOptionalString(args.kind) ?? null) as never,
        concept: asOptionalString(args.concept) ?? null,
        counterparty: asOptionalString(args.counterparty) ?? null,
        counterpartyRnc: asOptionalString(args.counterparty_rnc) ?? null,
        expenseCategory: asOptionalString(args.expense_category) ?? null,
        isInternalTransfer: asBoolean(args.is_internal_transfer) ?? false,
        notes: asOptionalString(args.notes) ?? null,
      });
      return { summary: result.summary, payload: { transactionId, repeated: result.repeated } };
    },
  },
  {
    name: "categorize_movements_by_rule",
    requiredPermission: "treasury.transactions.classify",
    description:
      "Classify ALL unclassified movements that share the selected movement's description, and remember the rule for future imports. Requires approval because it affects many rows at once and persists a recurring rule. Reversible with Undo. Use for recurring movements like TSS, DGII taxes or bank fees.",
    requiresApproval: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["transaction_id", "kind"],
      properties: {
        transaction_id: { type: "string", description: "A representative movement whose description defines the rule." },
        kind: {
          type: "string",
          enum: ["income", "expense", "transfer", "fx_exchange", "salary", "reimbursement", "tax", "tss", "bank_fee", "interest", "owner_draw", "other"],
        },
        expense_category: { type: "string" },
        counterparty: { type: "string" },
        match_type: { type: "string", enum: ["exact", "contains"], description: "Defaults to exact." },
      },
    },
    execute: (args, context) => {
      const workspaceId = requireWorkspaceId(context);
      const transactionId = asString(args.transaction_id);
      if (!transactionId) throw new Error("transaction_id is required.");
      const result = services.treasury.applyCounterpartyRule({
        commandId: newCommandId("agent-rule"),
        workspaceId,
        actorType: "agent",
        sourceChannel: resolveSourceChannel(context),
        transactionId,
        txnKind: (asOptionalString(args.kind) ?? null) as never,
        expenseCategory: asOptionalString(args.expense_category) ?? null,
        counterparty: asOptionalString(args.counterparty) ?? null,
        matchType: asString(args.match_type) === "contains" ? "contains" : "exact",
      });
      return {
        summary: result.summary,
        payload: { ruleId: result.ruleId, affectedCount: result.affectedCount, matchPattern: result.matchPattern },
      };
    },
  },
  {
    name: "set_project_allocations",
    requiredPermission: "treasury.transactions.classify",
    description:
      "Split a movement's amount across one or more projects for per-project P&L. Replaces existing allocations. Applies immediately and is reversible with Undo. The allocation total cannot exceed the movement amount.",
    requiresApproval: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["transaction_id", "allocations"],
      properties: {
        transaction_id: { type: "string" },
        allocations: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["amount"],
            properties: {
              project_id: { type: "string" },
              project_name: { type: "string" },
              amount: { type: "number" },
              percent: { type: "number" },
              notes: { type: "string" },
            },
          },
        },
      },
    },
    execute: (args, context) => {
      const workspaceId = requireWorkspaceId(context);
      const transactionId = asString(args.transaction_id);
      if (!transactionId) throw new Error("transaction_id is required.");
      const rawAllocations = Array.isArray(args.allocations) ? args.allocations : [];
      const allocations = rawAllocations.map((entry) => {
        const allocation = entry as Record<string, unknown>;
        return {
          projectId: resolveOptionalProjectId(services, workspaceId, allocation.project_id),
          projectNameSnapshot: asOptionalString(allocation.project_name) ?? null,
          amount: asNumber(allocation.amount) ?? 0,
          percent: asNumber(allocation.percent) ?? null,
          notes: asOptionalString(allocation.notes) ?? null,
        };
      });
      const result = services.treasury.setAllocations({
        commandId: newCommandId("agent-alloc"),
        workspaceId,
        actorType: "agent",
        sourceChannel: resolveSourceChannel(context),
        transactionId,
        allocations,
      });
      return { summary: result.summary, payload: { transactionId, count: allocations.length } };
    },
  },
  {
    name: "create_bank_account",
    requiredPermission: "treasury.accounts.manage",
    description:
      "Create a treasury bank account so statements can be imported into it. Requires approval. Use list_bank_accounts first to avoid duplicates.",
    requiresApproval: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["account_label", "currency"],
      properties: {
        bank_name: { type: "string", enum: ["popular", "santa_cruz", "custom"], description: "Defaults to custom." },
        account_label: { type: "string" },
        account_number: { type: "string" },
        currency: { type: "string", description: "DOP, USD or EUR." },
        opening_balance: { type: "number" },
        notes: { type: "string" },
      },
    },
    execute: (args, context) => {
      const workspaceId = requireWorkspaceId(context);
      const accountLabel = asString(args.account_label);
      if (!accountLabel) throw new Error("account_label is required.");
      const bankName = (asString(args.bank_name) || "custom") as never;
      const result = services.treasury.upsertBankAccount({
        commandId: newCommandId("agent-account"),
        workspaceId,
        actorType: "agent",
        sourceChannel: resolveSourceChannel(context),
        bankName,
        accountLabel,
        accountNumberFull: asOptionalString(args.account_number) ?? null,
        currency: (asOptionalString(args.currency) ?? "DOP").toUpperCase(),
        openingBalance: asNumber(args.opening_balance) ?? 0,
        notes: asOptionalString(args.notes) ?? null,
      });
      return { summary: result.summary, payload: { bankAccountId: result.bankAccountId } };
    },
  },
  {
    name: "review_deductible",
    requiredPermission: "treasury.reimbursements.review",
    description:
      "Accountant review: set the DGII-deductible amount and fiscal data (NCF, withholding) for an expense. Requires approval. deductible_amount cannot exceed the claimed amount.",
    requiresApproval: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["transaction_id", "deductible_amount"],
      properties: {
        transaction_id: { type: "string" },
        deductible_amount: { type: "number" },
        supplier_ncf: { type: "string" },
        dgii_expense_type: { type: "string" },
        withholding_type: { type: "string" },
        withholding_rate: { type: "number" },
        withholding_amount: { type: "number" },
        fiscal_period: { type: "string", description: "YYYY-MM" },
        notes: { type: "string" },
      },
    },
    execute: (args, context) => {
      const workspaceId = requireWorkspaceId(context);
      const transactionId = asString(args.transaction_id);
      if (!transactionId) throw new Error("transaction_id is required.");
      const deductibleAmount = asNumber(args.deductible_amount) ?? 0;
      const result = services.treasury.reviewReimbursement({
        commandId: newCommandId("agent-review"),
        workspaceId,
        actorType: "agent",
        sourceChannel: resolveSourceChannel(context),
        transactionId,
        reimbursementStatus: deductibleAmount > 0 ? "accepted" : "rejected",
        deductibleAmount,
        supplierNcf: asOptionalString(args.supplier_ncf) ?? null,
        dgiiExpenseType: asOptionalString(args.dgii_expense_type) ?? null,
        withholdingType: asOptionalString(args.withholding_type) ?? null,
        withholdingRate: asNumber(args.withholding_rate) ?? null,
        withholdingAmount: asNumber(args.withholding_amount) ?? null,
        fiscalPeriod: asOptionalString(args.fiscal_period) ?? null,
        fiscalStatus: deductibleAmount > 0 ? "accepted" : "rejected",
        notes: asOptionalString(args.notes) ?? null,
      });
      return { summary: result.summary, payload: { transactionId, deductibleAmount } };
    },
  },
  {
    name: "correct_movement",
    requiredPermission: "treasury.transactions.classify",
    description:
      "Correct an imported bank movement's raw fields (date, description, amount, direction, reference). Requires approval. Reversible with Undo.",
    requiresApproval: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["transaction_id"],
      properties: {
        transaction_id: { type: "string" },
        txn_date: { type: "string", description: "YYYY-MM-DD" },
        raw_description: { type: "string" },
        reference: { type: "string" },
        amount: { type: "number" },
        direction: { type: "string", enum: ["debit", "credit"] },
        notes: { type: "string" },
      },
    },
    execute: (args, context) => {
      const workspaceId = requireWorkspaceId(context);
      const transactionId = asString(args.transaction_id);
      if (!transactionId) throw new Error("transaction_id is required.");
      const direction = asString(args.direction);
      const result = services.treasury.correctTransaction({
        commandId: newCommandId("agent-correct"),
        workspaceId,
        actorType: "agent",
        sourceChannel: resolveSourceChannel(context),
        transactionId,
        txnDate: asOptionalString(args.txn_date),
        rawDescription: asOptionalString(args.raw_description) ?? null,
        reference: asOptionalString(args.reference) ?? null,
        amount: asNumber(args.amount),
        direction: direction === "debit" || direction === "credit" ? direction : undefined,
        notes: asOptionalString(args.notes) ?? null,
      });
      return { summary: result.summary, payload: { transactionId, repeated: result.repeated } };
    },
  },
  {
    name: "import_bank_statement",
    requiredPermission: "treasury.import",
    description:
      "Import bank statement movements into a treasury account. First read the attached statement with read_attached_document, map each line to a normalized row, then call this tool. Requires approval. Duplicates are detected automatically (re-importing the same movements is safe). The import is reversible via Undo / delete import.",
    requiresApproval: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["bank_account_id", "rows"],
      properties: {
        bank_account_id: { type: "string", description: "Target account id (use list_bank_accounts to resolve)." },
        source_format: {
          type: "string",
          enum: ["csv", "xlsx", "pdf", "manual"],
          description: "Format of the source document the rows came from. Defaults to manual.",
        },
        original_filename: { type: "string", description: "Source file name, for traceability." },
        period_start: { type: "string", description: "Statement period start, YYYY-MM-DD." },
        period_end: { type: "string", description: "Statement period end, YYYY-MM-DD." },
        notes: { type: "string" },
        rows: {
          type: "array",
          minItems: 1,
          description: "Normalized statement movements, one per transaction line.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["txn_date", "amount", "direction"],
            properties: {
              txn_date: { type: "string", description: "Posting date, YYYY-MM-DD." },
              value_date: { type: "string", description: "Value date, YYYY-MM-DD." },
              description: { type: "string", description: "Raw description / concept as it appears on the statement." },
              reference: { type: "string" },
              serial: { type: "string" },
              amount: { type: "number", description: "Positive movement amount (sign comes from direction)." },
              direction: { type: "string", enum: ["debit", "credit"], description: "debit = money out, credit = money in." },
              running_balance: { type: "number", description: "Account balance after this movement, if shown." },
            },
          },
        },
      },
    },
    execute: (args, context) => {
      const workspaceId = requireWorkspaceId(context);
      const bankAccountId = asString(args.bank_account_id);
      if (!bankAccountId) throw new Error("bank_account_id is required.");

      const rawRows = Array.isArray(args.rows) ? args.rows : [];
      if (!rawRows.length) throw new Error("At least one statement row is required.");

      const isoDate = /^\d{4}-\d{2}-\d{2}$/;
      const rows: ParsedBankTransaction[] = rawRows.map((entry, index) => {
        const row = (entry ?? {}) as Record<string, unknown>;
        const txnDate = asString(row.txn_date);
        if (!isoDate.test(txnDate)) {
          throw new Error(`Row ${index + 1}: txn_date must be YYYY-MM-DD (got "${txnDate || "empty"}").`);
        }
        const amount = asNumber(row.amount);
        if (amount === undefined) {
          throw new Error(`Row ${index + 1}: amount must be a finite number.`);
        }
        const direction = asString(row.direction);
        if (direction !== "debit" && direction !== "credit") {
          throw new Error(`Row ${index + 1}: direction must be "debit" or "credit".`);
        }
        const valueDate = asOptionalString(row.value_date);
        if (valueDate && !isoDate.test(valueDate)) {
          throw new Error(`Row ${index + 1}: value_date must be YYYY-MM-DD when provided.`);
        }
        return {
          txnDate,
          valueDate: valueDate ?? null,
          rawDescription: asOptionalString(row.description) ?? null,
          reference: asOptionalString(row.reference) ?? null,
          serial: asOptionalString(row.serial) ?? null,
          amount: Math.abs(amount),
          direction,
          runningBalance: asNumber(row.running_balance) ?? null,
        };
      });

      const sourceFormat = asString(args.source_format);
      const normalizedFormat: StatementSourceFormat =
        sourceFormat === "csv" || sourceFormat === "xlsx" || sourceFormat === "pdf" ? sourceFormat : "manual";

      const result = services.treasury.importStatement({
        commandId: newCommandId("agent-import"),
        workspaceId,
        actorType: "agent",
        sourceChannel: resolveSourceChannel(context),
        bankAccountId,
        sourceFormat: normalizedFormat,
        originalFilename: asOptionalString(args.original_filename) ?? null,
        periodStart: asOptionalString(args.period_start) ?? null,
        periodEnd: asOptionalString(args.period_end) ?? null,
        rows,
        notes: asOptionalString(args.notes) ?? null,
      });

      return {
        summary: result.summary,
        payload: {
          importId: result.importId,
          bankAccountId: result.bankAccountId,
          rowCount: result.rowCount,
          insertedCount: result.insertedCount,
          duplicateCount: result.duplicateCount,
          repeated: result.repeated,
        },
      };
    },
  },
];
