import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);
const optionalTrimmedString = z.string().trim().optional();
const optionalNullableString = z.string().trim().nullable().optional();
const commandActorTypeSchema = z.enum(["user", "agent", "integration"]);
const commandSourceChannelSchema = z.enum(["desktop", "mobile", "api", "whatsapp", "telegram"]);
const agentStatusSchema = z.enum(["active", "paused"]);
const agentApprovalModeSchema = z.enum(["auto", "supervised", "needs_approval"]);
const assistantApprovalPreferenceSchema = z.enum(["supervised", "needs_approval", "unsupervised"]);
const rmaStatusSchema = z.enum(["Draft", "Ready", "Sent", "Closed"]);
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

export const assistantGatewayAttachmentSchema = z
  .object({
    id: nonEmptyString,
    kind: z.literal("image"),
    name: nonEmptyString,
    mimeType: nonEmptyString,
    dataUrl: nonEmptyString,
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
    replacementValue: z.number().finite().nonnegative().optional(),
    ownershipType: optionalTrimmedString,
    qrCodeValue: optionalTrimmedString,
    isActive: z.boolean().optional(),
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
    incidentId: nonEmptyString,
    resolutionNotes: optionalTrimmedString,
    costEstimate: z.number().finite().nonnegative().optional(),
    financialStatus: optionalTrimmedString,
    resolvedByUserId: optionalTrimmedString,
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

export const createPackingSlipSchema = z
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

export const updateProjectSchema = createProjectSchema.extend({
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
    generalInfo: projectBlueprintGeneralInfoSchema,
    mainUnit: projectBlueprintUnitSchema,
    additionalUnits: z.array(projectBlueprintUnitSchema),
  })
  .strict();

const createCatalogLocationSchema = z
  .object({
    entityType: z.literal("location"),
    code: nonEmptyString,
    name: nonEmptyString,
    locationType: nonEmptyString,
    description: optionalTrimmedString,
  })
  .strict();

const createCatalogDepartmentSchema = z
  .object({
    entityType: z.literal("department"),
    code: nonEmptyString,
    name: nonEmptyString,
    description: optionalTrimmedString,
  })
  .strict();

const createCatalogCrewSchema = z
  .object({
    entityType: z.literal("crew"),
    fullName: nonEmptyString,
    primaryDepartmentId: optionalTrimmedString,
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
    entityType: z.literal("client"),
    name: nonEmptyString,
    contactName: optionalTrimmedString,
    email: optionalTrimmedString,
    phone: optionalTrimmedString,
    notes: optionalTrimmedString,
  })
  .strict();

const createCatalogProductionCompanySchema = z
  .object({
    entityType: z.literal("production_company"),
    name: nonEmptyString,
    contactName: optionalTrimmedString,
    email: optionalTrimmedString,
    phone: optionalTrimmedString,
    notes: optionalTrimmedString,
  })
  .strict();

const createCatalogManufacturerSchema = z
  .object({
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
    entityType: z.literal("category"),
    code: nonEmptyString,
    name: nonEmptyString,
    description: optionalTrimmedString,
  })
  .strict();

const createCatalogKitSchema = z
  .object({
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
    entityType: z.enum(["location", "department", "crew", "client", "production_company", "manufacturer", "category", "kit"]),
    id: nonEmptyString,
  })
  .strict();

export const deleteCatalogEntitiesSchema = z
  .object({
    entityType: z.enum(["location", "department", "crew", "client", "production_company", "manufacturer", "category", "kit"]),
    ids: z.array(nonEmptyString).min(1),
  })
  .strict();

export const exportCatalogCsvSchema = z
  .object({
    entityType: z.enum(["location", "department", "crew", "client", "production_company", "manufacturer", "category", "kit"]),
    mode: z.enum(["template", "data"]),
    ids: z.array(nonEmptyString).optional(),
  })
  .strict();

export const previewCatalogCsvImportSchema = z
  .object({
    entityType: z.enum(["location", "department", "crew", "client", "production_company", "manufacturer", "category", "kit"]),
    csvText: nonEmptyString,
    strategy: z.enum(["merge", "replace"]),
  })
  .strict();

export const importCatalogCsvSchema = previewCatalogCsvImportSchema;

export const uploadCrewCatalogDocumentsReadArgsSchema = z.tuple([
  z
    .object({
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
