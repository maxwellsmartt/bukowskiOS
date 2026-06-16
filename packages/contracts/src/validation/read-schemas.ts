import { z } from "zod";
import { createProjectBlueprintSchema } from "./mutation-schemas";

const nonEmptyId = z.string().trim().min(1).max(160);
const boundedSearch = z.string().trim().max(200);
const sortDirectionSchema = z.enum(["asc", "desc"]);
const isoDateSchema = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/u, "Expected a YYYY-MM-DD date.");
const currencyRateTypeSchema = z.enum(["buy", "sell", "average", "manual"]);
const currencyRateSourceSchema = z.enum(["manual", "banco_popular", "banco_central", "banco_santa_cruz", "custom"]);

const assetSortFieldSchema = z.enum([
  "name",
  "code",
  "category",
  "status",
  "condition",
  "location",
  "project",
  "projectUnit",
  "responsible",
  "serialNumber",
  "qrCode",
  "incidentsOpen",
  "createdAt",
  "updatedAt",
]);

const packingSlipSortFieldSchema = z.enum([
  "number",
  "project",
  "department",
  "responsible",
  "issuedDate",
  "dueDate",
  "itemCount",
  "returnedCount",
  "status",
]);

const incidentSortFieldSchema = z.enum([
  "title",
  "asset",
  "project",
  "responsible",
  "severity",
  "costEstimate",
  "status",
  "reportedAt",
]);

const projectSortFieldSchema = z.enum([
  "name",
  "code",
  "client",
  "status",
  "startDate",
  "endDate",
  "colorKey",
  "assetCount",
  "incidentCount",
  "activeUnitCount",
  "exposure",
  "createdAt",
  "updatedAt",
]);

const financeEntrySortFieldSchema = z.enum(["date", "type", "category", "reference", "project", "amount", "status"]);
const collaboratorFeeSortFieldSchema = z.enum(["expectedDate", "crew", "project", "feeType", "amount", "outstanding", "status"]);
const collaboratorFeeStatusSchema = z.enum(["draft", "approved", "scheduled", "partially_paid", "paid", "cancelled", "all"]);
const financeOverviewPeriodSchema = z.enum(["month", "quarter", "year", "custom"]);
const catalogEntityTypeSchema = z.enum(["location", "department", "crew", "client", "production_company", "manufacturer", "category", "kit"]);
const catalogSortFieldSchema = z.enum([
  "code",
  "name",
  "fullName",
  "status",
  "type",
  "description",
  "roleLabel",
  "contactName",
  "supportEmail",
  "email",
  "phone",
  "rnc",
  "pur",
  "assetCount",
]);

export const emptyReadArgsSchema = z.tuple([]);

export const idReadArgsSchema = z.tuple([nonEmptyId]);

export const exportPackingSlipInsurancePdfReadArgsSchema = z.tuple([
  z
    .object({
      packingSlipId: nonEmptyId,
      options: z
        .object({
          outputCurrency: z.enum(["USD", "DOP"]),
          exchangeRate: z.number().finite().positive(),
          exchangeRateSource: currencyRateSourceSchema,
          exchangeRateType: currencyRateTypeSchema,
          exchangeRateEffectiveDate: z.string().trim().nullable().optional(),
          exchangeRateSourceLabel: z.string().trim().nullable().optional(),
          mode: z.enum(["automatic", "manual"]),
        })
        .strict()
        .nullable()
        .optional(),
    })
    .strict(),
]);

export const workspaceQuerySchema = z.object({
  workspaceId: nonEmptyId.optional(),
});

export const globalSearchQuerySchema = z.object({
  workspaceId: nonEmptyId.optional(),
  query: boundedSearch,
  recentEntityKeys: z.array(nonEmptyId).max(50).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export const globalSearchReadArgsSchema = z.tuple([globalSearchQuerySchema]);

export const scheduleTimelinePaginationSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).max(1000).optional(),
});

export const scheduleTimelineQuerySchema = z.object({
  workspaceId: nonEmptyId.optional(),
  pagination: scheduleTimelinePaginationSchema.optional(),
});

export const scheduleTimelineReadArgsSchema = z.tuple([
  z.enum(["30d", "90d", "6m"]),
  z.enum(["day", "week", "month"]),
  isoDateSchema.optional(),
  scheduleTimelineQuerySchema.optional(),
]);

export const assetListQuerySchema = z.object({
  workspaceId: nonEmptyId.optional(),
  scopeProjectId: nonEmptyId.nullable().optional(),
  search: boundedSearch.optional(),
  sortBy: assetSortFieldSchema,
  sortDirection: sortDirectionSchema,
});

