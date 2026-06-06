import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);
const optionalTrimmedString = z.string().trim().optional();
const optionalNullableString = z.string().trim().nullable().optional();
const commandActorTypeSchema = z.enum(["user", "agent", "integration"]);
const commandSourceChannelSchema = z.enum(["desktop", "mobile", "api", "whatsapp", "telegram"]);
const agentStatusSchema = z.enum(["active", "paused"]);
const agentApprovalModeSchema = z.enum(["auto", "supervised", "needs_approval"]);
const assistantApprovalPreferenceSchema = z.enum(["supervised", "needs_approval", "unsupervised"]);
const rmaStatusSchema = z.enum([
  "Needs review",
  "Sent to repair",
  "Waiting parts",
  "Repaired",
  "No repair / retired",
  "Returned to inventory",
]);
const financeEntrySchema = z
  .object({
    entryType: nonEmptyString,
    category: nonEmptyString,
    amount: z.number().finite().nonnegative(),
    currency: optionalTrimmedString,
    exchangeRate: z.number().finite().positive().nullable().optional(),
    baseCurrencyAmount: z.number().finite().nonnegative().nullable().optional(),
    status: nonEmptyString,
    projectId: optionalNullableString,
    assetId: optionalNullableString,
    incidentId: optionalNullableString,
    entryDate: nonEmptyString,
    description: optionalNullableString,
    notes: optionalNullableString,
  })
  .strict();
const collaboratorFeeSchema = z
  .object({
    crewMemberId: nonEmptyString,
    projectId: optionalNullableString,
    projectUnitId: optionalNullableString,
    departmentId: optionalNullableString,
    sourceAssignmentId: optionalNullableString,
    feeType: nonEmptyString,
    description: optionalNullableString,
    agreedAmount: z.number().finite().positive(),
    currency: nonEmptyString,
    exchangeRate: z.number().finite().positive().nullable().optional(),
    baseCurrencyAmount: z.number().finite().nonnegative().nullable().optional(),
    expectedPaymentDate: optionalNullableString,
    notes: optionalNullableString,
  })
  .strict();

export const createAgentSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    agentId: nonEmptyString,
    displayName: nonEmptyString,
    emoji: optionalTrimmedString,
    modelKey: nonEmptyString,
    role: nonEmptyString,
    mission: nonEmptyString,
    domain: nonEmptyString,
    allowedTools: z.array(nonEmptyString),
    allowedDomains: z.array(nonEmptyString),
    status: agentStatusSchema,
    approvalMode: agentApprovalModeSchema,
    notes: optionalTrimmedString,
  })
  .strict();

export const updateAgentSchema = createAgentSchema.extend({
  id: nonEmptyString,
});

export const setAgentStatusSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    id: nonEmptyString,
    status: agentStatusSchema,
  })
  .strict();

export const setAgentApprovalModeSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    id: nonEmptyString,
    approvalMode: agentApprovalModeSchema,
  })
  .strict();

export const saveAiProviderConfigSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    providerKey: nonEmptyString,
    enabled: z.boolean(),
    apiKey: optionalTrimmedString,
    clearStoredKey: z.boolean().optional(),
    baseUrl: optionalTrimmedString,
    defaultModelKey: nonEmptyString,
    fallbackModelKey: optionalTrimmedString,
    timeoutMs: z.number().int().nonnegative(),
    retryCount: z.number().int().nonnegative(),
  })
  .strict();

export const testAiProviderConnectionSchema = z
  .object({
    workspaceId: nonEmptyString,
    providerKey: nonEmptyString,
  })
  .strict();

export const refreshAiProviderModelsSchema = z
  .object({
    workspaceId: nonEmptyString,
    providerKey: nonEmptyString,
  })
  .strict();

export const saveConnectorConfigSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    connectorKey: nonEmptyString,
    enabled: z.boolean(),
    botToken: optionalTrimmedString,
    clearStoredSecret: z.boolean().optional(),
  })
  .strict();

export const testConnectorConnectionSchema = z
  .object({
    workspaceId: nonEmptyString,
    connectorKey: nonEmptyString,
  })
  .strict();

export const createConnectorLinkTokenSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    connectorKey: nonEmptyString,
    userId: nonEmptyString,
    expiresInMinutes: z.number().int().positive().max(24 * 60).optional(),
  })
  .strict();

export const createAppUserSchema = z
  .object({
    workspaceId: nonEmptyString,
    fullName: nonEmptyString,
    email: optionalTrimmedString,
    phone: optionalTrimmedString,
    roleId: nonEmptyString,
    linkedCrewMemberId: optionalTrimmedString,
  })
  .strict();

export const updateAppUserSchema = z
  .object({
    workspaceId: nonEmptyString,
    userId: nonEmptyString,
    fullName: nonEmptyString,
    email: optionalTrimmedString,
    phone: optionalTrimmedString,
    roleId: nonEmptyString,
    linkedCrewMemberId: optionalTrimmedString,
  })
  .strict();

export const setAppUserActiveSchema = z
  .object({
    workspaceId: nonEmptyString,
    userId: nonEmptyString,
    isActive: z.boolean(),
  })
  .strict();

export const revokeTelegramLinkSchema = z
  .object({
    workspaceId: nonEmptyString,
    userId: nonEmptyString,
  })
  .strict();

export const deleteAppUserSchema = z
  .object({
    workspaceId: nonEmptyString,
    userId: nonEmptyString,
  })
  .strict();

export const assignAgentModelSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    agentId: nonEmptyString,
    providerKey: nonEmptyString,
    modelKey: nonEmptyString,
    modelLabel: nonEmptyString,
  })
  .strict();

export const createAssistantThreadSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    contextKey: nonEmptyString,
    contextLabel: nonEmptyString,
  })
  .strict();

export const deleteAssistantThreadSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    threadId: nonEmptyString,
  })
  .strict();

export const setActiveAssistantThreadSchema = deleteAssistantThreadSchema;

export const updateAssistantThreadPreferencesSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    threadId: nonEmptyString,
    preferredApprovalMode: assistantApprovalPreferenceSchema,
  })
  .strict();

export const renameAssistantThreadSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    threadId: nonEmptyString,
    title: z.string().trim().min(1).max(120),
  })
  .strict();

export const assistantGatewayAttachmentSchema = z
  .object({
    id: nonEmptyString,
    kind: z.literal("image"),
    name: nonEmptyString,
    mimeType: nonEmptyString,
    dataUrl: nonEmptyString,
  })
  .strict();

export const transcribeAssistantAudioSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    fileName: nonEmptyString,
    mimeType: nonEmptyString,
    dataUrl: nonEmptyString,
    source: z.enum(["desktop", "telegram"]),
  })
  .strict();

export const assistantGatewayToolContextSchema = z
  .object({
    workspaceId: nonEmptyString,
    activePath: optionalTrimmedString,
    activeProjectId: optionalNullableString,
    currentView: optionalNullableString,
    activeFilters: z.record(z.string(), z.string()).optional(),
    requestedApprovalMode: assistantApprovalPreferenceSchema.optional(),
    sourceConnectorKey: optionalNullableString,
    sourceChannelId: optionalNullableString,
    sourceExternalMessageId: optionalNullableString,
    sourceActorUserId: optionalNullableString,
    userPermissions: z.array(nonEmptyString).optional(),
    correlationId: optionalNullableString,
  })
  .strict();

export const assistantChatMessageSourceSchema = z
  .object({
    connectorKey: nonEmptyString,
    connectorLabel: optionalTrimmedString,
    channelLabel: optionalTrimmedString,
    actorUserId: optionalNullableString,
    actorName: nonEmptyString,
    actorRole: optionalNullableString,
    permissionSummary: nonEmptyString,
    externalMessageId: optionalNullableString,
    correlationId: optionalNullableString,
    isLinkedIdentity: z.boolean(),
  })
  .strict();

export const sendAssistantChatTurnSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    threadId: nonEmptyString,
    message: nonEmptyString,
    attachments: z.array(assistantGatewayAttachmentSchema).optional(),
    context: assistantGatewayToolContextSchema,
    source: assistantChatMessageSourceSchema.optional(),
  })
  .strict();

export const reviewAgentRunSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    runId: nonEmptyString,
    decision: z.enum(["approve", "deny", "approve_for_session"]),
  })
  .strict();

export const createDraftRunFromChatSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    message: nonEmptyString,
    routeHint: optionalTrimmedString,
    activePath: optionalTrimmedString,
  })
  .strict();

export const recordRuntimeErrorSchema = z
  .object({
    sourceKind: z.enum(["main", "renderer", "webcontents"]),
    processLabel: nonEmptyString,
    errorName: nonEmptyString,
    message: nonEmptyString,
    stack: z.string().nullable().optional(),
    severity: z.enum(["low", "medium", "critical"]).optional(),
    context: z.record(z.string(), z.unknown()).nullable().optional(),
    threadId: z.string().nullable().optional(),
  })
  .strict();

const assetEditorSchema = z
  .object({
    name: nonEmptyString,
    internalCode: nonEmptyString,
    categoryId: nonEmptyString,
    brand: optionalTrimmedString,
    model: optionalTrimmedString,
    serialNumber: optionalTrimmedString,
    description: optionalTrimmedString,
    defaultLocationId: optionalTrimmedString,
    conditionStatus: nonEmptyString,
    notes: optionalTrimmedString,
    purchasePrice: z.number().finite().nonnegative().optional(),
    additionalCosts: z.number().finite().nonnegative().optional(),
    replacementValue: z.number().finite().nonnegative().optional(),
    currentBookValue: z.number().finite().nonnegative().optional(),
    ownershipType: optionalTrimmedString,
    qrCodeValue: optionalTrimmedString,
    isActive: z.boolean().optional(),
    totalQuantity: z.number().int().nonnegative().optional(),
  })
  .strict();

export const createAssetSchema = assetEditorSchema.extend({
  commandId: nonEmptyString,
  workspaceId: nonEmptyString,
  actorType: commandActorTypeSchema,
  sourceChannel: commandSourceChannelSchema,
});

export const updateAssetSchema = createAssetSchema.extend({
  assetId: nonEmptyString,
});

export const archiveAssetSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    assetId: nonEmptyString,
    actorType: commandActorTypeSchema,
    sourceChannel: commandSourceChannelSchema,
  })
  .strict();

export const assignMoveAssetsSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    assetIds: z.array(nonEmptyString).min(1),
    assetSelections: z
      .array(
        z
          .object({
            assetId: nonEmptyString,
            quantity: z.number().int().positive(),
          })
          .strict(),
      )
      .optional(),
    sourceKitId: optionalTrimmedString,
    mode: z.enum(["assign", "move"]),
    projectId: optionalTrimmedString,
    projectUnitId: optionalTrimmedString,
    departmentId: optionalTrimmedString,
    assignedToUserId: optionalTrimmedString,
    targetLocationId: optionalTrimmedString,
    expectedReturnAt: optionalTrimmedString,
    notes: optionalTrimmedString,
    actorType: commandActorTypeSchema,
    sourceChannel: commandSourceChannelSchema,
  })
  .strict();

export const reportIncidentSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    actorUserId: optionalTrimmedString,
    assetId: optionalTrimmedString,
    assignmentId: optionalTrimmedString,
    projectId: optionalTrimmedString,
    projectUnitId: optionalTrimmedString,
    departmentId: optionalTrimmedString,
    responsibleUserId: optionalTrimmedString,
    incidentType: nonEmptyString,
    severity: nonEmptyString,
    title: nonEmptyString,
    description: nonEmptyString,
    costEstimate: z.number().finite().nonnegative().optional(),
    currency: optionalTrimmedString,
    financialStatus: optionalTrimmedString,
    notes: optionalTrimmedString,
    actorType: commandActorTypeSchema,
    sourceChannel: commandSourceChannelSchema,
  })
  .strict();

export const updateIncidentSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    actorUserId: optionalTrimmedString,
    incidentId: nonEmptyString,
    title: optionalTrimmedString,
    description: optionalTrimmedString,
    severity: optionalTrimmedString,
    status: optionalTrimmedString,
    responsibleUserId: optionalNullableString,
    costEstimate: z.number().finite().nonnegative().nullable().optional(),
    financialStatus: optionalNullableString,
    notes: optionalNullableString,
    actorType: commandActorTypeSchema,
    sourceChannel: commandSourceChannelSchema,
  })
  .strict();

export const resolveIncidentSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    actorUserId: optionalTrimmedString,
    incidentId: nonEmptyString,
    resolutionNotes: optionalTrimmedString,
    costEstimate: z.number().finite().nonnegative().optional(),
    financialStatus: optionalTrimmedString,
    resolvedByUserId: optionalTrimmedString,
    retireAsset: z.boolean().optional(),
    actorType: commandActorTypeSchema,
    sourceChannel: commandSourceChannelSchema,
  })
  .strict();

export const createFinancialEntrySchema = financeEntrySchema.extend({
  commandId: nonEmptyString,
  workspaceId: nonEmptyString,
  actorType: commandActorTypeSchema,
  sourceChannel: commandSourceChannelSchema,
});

export const updateFinancialEntrySchema = createFinancialEntrySchema.extend({
  entryId: nonEmptyString,
});

export const createCollaboratorFeeSchema = collaboratorFeeSchema
  .extend({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    actorType: commandActorTypeSchema,
    sourceChannel: commandSourceChannelSchema,
  })
  .strict();

export const updateCollaboratorFeeSchema = createCollaboratorFeeSchema.extend({
  feeId: nonEmptyString,
});

export const approveCollaboratorFeeSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    feeId: nonEmptyString,
    actorType: commandActorTypeSchema,
    sourceChannel: commandSourceChannelSchema,
  })
  .strict();

export const cancelCollaboratorFeeSchema = approveCollaboratorFeeSchema.extend({
  reason: optionalNullableString,
});

export const recordCollaboratorPaymentSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    crewMemberId: nonEmptyString,
    paidAt: nonEmptyString,
    currency: nonEmptyString,
    exchangeRate: z.number().finite().positive().nullable().optional(),
    paymentMethod: optionalNullableString,
    reference: optionalNullableString,
    notes: optionalNullableString,
    allocations: z
      .array(
        z
          .object({
            feeId: nonEmptyString,
            amount: z.number().finite().positive(),
          })
          .strict(),
      )
      .min(1),
    actorType: commandActorTypeSchema,
    sourceChannel: commandSourceChannelSchema,
  })
  .strict();