export const assetWorkspaceQuerySchema = z.object({
  workspaceId: nonEmptyId.optional(),
});

export const assetListReadArgsSchema = z.tuple([assetListQuerySchema.optional()]);
export const assetWorkspaceReadArgsSchema = z.tuple([assetWorkspaceQuerySchema.optional()]);
export const agentWorkspaceReadArgsSchema = z.tuple([workspaceQuerySchema.optional()]);
export const appUsersSnapshotReadArgsSchema = z.tuple([workspaceQuerySchema.optional()]);

export const packingSlipListQuerySchema = z.object({
  workspaceId: nonEmptyId.optional(),
  scopeProjectId: nonEmptyId.nullable().optional(),
  search: boundedSearch.optional(),
  sortBy: packingSlipSortFieldSchema,
  sortDirection: sortDirectionSchema,
});

export const packingSlipListReadArgsSchema = z.tuple([packingSlipListQuerySchema.optional()]);

export const incidentListQuerySchema = z.object({
  workspaceId: nonEmptyId.optional(),
  scopeProjectId: nonEmptyId.nullable().optional(),
  search: boundedSearch.optional(),
  sortBy: incidentSortFieldSchema,
  sortDirection: sortDirectionSchema,
});

export const incidentListReadArgsSchema = z.tuple([incidentListQuerySchema.optional()]);

export const projectListQuerySchema = z.object({
  workspaceId: nonEmptyId.optional(),
  search: boundedSearch.optional(),
  sortBy: projectSortFieldSchema,
  sortDirection: sortDirectionSchema,
  includeArchived: z.boolean().optional(),
});

export const projectListReadArgsSchema = z.tuple([projectListQuerySchema.optional()]);

export const financeEntryListQuerySchema = z.object({
  workspaceId: nonEmptyId.optional(),
  projectId: nonEmptyId.nullable().optional(),
  search: boundedSearch.optional(),
  sortBy: financeEntrySortFieldSchema,
  sortDirection: sortDirectionSchema,
});

export const financeEntryListReadArgsSchema = z.tuple([financeEntryListQuerySchema.optional()]);

export const collaboratorFeeListQuerySchema = z.object({
  workspaceId: nonEmptyId.optional(),
  search: boundedSearch.optional(),
  sortBy: collaboratorFeeSortFieldSchema,
  sortDirection: sortDirectionSchema,
  status: collaboratorFeeStatusSchema.optional(),
  projectId: nonEmptyId.nullable().optional(),
  crewMemberId: nonEmptyId.nullable().optional(),
});

export const collaboratorFeeListReadArgsSchema = z.tuple([collaboratorFeeListQuerySchema.optional()]);
export const collaboratorFeeDetailReadArgsSchema = z.tuple([
  z.object({
    workspaceId: nonEmptyId,
    feeId: nonEmptyId,
  }),
]);
export const collaboratorFeeSummaryReadArgsSchema = z.tuple([
  z.object({
    workspaceId: nonEmptyId,
    projectId: nonEmptyId.nullable().optional(),
  }),
]);
export const collaboratorFeeSuggestionsReadArgsSchema = z.tuple([
  z.object({
    workspaceId: nonEmptyId,
    projectId: nonEmptyId.nullable().optional(),
    crewMemberId: nonEmptyId.nullable().optional(),
  }),
]);

export const financeOverviewQuerySchema = z
  .object({
    workspaceId: nonEmptyId.optional(),
    period: financeOverviewPeriodSchema,
    customStartDate: isoDateSchema.nullable().optional(),
    customEndDate: isoDateSchema.nullable().optional(),
  })
  .superRefine((value, context) => {
    if (value.period !== "custom") {
      return;
    }

    if (!value.customStartDate || !value.customEndDate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Custom finance overview periods require both start and end dates.",
        path: ["customStartDate"],
      });
      return;
    }

    if (value.customStartDate > value.customEndDate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Custom finance overview start date must be before or equal to the end date.",
        path: ["customStartDate"],
      });
    }
  });

export const financeOverviewReadArgsSchema = z.tuple([financeOverviewQuerySchema.optional()]);

export const rmaSnapshotReadArgsSchema = z.tuple([workspaceQuerySchema.optional()]);

export const catalogListQuerySchema = z.object({
  workspaceId: nonEmptyId.optional(),
  entityType: catalogEntityTypeSchema,
  search: boundedSearch.optional(),
  sortBy: catalogSortFieldSchema,
  sortDirection: sortDirectionSchema,
});

export const catalogListReadArgsSchema = z.tuple([catalogListQuerySchema.optional()]);

export const createProjectBlueprintReadArgsSchema = z.tuple([createProjectBlueprintSchema]);