export const createPackingSlipSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    actorUserId: optionalTrimmedString,
    assetIds: z.array(nonEmptyString).min(1),
    assetSelections: z
      .array(
        z
          .object({
            assetId: nonEmptyString,
            quantity: z.number().int().positive(),
          })
          .strict(),
      )
      .optional(),
    sourceKitId: optionalTrimmedString,
    projectId: nonEmptyString,
    projectUnitId: optionalTrimmedString,
    departmentId: optionalTrimmedString,
    responsibleUserId: optionalTrimmedString,
    returnDueAt: optionalTrimmedString,
    notes: optionalTrimmedString,
    actorType: commandActorTypeSchema,
    sourceChannel: commandSourceChannelSchema,
  })
  .strict();

export const returnPackingSlipItemsSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    actorUserId: optionalTrimmedString,
    packingSlipId: nonEmptyString,
    assetIds: z.array(nonEmptyString).optional(),
    conditionIn: optionalTrimmedString,
    notes: optionalTrimmedString,
    actorType: commandActorTypeSchema,
    sourceChannel: commandSourceChannelSchema,
  })
  .strict();

export const createProjectSchema = z
  .object({
    workspaceId: nonEmptyString,
    code: nonEmptyString,
    name: nonEmptyString,
    clientId: optionalTrimmedString,
    clientName: optionalTrimmedString,
    productionCompanyId: optionalTrimmedString,
    productionCompanyName: optionalTrimmedString,
    status: optionalTrimmedString,
    description: optionalTrimmedString,
    startDate: optionalTrimmedString,
    endDate: optionalTrimmedString,
    hasPreproduction: z.boolean().optional(),
    preproductionStartDate: optionalTrimmedString,
    preproductionEndDate: optionalTrimmedString,
    colorKey: optionalTrimmedString,
  })
  .strict();

export const updateProjectSchema = createProjectSchema.omit({ workspaceId: true }).extend({
  projectId: nonEmptyString,
});

export const projectBlueprintGeneralInfoSchema = z
  .object({
    code: optionalTrimmedString,
    name: nonEmptyString,
    clientId: optionalTrimmedString,
    clientName: optionalTrimmedString,
    productionCompanyId: optionalTrimmedString,
    productionCompanyName: optionalTrimmedString,
    status: nonEmptyString,
    description: optionalTrimmedString,
    startDate: nonEmptyString,
    endDate: nonEmptyString,
    hasPreproduction: z.boolean().optional(),
    preproductionStartDate: optionalTrimmedString,
    preproductionEndDate: optionalTrimmedString,
    colorKey: nonEmptyString,
    departmentIds: z.array(nonEmptyString),
  })
  .strict();

export const deleteProjectSchema = z
  .object({
    projectId: nonEmptyString,
    confirmedWithBackup: z.literal(true),
  })
  .strict();

export const archiveProjectSchema = z
  .object({
    projectId: nonEmptyString,
  })
  .strict();

export const unarchiveProjectSchema = z
  .object({
    projectId: nonEmptyString,
  })
  .strict();

const projectUnitSchema = z
  .object({
    projectId: nonEmptyString,
    code: nonEmptyString,
    name: nonEmptyString,
    sortOrder: z.number().int().optional(),
    colorKey: optionalTrimmedString,
    startDate: optionalTrimmedString,
    endDate: optionalTrimmedString,
    notes: optionalTrimmedString,
  })
  .strict();

export const createProjectUnitSchema = projectUnitSchema;

export const updateProjectUnitSchema = projectUnitSchema.extend({
    unitId: nonEmptyString,
    sortOrder: z.number().int(),
    statusAction: z.enum(["none", "mark_wrapped", "cancel", "reactivate"]).optional(),
  });

export const deleteProjectUnitSchema = z
  .object({
    projectId: nonEmptyString,
    unitId: nonEmptyString,
  })
  .strict();

export const assignCrewToProjectUnitSchema = z
  .object({
    projectId: nonEmptyString,
    unitId: nonEmptyString,
    crewMemberId: nonEmptyString,
    roleLabel: optionalTrimmedString,
    startDate: optionalTrimmedString,
    endDate: optionalTrimmedString,
    notes: optionalTrimmedString,
  })
  .strict();

export const unassignCrewFromProjectUnitSchema = z
  .object({
    projectId: nonEmptyString,
    unitId: nonEmptyString,
    assignmentId: nonEmptyString,
  })
  .strict();

const projectBlueprintCrewAssignmentSchema = z
  .object({
    crewMemberId: nonEmptyString,
    roleLabel: optionalTrimmedString,
    startDate: optionalTrimmedString,
    endDate: optionalTrimmedString,
    notes: optionalTrimmedString,
  })
  .strict();

const projectBlueprintPackingSeedSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }).strict(),
  z
    .object({
      mode: z.literal("existing"),
      packingSlipId: nonEmptyString,
    })
    .strict(),
  z
    .object({
      mode: z.literal("draft"),
      label: optionalTrimmedString,
      responsibleUserId: optionalTrimmedString,
      notes: optionalTrimmedString,
    })
    .strict(),
]);

const projectBlueprintUnitWindowSchema = z
  .object({
    id: optionalTrimmedString,
    startDate: optionalTrimmedString,
    endDate: optionalTrimmedString,
    sortOrder: z.number().int().optional(),
    label: optionalTrimmedString,
  })
  .strict();

const projectBlueprintUnitDepartmentSchema = z
  .object({
    departmentId: nonEmptyString,
    assetIds: z.array(nonEmptyString),
    crewAssignments: z.array(projectBlueprintCrewAssignmentSchema),
    packingSeed: projectBlueprintPackingSeedSchema.optional(),
  })
  .strict();

const projectBlueprintUnitSchema = z
  .object({
    id: optionalTrimmedString,
    code: optionalTrimmedString,
    name: nonEmptyString,
    suggestedPreset: optionalTrimmedString,
    sortOrder: z.number().int().optional(),
    colorKey: optionalTrimmedString,
    windows: z.array(projectBlueprintUnitWindowSchema),
    departmentIds: z.array(nonEmptyString),
    unitDepartments: z.array(projectBlueprintUnitDepartmentSchema),
    notes: optionalTrimmedString,
  })
  .strict();

export const createProjectBlueprintSchema = z
  .object({
    workspaceId: nonEmptyString,
    generalInfo: projectBlueprintGeneralInfoSchema,
    mainUnit: projectBlueprintUnitSchema,
    additionalUnits: z.array(projectBlueprintUnitSchema),
  })
  .strict();

const createCatalogLocationSchema = z
  .object({
    workspaceId: nonEmptyString,
    entityType: z.literal("location"),
    code: nonEmptyString,
    name: nonEmptyString,
    locationType: nonEmptyString,
    description: optionalTrimmedString,
  })
  .strict();

const createCatalogDepartmentSchema = z
  .object({
    workspaceId: nonEmptyString,
    entityType: z.literal("department"),
    code: nonEmptyString,
    name: nonEmptyString,
    description: optionalTrimmedString,
  })
  .strict();

const createCatalogCrewSchema = z
  .object({
    workspaceId: nonEmptyString,
    entityType: z.literal("crew"),
    fullName: nonEmptyString,
    primaryDepartmentId: optionalTrimmedString,
    linkedUserId: optionalTrimmedString,
    documentId: optionalTrimmedString,
    roleLabel: optionalTrimmedString,
    email: optionalTrimmedString,
    phone: optionalTrimmedString,
    notes: optionalTrimmedString,
    bankAccounts: z
      .array(
        z
          .object({
            bankName: optionalTrimmedString,
            accountHolder: optionalTrimmedString,
            accountNumber: nonEmptyString,
            accountType: optionalTrimmedString,
            routingNumber: optionalTrimmedString,
            notes: optionalTrimmedString,
            maskInPreview: z.boolean().optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

const createCatalogClientSchema = z
  .object({
    workspaceId: nonEmptyString,
    entityType: z.literal("client"),
    name: nonEmptyString,
    contactName: optionalTrimmedString,
    email: optionalTrimmedString,
    phone: optionalTrimmedString,
    rnc: optionalTrimmedString,
    notes: optionalTrimmedString,
  })
  .strict();

const createCatalogProductionCompanySchema = z
  .object({
    workspaceId: nonEmptyString,
    entityType: z.literal("production_company"),
    name: nonEmptyString,
    contactName: optionalTrimmedString,
    email: optionalTrimmedString,
    phone: optionalTrimmedString,
    pur: optionalTrimmedString,
    notes: optionalTrimmedString,
  })
  .strict();

const createCatalogManufacturerSchema = z
  .object({
    workspaceId: nonEmptyString,
    entityType: z.literal("manufacturer"),
    name: nonEmptyString,
    contactName: optionalTrimmedString,
    supportEmail: optionalTrimmedString,
    phone: optionalTrimmedString,
    notes: optionalTrimmedString,
  })
  .strict();

const createCatalogCategorySchema = z
  .object({
    workspaceId: nonEmptyString,
    entityType: z.literal("category"),
    code: nonEmptyString,
    name: nonEmptyString,
    description: optionalTrimmedString,
  })
  .strict();

const createCatalogKitSchema = z
  .object({
    workspaceId: nonEmptyString,
    entityType: z.literal("kit"),
    code: nonEmptyString,
    name: nonEmptyString,
    description: optionalTrimmedString,
    notes: optionalTrimmedString,
    assetIds: z.array(nonEmptyString).optional(),
    assetSelections: z
      .array(
        z
          .object({
            assetId: nonEmptyString,
            quantity: z.number().int().positive(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

export const createCatalogEntitySchema = z.discriminatedUnion("entityType", [
  createCatalogLocationSchema,
  createCatalogDepartmentSchema,
  createCatalogCrewSchema,
  createCatalogClientSchema,
  createCatalogProductionCompanySchema,
  createCatalogManufacturerSchema,
  createCatalogCategorySchema,
  createCatalogKitSchema,
]);

export const updateCatalogEntitySchema = z.discriminatedUnion("entityType", [
  createCatalogLocationSchema.extend({ id: nonEmptyString }),
  createCatalogDepartmentSchema.extend({ id: nonEmptyString }),
  createCatalogCrewSchema.extend({ id: nonEmptyString }),
  createCatalogClientSchema.extend({ id: nonEmptyString }),
  createCatalogProductionCompanySchema.extend({ id: nonEmptyString }),
  createCatalogManufacturerSchema.extend({ id: nonEmptyString }),
  createCatalogCategorySchema.extend({ id: nonEmptyString }),
  createCatalogKitSchema.extend({ id: nonEmptyString }),
]);

export const deleteCatalogEntitySchema = z
  .object({
    workspaceId: nonEmptyString,
    entityType: z.enum(["location", "department", "crew", "client", "production_company", "manufacturer", "category", "kit"]),
    id: nonEmptyString,
  })
  .strict();

export const deleteCatalogEntitiesSchema = z
  .object({
    workspaceId: nonEmptyString,
    entityType: z.enum(["location", "department", "crew", "client", "production_company", "manufacturer", "category", "kit"]),
    ids: z.array(nonEmptyString).min(1),
  })
  .strict();

export const exportCatalogCsvSchema = z
  .object({
    workspaceId: nonEmptyString,
    entityType: z.enum(["location", "department", "crew", "client", "production_company", "manufacturer", "category", "kit"]),
    mode: z.enum(["template", "data"]),
    ids: z.array(nonEmptyString).optional(),
  })
  .strict();

export const previewCatalogCsvImportSchema = z
  .object({
    workspaceId: nonEmptyString,
    entityType: z.enum(["location", "department", "crew", "client", "production_company", "manufacturer", "category", "kit"]),
    csvText: nonEmptyString,
    strategy: z.enum(["merge", "replace"]),
  })
  .strict();

export const importCatalogCsvSchema = previewCatalogCsvImportSchema;

export const uploadCrewCatalogDocumentsReadArgsSchema = z.tuple([
  z
    .object({
      workspaceId: nonEmptyString,
      crewMemberId: nonEmptyString,
      sourceFilePaths: z.array(nonEmptyString).optional(),
    })
    .strict(),
]);

const rmaCaseAssetSchema = z
  .object({
    assetId: nonEmptyString,
    equipmentYear: optionalTrimmedString,
    issueSummary: nonEmptyString,
  })
  .strict();

export const createRmaCaseSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    actorUserId: optionalTrimmedString,
    manufacturerId: nonEmptyString,
    supportEmail: optionalTrimmedString,
    title: nonEmptyString,
    problemSummary: nonEmptyString,
    notes: optionalTrimmedString,
    assetItems: z.array(rmaCaseAssetSchema).min(1),
    actorType: nonEmptyString,
    sourceChannel: nonEmptyString,
  })
  .strict();

export const updateRmaCaseSchema = createRmaCaseSchema.extend({
  rmaCaseId: nonEmptyString,
  status: rmaStatusSchema,
});

const currencyCodeSchema = z.string().trim().min(2).max(8).transform((v) => v.toUpperCase());
const currencyRateTypeSchema = z.enum(["buy", "sell", "average", "manual"]);
const currencyRateSourceSchema = z.enum(["manual", "banco_popular", "banco_central", "banco_santa_cruz", "custom"]);
const currencyRateProviderSchema = z.enum(["tasareal"]);

// Accepts string | null | undefined and normalises null/empty to undefined.
// Used for optional text fields that the renderer sends as `null` when empty.
const nullableOrOptionalText = z
  .union([z.string().trim(), z.null()])
  .optional()
  .transform((value) => (value === null ? undefined : value));

export const upsertCurrencySettingsSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    actorType: commandActorTypeSchema,
    sourceChannel: commandSourceChannelSchema,
    baseCurrency: currencyCodeSchema,
    defaultQuoteCurrency: currencyCodeSchema,
    enabledCurrencies: z.array(currencyCodeSchema).min(1),
    defaultRateSource: currencyRateSourceSchema,
    defaultRateType: currencyRateTypeSchema,
    defaultItbisRate: z.number().finite().min(0).max(1),
    defaultQuoteValidityDays: z.number().int().min(1).max(365),
    sirecineNumber: nullableOrOptionalText,
    workspaceLogoUrl: nullableOrOptionalText,
    workspaceSealUrl: nullableOrOptionalText,
    workspaceSignatureUrl: nullableOrOptionalText,
    ncfSeriesActive: nullableOrOptionalText,
    ncfSequenceNext: z.number().int().min(1).nullable().optional(),
    ncfSequenceMax: z.number().int().min(1).nullable().optional(),
    ncfExpiresAt: nullableOrOptionalText,
  })
  .strict();

export const createExchangeRateSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    actorType: commandActorTypeSchema,
    sourceChannel: commandSourceChannelSchema,
    baseCurrency: currencyCodeSchema,
    quoteCurrency: currencyCodeSchema,
    rate: z.number().finite().positive(),
    rateType: currencyRateTypeSchema,
    source: currencyRateSourceSchema,
    sourceLabel: nullableOrOptionalText,
    effectiveDate: nonEmptyString,
    fetchedAt: nullableOrOptionalText,
    notes: nullableOrOptionalText,
  })
  .strict();

export const deleteExchangeRateSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    actorType: commandActorTypeSchema,
    sourceChannel: commandSourceChannelSchema,
    rateId: nonEmptyString,
  })
  .strict();

export const currencyRateProviderStatusReadArgsSchema = z.tuple([
  z.object({
    workspaceId: nonEmptyString,
    provider: currencyRateProviderSchema.default("tasareal"),
  }),
]);

export const saveCurrencyRateProviderConfigSchema = z
  .object({
    workspaceId: nonEmptyString,
    provider: currencyRateProviderSchema,
    apiKey: nullableOrOptionalText,
    clearApiKey: z.boolean().optional(),
  })
  .strict();

export const refreshCurrencyRatesSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    provider: currencyRateProviderSchema,
    currency: currencyCodeSchema.optional(),
  })
  .strict();

export const currencySettingsQuerySchema = z
  .object({ workspaceId: nonEmptyString })
  .strict();

export const exchangeRateListQuerySchema = z
  .object({
    workspaceId: nonEmptyString,
    baseCurrency: currencyCodeSchema.optional(),
    quoteCurrency: currencyCodeSchema.optional(),
    limit: z.number().int().positive().max(200).optional(),
  })
  .strict();

export const latestExchangeRateQuerySchema = z
  .object({
    workspaceId: nonEmptyString,
    baseCurrency: currencyCodeSchema,
    quoteCurrency: currencyCodeSchema,
    rateType: currencyRateTypeSchema.optional(),
  })
  .strict();

const quoteTaxProfileSchema = z.enum(["film_law_exempt", "standard_itbis", "mixed", "manual"]);
const quoteItemTaxBehaviorSchema = z.enum(["follows_quote", "taxable", "exempt", "show_only", "included"]);
const quoteItemDurationUnitSchema = z.enum(["day", "week", "month", "unit", "flat"]);
const quoteStatusSchema = z.enum(["draft", "sent", "approved", "rejected", "expired", "cancelled"]);
const quoteSettableStatusSchema = z.enum(["sent", "approved", "rejected", "cancelled"]);

const nullableOrOptionalStringField = z
  .union([z.string().trim(), z.null()])
  .optional()
  .transform((value) => (value === null ? undefined : value));

const quoteItemInputSchema = z
  .object({
    sortOrder: z.number().int().min(0),
    quantity: z.number().finite().min(0),
    title: nonEmptyString,
    description: nullableOrOptionalStringField,
    durationValue: z.number().finite().min(0).nullable().optional(),
    durationUnit: quoteItemDurationUnitSchema.nullable().optional(),
    unitPrice: z.number().finite().min(0),
    discountRate: z.number().finite().min(0).max(1).nullable().optional(),
    discountAmount: z.number().finite().min(0).nullable().optional(),
    taxBehavior: quoteItemTaxBehaviorSchema,
    taxRate: z.number().finite().min(0).max(1).nullable().optional(),
    notes: nullableOrOptionalStringField,
  })
  .strict();

const nullableOrOptionalString = z
  .union([z.string().trim(), z.null()])
  .optional()
  .transform((value) => (value === null ? undefined : value));

const quoteHeaderInputSchema = z.object({
  quoteDate: nonEmptyString,
  validityDays: z.number().int().min(1).max(365),
  clientId: nullableOrOptionalString,
  clientNameSnapshot: nonEmptyString,
  clientRncSnapshot: nullableOrOptionalString,
  productionCompanyId: nullableOrOptionalString,
  productionCompanyNameSnapshot: nullableOrOptionalString,
  productionPurSnapshot: nullableOrOptionalString,
  workspaceSirecineSnapshot: nullableOrOptionalString,
  attentionName: nullableOrOptionalString,
  attentionPhone: nullableOrOptionalString,
  projectId: nullableOrOptionalString,
  projectNameSnapshot: nullableOrOptionalString,
  productionName: nullableOrOptionalString,
  description: nullableOrOptionalString,
  packageTitle: nullableOrOptionalString,
  currency: z.string().trim().min(2).max(8).transform((v) => v.toUpperCase()),
  baseCurrency: z.string().trim().min(2).max(8).transform((v) => v.toUpperCase()),
  exchangeRate: z.number().finite().positive(),
  exchangeRateSource: z.enum(["manual", "banco_popular", "banco_central", "banco_santa_cruz", "custom"]),
  exchangeRateType: z.enum(["buy", "sell", "average", "manual"]),
  exchangeRateEffectiveDate: nullableOrOptionalString,
  taxProfile: quoteTaxProfileSchema,
  itbisRate: z.number().finite().min(0).max(1),
  taxAddedToTotal: z.boolean(),
  taxNotes: nullableOrOptionalString,
  discountRate: z.number().finite().min(0).max(1).nullable().optional(),
  discountAmount: z.number().finite().min(0).nullable().optional(),
  observations: nullableOrOptionalString,
});

export const createQuoteSchema = quoteHeaderInputSchema
  .extend({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    actorType: commandActorTypeSchema,
    sourceChannel: commandSourceChannelSchema,
    items: z.array(quoteItemInputSchema).min(1),
  })
  .strict();

export const updateQuoteSchema = quoteHeaderInputSchema
  .extend({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    quoteId: nonEmptyString,
    actorType: commandActorTypeSchema,
    sourceChannel: commandSourceChannelSchema,
    items: z.array(quoteItemInputSchema).min(1),
    changeSummary: nullableOrOptionalString,
  })
  .strict();

export const setQuoteStatusSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    actorType: commandActorTypeSchema,
    sourceChannel: commandSourceChannelSchema,
    quoteId: nonEmptyString,
    status: quoteSettableStatusSchema,
    reason: optionalTrimmedString,
  })
  .strict();

export const duplicateQuoteSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    actorType: commandActorTypeSchema,
    sourceChannel: commandSourceChannelSchema,
    quoteId: nonEmptyString,
  })
  .strict();

export const restoreQuoteFromVersionSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    quoteId: nonEmptyString,
    versionNumber: z.number().int().positive(),
    actorType: commandActorTypeSchema,
    sourceChannel: commandSourceChannelSchema,
  })
  .strict();

const commercialDocumentNumberSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{1,8}$/, "Use the format YYYY-0001.");

export const renumberQuoteSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    quoteId: nonEmptyString,
    quoteNumber: commercialDocumentNumberSchema,
    actorType: commandActorTypeSchema,
    sourceChannel: commandSourceChannelSchema,
  })
  .strict();

// ----------------------------------------------------------------------------
// Invoices
// ----------------------------------------------------------------------------
//
// Most validators are reused from the quote schemas above — same item
// shape, same currency/tax shape, same actor channels.

const invoiceHeaderInputSchema = z.object({
  issueDate: nonEmptyString,
  dueDate: nullableOrOptionalString,
  paymentTermsDays: z.number().int().min(0).nullable().optional(),
  clientId: nullableOrOptionalString,
  clientNameSnapshot: nonEmptyString,
  clientRncSnapshot: nullableOrOptionalString,
  productionCompanyId: nullableOrOptionalString,
  productionCompanyNameSnapshot: nullableOrOptionalString,
  productionPurSnapshot: nullableOrOptionalString,
  workspaceSirecineSnapshot: nullableOrOptionalString,
  attentionName: nullableOrOptionalString,
  attentionPhone: nullableOrOptionalString,
  projectId: nullableOrOptionalString,
  projectNameSnapshot: nullableOrOptionalString,
  productionName: nullableOrOptionalString,
  description: nullableOrOptionalString,
  packageTitle: nullableOrOptionalString,
  currency: z.string().trim().min(2).max(8).transform((v) => v.toUpperCase()),
  baseCurrency: z.string().trim().min(2).max(8).transform((v) => v.toUpperCase()),
  exchangeRate: z.number().finite().positive(),
  exchangeRateSource: z.enum(["manual", "banco_popular", "banco_central", "banco_santa_cruz", "custom"]),
  exchangeRateType: z.enum(["buy", "sell", "average", "manual"]),
  exchangeRateEffectiveDate: nullableOrOptionalString,
  taxProfile: quoteTaxProfileSchema,
  itbisRate: z.number().finite().min(0).max(1),
  taxAddedToTotal: z.boolean(),
  taxNotes: nullableOrOptionalString,
  discountRate: z.number().finite().min(0).max(1).nullable().optional(),
  discountAmount: z.number().finite().min(0).nullable().optional(),
  observations: nullableOrOptionalString,
});

export const createInvoiceSchema = invoiceHeaderInputSchema
  .extend({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    actorType: commandActorTypeSchema,
    sourceChannel: commandSourceChannelSchema,
    items: z.array(quoteItemInputSchema).min(1),
    sourceQuoteId: nullableOrOptionalString,
  })
  .strict();

export const updateInvoiceSchema = invoiceHeaderInputSchema
  .extend({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    invoiceId: nonEmptyString,
    actorType: commandActorTypeSchema,
    sourceChannel: commandSourceChannelSchema,
    items: z.array(quoteItemInputSchema).min(1),
  })
  .strict();

export const issueInvoiceSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    invoiceId: nonEmptyString,
    actorType: commandActorTypeSchema,
    sourceChannel: commandSourceChannelSchema,
  })
  .strict();

export const cancelInvoiceSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    invoiceId: nonEmptyString,
    actorType: commandActorTypeSchema,
    sourceChannel: commandSourceChannelSchema,
    reason: optionalTrimmedString,
  })
  .strict();

export const recordInvoicePaymentSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    invoiceId: nonEmptyString,
    actorType: commandActorTypeSchema,
    sourceChannel: commandSourceChannelSchema,
    paidAt: nonEmptyString,
    amount: z.number().finite().positive(),
    currency: z.string().trim().min(2).max(8).transform((v) => v.toUpperCase()),
    exchangeRate: z.number().finite().positive().nullable().optional(),
    paymentMethod: nullableOrOptionalString,
    reference: nullableOrOptionalString,
    notes: nullableOrOptionalString,
  })
  .strict();

export const renumberInvoiceSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    invoiceId: nonEmptyString,
    invoiceNumber: commercialDocumentNumberSchema,
    actorType: commandActorTypeSchema,
    sourceChannel: commandSourceChannelSchema,
  })
  .strict();

export const createInvoiceFromQuoteSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    quoteId: nonEmptyString,
  })
  .strict();

export const quoteListQuerySchema = z
  .object({
    workspaceId: nonEmptyString,
    status: quoteStatusSchema.optional(),
    clientId: optionalTrimmedString,
    projectId: optionalTrimmedString,
    dateFrom: optionalTrimmedString,
    dateTo: optionalTrimmedString,
    currency: optionalTrimmedString,
    search: optionalTrimmedString,
    limit: z.number().int().positive().max(500).optional(),
  })
  .strict();

export const quoteDetailQuerySchema = z
  .object({ workspaceId: nonEmptyString, quoteId: nonEmptyString })
  .strict();

// Read-args wrappers (tuple-shaped) for `safeHandleReadWithSchema` which parses
// the full `args` array, not a single object.
export const currencySettingsReadArgsSchema = z.tuple([currencySettingsQuerySchema]);
export const exchangeRateListReadArgsSchema = z.tuple([exchangeRateListQuerySchema]);
export const latestExchangeRateReadArgsSchema = z.tuple([latestExchangeRateQuerySchema]);
export const quoteListReadArgsSchema = z.tuple([quoteListQuerySchema]);
export const quoteDetailReadArgsSchema = z.tuple([quoteDetailQuerySchema]);

export const quoteExportPdfReadArgsSchema = z.tuple([
  z.object({ workspaceId: nonEmptyString, quoteId: nonEmptyString }).strict(),
]);

export const quoteVersionsReadArgsSchema = z.tuple([
  z.object({ workspaceId: nonEmptyString, quoteId: nonEmptyString }).strict(),
]);

// ----------------------------------------------------------------------------
// Invoices — read schemas
// ----------------------------------------------------------------------------

const invoiceStatusSchema = z.enum([
  "draft",
  "issued",
  "partially_paid",
  "paid",
  "cancelled",
  "void",
]);

export const invoiceListQuerySchema = z
  .object({
    workspaceId: nonEmptyString,
    status: invoiceStatusSchema.optional(),
    sourceQuoteId: optionalTrimmedString,
    clientId: optionalTrimmedString,
    projectId: optionalTrimmedString,
    dateFrom: optionalTrimmedString,
    dateTo: optionalTrimmedString,
    currency: optionalTrimmedString,
    search: optionalTrimmedString,
    hasOutstanding: z.boolean().optional(),
    limit: z.number().int().positive().max(500).optional(),
  })
  .strict();

export const invoiceDetailQuerySchema = z
  .object({ workspaceId: nonEmptyString, invoiceId: nonEmptyString })
  .strict();

export const invoiceListReadArgsSchema = z.tuple([invoiceListQuerySchema]);
export const invoiceDetailReadArgsSchema = z.tuple([invoiceDetailQuerySchema]);

// ----------------------------------------------------------------------------
// Treasury (PILAR T) — bank reconciliation
// ----------------------------------------------------------------------------

const bankNameSchema = z.enum(["popular", "santa_cruz", "custom"]);
const bankAccountTypeSchema = z.enum(["checking", "savings", "other"]);
const transactionDirectionSchema = z.enum(["debit", "credit"]);
const transactionKindSchema = z.enum([
  "income",
  "expense",
  "transfer",
  "fx_exchange",
  "salary",
  "reimbursement",
  "tax",
  "tss",
  "bank_fee",
  "interest",
  "owner_draw",
  "other",
]);
const reimbursementStatusSchema = z.enum(["n/a", "pending", "accepted", "rejected", "partial"]);
const fiscalStatusSchema = z.enum(["pending", "accepted", "rejected"]);
const statementSourceFormatSchema = z.enum(["csv", "xlsx", "manual", "pdf"]);
const transactionLinkEntityTypeSchema = z.enum([
  "invoice",
  "invoice_payment",
  "crew_voucher",
  "financial_entry",
]);

export const upsertBankAccountSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    actorType: commandActorTypeSchema,
    sourceChannel: commandSourceChannelSchema,
    bankAccountId: nullableOrOptionalString,
    bankName: bankNameSchema,
    accountLabel: nonEmptyString,
    accountNumberMasked: nullableOrOptionalString,
    accountNumberFull: nullableOrOptionalString,
    currency: z.string().trim().min(2).max(8).transform((v) => v.toUpperCase()),
    accountType: bankAccountTypeSchema.nullable().optional(),
    openingBalance: z.number().finite().nullable().optional(),
    openingBalanceDate: nullableOrOptionalString,
    isActive: z.boolean().optional(),
    notes: nullableOrOptionalString,
  })
  .strict();

const parsedBankTransactionSchema = z
  .object({
    txnDate: nonEmptyString,
    valueDate: nullableOrOptionalString,
    rawDescription: nullableOrOptionalString,
    reference: nullableOrOptionalString,
    serial: nullableOrOptionalString,
    amount: z.number().finite().min(0),
    direction: transactionDirectionSchema,
    runningBalance: z.number().finite().nullable().optional(),
  })
  .strict();

export const importStatementSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    actorType: commandActorTypeSchema,
    sourceChannel: commandSourceChannelSchema,
    bankAccountId: nonEmptyString,
    sourceFormat: statementSourceFormatSchema,
    originalFilename: nullableOrOptionalString,
    periodStart: nullableOrOptionalString,
    periodEnd: nullableOrOptionalString,
    rows: z.array(parsedBankTransactionSchema).min(1),
    notes: nullableOrOptionalString,
  })
  .strict();

export const addManualTransactionsSchema = importStatementSchema;

export const deleteImportSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    actorType: commandActorTypeSchema,
    sourceChannel: commandSourceChannelSchema,
    importId: nonEmptyString,
  })
  .strict();

export const correctTransactionSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    actorType: commandActorTypeSchema,
    sourceChannel: commandSourceChannelSchema,
    transactionId: nonEmptyString,
    txnDate: optionalTrimmedString,
    valueDate: nullableOrOptionalString,
    rawDescription: nullableOrOptionalString,
    reference: nullableOrOptionalString,
    serial: nullableOrOptionalString,
    amount: z.number().finite().min(0).optional(),
    direction: transactionDirectionSchema.optional(),
    runningBalance: z.number().finite().nullable().optional(),
    notes: nullableOrOptionalString,
  })
  .strict();

export const annotateTransactionSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    actorType: commandActorTypeSchema,
    sourceChannel: commandSourceChannelSchema,
    transactionId: nonEmptyString,
    txnKind: transactionKindSchema.nullable().optional(),
    concept: nullableOrOptionalString,
    counterparty: nullableOrOptionalString,
    counterpartyRnc: nullableOrOptionalString,
    expenseCategory: nullableOrOptionalString,
    supplierNcf: nullableOrOptionalString,
    dgiiExpenseType: nullableOrOptionalString,
    withholdingType: nullableOrOptionalString,
    withholdingRate: z.number().finite().min(0).nullable().optional(),
    withholdingAmount: z.number().finite().min(0).nullable().optional(),
    fiscalPeriod: nullableOrOptionalString,
    isInternalTransfer: z.boolean().optional(),
    reimbursementStatus: reimbursementStatusSchema.optional(),
    claimedAmount: z.number().finite().nullable().optional(),
    supportDocFileId: nullableOrOptionalString,
    notes: nullableOrOptionalString,
  })
  .strict();

export const applyCounterpartyRuleSchema = annotateTransactionSchema.extend({
  matchPattern: nullableOrOptionalString,
  matchType: z.enum(["exact", "contains"]).optional(),
});

const projectAllocationInputSchema = z
  .object({
    projectId: nullableOrOptionalString,
    projectNameSnapshot: nullableOrOptionalString,
    amount: z.number().finite(),
    percent: z.number().finite().min(0).max(100).nullable().optional(),
    notes: nullableOrOptionalString,
  })
  .strict();

export const setAllocationsSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    actorType: commandActorTypeSchema,
    sourceChannel: commandSourceChannelSchema,
    transactionId: nonEmptyString,
    allocations: z.array(projectAllocationInputSchema),
  })
  .strict();

export const reviewReimbursementSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    actorType: commandActorTypeSchema,
    sourceChannel: commandSourceChannelSchema,
    transactionId: nonEmptyString,
    reimbursementStatus: reimbursementStatusSchema,
    deductibleAmount: z.number().finite().min(0).nullable().optional(),
    supplierNcf: nullableOrOptionalString,
    dgiiExpenseType: nullableOrOptionalString,
    withholdingType: nullableOrOptionalString,
    withholdingRate: z.number().finite().min(0).nullable().optional(),
    withholdingAmount: z.number().finite().min(0).nullable().optional(),
    fiscalPeriod: nullableOrOptionalString,
    fiscalStatus: fiscalStatusSchema,
    notes: nullableOrOptionalString,
  })
  .strict();

export const linkTransactionSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    actorType: commandActorTypeSchema,
    sourceChannel: commandSourceChannelSchema,
    transactionId: nonEmptyString,
    linkedEntityType: transactionLinkEntityTypeSchema,
    linkedEntityId: nonEmptyString,
    notes: nullableOrOptionalString,
  })
  .strict();

export const undoTreasuryActionSchema = z
  .object({
    commandId: nonEmptyString,
    workspaceId: nonEmptyString,
    actorType: commandActorTypeSchema,
    sourceChannel: commandSourceChannelSchema,
    undoId: nullableOrOptionalString,
  })
  .strict();

// Treasury — Invoice Inbox

const invoiceInboxFileInputSchema = z
  .object({
    name: nonEmptyString,
    mimeType: nonEmptyString,
    dataUrl: nonEmptyString,
  })
  .strict();

export const enqueueInvoiceBatchSchema = z
  .object({
    workspaceId: nonEmptyString,
    files: z.array(invoiceInboxFileInputSchema).min(1).max(60),
    uploadedByUserId: nullableOrOptionalString,
    uploadedByName: nullableOrOptionalString,
  })
  .strict();

export const invoiceInboxListQuerySchema = z
  .object({
    workspaceId: nonEmptyString,
    batchId: nullableOrOptionalString,
    includeResolved: z.boolean().optional(),
  })
  .strict();

export const updateInvoiceExtractionSchema = z
  .object({
    workspaceId: nonEmptyString,
    extractionId: nonEmptyString,
    supplierName: nullableOrOptionalString,
    supplierRnc: nullableOrOptionalString,
    ncf: nullableOrOptionalString,
    invoiceDate: nullableOrOptionalString,
    subtotal: z.number().finite().nullable().optional(),
    itbis: z.number().finite().nullable().optional(),
    total: z.number().finite().nullable().optional(),
    currency: nullableOrOptionalString,
    dgiiExpenseType: nullableOrOptionalString,
    expenseCategory: nullableOrOptionalString,
    linkedUserId: nullableOrOptionalString,
    linkedUserName: nullableOrOptionalString,
    projects: z
      .array(
        z
          .object({ projectId: nonEmptyString, projectName: nullableOrOptionalString })
          .strict(),
      )
      .optional(),
  })
  .strict();

export const bulkLinkInvoiceExtractionsSchema = z
  .object({
    workspaceId: nonEmptyString,
    extractionIds: z.array(nonEmptyString).min(1).max(500),
    linkedUserId: nullableOrOptionalString,
    linkedUserName: nullableOrOptionalString,
    projects: z
      .array(
        z
          .object({ projectId: nonEmptyString, projectName: nullableOrOptionalString })
          .strict(),
      )
      .optional(),
  })
  .strict();

export const applyInvoiceExtractionSchema = z
  .object({
    workspaceId: nonEmptyString,
    extractionId: nonEmptyString,
    transactionId: nonEmptyString,
    deductibleAmount: z.number().finite().min(0).nullable().optional(),
    fiscalPeriod: nullableOrOptionalString,
  })
  .strict();

export const dismissInvoiceExtractionSchema = z
  .object({
    workspaceId: nonEmptyString,
    extractionId: nonEmptyString,
  })
  .strict();

export const retryInvoiceExtractionsSchema = z
  .object({
    workspaceId: nonEmptyString,
    extractionIds: z.array(nonEmptyString).min(1).max(500),
  })
  .strict();

// Treasury — read schemas

export const treasuryTransactionListQuerySchema = z
  .object({
    workspaceId: nonEmptyString,
    bankAccountId: optionalTrimmedString,
    dateFrom: optionalTrimmedString,
    dateTo: optionalTrimmedString,
    kind: transactionKindSchema.optional(),
    direction: transactionDirectionSchema.optional(),
    projectId: optionalTrimmedString,
    unclassifiedOnly: z.boolean().optional(),
    pendingReviewOnly: z.boolean().optional(),
    search: optionalTrimmedString,
    limit: z.number().int().positive().max(1000).optional(),
  })
  .strict();

export const counterpartyRulePreviewQuerySchema = z
  .object({
    workspaceId: nonEmptyString,
    transactionId: nonEmptyString,
    matchPattern: nullableOrOptionalString,
    matchType: z.enum(["exact", "contains"]).optional(),
  })
  .strict();

export const treasuryOverviewQuerySchema = z
  .object({
    workspaceId: nonEmptyString,
    period: z.enum(["month", "quarter", "year", "fiscal", "all", "custom"]),
    customStartDate: optionalTrimmedString,
    customEndDate: optionalTrimmedString,
    reportCurrency: optionalTrimmedString,
  })
  .strict();

export const treasuryDeductibleLedgerQuerySchema = z
  .object({
    workspaceId: nonEmptyString,
    period: z.enum(["month", "quarter", "year", "fiscal", "all", "custom"]),
    customStartDate: optionalTrimmedString,
    customEndDate: optionalTrimmedString,
  })
  .strict();

export const treasuryDeductibleLedgerExportSchema = treasuryDeductibleLedgerQuerySchema.extend({
  format: z.enum(["csv", "xlsx", "pdf"]),
});

export const dgiiReportQuerySchema = z
  .object({
    workspaceId: nonEmptyString,
    report: z.enum(["606", "607", "608"]),
    period: z.enum(["month", "quarter", "year", "fiscal", "all", "custom"]),
    customStartDate: optionalTrimmedString,
    customEndDate: optionalTrimmedString,
  })
  .strict();

export const dgiiReportExportSchema = dgiiReportQuerySchema.extend({
  format: z.enum(["csv", "xlsx", "pdf"]),
});

export const dgiiReportReadArgsSchema = z.tuple([dgiiReportQuerySchema]);

export const treasuryAccountsQuerySchema = z
  .object({ workspaceId: nonEmptyString })
  .strict();

export const treasuryProjectPnlQuerySchema = z
  .object({
    workspaceId: nonEmptyString,
    dateFrom: optionalTrimmedString,
    dateTo: optionalTrimmedString,
  })
  .strict();

export const treasuryUndoPreviewQuerySchema = z.object({ workspaceId: nonEmptyString }).strict();

export const treasuryImportsQuerySchema = z
  .object({ workspaceId: nonEmptyString, bankAccountId: optionalTrimmedString })
  .strict();

export const treasuryAccountsReadArgsSchema = z.tuple([treasuryAccountsQuerySchema]);
export const treasuryExpenseCategoriesReadArgsSchema = z.tuple([treasuryAccountsQuerySchema]);
export const treasuryImportsReadArgsSchema = z.tuple([treasuryImportsQuerySchema]);
export const treasuryTransactionListReadArgsSchema = z.tuple([treasuryTransactionListQuerySchema]);
export const counterpartyRulePreviewReadArgsSchema = z.tuple([counterpartyRulePreviewQuerySchema]);
export const treasuryOverviewReadArgsSchema = z.tuple([treasuryOverviewQuerySchema]);
export const treasuryReviewQueueReadArgsSchema = z.tuple([treasuryAccountsQuerySchema]);
export const treasuryProjectPnlReadArgsSchema = z.tuple([treasuryProjectPnlQuerySchema]);
export const treasuryUndoPreviewReadArgsSchema = z.tuple([treasuryUndoPreviewQuerySchema]);
export const treasuryDeductibleLedgerReadArgsSchema = z.tuple([treasuryDeductibleLedgerQuerySchema]);
export const invoiceInboxListReadArgsSchema = z.tuple([invoiceInboxListQuerySchema]);
export const invoiceInboxPreviewReadArgsSchema = z.tuple([
  z.object({ workspaceId: nonEmptyString, extractionId: nonEmptyString }).strict(),
]);
export const invoiceInboxDuplicatesReadArgsSchema = z.tuple([
  z.object({ workspaceId: nonEmptyString }).strict(),
]);
export const downloadInvoiceExtractionSchema = z
  .object({ workspaceId: nonEmptyString, extractionId: nonEmptyString })
  .strict();
export const downloadInvoiceExtractionBatchSchema = z
  .object({ workspaceId: nonEmptyString, extractionIds: z.array(nonEmptyString).min(1).max(500) })
  .strict();
export const backfillInvoiceHashesSchema = z.object({ workspaceId: nonEmptyString }).strict();

// ----------------------------------------------------------------------------
// Software licenses (local-first)
// ----------------------------------------------------------------------------

const softwareLicenseStatusSchema = z.enum([
  "active",
  "expiring",
  "expired",
  "permanent",
  "archived",
]);
const softwareLicenseTypeSchema = z.enum([
  "subscription",
  "perpetual",
  "trial",
  "usage_based",
  "web_service",
  "other",
]);

export const upsertSoftwareLicenseSchema = z
  .object({
    workspaceId: nonEmptyString,
    licenseId: nullableOrOptionalString,
    softwareName: nonEmptyString,
    vendor: nullableOrOptionalString,
    status: softwareLicenseStatusSchema,
    licenseType: softwareLicenseTypeSchema,
    seatCount: z.number().int().min(0),
    seatAssignments: z.array(z.string()),
    licenseKey: nullableOrOptionalString,
    accountEmail: nullableOrOptionalString,
    startsAt: nullableOrOptionalString,
    expiresAt: nullableOrOptionalString,
    renewalUrl: nullableOrOptionalString,
    paymentUrl: nullableOrOptionalString,
    invoiceUrl: nullableOrOptionalString,
    reminderDaysBefore: z.number().int().min(0),
    notes: nullableOrOptionalString,
  })
  .strict();

export const archiveSoftwareLicenseSchema = z
  .object({ workspaceId: nonEmptyString, licenseId: nonEmptyString })
  .strict();

export const setLicenseSeatsSchema = z
  .object({
    workspaceId: nonEmptyString,
    licenseId: nonEmptyString,
    seatAssignments: z.array(z.string()),
  })
  .strict();

export const softwareLicensesReadArgsSchema = z.tuple([
  z.object({ workspaceId: nonEmptyString }).strict(),
]);
