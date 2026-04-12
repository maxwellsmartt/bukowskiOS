import type { DatabaseSync } from "node:sqlite";

import type {
  AssetsOverviewSnapshot,
  AssetSummarySnapshot,
  AssetListQuery,
  AssetSortField,
  AssetDetailSnapshot,
  AssetLinkedIncidentRow,
  AssetListRow,
  AssetTimelineItem,
  CatalogListQuery,
  CatalogSortField,
  CatalogSnapshot,
  FinanceEntryListQuery,
  FinanceCostLinkRow,
  FinanceEntryRow,
  FinanceEntrySortField,
  FinanceOverviewSnapshot,
  GlobalSearchEntityType,
  GlobalSearchGroup,
  GlobalSearchQuery,
  GlobalSearchResult,
  IncidentListQuery,
  IncidentListRow,
  IncidentSortField,
  ListSortDirection,
  OverviewMetric,
  OverviewSnapshot,
  PackingSlipDetailSnapshot,
  PackingSlipItemRow,
  PackingSlipListQuery,
  PackingSlipRow,
  PackingSlipSortField,
  ProjectListQuery,
  ProjectCardRow,
  ProjectDetailAssetRow,
  ProjectDetailIncidentRow,
  ProjectDetailSnapshot,
  ProjectExposureRow,
  ProjectResponsibleRow,
  ProjectSortField,
  ProjectUnitCrewAssignmentRow,
  ProjectUnitRow,
  ScheduleTimelineRange,
  ScheduleTimelineScale,
  ScheduleTimelineSnapshot,
  ShellBootstrap,
  RmaCaseDetailSnapshot,
  RmaSnapshot,
} from "@contracts";

import { createCatalogReadService } from "./catalogReadService";
import { deriveProjectUnitStatus, resolveScheduleWindowLabel } from "./projectScheduling";

const workspaceId = "workspace-metadata";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "2-digit",
});

const eventTimeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

type CountRow = {
  count: number;
};

type AmountRow = {
  amount: number | null;
};

const formatCurrency = (amount: number | null | undefined) =>
  typeof amount === "number" ? currencyFormatter.format(amount) : "Pending";

const truncate = (value: string, max = 120) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value);
const interruptedConversationSummary = "This conversation was interrupted before the assistant finished responding.";

const resolvePreferredChannel = (email: string | null | undefined, phone: string | null | undefined) => {
  if ((email ?? "").trim()) {
    return "email";
  }

  if ((phone ?? "").trim()) {
    return "phone";
  }

  return "unreachable";
};

const parseJsonObject = (value: string | null | undefined) => {
  if (!value) {
    return null as Record<string, unknown> | null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

const deriveSystemIssueSeverity = (sourceType: "run" | "thread" | "provider" | "runtime", status: string) => {
  if (sourceType === "provider") {
    return status === "invalid_key" || status === "unavailable" ? "critical" : "medium";
  }

  if (sourceType === "runtime") {
    return status === "main" ? "critical" : "medium";
  }

  if (status === "provider_error" || status === "needs_configuration") {
    return "critical";
  }

  if (status === "tool_error" || status === "structured_error") {
    return "medium";
  }

  if (status === "interrupted") {
    return "low";
  }

  return "medium";
};

const buildIssueFingerprint = (sourceType: "run" | "thread" | "provider" | "runtime", status: string, title: string) =>
  `${sourceType}:${status}:${normalizeSearchText(title).slice(0, 42)}`;

const deriveSuggestedChecks = (input: {
  sourceType: "run" | "thread" | "provider" | "runtime";
  status: string;
  details?: Record<string, unknown> | null;
}) => {
  const checks = [] as string[];

  if (input.sourceType === "provider") {
    checks.push("Verify the provider key and Models health state.");
    checks.push("Retest the provider connection from Models.");
    return checks;
  }

  if (input.sourceType === "runtime") {
    checks.push("Inspect the runtime stack preview and renderer/main context payload.");
    checks.push("Replay the same UI flow and confirm whether the error reproduces.");
  }

  if (input.status === "tool_error") {
    checks.push("Review the tool arguments and the underlying read service response.");
  }

  if (input.status === "structured_error") {
    checks.push("Inspect the structured gateway output and parsing contract.");
  }

  if (input.status === "provider_error" || input.status === "needs_configuration") {
    checks.push("Check provider configuration, stored key, timeout and model assignment.");
  }

  const providerKey = typeof input.details?.provider_key === "string" ? input.details.provider_key : null;
  const targetAgent = typeof input.details?.target_agent === "string" ? input.details.target_agent : null;

  if (providerKey) {
    checks.push(`Review provider health for ${providerKey}.`);
  }

  if (targetAgent) {
    checks.push(`Confirm tool coverage and approval policy for ${targetAgent}.`);
  }

  if (!checks.length) {
    checks.push("Review the latest thread trace and related runs for a reproducible path.");
  }

  return checks;
};

const loadRunActivityTimeline = (db: DatabaseSync, runId: string, limit = 6) =>
  db
    .prepare(
      `
        SELECT
          title,
          body,
          tone,
          created_at
        FROM agent_activity_events
        WHERE workspace_id = ?
          AND run_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `,
    )
    .all(workspaceId, runId, limit) as Array<{
    title: string;
    body: string;
    tone: string;
    created_at: string;
  }>;

const loadThreadActivityTimeline = (db: DatabaseSync, threadId: string, limit = 8) =>
  db
    .prepare(
      `
        SELECT
          agent_activity_events.title,
          agent_activity_events.body,
          agent_activity_events.tone,
          agent_activity_events.created_at
        FROM agent_activity_events
        WHERE workspace_id = ?
          AND run_id IN (
            SELECT id
            FROM agent_runs
            WHERE thread_id = ?
          )
        ORDER BY agent_activity_events.created_at DESC
        LIMIT ?
      `,
    )
    .all(workspaceId, threadId, limit) as Array<{
    title: string;
    body: string;
    tone: string;
    created_at: string;
  }>;

const parseJsonStringArray = (value: string | null | undefined) => {
  if (!value) {
    return [] as string[];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
};

const normalizeSearchText = (value: string | null | undefined) =>
  (value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const tokenizeSearch = (value: string | null | undefined) =>
  normalizeSearchText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);

const matchesSearch = (query: string | undefined, values: Array<string | null | undefined>) => {
  const tokens = tokenizeSearch(query);

  if (!tokens.length) {
    return true;
  }

  const haystacks = values.map((value) => normalizeSearchText(value)).filter(Boolean);
  return tokens.every((token) => haystacks.some((value) => value.includes(token)));
};

const compareTextValue = (left: string | null | undefined, right: string | null | undefined, direction: ListSortDirection) => {
  const leftValue = normalizeSearchText(left) || "zzzzzz";
  const rightValue = normalizeSearchText(right) || "zzzzzz";
  const result = leftValue.localeCompare(rightValue, "en-US", { numeric: true, sensitivity: "base" });
  return direction === "desc" ? result * -1 : result;
};

const compareNumberValue = (left: number, right: number, direction: ListSortDirection) =>
  direction === "desc" ? right - left : left - right;

const compareNullableDateValue = (left: string | null, right: string | null, direction: ListSortDirection) => {
  if (!left && !right) {
    return 0;
  }

  if (!left) {
    return 1;
  }

  if (!right) {
    return -1;
  }

  return direction === "desc" ? right.localeCompare(left) : left.localeCompare(right);
};

const sortRows = <T>(rows: T[], comparator: (left: T, right: T) => number) => [...rows].sort(comparator);

const formatShortDate = (value: string | null) => {
  if (!value) {
    return "—";
  }

  return dateFormatter.format(new Date(value));
};

const isoDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "2-digit",
});

const formatDateOnlyLabel = (value: string | null) => {
  if (!value) {
    return "—";
  }

  return isoDateFormatter.format(new Date(`${value}T00:00:00.000Z`));
};

const todayDateOnly = () => new Date().toISOString().slice(0, 10);

const addDays = (date: string, offset: number) => {
  const nextDate = new Date(`${date}T00:00:00.000Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + offset);
  return nextDate.toISOString().slice(0, 10);
};

const startOfWeek = (date: string) => {
  const nextDate = new Date(`${date}T00:00:00.000Z`);
  const day = nextDate.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  nextDate.setUTCDate(nextDate.getUTCDate() + offset);
  return nextDate.toISOString().slice(0, 10);
};

const startOfMonth = (date: string) => {
  const nextDate = new Date(`${date}T00:00:00.000Z`);
  nextDate.setUTCDate(1);
  return nextDate.toISOString().slice(0, 10);
};

const resolveTimelineRangeLength = (range: ScheduleTimelineRange) => {
  if (range === "30d") {
    return 30;
  }

  if (range === "6m") {
    return 182;
  }

  return 90;
};

const sanitizeTimelineAnchorDate = (value?: string | null) =>
  value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : todayDateOnly();

const clampDate = (value: string, min: string, max: string) => {
  if (value < min) {
    return min;
  }

  if (value > max) {
    return max;
  }

  return value;
};

const resolveTimelineWindow = (range: ScheduleTimelineRange, scale: ScheduleTimelineScale, anchorDate?: string | null) => {
  const totalDays = resolveTimelineRangeLength(range);
  const safeAnchorDate = sanitizeTimelineAnchorDate(anchorDate);
  const lookbackDays = Math.max(1, Math.floor(totalDays * 0.2));
  const rawStart = addDays(safeAnchorDate, -lookbackDays);
  const alignedStart =
    scale === "month" ? startOfMonth(rawStart) : scale === "week" ? startOfWeek(rawStart) : rawStart;
  const start = alignedStart;
  const end = addDays(start, totalDays - 1);

  return {
    anchorDate: safeAnchorDate,
    start,
    end,
  };
};

const formatTimelineMonthLabel = (value: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short" }).format(new Date(`${value}T00:00:00.000Z`)).toUpperCase();

const buildTimelineMarkers = (
  rangeStart: string,
  rangeEnd: string,
  scale: ScheduleTimelineScale,
): ScheduleTimelineSnapshot["markers"] => {
  if (scale === "day") {
    return Array.from({ length: diffDaysInclusive(rangeStart, rangeEnd) + 1 }, (_, index) => {
      const markerDate = addDays(rangeStart, index);
      return {
        key: markerDate,
        label: new Intl.DateTimeFormat("en-US", { day: "numeric" }).format(new Date(`${markerDate}T00:00:00.000Z`)),
        startDate: markerDate,
        endDate: markerDate,
      };
    });
  }

  if (scale === "month") {
    const markers: ScheduleTimelineSnapshot["markers"] = [];
    let markerStart = startOfMonth(rangeStart);

    while (markerStart <= rangeEnd) {
      const markerEnd = addDays(startOfMonth(addDays(markerStart, 32)), -1);
      markers.push({
        key: markerStart,
        label: formatTimelineMonthLabel(markerStart),
        startDate: clampDate(markerStart, rangeStart, rangeEnd),
        endDate: clampDate(markerEnd, rangeStart, rangeEnd),
      });
      markerStart = startOfMonth(addDays(markerStart, 32));
    }

    return markers;
  }

  return Array.from({ length: Math.ceil((diffDaysInclusive(rangeStart, rangeEnd) + 1) / 7) })
    .map((_, index) => {
      const markerStart = addDays(rangeStart, index * 7);
      if (markerStart > rangeEnd) {
        return null;
      }

      const markerEnd = addDays(markerStart, 6) > rangeEnd ? rangeEnd : addDays(markerStart, 6);
      return {
        key: markerStart,
        label: formatDateOnlyLabel(markerStart),
        startDate: markerStart,
        endDate: markerEnd,
      };
    })
    .filter((marker): marker is ScheduleTimelineSnapshot["markers"][number] => Boolean(marker));
};

const compareDateOnly = (left: string | null, right: string | null) => {
  if (!left && !right) {
    return 0;
  }

  if (!left) {
    return 1;
  }

  if (!right) {
    return -1;
  }

  return left.localeCompare(right);
};

const diffDaysInclusive = (start: string, end: string) => {
  const startTime = new Date(`${start}T00:00:00.000Z`).getTime();
  const endTime = new Date(`${end}T00:00:00.000Z`).getTime();
  return Math.max(0, Math.floor((endTime - startTime) / (24 * 60 * 60 * 1000)));
};

const compareProjectStatus = (status: string) => {
  switch (status) {
    case "Active":
      return 0;
    case "Prep":
      return 1;
    case "Wrap":
      return 2;
    default:
      return 3;
  }
};

const formatTimelineTimestamp = (value: string) => {
  const eventDate = new Date(value);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  const sameDay =
    eventDate.getFullYear() === now.getFullYear() &&
    eventDate.getMonth() === now.getMonth() &&
    eventDate.getDate() === now.getDate();

  const isYesterday =
    eventDate.getFullYear() === yesterday.getFullYear() &&
    eventDate.getMonth() === yesterday.getMonth() &&
    eventDate.getDate() === yesterday.getDate();

  if (sameDay) {
    return `Today · ${eventTimeFormatter.format(eventDate)}`;
  }

  if (isYesterday) {
    return `Yesterday · ${eventTimeFormatter.format(eventDate)}`;
  }

  return `${dateFormatter.format(eventDate)} · ${eventTimeFormatter.format(eventDate)}`;
};

const mapAssetStatus = (operationalStatus: string, custodyStatus: string) => {
  if (operationalStatus === "maintenance") {
    return "Maintenance";
  }

  if (custodyStatus === "checked_out") {
    return "Checked out";
  }

  if (custodyStatus === "assigned") {
    return "Assigned";
  }

  return "Available";
};

const mapTrackingLabel = (value: string | null | undefined) => {
  switch (value) {
    case "serialized":
      return "Serialized";
    case "grouped":
      return "Grouped";
    default:
      return "Single";
  }
};

const mapEventTitle = (eventType: string) => {
  switch (eventType) {
    case "asset_created":
      return "Asset created";
    case "check_out":
      return "Checked out";
    case "check_in":
      return "Checked in";
    case "assigned":
      return "Assigned";
    case "moved":
      return "Moved";
    case "incident_reported":
      return "Incident reported";
    case "maintenance_started":
      return "Maintenance started";
    case "maintenance_completed":
      return "Maintenance completed";
    default:
      return "Status updated";
  }
};

const toIsoDate = (value?: string | null) => {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  return todayDateOnly();
};

const resolvePackingStatus = (storedStatus: string, dueDate: string | null, itemCount: number, returnedCount: number) => {
  if (itemCount > 0 && returnedCount >= itemCount) {
    return "Closed";
  }

  if (dueDate) {
    const dueTimestamp = new Date(dueDate).getTime();

    if (Number.isFinite(dueTimestamp) && dueTimestamp < Date.now() && returnedCount < itemCount) {
      return "Overdue";
    }
  }

  if (returnedCount > 0 && returnedCount < itemCount) {
    return "Partial return";
  }

  return storedStatus;
};

const defaultAssetListQuery: AssetListQuery = {
  scopeProjectId: null,
  search: "",
  sortBy: "name",
  sortDirection: "asc",
};

const defaultPackingListQuery: PackingSlipListQuery = {
  scopeProjectId: null,
  search: "",
  sortBy: "issuedDate",
  sortDirection: "desc",
};

const defaultIncidentListQuery: IncidentListQuery = {
  scopeProjectId: null,
  search: "",
  sortBy: "reportedAt",
  sortDirection: "desc",
};

const defaultProjectListQuery: ProjectListQuery = {
  search: "",
  sortBy: "name",
  sortDirection: "asc",
};

const defaultFinanceEntryListQuery: FinanceEntryListQuery = {
  search: "",
  sortBy: "date",
  sortDirection: "desc",
};

const defaultCatalogListQuery: CatalogListQuery = {
  entityType: "location",
  search: "",
  sortBy: "name",
  sortDirection: "asc",
};

const resolveAssetComparator = (
  sortBy: AssetSortField,
  direction: ListSortDirection,
): ((left: AssetListRow & { createdAt: string | null; updatedAt: string | null }, right: AssetListRow & { createdAt: string | null; updatedAt: string | null }) => number) =>
  (left, right) => {
    switch (sortBy) {
      case "code":
        return compareTextValue(left.code, right.code, direction);
      case "category":
        return compareTextValue(left.category, right.category, direction);
      case "status":
        return compareTextValue(left.status, right.status, direction);
      case "condition":
        return compareTextValue(left.condition, right.condition, direction);
      case "location":
        return compareTextValue(left.location, right.location, direction);
      case "project":
        return compareTextValue(left.project, right.project, direction);
      case "projectUnit":
        return compareTextValue(left.projectUnit, right.projectUnit, direction);
      case "responsible":
        return compareTextValue(left.responsible, right.responsible, direction);
      case "serialNumber":
        return compareTextValue(left.serialNumber, right.serialNumber, direction);
      case "qrCode":
        return compareTextValue(left.qrCode, right.qrCode, direction);
      case "incidentsOpen":
        return compareNumberValue(left.incidentsOpen, right.incidentsOpen, direction);
      case "createdAt":
        return compareNullableDateValue(left.createdAt, right.createdAt, direction);
      case "updatedAt":
        return compareNullableDateValue(left.updatedAt, right.updatedAt, direction);
      case "name":
      default:
        return compareTextValue(left.name, right.name, direction);
    }
  };

const resolvePackingComparator = (
  sortBy: PackingSlipSortField,
  direction: ListSortDirection,
): ((
  left: PackingSlipRow & { issueDateRaw: string; dueDateRaw: string | null },
  right: PackingSlipRow & { issueDateRaw: string; dueDateRaw: string | null },
) => number) => (left, right) => {
  switch (sortBy) {
    case "number":
      return compareTextValue(left.number, right.number, direction);
    case "project":
      return compareTextValue(left.project, right.project, direction);
    case "department":
      return compareTextValue(left.department, right.department, direction);
    case "responsible":
      return compareTextValue(left.responsible, right.responsible, direction);
    case "dueDate":
      return compareNullableDateValue(left.dueDateRaw, right.dueDateRaw, direction);
    case "itemCount":
      return compareNumberValue(left.itemCount, right.itemCount, direction);
    case "returnedCount":
      return compareNumberValue(left.returnedCount, right.returnedCount, direction);
    case "status":
      return compareTextValue(left.status, right.status, direction);
    case "issuedDate":
    default:
      return compareNullableDateValue(left.issueDateRaw, right.issueDateRaw, direction);
  }
};

const resolveIncidentComparator = (
  sortBy: IncidentSortField,
  direction: ListSortDirection,
): ((left: IncidentListRow & { reportedAt: string }, right: IncidentListRow & { reportedAt: string }) => number) => (left, right) => {
  switch (sortBy) {
    case "asset":
      return compareTextValue(left.asset, right.asset, direction);
    case "project":
      return compareTextValue(left.project, right.project, direction);
    case "responsible":
      return compareTextValue(left.responsible, right.responsible, direction);
    case "severity":
      return compareTextValue(left.severity, right.severity, direction);
    case "costEstimate":
      return compareTextValue(left.costEstimate, right.costEstimate, direction);
    case "status":
      return compareTextValue(left.status, right.status, direction);
    case "reportedAt":
      return compareNullableDateValue(left.reportedAt, right.reportedAt, direction);
    case "title":
    default:
      return compareTextValue(left.title, right.title, direction);
  }
};

const resolveProjectComparator = (
  sortBy: ProjectSortField,
  direction: ListSortDirection,
): ((
  left: ProjectCardRow & { createdAt: string | null; updatedAt: string | null; exposureValue: number },
  right: ProjectCardRow & { createdAt: string | null; updatedAt: string | null; exposureValue: number },
) => number) => (left, right) => {
  switch (sortBy) {
    case "code":
      return compareTextValue(left.code, right.code, direction);
    case "client":
      return compareTextValue(left.client, right.client, direction);
    case "status":
      return compareTextValue(left.status, right.status, direction);
    case "startDate":
      return compareNullableDateValue(left.startDate, right.startDate, direction);
    case "endDate":
      return compareNullableDateValue(left.endDate, right.endDate, direction);
    case "colorKey":
      return compareTextValue(left.colorKey, right.colorKey, direction);
    case "assetCount":
      return compareNumberValue(left.assetCount, right.assetCount, direction);
    case "incidentCount":
      return compareNumberValue(left.incidentCount, right.incidentCount, direction);
    case "activeUnitCount":
      return compareNumberValue(left.activeUnitCount, right.activeUnitCount, direction);
    case "exposure":
      return compareNumberValue(left.exposureValue, right.exposureValue, direction);
    case "createdAt":
      return compareNullableDateValue(left.createdAt, right.createdAt, direction);
    case "updatedAt":
      return compareNullableDateValue(left.updatedAt, right.updatedAt, direction);
    case "name":
    default:
      return compareTextValue(left.name, right.name, direction);
    }
  };

const resolveFinanceEntryComparator = (
  sortBy: FinanceEntrySortField,
  direction: ListSortDirection,
): ((left: FinanceEntryRow & { amountValue: number; dateValue: string }, right: FinanceEntryRow & { amountValue: number; dateValue: string }) => number) =>
  (left, right) => {
    switch (sortBy) {
      case "type":
        return compareTextValue(left.type, right.type, direction);
      case "category":
        return compareTextValue(left.category, right.category, direction);
      case "reference":
        return compareTextValue(left.reference, right.reference, direction);
      case "project":
        return compareTextValue(left.project, right.project, direction);
      case "amount":
        return compareNumberValue(left.amountValue, right.amountValue, direction);
      case "status":
        return compareTextValue(left.status, right.status, direction);
      case "date":
      default:
        return compareNullableDateValue(left.dateValue, right.dateValue, direction);
      }
  };

const globalSearchGroupLabels: Record<GlobalSearchEntityType, string> = {
  asset: "Assets",
  project: "Projects",
  project_unit: "Units",
  packing_slip: "Packing slips",
  incident: "Incidents",
};

const buildRecentEntityKey = (entityType: GlobalSearchEntityType, entityId: string) => `${entityType}:${entityId}`;

const matchesWordStart = (value: string, query: string) => value.split(" ").some((part) => part.startsWith(query));

const resolveSearchRank = (query: string, code: string | null | undefined, title: string | null | undefined) => {
  const normalizedQuery = normalizeSearchText(query);
  const normalizedCode = normalizeSearchText(code);
  const normalizedTitle = normalizeSearchText(title);

  if (!normalizedQuery) {
    return Number.POSITIVE_INFINITY;
  }

  if (normalizedCode && normalizedCode === normalizedQuery) {
    return 0;
  }

  if (normalizedTitle && normalizedTitle === normalizedQuery) {
    return 10;
  }

  if (normalizedCode && normalizedCode.startsWith(normalizedQuery)) {
    return 20;
  }

  if (normalizedTitle && normalizedTitle.startsWith(normalizedQuery)) {
    return 30;
  }

  if (normalizedCode && matchesWordStart(normalizedCode, normalizedQuery)) {
    return 40;
  }

  if (normalizedTitle && matchesWordStart(normalizedTitle, normalizedQuery)) {
    return 50;
  }

  if (normalizedCode && normalizedCode.includes(normalizedQuery)) {
    return 60;
  }

  if (normalizedTitle && normalizedTitle.includes(normalizedQuery)) {
    return 70;
  }

  return Number.POSITIVE_INFINITY;
};

export const createFoundationReadService = (db: DatabaseSync) => {
  const catalogReads = createCatalogReadService(db);

  return {
  getShellBootstrap(): ShellBootstrap {
    const workspace = db.prepare("SELECT name FROM workspaces WHERE is_active = 1 ORDER BY created_at LIMIT 1").get() as
      | { name: string }
      | undefined;

    const activeProject = db
      .prepare(
        `
          SELECT name
          FROM projects
          WHERE workspace_id = 'workspace-metadata'
          ORDER BY CASE status
            WHEN 'Active' THEN 0
            WHEN 'Prep' THEN 1
            ELSE 2
          END, name
          LIMIT 1
        `,
      )
      .get() as { name: string } | undefined;

    return {
      workspaceName: workspace?.name ?? "Metadata Cine",
      projectScope: activeProject ? `Global / ${activeProject.name}` : "Global",
      syncLabel: "Local-first",
    };
  },

  getGlobalSearch(query: GlobalSearchQuery): GlobalSearchGroup[] {
    const normalizedQuery = normalizeSearchText(query.query);

    if (!normalizedQuery) {
      return [];
    }

    const recentKeys = query.recentEntityKeys ?? [];
    const recentRank = new Map(recentKeys.map((key, index) => [key, index]));
    const limit = query.limit ?? 20;
    const perGroupLimit = Math.min(5, limit);

    const assets = db
      .prepare(
        `
          SELECT
            assets.id,
            assets.name,
            COALESCE(legacy_rentman_items.legacy_code, assets.internal_code) AS code,
            COALESCE(projects.name, '—') AS project_name
          FROM assets
          LEFT JOIN legacy_rentman_asset_links ON legacy_rentman_asset_links.asset_id = assets.id
          LEFT JOIN legacy_rentman_items ON legacy_rentman_items.id = legacy_rentman_asset_links.legacy_item_id
          LEFT JOIN asset_current_state ON asset_current_state.asset_id = assets.id
          LEFT JOIN projects ON projects.id = asset_current_state.current_project_id
          WHERE assets.is_active = 1
        `,
      )
      .all() as Array<{ id: string; name: string; code: string; project_name: string }>;

    const projects = db
      .prepare(
        `
          SELECT
            projects.id,
            projects.code,
            projects.name,
            COALESCE(clients.name, projects.client_name, '—') AS client_name
          FROM projects
          LEFT JOIN clients ON clients.id = projects.client_id
        `,
      )
      .all() as Array<{ id: string; code: string; name: string; client_name: string }>;

    const units = db
      .prepare(
        `
          SELECT
            project_units.id,
            project_units.code,
            project_units.name,
            projects.id AS project_id,
            projects.code AS project_code,
            projects.name AS project_name
          FROM project_units
          JOIN projects ON projects.id = project_units.project_id
        `,
      )
      .all() as Array<{
      id: string;
      code: string;
      name: string;
      project_id: string;
      project_code: string;
      project_name: string;
    }>;

    const packing = db
      .prepare(
        `
          SELECT
            packing_slips.id,
            projects.name AS project_name
          FROM packing_slips
          JOIN projects ON projects.id = packing_slips.project_id
        `,
      )
      .all() as Array<{ id: string; project_name: string }>;

    const incidents = db
      .prepare(
        `
          SELECT
            incidents.id,
            incidents.title,
            COALESCE(assets.internal_code, '—') AS asset_code,
            COALESCE(projects.name, '—') AS project_name
          FROM incidents
          LEFT JOIN assets ON assets.id = incidents.asset_id
          LEFT JOIN projects ON projects.id = incidents.project_id
        `,
      )
      .all() as Array<{ id: string; title: string; asset_code: string; project_name: string }>;

    const rankedResults: Array<GlobalSearchResult & { score: number; recentRank: number }> = [];

    assets.forEach((row) => {
      if (!matchesSearch(normalizedQuery, [row.code, row.name, row.project_name])) {
        return;
      }

      const score = resolveSearchRank(normalizedQuery, row.code, row.name);
      rankedResults.push({
        entityType: "asset",
        entityId: row.id,
        title: row.name,
        subtitle: `${row.code} · ${row.project_name}`,
        navigationPath: `/assets/${row.id}`,
        recent: recentRank.has(buildRecentEntityKey("asset", row.id)),
        score,
        recentRank: recentRank.get(buildRecentEntityKey("asset", row.id)) ?? Number.MAX_SAFE_INTEGER,
      });
    });

    projects.forEach((row) => {
      if (!matchesSearch(normalizedQuery, [row.code, row.name, row.client_name])) {
        return;
      }

      const score = resolveSearchRank(normalizedQuery, row.code, row.name);
      rankedResults.push({
        entityType: "project",
        entityId: row.id,
        title: row.name,
        subtitle: `${row.code} · ${row.client_name}`,
        navigationPath: `/projects/${row.id}/overview`,
        recent: recentRank.has(buildRecentEntityKey("project", row.id)),
        score,
        recentRank: recentRank.get(buildRecentEntityKey("project", row.id)) ?? Number.MAX_SAFE_INTEGER,
      });
    });

    units.forEach((row) => {
      if (!matchesSearch(normalizedQuery, [row.code, row.name, row.project_code, row.project_name])) {
        return;
      }

      const score = resolveSearchRank(normalizedQuery, row.code, row.name);
      rankedResults.push({
        entityType: "project_unit",
        entityId: row.id,
        title: `${row.project_code} · ${row.project_name}`,
        subtitle: `${row.code} · ${row.name}`,
        navigationPath: `/projects/${row.project_id}/info?unit=${row.id}`,
        recent: recentRank.has(buildRecentEntityKey("project_unit", row.id)),
        score,
        recentRank: recentRank.get(buildRecentEntityKey("project_unit", row.id)) ?? Number.MAX_SAFE_INTEGER,
      });
    });

    packing.forEach((row) => {
      const slipNumber = row.id.replace("packing-", "PS-");

      if (!matchesSearch(normalizedQuery, [slipNumber, row.project_name])) {
        return;
      }

      const score = resolveSearchRank(normalizedQuery, slipNumber, row.project_name);
      rankedResults.push({
        entityType: "packing_slip",
        entityId: row.id,
        title: slipNumber,
        subtitle: row.project_name,
        navigationPath: `/packing-slips?focus=${row.id}`,
        recent: recentRank.has(buildRecentEntityKey("packing_slip", row.id)),
        score,
        recentRank: recentRank.get(buildRecentEntityKey("packing_slip", row.id)) ?? Number.MAX_SAFE_INTEGER,
      });
    });

    incidents.forEach((row) => {
      if (!matchesSearch(normalizedQuery, [row.title, row.asset_code, row.project_name])) {
        return;
      }

      const score = resolveSearchRank(normalizedQuery, row.asset_code, row.title);
      rankedResults.push({
        entityType: "incident",
        entityId: row.id,
        title: row.title,
        subtitle: `${row.asset_code} · ${row.project_name}`,
        navigationPath: `/incidents?focus=${row.id}`,
        recent: recentRank.has(buildRecentEntityKey("incident", row.id)),
        score,
        recentRank: recentRank.get(buildRecentEntityKey("incident", row.id)) ?? Number.MAX_SAFE_INTEGER,
      });
    });

    const grouped = new Map<GlobalSearchEntityType, Array<GlobalSearchResult & { score: number; recentRank: number }>>();

    sortRows(rankedResults, (left, right) => {
      if (left.score !== right.score) {
        return left.score - right.score;
      }

      if (left.recentRank !== right.recentRank) {
        return left.recentRank - right.recentRank;
      }

      return compareTextValue(left.title, right.title, "asc");
    }).forEach((result) => {
      const current = grouped.get(result.entityType) ?? [];

      if (current.length < perGroupLimit) {
        current.push(result);
        grouped.set(result.entityType, current);
      }
    });

    const groups = Array.from(grouped.entries())
      .map(([entityType, results]) => ({
        entityType,
        label: globalSearchGroupLabels[entityType],
        results: results.slice(0, limit).map(({ score: _score, recentRank: _recentRank, ...result }) => result),
      }))
      .filter((group) => group.results.length);

    return groups;
  },

  getOverviewSnapshot(): OverviewSnapshot {
    const overdueReturns = db
      .prepare("SELECT COUNT(*) AS count FROM packing_slips WHERE status IN ('Partial return', 'Overdue')")
      .get() as CountRow;
    const activeIncidents = db
      .prepare("SELECT COUNT(*) AS count FROM incidents WHERE status IN ('Open', 'In review')")
      .get() as CountRow;
    const openPackingSlips = db
      .prepare("SELECT COUNT(*) AS count FROM packing_slips WHERE status IN ('Issued', 'Partial return', 'Overdue')")
      .get() as CountRow;
    const maintenanceWatch = db
      .prepare("SELECT COUNT(*) AS count FROM asset_current_state WHERE operational_status = 'maintenance'")
      .get() as CountRow;

    const recentMovements = db
      .prepare(
        `
          SELECT
            assets.name AS asset,
            assets.internal_code AS code,
            COALESCE(from_location.name, '—') AS from_location,
            COALESCE(to_location.name, location.name, '—') AS to_location,
            COALESCE(departments.name, users.full_name, 'Operations') AS actor,
            asset_events.event_timestamp AS event_timestamp
          FROM asset_events
          JOIN assets ON assets.id = asset_events.asset_id
          LEFT JOIN locations AS from_location ON from_location.id = asset_events.from_location_id
          LEFT JOIN locations AS to_location ON to_location.id = asset_events.to_location_id
          LEFT JOIN locations AS location ON location.id = asset_events.location_id
          LEFT JOIN departments ON departments.id = asset_events.department_id
          LEFT JOIN users ON users.id = asset_events.performed_by_user_id
          WHERE asset_events.event_type IN ('asset_created', 'check_out', 'assigned', 'moved', 'maintenance_started', 'check_in')
          ORDER BY asset_events.event_timestamp DESC
          LIMIT 3
        `,
      )
      .all() as Array<{
      asset: string;
      code: string;
      from_location: string;
      to_location: string;
      actor: string;
      event_timestamp: string;
    }>;

    return {
      cards: {
        overdueReturns: {
          label: "Overdue returns",
          value: String(overdueReturns.count),
          subtitle: "Slips nearing or past due return need review.",
          tone: "warning",
        },
        openPackingSlips: {
          label: "Open packing slips",
          value: String(openPackingSlips.count),
          subtitle: "Issued slips still active across warehouse and set.",
          tone: "warning",
        },
        activeIncidents: {
          label: "Active incidents",
          value: String(activeIncidents.count),
          subtitle: "Open issues with pending follow-up or missing estimates.",
          tone: "critical",
        },
        maintenanceWatch: {
          label: "Maintenance watch",
          value: String(maintenanceWatch.count),
          subtitle: "Assets flagged for bench review or spare-part follow-up.",
          tone: "success",
        },
      },
      recentMovements: recentMovements.map((row) => ({
        asset: row.asset,
        code: row.code,
        from: row.from_location,
        to: row.to_location,
        actor: row.actor,
        timestamp: eventTimeFormatter.format(new Date(row.event_timestamp)),
      })),
    };
  },

  getAssetSummary(): AssetSummarySnapshot {
    const totalAssets = db.prepare("SELECT COUNT(*) AS count FROM assets WHERE is_active = 1").get() as CountRow;
    const assignedAssets = db
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM asset_current_state
          WHERE custody_status IN ('checked_out', 'assigned')
        `,
      )
      .get() as CountRow;

    return {
      totalAssets: String(totalAssets.count),
      assignedAssets: String(assignedAssets.count),
    };
  },

  getAssetsOverview(): AssetsOverviewSnapshot {
    const overviewSnapshot = this.getOverviewSnapshot();
    const assetSummary = this.getAssetSummary();

    return {
      totalAssets: assetSummary.totalAssets,
      assignedAssets: assetSummary.assignedAssets,
      cards: overviewSnapshot.cards,
      recentMovements: overviewSnapshot.recentMovements,
    };
  },

  getRmaSnapshot(): RmaSnapshot {
    const maintenanceAssets = db
      .prepare(
        `
          SELECT
            assets.id,
            assets.name,
            COALESCE(assets.brand, '') AS brand,
            COALESCE(assets.model, '') AS model,
            COALESCE(assets.serial_number, '') AS serial_number,
            COALESCE(locations.name, '—') AS location,
            COALESCE((
              SELECT incidents.title
              FROM incidents
              WHERE incidents.asset_id = assets.id
                AND incidents.status IN ('Open', 'In review')
              ORDER BY incidents.reported_at DESC
              LIMIT 1
            ), 'Maintenance review pending summary.') AS latest_issue
          FROM asset_current_state
          JOIN assets ON assets.id = asset_current_state.asset_id
          LEFT JOIN locations ON locations.id = asset_current_state.current_location_id
          WHERE asset_current_state.operational_status = 'maintenance'
            AND assets.is_active = 1
          ORDER BY assets.name
        `,
      )
      .all() as Array<{
      id: string;
      name: string;
      brand: string;
      model: string;
      serial_number: string;
      location: string;
      latest_issue: string;
    }>;

    const rmaCases = db
      .prepare(
        `
          SELECT
            rma_cases.id,
            rma_cases.title,
            COALESCE(manufacturers.name, '—') AS manufacturer_name,
            COALESCE(rma_cases.support_email, COALESCE(manufacturers.support_email, ''), '') AS support_email,
            rma_cases.status,
            rma_cases.updated_at,
            COALESCE((
              SELECT COUNT(*)
              FROM rma_case_assets
              WHERE rma_case_assets.rma_case_id = rma_cases.id
            ), 0) AS asset_count
          FROM rma_cases
          LEFT JOIN manufacturers ON manufacturers.id = rma_cases.manufacturer_id
          WHERE rma_cases.workspace_id = ?
          ORDER BY rma_cases.updated_at DESC, rma_cases.title
        `,
      )
      .all(workspaceId) as Array<{
      id: string;
      title: string;
      manufacturer_name: string;
      support_email: string;
      status: "Draft" | "Ready" | "Sent" | "Closed";
      updated_at: string;
      asset_count: number;
    }>;

    return {
      cases: rmaCases.map((row) => ({
        id: row.id,
        title: row.title,
        manufacturerName: row.manufacturer_name,
        supportEmail: row.support_email,
        status: row.status,
        assetCount: row.asset_count,
        updatedAtLabel: formatTimelineTimestamp(row.updated_at),
      })),
      maintenanceAssets: maintenanceAssets.map((row) => ({
        id: row.id,
        name: row.name,
        brand: row.brand,
        model: row.model,
        serialNumber: row.serial_number,
        location: row.location,
        latestIssue: row.latest_issue,
      })),
      manufacturers: catalogReads.getSnapshot().manufacturers,
    };
  },

  getRmaCaseDetail(rmaCaseId: string): RmaCaseDetailSnapshot {
    const caseRecord = db
      .prepare(
        `
          SELECT
            rma_cases.id,
            rma_cases.manufacturer_id,
            rma_cases.title,
            COALESCE(manufacturers.name, '—') AS manufacturer_name,
            COALESCE(manufacturers.contact_name, '') AS contact_name,
            COALESCE(rma_cases.support_email, COALESCE(manufacturers.support_email, ''), '') AS support_email,
            COALESCE(manufacturers.phone, '') AS phone,
            rma_cases.problem_summary,
            COALESCE(rma_cases.notes, '') AS notes,
            rma_cases.status,
            rma_cases.created_at,
            rma_cases.updated_at
          FROM rma_cases
          LEFT JOIN manufacturers ON manufacturers.id = rma_cases.manufacturer_id
          WHERE rma_cases.id = ?
          LIMIT 1
        `,
      )
      .get(rmaCaseId) as {
      id: string;
      manufacturer_id: string;
      title: string;
      manufacturer_name: string;
      contact_name: string;
      support_email: string;
      phone: string;
      problem_summary: string;
      notes: string;
      status: "Draft" | "Ready" | "Sent" | "Closed";
      created_at: string;
      updated_at: string;
    } | undefined;

    if (!caseRecord) {
      return {
        caseRecord: null,
        assets: [],
      };
    }

    const assets = db
      .prepare(
        `
          SELECT
            rma_case_assets.asset_id,
            assets.name AS asset_name,
            COALESCE(assets.brand, '') AS brand,
            COALESCE(assets.model, '') AS model,
            COALESCE(assets.serial_number, '') AS serial_number,
            COALESCE(rma_case_assets.equipment_year, '') AS equipment_year,
            rma_case_assets.issue_summary
          FROM rma_case_assets
          JOIN assets ON assets.id = rma_case_assets.asset_id
          WHERE rma_case_assets.rma_case_id = ?
          ORDER BY assets.name
        `,
      )
      .all(rmaCaseId) as Array<{
      asset_id: string;
      asset_name: string;
      brand: string;
      model: string;
      serial_number: string;
      equipment_year: string;
      issue_summary: string;
    }>;

    return {
      caseRecord: {
        id: caseRecord.id,
        manufacturerId: caseRecord.manufacturer_id,
        title: caseRecord.title,
        manufacturerName: caseRecord.manufacturer_name,
        contactName: caseRecord.contact_name,
        supportEmail: caseRecord.support_email,
        phone: caseRecord.phone,
        problemSummary: caseRecord.problem_summary,
        notes: caseRecord.notes,
        status: caseRecord.status,
        createdAtLabel: formatTimelineTimestamp(caseRecord.created_at),
        updatedAtLabel: formatTimelineTimestamp(caseRecord.updated_at),
      },
      assets: assets.map((row) => ({
        assetId: row.asset_id,
        assetName: row.asset_name,
        brand: row.brand,
        model: row.model,
        serialNumber: row.serial_number,
        equipmentYear: row.equipment_year,
        issueSummary: row.issue_summary,
      })),
    };
  },

  getScheduleTimeline(range: ScheduleTimelineRange, scale: ScheduleTimelineScale, anchorDate?: string): ScheduleTimelineSnapshot {
    const window = resolveTimelineWindow(range, scale, anchorDate);
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
        units: ScheduleTimelineSnapshot["projects"][number]["units"];
      }
    >();

    rows.forEach((row) => {
      const projectEntry =
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
          units: [],
        };

      if (!projectMap.has(row.project_id)) {
        projectMap.set(row.project_id, projectEntry);
      }

      if (row.unit_id) {
        const resolvedStatus = deriveProjectUnitStatus(
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
        });
      }
    });

    const markers = buildTimelineMarkers(window.start, window.end, scale);

    const scheduledProjects: ScheduleTimelineSnapshot["projects"] = [];
    const unscheduled: ScheduleTimelineSnapshot["unscheduled"] = [];

    projectMap.forEach((project) => {
      project.units.sort((left, right) => {
        const sortOrderDelta = left.sortOrder - right.sortOrder;
        if (sortOrderDelta !== 0) {
          return sortOrderDelta;
        }

        const dateDelta = compareDateOnly(left.startDate, right.startDate);
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
      const statusDelta = compareProjectStatus(left.status) - compareProjectStatus(right.status);
      if (statusDelta !== 0) {
        return statusDelta;
      }

      const dateDelta = compareDateOnly(left.startDate, right.startDate);
      if (dateDelta !== 0) {
        return dateDelta;
      }

      return left.code.localeCompare(right.code);
    });

    unscheduled.sort((left, right) => left.code.localeCompare(right.code));

    return {
      range,
      scale,
      anchorDate: window.anchorDate,
      rangeStart: window.start,
      rangeEnd: window.end,
      markers,
      projects: scheduledProjects,
      unscheduled,
    };
  },

  getAssets(query: AssetListQuery = defaultAssetListQuery): AssetListRow[] {
    const rows = db
      .prepare(
        `
          SELECT
            assets.id,
            assets.name,
            COALESCE(legacy_rentman_items.legacy_code, assets.internal_code) AS code,
            asset_categories.name AS category,
            COALESCE(legacy_rentman_items.current_quantity, 1) AS quantity,
            COALESCE(legacy_rentman_asset_links.import_strategy, 'single') AS tracking,
            asset_current_state.operational_status,
            asset_current_state.custody_status,
            asset_current_state.condition_status,
            COALESCE(locations.name, '—') AS location,
            asset_current_state.current_project_id AS project_id,
            COALESCE(projects.name, '—') AS project,
            asset_current_state.project_unit_id AS project_unit_id,
            COALESCE(project_units.name, '—') AS project_unit,
            COALESCE(users.full_name, '—') AS responsible,
            COALESCE(legacy_rentman_items.serial_number, assets.serial_number, '—') AS serial_number,
            COALESCE(legacy_rentman_items.qr_code_value, assets.qr_code_value, '—') AS qr_code_value,
            COALESCE(legacy_rentman_items.warehouse_slot, '—') AS warehouse_slot,
            COALESCE(legacy_rentman_items.folder_path, '—') AS folder_path,
            CASE legacy_rentman_items.has_accessories
              WHEN 1 THEN 'Yes'
              WHEN 0 THEN 'No'
              ELSE 'Unknown'
            END AS has_accessories,
            COALESCE(legacy_rentman_imports.source_label, 'Operational registry') AS source_label,
            assets.created_at,
            assets.updated_at,
            (
              SELECT COUNT(*)
              FROM incidents
              WHERE incidents.asset_id = assets.id
                AND incidents.status IN ('Open', 'In review')
            ) AS incidents_open
          FROM assets
          JOIN asset_categories ON asset_categories.id = assets.category_id
          JOIN asset_current_state ON asset_current_state.asset_id = assets.id
          LEFT JOIN legacy_rentman_asset_links ON legacy_rentman_asset_links.asset_id = assets.id
          LEFT JOIN legacy_rentman_items ON legacy_rentman_items.id = legacy_rentman_asset_links.legacy_item_id
          LEFT JOIN legacy_rentman_imports ON legacy_rentman_imports.id = legacy_rentman_items.import_id
          LEFT JOIN locations ON locations.id = asset_current_state.current_location_id
          LEFT JOIN projects ON projects.id = asset_current_state.current_project_id
          LEFT JOIN project_units ON project_units.id = asset_current_state.project_unit_id
          LEFT JOIN users ON users.id = asset_current_state.current_responsible_user_id
          WHERE assets.is_active = 1
        `,
      )
      .all() as Array<{
      id: string;
      name: string;
      code: string;
      category: string;
      quantity: number;
      tracking: string;
      operational_status: string;
      custody_status: string;
      condition_status: string;
      location: string;
      project_id: string | null;
      project: string;
      project_unit_id: string | null;
      project_unit: string;
      responsible: string;
      serial_number: string;
      qr_code_value: string;
      warehouse_slot: string;
      folder_path: string;
      has_accessories: string;
      source_label: string;
      created_at: string | null;
      updated_at: string | null;
      incidents_open: number;
    }>;

    const scopedRows = rows
      .map((row) => ({
        id: row.id,
        name: row.name,
        code: row.code,
        category: row.category,
        quantity: row.quantity,
        tracking: mapTrackingLabel(row.tracking),
        status: mapAssetStatus(row.operational_status, row.custody_status),
        condition: row.condition_status,
        custody: row.custody_status,
        location: row.location,
        projectId: row.project_id,
        project: row.project,
        projectUnitId: row.project_unit_id,
        projectUnit: row.project_unit,
        responsible: row.responsible,
        serialNumber: row.serial_number,
        qrCode: row.qr_code_value,
        warehouseSlot: row.warehouse_slot,
        folderPath: row.folder_path,
        hasAccessories: row.has_accessories,
        source: row.source_label,
        incidentsOpen: row.incidents_open,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }))
      .filter((row) => !query.scopeProjectId || row.projectId === query.scopeProjectId)
      .filter((row) =>
        matchesSearch(query.search, [
          row.name,
          row.code,
          row.category,
          row.location,
          row.project,
          row.projectUnit,
          row.responsible,
          row.serialNumber,
          row.qrCode,
        ]),
      );

    return sortRows(
      scopedRows,
      resolveAssetComparator(query.sortBy ?? defaultAssetListQuery.sortBy, query.sortDirection ?? defaultAssetListQuery.sortDirection),
    ).map(({ createdAt: _createdAt, updatedAt: _updatedAt, ...row }) => row);
  },

  getAssetDetail(assetId: string): AssetDetailSnapshot {
    const asset = db
      .prepare(
        `
          SELECT
            assets.id,
            assets.name,
            COALESCE(legacy_rentman_items.legacy_code, assets.internal_code) AS code,
            assets.internal_code,
            assets.category_id,
            COALESCE(asset_categories.name, '—') AS category_name,
            assets.brand,
            assets.model,
            assets.serial_number,
            assets.description,
            assets.replacement_value,
            assets.default_location_id,
            assets.notes,
            assets.ownership_type,
            assets.is_active,
            asset_current_state.condition_status,
            asset_current_state.custody_status,
            asset_current_state.operational_status,
            COALESCE(legacy_rentman_items.current_quantity, 1) AS quantity,
            COALESCE(legacy_rentman_asset_links.import_strategy, 'single') AS tracking,
            COALESCE(locations.name, '—') AS location,
            COALESCE(projects.name, '—') AS project,
            COALESCE(users.full_name, '—') AS responsible,
            COALESCE(legacy_rentman_imports.source_label, 'Operational registry') AS source_label,
            COALESCE(legacy_rentman_items.qr_code_value, assets.qr_code_value, '—') AS qr_code_value,
            COALESCE(legacy_rentman_items.warehouse_slot, '—') AS warehouse_slot,
            COALESCE(legacy_rentman_items.folder_path, '—') AS folder_path,
            CASE legacy_rentman_items.has_accessories
              WHEN 1 THEN 'Yes'
              WHEN 0 THEN 'No'
              ELSE 'Unknown'
            END AS has_accessories
          FROM assets
          JOIN asset_current_state ON asset_current_state.asset_id = assets.id
          LEFT JOIN asset_categories ON asset_categories.id = assets.category_id
          LEFT JOIN legacy_rentman_asset_links ON legacy_rentman_asset_links.asset_id = assets.id
          LEFT JOIN legacy_rentman_items ON legacy_rentman_items.id = legacy_rentman_asset_links.legacy_item_id
          LEFT JOIN legacy_rentman_imports ON legacy_rentman_imports.id = legacy_rentman_items.import_id
          LEFT JOIN locations ON locations.id = asset_current_state.current_location_id
          LEFT JOIN projects ON projects.id = asset_current_state.current_project_id
          LEFT JOIN users ON users.id = asset_current_state.current_responsible_user_id
          WHERE assets.id = ?
          LIMIT 1
        `,
      )
      .get(assetId) as
      | {
          id: string;
          name: string;
          code: string;
          internal_code: string;
          category_id: string;
          category_name: string;
          brand: string | null;
          model: string | null;
          serial_number: string | null;
          description: string | null;
          replacement_value: number | null;
          default_location_id: string | null;
          notes: string | null;
          ownership_type: string | null;
          is_active: number;
          condition_status: string;
          custody_status: string;
          operational_status: string;
          quantity: number;
          tracking: string;
          location: string;
          project: string;
          responsible: string;
          source_label: string;
          qr_code_value: string;
          warehouse_slot: string;
          folder_path: string;
          has_accessories: string;
        }
      | undefined;

    if (!asset) {
      return {
        asset: null,
        legacy: null,
        timeline: [],
        linkedIncidents: [],
        editor: null,
        scannableCodes: [],
      };
    }

    const timelineRows = db
      .prepare(
        `
          SELECT event_type, event_timestamp, notes
          FROM asset_events
          WHERE asset_id = ?
          ORDER BY event_timestamp DESC
          LIMIT 6
        `,
      )
      .all(assetId) as Array<{
      event_type: string;
      event_timestamp: string;
      notes: string | null;
    }>;

    const linkedIncidents = db
      .prepare(
        `
          SELECT
            incidents.id,
            title,
            COALESCE(projects.name, '—') AS project,
            cost_estimate,
            severity
          FROM incidents
          LEFT JOIN projects ON projects.id = incidents.project_id
          WHERE asset_id = ?
          ORDER BY reported_at DESC
          LIMIT 3
        `,
      )
      .all(assetId) as Array<{
      id: string;
      title: string;
      project: string;
      cost_estimate: number | null;
      severity: string;
    }>;

    const scannableCodes = db
      .prepare(
        `
          SELECT id, symbology, code_value, is_primary
          FROM scannable_codes
          WHERE entity_type = 'asset'
            AND entity_id = ?
          ORDER BY is_primary DESC, created_at ASC
        `,
      )
      .all(assetId) as Array<{
      id: string;
      symbology: string;
      code_value: string;
      is_primary: number;
    }>;

    const primaryCodeValue = scannableCodes.find((row) => row.is_primary)?.code_value ?? asset.qr_code_value;

    const timeline: AssetTimelineItem[] = timelineRows.map((row) => ({
      timestamp: formatTimelineTimestamp(row.event_timestamp),
      title: mapEventTitle(row.event_type),
      body: row.notes ?? "Operational event recorded in the asset timeline.",
    }));

    const incidentRows: AssetLinkedIncidentRow[] = linkedIncidents.map((row) => ({
      id: row.id,
      title: row.title,
      project: row.project,
      costEstimate: formatCurrency(row.cost_estimate),
      severity: row.severity,
    }));

    return {
      asset: {
        id: asset.id,
        name: asset.name,
        code: asset.code,
        status: mapAssetStatus(asset.operational_status, asset.custody_status),
        quantity: asset.quantity,
        tracking: mapTrackingLabel(asset.tracking),
        location: asset.location,
        project: asset.project,
        responsible: asset.responsible,
        replacementValue: formatCurrency(asset.replacement_value),
        condition: asset.condition_status,
        custody: asset.custody_status,
      },
      legacy: {
        source: asset.source_label,
        legacyCode: asset.code || "—",
        qrCode: asset.qr_code_value,
        warehouseSlot: asset.warehouse_slot,
        folderPath: asset.folder_path,
        hasAccessories: asset.has_accessories,
      },
      timeline,
      linkedIncidents: incidentRows,
      editor: {
        id: asset.id,
        name: asset.name,
        internalCode: asset.internal_code,
        categoryId: asset.category_id,
        brand: asset.brand ?? "",
        model: asset.model ?? "",
        serialNumber: asset.serial_number ?? "",
        description: asset.description ?? "",
        defaultLocationId: asset.default_location_id,
        conditionStatus: asset.condition_status,
        notes: asset.notes ?? "",
        replacementValue: asset.replacement_value,
        ownershipType: asset.ownership_type ?? "owned",
        isActive: Boolean(asset.is_active),
        qrCodeValue: asset.qr_code_value === "—" ? "" : asset.qr_code_value,
        primaryCodeValue: primaryCodeValue ?? "",
      },
      scannableCodes: scannableCodes.map((row) => ({
        id: row.id,
        symbology: row.symbology,
        codeValue: row.code_value,
        isPrimary: Boolean(row.is_primary),
      })),
    };
  },

  getPackingSlips(query: PackingSlipListQuery = defaultPackingListQuery): PackingSlipRow[] {
    const rows = db
      .prepare(
        `
          SELECT
            packing_slips.id,
            packing_slips.status,
            packing_slips.issue_date,
            packing_slips.return_due_date,
            packing_slips.project_id,
            projects.name AS project,
            COALESCE(departments.name, '—') AS department,
            COALESCE(users.full_name, '—') AS responsible,
            COUNT(packing_slip_items.id) AS item_count,
            SUM(CASE WHEN packing_slip_items.returned_at IS NOT NULL THEN 1 ELSE 0 END) AS returned_count
          FROM packing_slips
          JOIN projects ON projects.id = packing_slips.project_id
          LEFT JOIN departments ON departments.id = packing_slips.department_id
          LEFT JOIN users ON users.id = packing_slips.responsible_user_id
          LEFT JOIN packing_slip_items ON packing_slip_items.packing_slip_id = packing_slips.id
          GROUP BY
            packing_slips.id,
            packing_slips.status,
            packing_slips.issue_date,
            packing_slips.return_due_date,
            packing_slips.project_id,
            projects.name,
            departments.name,
            users.full_name
        `,
      )
      .all() as Array<{
      id: string;
      status: string;
      issue_date: string;
      return_due_date: string | null;
      project_id: string;
      project: string;
      department: string;
      responsible: string;
      item_count: number;
      returned_count: number | null;
    }>;

    const mappedRows = rows
      .map((row) => ({
        id: row.id,
        number: row.id.replace("packing-", "PS-"),
        projectId: row.project_id,
        project: row.project,
        department: row.department,
        responsible: row.responsible,
        issuedDate: formatShortDate(row.issue_date),
        dueDate: formatShortDate(row.return_due_date),
        itemCount: row.item_count,
        returnedCount: row.returned_count ?? 0,
        status: resolvePackingStatus(row.status, row.return_due_date, row.item_count, row.returned_count ?? 0),
        issueDateRaw: row.issue_date,
        dueDateRaw: row.return_due_date,
      }))
      .filter((row) => !query.scopeProjectId || row.projectId === query.scopeProjectId)
      .filter((row) => matchesSearch(query.search, [row.number, row.project, row.department, row.responsible, row.status]));

    return sortRows(
      mappedRows,
      resolvePackingComparator(query.sortBy ?? defaultPackingListQuery.sortBy, query.sortDirection ?? defaultPackingListQuery.sortDirection),
    ).map(({ issueDateRaw: _issueDateRaw, dueDateRaw: _dueDateRaw, ...row }) => row);
  },

  getPackingSlipDetail(packingSlipId: string): PackingSlipDetailSnapshot {
    const slip = db
      .prepare(
        `
          SELECT
            packing_slips.id,
            packing_slips.status,
            packing_slips.issue_date,
            packing_slips.return_due_date,
            COALESCE(packing_slips.notes, 'No operational notes yet.') AS notes,
            projects.name AS project,
            COALESCE(departments.name, '—') AS department,
            COALESCE(responsible.full_name, '—') AS responsible,
            COALESCE(prepared.full_name, '—') AS prepared_by,
            COALESCE((
              SELECT code_value
              FROM scannable_codes
              WHERE entity_type = 'packing_slip'
                AND entity_id = packing_slips.id
                AND is_primary = 1
              LIMIT 1
            ), packing_slips.id) AS primary_code_value,
            COUNT(packing_slip_items.id) AS item_count,
            SUM(CASE WHEN packing_slip_items.returned_at IS NOT NULL THEN 1 ELSE 0 END) AS returned_count
          FROM packing_slips
          JOIN projects ON projects.id = packing_slips.project_id
          LEFT JOIN departments ON departments.id = packing_slips.department_id
          LEFT JOIN users AS responsible ON responsible.id = packing_slips.responsible_user_id
          LEFT JOIN users AS prepared ON prepared.id = packing_slips.prepared_by_user_id
          LEFT JOIN packing_slip_items ON packing_slip_items.packing_slip_id = packing_slips.id
          WHERE packing_slips.id = ?
          GROUP BY
            packing_slips.id,
            packing_slips.status,
            packing_slips.issue_date,
            packing_slips.return_due_date,
            packing_slips.notes,
            projects.name,
            departments.name,
            responsible.full_name,
            prepared.full_name
          LIMIT 1
        `,
      )
      .get(packingSlipId) as
      | {
          id: string;
          status: string;
          issue_date: string;
          return_due_date: string | null;
          notes: string;
          project: string;
          department: string;
          responsible: string;
          prepared_by: string;
          primary_code_value: string;
          item_count: number;
          returned_count: number | null;
        }
      | undefined;

    if (!slip) {
      return {
        slip: null,
        items: [],
      };
    }

    const items = db
      .prepare(
        `
          SELECT
            packing_slip_items.id,
            assets.id AS asset_id,
            assets.name AS asset_name,
            COALESCE(legacy_rentman_items.legacy_code, assets.internal_code) AS code,
            packing_slip_items.quantity,
            COALESCE(packing_slip_items.condition_out, '—') AS condition_out,
            COALESCE(packing_slip_items.condition_in, '—') AS condition_in,
            packing_slip_items.returned_at,
            COALESCE(locations.name, '—') AS location,
            COALESCE(users.full_name, '—') AS responsible
          FROM packing_slip_items
          JOIN assets ON assets.id = packing_slip_items.asset_id
          JOIN asset_current_state ON asset_current_state.asset_id = assets.id
          LEFT JOIN legacy_rentman_asset_links ON legacy_rentman_asset_links.asset_id = assets.id
          LEFT JOIN legacy_rentman_items ON legacy_rentman_items.id = legacy_rentman_asset_links.legacy_item_id
          LEFT JOIN locations ON locations.id = asset_current_state.current_location_id
          LEFT JOIN users ON users.id = asset_current_state.current_responsible_user_id
          WHERE packing_slip_items.packing_slip_id = ?
          ORDER BY assets.name
        `,
      )
      .all(packingSlipId) as Array<{
      id: string;
      asset_id: string;
      asset_name: string;
      code: string;
      quantity: number;
      condition_out: string;
      condition_in: string;
      returned_at: string | null;
      location: string;
      responsible: string;
    }>;

    const returnedCount = slip.returned_count ?? 0;
    const itemRows: PackingSlipItemRow[] = items.map((row) => ({
      id: row.id,
      assetId: row.asset_id,
      asset: row.asset_name,
      code: row.code,
      quantity: row.quantity,
      conditionOut: row.condition_out,
      conditionIn: row.condition_in,
      returnedAt: row.returned_at ? formatTimelineTimestamp(row.returned_at) : "Pending return",
      status: row.returned_at ? "Returned" : "Out",
      location: row.location,
      responsible: row.responsible,
    }));

    return {
      slip: {
        id: slip.id,
        number: slip.id.replace("packing-", "PS-"),
        project: slip.project,
        department: slip.department,
        responsible: slip.responsible,
        preparedBy: slip.prepared_by,
        issueDate: formatShortDate(slip.issue_date),
        dueDate: formatShortDate(slip.return_due_date),
        status: resolvePackingStatus(slip.status, slip.return_due_date, slip.item_count, returnedCount),
        notes: slip.notes,
        itemCount: slip.item_count,
        returnedCount,
        pendingCount: Math.max(0, slip.item_count - returnedCount),
        primaryCodeValue: slip.primary_code_value,
      },
      items: itemRows,
    };
  },

  getIncidents(query: IncidentListQuery = defaultIncidentListQuery): IncidentListRow[] {
    const rows = db
      .prepare(
        `
          SELECT
            incidents.id,
            incidents.title,
            COALESCE(assets.internal_code, '—') AS asset_code,
            incidents.project_id,
            COALESCE(projects.name, '—') AS project,
            COALESCE(users.full_name, '—') AS responsible,
            incidents.severity,
            incidents.cost_estimate,
            incidents.status,
            incidents.reported_at
          FROM incidents
          LEFT JOIN assets ON assets.id = incidents.asset_id
          LEFT JOIN projects ON projects.id = incidents.project_id
          LEFT JOIN users ON users.id = incidents.responsible_user_id
        `,
      )
      .all() as Array<{
      id: string;
      title: string;
      asset_code: string;
      project_id: string | null;
      project: string;
      responsible: string;
      severity: string;
      cost_estimate: number | null;
      status: string;
      reported_at: string;
    }>;

    const mappedRows = rows
      .map((row) => ({
        id: row.id,
        title: row.title,
        asset: row.asset_code,
        projectId: row.project_id,
        project: row.project,
        responsible: row.responsible,
        severity: row.severity,
        costEstimate: formatCurrency(row.cost_estimate),
        status: row.status,
        reportedAt: row.reported_at,
      }))
      .filter((row) => !query.scopeProjectId || row.projectId === query.scopeProjectId)
      .filter((row) =>
        matchesSearch(query.search, [row.title, row.asset, row.project, row.responsible, row.severity, row.status]),
      );

    return sortRows(
      mappedRows,
      resolveIncidentComparator(query.sortBy ?? defaultIncidentListQuery.sortBy, query.sortDirection ?? defaultIncidentListQuery.sortDirection),
    ).map(({ reportedAt: _reportedAt, ...row }) => row);
  },

  getProjects(query: ProjectListQuery = defaultProjectListQuery): ProjectCardRow[] {
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
        exposure: formatCurrency(row.exposure),
        assetCount: row.asset_count,
        incidentCount: row.incident_count,
        activeUnitCount: row.active_unit_count,
        description: row.description,
        exposureValue: row.exposure,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }))
      .filter((row) =>
        matchesSearch(query.search, [row.code, row.name, row.client, row.status, row.departments, row.description]),
      );

    return sortRows(
      mappedRows,
      resolveProjectComparator(query.sortBy ?? defaultProjectListQuery.sortBy, query.sortDirection ?? defaultProjectListQuery.sortDirection),
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
          totalEntries: formatCurrency(0),
          reserve: formatCurrency(0),
          exposure: formatCurrency(0),
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

    const detailMetrics: OverviewMetric[] = [
      { label: "Assigned assets", value: String(project.asset_count), tone: "info" },
      { label: "Open incidents", value: String(incidents.filter((row) => row.status !== "Closed").length), tone: "critical" },
      { label: "Incident exposure", value: formatCurrency(project.exposure), tone: "warning" },
      { label: "Replacement at risk", value: formatCurrency(project.replacement_at_risk), tone: "neutral" },
    ];

    const assetRows: ProjectDetailAssetRow[] = assets.map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code,
      status: mapAssetStatus(row.operational_status, row.custody_status),
      location: row.location,
      responsible: row.responsible,
      condition: row.condition_status,
      replacementValue: formatCurrency(row.replacement_value),
      projectUnitId: row.project_unit_id,
      projectUnit: row.project_unit,
    }));

    const incidentRows: ProjectDetailIncidentRow[] = incidents.map((row) => ({
      id: row.id,
      title: row.title,
      asset: row.asset_code,
      responsible: row.responsible,
      severity: row.severity,
      costEstimate: formatCurrency(row.cost_estimate),
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
      const derived = deriveProjectUnitStatus(row.start_date, row.end_date, row.status, row.status_source);
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
        exposure: formatCurrency(project.exposure),
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
        windowLabel: resolveScheduleWindowLabel(project.start_date, project.end_date),
      },
      units,
      timelineSummary,
      metrics: detailMetrics,
      assets: assetRows,
      incidents: incidentRows,
      responsibles: responsibleRows,
      budget: {
        totalEntries: formatCurrency(budgetRow.total_entries),
        reserve: formatCurrency(budgetRow.reserve_amount),
        exposure: formatCurrency(project.exposure),
        status: hasBudgetEntries ? "Finance hooks linked" : "No finance entries yet",
        note: hasBudgetEntries
          ? `Committed foundation entries: ${formatCurrency(budgetRow.committed_amount)}.`
          : "This project is ready for budget, reserve and actual tracking once Finance flows are expanded.",
      },
    };
  },

  getCatalogSnapshot(query: CatalogListQuery = defaultCatalogListQuery): CatalogSnapshot {
    const snapshot = catalogReads.getSnapshot();

    const sortCatalogRows = <T extends Record<string, unknown>>(rows: T[]) =>
      sortRows(rows, (left, right) => {
        const leftStatus = "isActive" in left ? ((left.isActive as boolean) ? "active" : "inactive") : "";
        const rightStatus = "isActive" in right ? ((right.isActive as boolean) ? "active" : "inactive") : "";

        switch (query.sortBy) {
          case "code":
            return compareTextValue(String(left.code ?? ""), String(right.code ?? ""), query.sortDirection);
          case "fullName":
            return compareTextValue(String(left.fullName ?? ""), String(right.fullName ?? ""), query.sortDirection);
          case "status":
            return compareTextValue(leftStatus, rightStatus, query.sortDirection);
          case "type":
            return compareTextValue(String(left.type ?? ""), String(right.type ?? ""), query.sortDirection);
          case "description":
            return compareTextValue(String(left.description ?? ""), String(right.description ?? ""), query.sortDirection);
          case "roleLabel":
            return compareTextValue(String(left.roleLabel ?? ""), String(right.roleLabel ?? ""), query.sortDirection);
          case "contactName":
            return compareTextValue(String(left.contactName ?? ""), String(right.contactName ?? ""), query.sortDirection);
          case "supportEmail":
            return compareTextValue(String(left.supportEmail ?? ""), String(right.supportEmail ?? ""), query.sortDirection);
          case "email":
            return compareTextValue(String(left.email ?? ""), String(right.email ?? ""), query.sortDirection);
          case "phone":
            return compareTextValue(String(left.phone ?? ""), String(right.phone ?? ""), query.sortDirection);
          case "assetCount":
            return compareNumberValue(Number(left.assetCount ?? 0), Number(right.assetCount ?? 0), query.sortDirection);
          case "name":
          default:
            return compareTextValue(String(left.name ?? ""), String(right.name ?? ""), query.sortDirection);
        }
      });

    const filterCatalogRows = <T extends Record<string, unknown>>(rows: T[], values: (row: T) => Array<string | null | undefined>) =>
      rows.filter((row) => matchesSearch(query.search, values(row)));

    switch (query.entityType) {
      case "location":
        return {
          ...snapshot,
          locations: sortCatalogRows(
            filterCatalogRows(snapshot.locations, (row) => [row.code, row.name, row.type, row.description]),
          ),
        };
      case "department":
        return {
          ...snapshot,
          departments: sortCatalogRows(filterCatalogRows(snapshot.departments, (row) => [row.code, row.name, row.description])),
        };
      case "crew":
        return {
          ...snapshot,
          crewMembers: sortCatalogRows(
            filterCatalogRows(snapshot.crewMembers, (row) => [row.fullName, row.roleLabel, row.email, row.phone, row.notes]),
          ),
        };
      case "client":
        return {
          ...snapshot,
          clients: sortCatalogRows(
            filterCatalogRows(snapshot.clients, (row) => [row.name, row.contactName, row.email, row.phone, row.notes]),
          ),
        };
      case "manufacturer":
        return {
          ...snapshot,
          manufacturers: sortCatalogRows(
            filterCatalogRows(snapshot.manufacturers, (row) => [row.name, row.contactName, row.supportEmail, row.phone, row.notes]),
          ),
        };
      case "kit":
        return {
          ...snapshot,
          kits: sortCatalogRows(
            filterCatalogRows(snapshot.kits, (row) => [row.code, row.name, row.description, row.primaryCodeValue]),
          ),
        };
      case "category":
      default:
        return {
          ...snapshot,
          categories: sortCatalogRows(
            filterCatalogRows(snapshot.categories, (row) => [row.code, row.name, row.description]),
          ),
        };
    }
  },

  getFinanceOverview(): FinanceOverviewSnapshot {
    const incidentExposure = db
      .prepare(
        `
          SELECT COALESCE(SUM(cost_estimate), 0) AS amount
          FROM incidents
          WHERE status IN ('Open', 'In review')
        `,
      )
      .get() as AmountRow;
    const replacementAtRisk = db
      .prepare(
        `
          SELECT COALESCE(SUM(assets.replacement_value), 0) AS amount
          FROM asset_current_state
          JOIN assets ON assets.id = asset_current_state.asset_id
          WHERE asset_current_state.custody_status IN ('checked_out', 'assigned')
        `,
      )
      .get() as AmountRow;
    const maintenanceQueue = db
      .prepare("SELECT COUNT(*) AS count FROM asset_current_state WHERE operational_status = 'maintenance'")
      .get() as CountRow;
    const missingEstimates = db
      .prepare(
        `
          SELECT COUNT(*) AS count
          FROM incidents
          WHERE status IN ('Open', 'In review') AND cost_estimate IS NULL
        `,
      )
      .get() as CountRow;

    return {
      metrics: [
        { label: "Incident exposure", value: formatCurrency(incidentExposure.amount), tone: "critical" },
        { label: "Replacement at risk", value: formatCurrency(replacementAtRisk.amount), tone: "warning" },
        { label: "Maintenance queue", value: `${maintenanceQueue.count} assets`, tone: "info" },
        { label: "Missing estimates", value: `${missingEstimates.count} incidents`, tone: "neutral" },
      ],
      exposureByProject: this.getFinanceProjectExposure(),
      costLinks: this.getFinanceCostLinks(),
    };
  },

  getFinanceProjectExposure(): ProjectExposureRow[] {
    const rows = db
      .prepare(
        `
          SELECT
            projects.name AS project,
            COALESCE((
              SELECT SUM(cost_estimate)
              FROM incidents
              WHERE incidents.project_id = projects.id
            ), 0) AS exposure,
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
            ), 0) AS assets_out
          FROM projects
          ORDER BY exposure DESC, projects.name
        `,
      )
      .all() as Array<{
      project: string;
      exposure: number;
      incident_count: number;
      assets_out: number;
    }>;

    return rows.map((row) => ({
      project: row.project,
      exposure: formatCurrency(row.exposure),
      incidentCount: row.incident_count,
      assetsOut: formatCurrency(row.assets_out),
    }));
  },

  getFinanceCostLinks(): FinanceCostLinkRow[] {
    const rows = db
      .prepare(
        `
          SELECT
            incidents.title AS incident,
            COALESCE(assets.internal_code, '—') AS asset,
            COALESCE(projects.name, '—') AS project,
            COALESCE(users.full_name, '—') AS responsible,
            incidents.severity,
            incidents.cost_estimate,
            assets.replacement_value,
            COALESCE(incidents.financial_status, 'Unlinked') AS financial_status
          FROM incidents
          LEFT JOIN assets ON assets.id = incidents.asset_id
          LEFT JOIN projects ON projects.id = incidents.project_id
          LEFT JOIN users ON users.id = incidents.responsible_user_id
          ORDER BY incidents.reported_at DESC
        `,
      )
      .all() as Array<{
      incident: string;
      asset: string;
      project: string;
      responsible: string;
      severity: string;
      cost_estimate: number | null;
      replacement_value: number | null;
      financial_status: string;
    }>;

    return rows.map((row) => ({
      incident: row.incident,
      asset: row.asset,
      project: row.project,
      responsible: row.responsible,
      severity: row.severity,
      costEstimate: formatCurrency(row.cost_estimate),
      replacementValue: formatCurrency(row.replacement_value),
      financialStatus: row.financial_status,
    }));
  },

  getFinanceEntries(query: FinanceEntryListQuery = defaultFinanceEntryListQuery): FinanceEntryRow[] {
    const rows = db
      .prepare(
        `
          SELECT
            financial_entries.id,
            financial_entries.entry_date,
            financial_entries.entry_type,
            financial_entries.category,
            financial_entries.amount,
            financial_entries.status,
            COALESCE(projects.name, '—') AS project,
            COALESCE(incidents.title, assets.internal_code, financial_entries.id) AS reference
          FROM financial_entries
          LEFT JOIN projects ON projects.id = financial_entries.project_id
          LEFT JOIN incidents ON incidents.id = financial_entries.incident_id
          LEFT JOIN assets ON assets.id = financial_entries.asset_id
        `,
      )
      .all() as Array<{
      id: string;
      entry_date: string;
      entry_type: string;
      category: string;
      amount: number;
      status: string;
      project: string;
      reference: string;
    }>;

    const mappedRows = rows
      .map((row) => ({
        id: row.id,
        date: row.entry_date,
        type: row.entry_type,
        category: row.category,
        reference: row.reference,
        project: row.project,
        amount: formatCurrency(row.amount),
        status: row.status,
        amountValue: row.amount,
        dateValue: row.entry_date,
      }))
      .filter((row) => matchesSearch(query.search, [row.reference, row.project, row.category, row.type, row.status]));

    return sortRows(
      mappedRows,
      resolveFinanceEntryComparator(query.sortBy ?? defaultFinanceEntryListQuery.sortBy, query.sortDirection ?? defaultFinanceEntryListQuery.sortDirection),
    ).map(({ amountValue: _amountValue, dateValue: _dateValue, ...row }) => row);
  },

  getAgentCapabilitiesSnapshot() {
    const rows = db
      .prepare(
        `
          SELECT
            id,
            agent_key,
            display_name,
            status,
            approval_mode,
            provider_key,
            model_label,
            role_summary,
            COALESCE(mission, role_summary) AS mission,
            allowed_tools_json,
            allowed_domains_json,
            is_supervisor
          FROM agents
          WHERE workspace_id = ?
          ORDER BY is_supervisor DESC, sort_order ASC, display_name
        `,
      )
      .all(workspaceId) as Array<{
      id: string;
      agent_key: string;
      display_name: string;
      status: string;
      approval_mode: string;
      provider_key: string | null;
      model_label: string;
      role_summary: string;
      mission: string;
      allowed_tools_json: string | null;
      allowed_domains_json: string | null;
      is_supervisor: number;
    }>;

    return rows.map((row) => {
      const tools = parseJsonStringArray(row.allowed_tools_json);
      const domains = parseJsonStringArray(row.allowed_domains_json);

      return {
        id: row.id,
        agentKey: row.agent_key,
        displayName: row.display_name,
        status: row.status,
        approvalMode: row.approval_mode,
        providerKey: row.provider_key ?? "openai",
        modelLabel: row.model_label,
        role: row.role_summary,
        mission: row.mission,
        toolCount: tools.length,
        tools,
        domains,
        isSupervisor: row.is_supervisor === 1,
      };
    });
  },

  getPendingApprovals(limit = 8) {
    const rows = db
      .prepare(
        `
          SELECT
            agent_runs.id,
            agent_runs.title,
            agent_runs.updated_at,
            agent_runs.thread_id,
            COALESCE(agents.display_name, 'Supervisor Agent') AS agent_name
          FROM agent_runs
          LEFT JOIN agents ON agents.id = agent_runs.agent_id
          WHERE agent_runs.workspace_id = ?
            AND agent_runs.status = 'needs_approval'
          ORDER BY agent_runs.updated_at DESC
          LIMIT ?
        `,
      )
      .all(workspaceId, limit) as Array<{
      id: string;
      title: string;
      updated_at: string;
      thread_id: string | null;
      agent_name: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      agent: row.agent_name,
      threadId: row.thread_id,
      updatedAt: formatTimelineTimestamp(row.updated_at),
    }));
  },

  getAgentRunsSnapshot(agentKey?: string | null, status?: string | null, limit = 8) {
    const clauses = ["agent_runs.workspace_id = ?"];
    const params: Array<string | number> = [workspaceId];

    if (agentKey) {
      clauses.push("agents.agent_key = ?");
      params.push(agentKey);
    }

    if (status) {
      clauses.push("agent_runs.status = ?");
      params.push(status);
    }

    const rows = db
      .prepare(
        `
          SELECT
            agent_runs.id,
            agent_runs.title,
            agent_runs.status,
            agent_runs.updated_at,
            agent_runs.approval_required,
            COALESCE(agents.display_name, 'Supervisor Agent') AS agent_name
          FROM agent_runs
          LEFT JOIN agents ON agents.id = agent_runs.agent_id
          WHERE ${clauses.join(" AND ")}
          ORDER BY agent_runs.updated_at DESC
          LIMIT ?
        `,
      )
      .all(...params, limit) as Array<{
      id: string;
      title: string;
      status: string;
      updated_at: string;
      approval_required: number;
      agent_name: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      approvalRequired: row.approval_required === 1,
      agent: row.agent_name,
      updatedAt: formatTimelineTimestamp(row.updated_at),
    }));
  },

  getAgentHealthStatus() {
    const providers = db
      .prepare(
        `
          SELECT provider_key, display_name, status, enabled, last_error_summary
          FROM ai_provider_configs
          WHERE workspace_id = ?
          ORDER BY supports_live_requests DESC, display_name
        `,
      )
      .all(workspaceId) as Array<{
      provider_key: string;
      display_name: string;
      status: string;
      enabled: number;
      last_error_summary: string | null;
    }>;

    const agentCounts = db
      .prepare(
        `
          SELECT
            SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_count,
            SUM(CASE WHEN status = 'paused' THEN 1 ELSE 0 END) AS paused_count
          FROM agents
          WHERE workspace_id = ?
        `,
      )
      .get(workspaceId) as { active_count: number | null; paused_count: number | null };

    const runCounts = db
      .prepare(
        `
          SELECT
            SUM(CASE WHEN status = 'needs_approval' THEN 1 ELSE 0 END) AS approvals,
            SUM(CASE WHEN status IN ('failed', 'denied') THEN 1 ELSE 0 END) AS blocked_runs
          FROM agent_runs
          WHERE workspace_id = ?
        `,
      )
      .get(workspaceId) as { approvals: number | null; blocked_runs: number | null };

    return {
      activeAgents: agentCounts.active_count ?? 0,
      pausedAgents: agentCounts.paused_count ?? 0,
      pendingApprovals: runCounts.approvals ?? 0,
      blockedRuns: runCounts.blocked_runs ?? 0,
      providers: providers.map((row) => ({
        providerKey: row.provider_key,
        label: row.display_name,
        status: row.status,
        enabled: row.enabled === 1,
        lastErrorSummary: row.last_error_summary ?? "",
      })),
    };
  },

  getProjectConflicts(input?: { projectId?: string | null; rangeStart?: string | null; rangeEnd?: string | null }) {
    const rangeStart = toIsoDate(input?.rangeStart);
    const rangeEnd = toIsoDate(input?.rangeEnd ?? addDays(rangeStart, 30));
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

  getAssetAvailability(input?: { assetId?: string | null; query?: string | null; rangeStart?: string | null; rangeEnd?: string | null; limit?: number }) {
    const rangeStart = toIsoDate(input?.rangeStart);
    const rangeEnd = toIsoDate(input?.rangeEnd ?? addDays(rangeStart, 30));
    const rows = this.getAssets({
      scopeProjectId: null,
      search: input?.assetId ? undefined : input?.query ?? "",
      sortBy: "name",
      sortDirection: "asc",
    })
      .filter((row) => !input?.assetId || row.id === input.assetId)
      .slice(0, input?.limit ?? 8);

    return rows.map((row) => {
      const reservations = db
        .prepare(
          `
            SELECT COUNT(*) AS count
            FROM asset_assignments
            WHERE asset_id = ?
              AND returned_at IS NULL
              AND assignment_status IN ('reserved', 'assigned', 'checked_out')
              AND (
                expected_return_at IS NULL
                OR expected_return_at >= ?
              )
              AND created_at <= ?
          `,
        )
        .get(row.id, rangeStart, `${rangeEnd}T23:59:59.000Z`) as CountRow;

      return {
        id: row.id,
        code: row.code,
        name: row.name,
        status: row.status,
        location: row.location,
        project: row.project,
        projectUnit: row.projectUnit,
        reservationsInWindow: reservations.count,
        availableNow: row.status === "Available" && reservations.count === 0,
        rangeStart,
        rangeEnd,
      };
    });
  },

  getAssetLocation(assetId: string) {
    const detail = this.getAssetDetail(assetId);

    if (!detail.asset) {
      return { asset: null };
    }

    return {
      asset: {
        id: detail.asset.id,
        name: detail.asset.name,
        code: detail.asset.code,
        location: detail.asset.location,
        project: detail.asset.project,
        responsible: detail.asset.responsible,
        status: detail.asset.status,
        custody: detail.asset.custody,
      },
    };
  },

  getAssetMovements(assetId: string, limit = 8) {
    const rows = db
      .prepare(
        `
          SELECT
            asset_events.id,
            asset_events.event_type,
            asset_events.event_timestamp,
            COALESCE(users.full_name, '—') AS performed_by,
            COALESCE(projects.name, '—') AS project_name,
            COALESCE(from_locations.name, '—') AS from_location,
            COALESCE(to_locations.name, '—') AS to_location,
            COALESCE(asset_events.notes, '') AS notes
          FROM asset_events
          LEFT JOIN users ON users.id = asset_events.performed_by_user_id
          LEFT JOIN projects ON projects.id = asset_events.project_id
          LEFT JOIN locations AS from_locations ON from_locations.id = asset_events.from_location_id
          LEFT JOIN locations AS to_locations ON to_locations.id = asset_events.to_location_id
          WHERE asset_events.asset_id = ?
          ORDER BY asset_events.event_timestamp DESC
          LIMIT ?
        `,
      )
      .all(assetId, limit) as Array<{
      id: string;
      event_type: string;
      event_timestamp: string;
      performed_by: string;
      project_name: string;
      from_location: string;
      to_location: string;
      notes: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      type: row.event_type,
      title: mapEventTitle(row.event_type),
      timestamp: formatTimelineTimestamp(row.event_timestamp),
      performedBy: row.performed_by,
      project: row.project_name,
      fromLocation: row.from_location,
      toLocation: row.to_location,
      notes: row.notes,
    }));
  },

  getAssetReservations(input?: { assetId?: string | null; query?: string | null; rangeStart?: string | null; rangeEnd?: string | null; limit?: number }) {
    const rangeStart = toIsoDate(input?.rangeStart);
    const rangeEnd = toIsoDate(input?.rangeEnd ?? addDays(rangeStart, 30));
    const clauses = [
      "asset_assignments.returned_at IS NULL",
      "asset_assignments.assignment_status IN ('reserved', 'assigned', 'checked_out')",
      "COALESCE(asset_assignments.expected_return_at, '9999-12-31T23:59:59.000Z') >= ?",
      "asset_assignments.created_at <= ?",
    ];
    const params: Array<string | number | null> = [rangeStart, `${rangeEnd}T23:59:59.000Z`];

    if (input?.assetId) {
      clauses.push("assets.id = ?");
      params.push(input.assetId);
    }

    const rows = db
      .prepare(
        `
          SELECT
            asset_assignments.id,
            assets.id AS asset_id,
            assets.name AS asset_name,
            COALESCE(legacy_rentman_items.legacy_code, assets.internal_code) AS asset_code,
            COALESCE(projects.name, '—') AS project_name,
            COALESCE(users.full_name, '—') AS assigned_to,
            asset_assignments.assignment_status,
            asset_assignments.checked_out_at,
            asset_assignments.expected_return_at,
            asset_assignments.returned_at
          FROM asset_assignments
          JOIN assets ON assets.id = asset_assignments.asset_id
          LEFT JOIN legacy_rentman_asset_links ON legacy_rentman_asset_links.asset_id = assets.id
          LEFT JOIN legacy_rentman_items ON legacy_rentman_items.id = legacy_rentman_asset_links.legacy_item_id
          LEFT JOIN projects ON projects.id = asset_assignments.project_id
          LEFT JOIN users ON users.id = asset_assignments.assigned_to_user_id
          WHERE ${clauses.join(" AND ")}
          ORDER BY COALESCE(asset_assignments.expected_return_at, asset_assignments.created_at) ASC
          LIMIT ?
        `,
      )
      .all(...params, input?.limit ?? 10) as Array<{
      id: string;
      asset_id: string;
      asset_name: string;
      asset_code: string;
      project_name: string;
      assigned_to: string;
      assignment_status: string;
      checked_out_at: string | null;
      expected_return_at: string | null;
      returned_at: string | null;
    }>;

    return rows
      .filter((row) =>
        matchesSearch(input?.query ?? "", [row.asset_name, row.asset_code, row.project_name, row.assigned_to, row.assignment_status]),
      )
      .map((row) => ({
        id: row.id,
        assetId: row.asset_id,
        asset: row.asset_name,
        code: row.asset_code,
        project: row.project_name,
        assignedTo: row.assigned_to,
        status: row.assignment_status,
        checkedOutAt: row.checked_out_at ? formatTimelineTimestamp(row.checked_out_at) : "Not checked out",
        expectedReturnAt: row.expected_return_at ? formatTimelineTimestamp(row.expected_return_at) : "Open-ended",
        returnedAt: row.returned_at ? formatTimelineTimestamp(row.returned_at) : "Pending return",
      }));
  },

  getKitContents(input?: { kitId?: string | null; query?: string | null; limit?: number }) {
    const rows = db
      .prepare(
        `
          SELECT
            kits.id AS kit_id,
            kits.code AS kit_code,
            kits.name AS kit_name,
            COALESCE(kits.description, '') AS kit_description,
            assets.id AS asset_id,
            assets.name AS asset_name,
            COALESCE(legacy_rentman_items.legacy_code, assets.internal_code) AS asset_code
          FROM kits
          LEFT JOIN kit_assets ON kit_assets.kit_id = kits.id
          LEFT JOIN assets ON assets.id = kit_assets.asset_id
          LEFT JOIN legacy_rentman_asset_links ON legacy_rentman_asset_links.asset_id = assets.id
          LEFT JOIN legacy_rentman_items ON legacy_rentman_items.id = legacy_rentman_asset_links.legacy_item_id
          WHERE kits.is_active = 1
            AND (? IS NULL OR kits.id = ?)
          ORDER BY kits.name, assets.name
        `,
      )
      .all(input?.kitId ?? null, input?.kitId ?? null) as Array<{
      kit_id: string;
      kit_code: string;
      kit_name: string;
      kit_description: string;
      asset_id: string | null;
      asset_name: string | null;
      asset_code: string | null;
    }>;

    const byKit = new Map<
      string,
      {
        id: string;
        code: string;
        name: string;
        description: string;
        assets: Array<{ id: string; name: string; code: string }>;
      }
    >();

    rows.forEach((row) => {
      const current =
        byKit.get(row.kit_id) ??
        {
          id: row.kit_id,
          code: row.kit_code,
          name: row.kit_name,
          description: row.kit_description,
          assets: [],
        };

      if (!byKit.has(row.kit_id)) {
        byKit.set(row.kit_id, current);
      }

      if (row.asset_id && row.asset_name && row.asset_code) {
        current.assets.push({
          id: row.asset_id,
          name: row.asset_name,
          code: row.asset_code,
        });
      }
    });

    return Array.from(byKit.values())
      .filter((row) => matchesSearch(input?.query ?? "", [row.code, row.name, row.description, ...row.assets.map((asset) => asset.name)]))
      .slice(0, input?.limit ?? 6);
  },

  getIncidentDetail(incidentId: string) {
    const row = db
      .prepare(
        `
          SELECT
            incidents.id,
            incidents.title,
            incidents.incident_type,
            incidents.severity,
            incidents.status,
            incidents.description,
            incidents.reported_at,
            incidents.resolved_at,
            incidents.cost_estimate,
            incidents.currency,
            COALESCE(incidents.financial_status, 'Unlinked') AS financial_status,
            COALESCE(incidents.notes, '') AS notes,
            COALESCE(assets.id, '') AS asset_id,
            COALESCE(assets.name, '—') AS asset_name,
            COALESCE(assets.internal_code, '—') AS asset_code,
            COALESCE(projects.id, '') AS project_id,
            COALESCE(projects.name, '—') AS project_name,
            COALESCE(project_units.id, '') AS project_unit_id,
            COALESCE(project_units.name, '—') AS project_unit_name,
            COALESCE(users.full_name, '—') AS owner_name,
            COALESCE(reporters.full_name, '—') AS reporter_name,
            COALESCE(departments.name, '—') AS department_name
          FROM incidents
          LEFT JOIN assets ON assets.id = incidents.asset_id
          LEFT JOIN projects ON projects.id = incidents.project_id
          LEFT JOIN project_units ON project_units.id = incidents.project_unit_id
          LEFT JOIN users ON users.id = incidents.responsible_user_id
          LEFT JOIN users AS reporters ON reporters.id = incidents.reported_by_user_id
          LEFT JOIN departments ON departments.id = incidents.department_id
          WHERE incidents.id = ?
          LIMIT 1
        `,
      )
      .get(incidentId) as
      | {
          id: string;
          title: string;
          incident_type: string;
          severity: string;
          status: string;
          description: string;
          reported_at: string;
          resolved_at: string | null;
          cost_estimate: number | null;
          currency: string | null;
          financial_status: string;
          notes: string;
          asset_id: string;
          asset_name: string;
          asset_code: string;
          project_id: string;
          project_name: string;
          project_unit_id: string;
          project_unit_name: string;
          owner_name: string;
          reporter_name: string;
          department_name: string;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      title: row.title,
      type: row.incident_type,
      severity: row.severity,
      status: row.status,
      description: row.description,
      reportedAt: formatTimelineTimestamp(row.reported_at),
      resolvedAt: row.resolved_at ? formatTimelineTimestamp(row.resolved_at) : "Still open",
      costEstimate: formatCurrency(row.cost_estimate),
      currency: row.currency ?? "USD",
      financialStatus: row.financial_status,
      notes: row.notes,
      assetId: row.asset_id || null,
      asset: row.asset_name,
      assetCode: row.asset_code,
      projectId: row.project_id || null,
      project: row.project_name,
      projectUnitId: row.project_unit_id || null,
      projectUnit: row.project_unit_name,
      owner: row.owner_name,
      reporter: row.reporter_name,
      department: row.department_name,
    };
  },

  getIncidentTimeline(incidentId: string, limit = 8) {
    const incident = this.getIncidentDetail(incidentId);

    if (!incident) {
      return [];
    }

    const assetEvents = incident.assetId
      ? (db
          .prepare(
            `
              SELECT
                id,
                event_type,
                event_timestamp,
                COALESCE(notes, '') AS notes,
                metadata_json
              FROM asset_events
              WHERE asset_id = ?
              ORDER BY event_timestamp DESC
              LIMIT 20
            `,
          )
          .all(incident.assetId) as Array<{
          id: string;
          event_type: string;
          event_timestamp: string;
          notes: string;
          metadata_json: string | null;
        }>)
      : [];

    const linkedEvents = assetEvents
      .filter((row) => {
        const metadata = parseJsonObject(row.metadata_json);
        return metadata?.incidentId === incidentId;
      })
      .map((row) => ({
        id: row.id,
        title: mapEventTitle(row.event_type),
        timestamp: formatTimelineTimestamp(row.event_timestamp),
        body: row.notes || "Operational asset event linked to this incident.",
      }));

    const timeline = [
      {
        id: `${incidentId}-reported`,
        title: "Incident reported",
        timestamp: incident.reportedAt,
        body: incident.description,
      },
      ...linkedEvents,
      ...(incident.resolvedAt !== "Still open"
        ? [
            {
              id: `${incidentId}-resolved`,
              title: "Incident resolved",
              timestamp: incident.resolvedAt,
              body: "The incident was marked as resolved in the registry.",
            },
          ]
        : []),
    ];

    return timeline.slice(0, limit);
  },

  getIncidentEstimates(input?: { incidentId?: string | null; projectId?: string | null; limit?: number }) {
    const rows = this.getIncidents({
      scopeProjectId: input?.projectId ?? null,
      search: undefined,
      sortBy: "reportedAt",
      sortDirection: "desc",
    })
      .filter((row) => !input?.incidentId || row.id === input.incidentId)
      .slice(0, input?.limit ?? 12);

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      project: row.project,
      severity: row.severity,
      status: row.status,
      costEstimate: row.costEstimate,
      hasEstimate: row.costEstimate !== "Pending",
    }));
  },

  getMaintenanceQueue(limit = 8) {
    const rows = db
      .prepare(
        `
          SELECT
            assets.id,
            assets.name,
            COALESCE(assets.internal_code, '—') AS asset_code,
            COALESCE(locations.name, '—') AS location_name,
            COALESCE((
              SELECT incidents.title
              FROM incidents
              WHERE incidents.asset_id = assets.id
                AND incidents.status IN ('Open', 'In review')
              ORDER BY incidents.reported_at DESC
              LIMIT 1
            ), 'No linked incident') AS latest_incident,
            asset_current_state.updated_at
          FROM asset_current_state
          JOIN assets ON assets.id = asset_current_state.asset_id
          LEFT JOIN locations ON locations.id = asset_current_state.current_location_id
          WHERE asset_current_state.operational_status = 'maintenance'
            AND assets.is_active = 1
          ORDER BY asset_current_state.updated_at DESC, assets.name
          LIMIT ?
        `,
      )
      .all(limit) as Array<{
      id: string;
      name: string;
      asset_code: string;
      location_name: string;
      latest_incident: string;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      assetId: row.id,
      asset: row.name,
      code: row.asset_code,
      location: row.location_name,
      latestIncident: row.latest_incident,
      updatedAt: formatTimelineTimestamp(row.updated_at),
    }));
  },

  getAssetMaintenanceHistory(assetId: string, limit = 8) {
    const maintenanceEvents = db
      .prepare(
        `
          SELECT id, event_type, event_timestamp, COALESCE(notes, '') AS notes
          FROM asset_events
          WHERE asset_id = ?
            AND event_type IN ('maintenance_started', 'maintenance_completed')
          ORDER BY event_timestamp DESC
          LIMIT ?
        `,
      )
      .all(assetId, limit) as Array<{
      id: string;
      event_type: string;
      event_timestamp: string;
      notes: string;
    }>;

    const incidents = db
      .prepare(
        `
          SELECT id, title, reported_at, status
          FROM incidents
          WHERE asset_id = ?
          ORDER BY reported_at DESC
          LIMIT ?
        `,
      )
      .all(assetId, limit) as Array<{
      id: string;
      title: string;
      reported_at: string;
      status: string;
    }>;

    return {
      events: maintenanceEvents.map((row) => ({
        id: row.id,
        title: mapEventTitle(row.event_type),
        timestamp: formatTimelineTimestamp(row.event_timestamp),
        notes: row.notes,
      })),
      incidents: incidents.map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        reportedAt: formatTimelineTimestamp(row.reported_at),
      })),
    };
  },

  listCommunicationRecipients(input?: {
    query?: string | null;
    recipientType?: string | null;
    projectId?: string | null;
    limit?: number;
  }) {
    const projectDetail = input?.projectId ? this.getProjectDetail(input.projectId) : null;
    const projectResponsibleNames = new Set(
      (projectDetail?.responsibles ?? []).map((row) => normalizeSearchText(row.name)).filter(Boolean),
    );
    const projectClientName = normalizeSearchText(projectDetail?.project?.client ?? "");

    const users = db
      .prepare(
        `
          SELECT users.id, users.full_name, COALESCE(users.email, '') AS email, COALESCE(users.phone, '') AS phone
          FROM workspace_memberships
          JOIN users ON users.id = workspace_memberships.user_id
          WHERE workspace_memberships.workspace_id = ?
            AND workspace_memberships.status = 'active'
            AND users.is_active = 1
          ORDER BY users.full_name
        `,
      )
      .all(workspaceId) as Array<{
      id: string;
      full_name: string;
      email: string;
      phone: string;
    }>;

    const crewMembers = db
      .prepare(
        `
          SELECT id, full_name, COALESCE(role_label, '') AS role_label, COALESCE(email, '') AS email, COALESCE(phone, '') AS phone
          FROM crew_members
          WHERE workspace_id = ?
            AND is_active = 1
          ORDER BY full_name
        `,
      )
      .all(workspaceId) as Array<{
      id: string;
      full_name: string;
      role_label: string;
      email: string;
      phone: string;
    }>;

    const clients = db
      .prepare(
        `
          SELECT id, name, COALESCE(contact_name, '') AS contact_name, COALESCE(email, '') AS email, COALESCE(phone, '') AS phone
          FROM clients
          WHERE workspace_id = ?
            AND is_active = 1
          ORDER BY name
        `,
      )
      .all(workspaceId) as Array<{
      id: string;
      name: string;
      contact_name: string;
      email: string;
      phone: string;
    }>;

    const manufacturers = db
      .prepare(
        `
          SELECT id, name, COALESCE(contact_name, '') AS contact_name, COALESCE(support_email, '') AS support_email, COALESCE(phone, '') AS phone
          FROM manufacturers
          WHERE workspace_id = ?
            AND is_active = 1
          ORDER BY name
        `,
      )
      .all(workspaceId) as Array<{
      id: string;
      name: string;
      contact_name: string;
      support_email: string;
      phone: string;
    }>;

    const rows = [
      ...users.map((row) => ({
        id: row.id,
        recipientKey: `user:${row.id}`,
        type: "user",
        label: row.full_name,
        subtitle: "Workspace member",
        contactName: row.full_name,
        email: row.email,
        phone: row.phone,
        preferredChannel: resolvePreferredChannel(row.email, row.phone),
        projectRelevance: projectResponsibleNames.has(normalizeSearchText(row.full_name)) ? "project_owner" : null,
      })),
      ...crewMembers.map((row) => ({
        id: row.id,
        recipientKey: `crew:${row.id}`,
        type: "crew_member",
        label: row.full_name,
        subtitle: row.role_label || "Crew member",
        contactName: row.full_name,
        email: row.email,
        phone: row.phone,
        preferredChannel: resolvePreferredChannel(row.email, row.phone),
        projectRelevance: projectResponsibleNames.has(normalizeSearchText(row.full_name)) ? "project_owner" : null,
      })),
      ...clients.map((row) => ({
        id: row.id,
        recipientKey: `client:${row.id}`,
        type: "client",
        label: row.name,
        subtitle: row.contact_name || "Client",
        contactName: row.contact_name || row.name,
        email: row.email,
        phone: row.phone,
        preferredChannel: resolvePreferredChannel(row.email, row.phone),
        projectRelevance:
          projectClientName &&
          (normalizeSearchText(row.name) === projectClientName || normalizeSearchText(row.contact_name) === projectClientName)
            ? "project_client"
            : null,
      })),
      ...manufacturers.map((row) => ({
        id: row.id,
        recipientKey: `manufacturer:${row.id}`,
        type: "manufacturer",
        label: row.name,
        subtitle: row.contact_name || "Manufacturer",
        contactName: row.contact_name || row.name,
        email: row.support_email,
        phone: row.phone,
        preferredChannel: resolvePreferredChannel(row.support_email, row.phone),
        projectRelevance: null,
      })),
    ]
      .filter((row) => !input?.recipientType || row.type === input.recipientType)
      .filter((row) =>
        matchesSearch(input?.query ?? undefined, [row.label, row.subtitle, row.contactName, row.email, row.phone, row.type]),
      )
      .sort((left, right) => {
        const leftProjectRank = left.projectRelevance ? 0 : 1;
        const rightProjectRank = right.projectRelevance ? 0 : 1;

        if (leftProjectRank !== rightProjectRank) {
          return leftProjectRank - rightProjectRank;
        }

        const leftReachabilityRank = left.preferredChannel === "unreachable" ? 1 : 0;
        const rightReachabilityRank = right.preferredChannel === "unreachable" ? 1 : 0;

        if (leftReachabilityRank !== rightReachabilityRank) {
          return leftReachabilityRank - rightReachabilityRank;
        }

        return compareTextValue(left.label, right.label, "asc");
      })
      .slice(0, input?.limit ?? 8);

    return rows.map((row) => ({
      ...row,
      projectLabel: projectDetail?.project?.name ?? null,
    }));
  },

  getThreadContextSnapshot(threadId: string, limit = 6) {
    const thread = db
      .prepare(
        `
          SELECT
            assistant_chat_threads.id,
            assistant_chat_threads.title,
            assistant_chat_threads.context_key,
            assistant_chat_threads.context_label,
            assistant_chat_threads.summary_text,
            assistant_chat_threads.updated_at,
            COALESCE(assistant_chat_thread_state.last_state, 'idle') AS last_state,
            COALESCE(assistant_chat_thread_state.last_error_summary, '') AS last_error_summary,
            COALESCE(assistant_chat_thread_state.last_intent, '') AS last_intent
          FROM assistant_chat_threads
          LEFT JOIN assistant_chat_thread_state
            ON assistant_chat_thread_state.thread_id = assistant_chat_threads.id
          WHERE assistant_chat_threads.id = ?
            AND assistant_chat_threads.deleted_at IS NULL
          LIMIT 1
        `,
      )
      .get(threadId) as
      | {
          id: string;
          title: string;
          context_key: string;
          context_label: string;
          summary_text: string;
          updated_at: string;
          last_state: string;
          last_error_summary: string;
          last_intent: string;
        }
      | undefined;

    if (!thread) {
      return {
        thread: null,
        messages: [],
      };
    }

    const messages = db
      .prepare(
        `
          SELECT
            assistant_chat_messages.id,
            assistant_chat_messages.role,
            assistant_chat_messages.body,
            assistant_chat_messages.message_state,
            assistant_chat_messages.state_payload_json,
            assistant_chat_messages.created_at,
            COALESCE((
              SELECT COUNT(*)
              FROM assistant_chat_attachments
              WHERE assistant_chat_attachments.message_id = assistant_chat_messages.id
                AND assistant_chat_attachments.deleted_at IS NULL
                AND assistant_chat_attachments.status IN ('available', 'missing', 'cleanup_pending')
            ), 0) AS attachment_count
          FROM assistant_chat_messages
          WHERE assistant_chat_messages.thread_id = ?
            AND assistant_chat_messages.deleted_at IS NULL
          ORDER BY assistant_chat_messages.created_at DESC
          LIMIT ?
        `,
      )
      .all(threadId, limit) as Array<{
      id: string;
      role: "assistant" | "user";
      body: string;
      message_state: string;
      state_payload_json: string | null;
      created_at: string;
      attachment_count: number;
    }>;

    return {
      thread: {
        id: thread.id,
        title: thread.title,
        contextKey: thread.context_key,
        contextLabel: thread.context_label,
        summaryText: thread.summary_text,
        lastState: thread.last_state,
        lastIntent: thread.last_intent || null,
        lastErrorSummary: thread.last_error_summary || null,
        updatedAt: formatTimelineTimestamp(thread.updated_at),
      },
      messages: messages
        .reverse()
        .map((row) => {
          const meta = parseJsonObject(row.state_payload_json);
          return {
            id: row.id,
            role: row.role,
            body: truncate(row.body, 240),
            state: row.message_state,
            routedAgentName: typeof meta?.routedAgentName === "string" ? meta.routedAgentName : null,
            label: typeof meta?.label === "string" ? meta.label : null,
            attachmentCount: row.attachment_count,
            createdAt: formatTimelineTimestamp(row.created_at),
          };
        }),
    };
  },

  previewCommunicationTargets(input?: {
    recipientIds?: string[] | null;
    query?: string | null;
    recipientType?: string | null;
    projectId?: string | null;
    limit?: number;
  }) {
    const requestedRecipientIds = new Set((input?.recipientIds ?? []).filter(Boolean));
    const candidates = this.listCommunicationRecipients({
      query: input?.query ?? null,
      recipientType: input?.recipientType ?? null,
      projectId: input?.projectId ?? null,
      limit: Math.max(input?.limit ?? 8, requestedRecipientIds.size || 0, 8),
    }).filter((row) => !requestedRecipientIds.size || requestedRecipientIds.has(row.recipientKey));

    const missingRecipientIds = requestedRecipientIds.size
      ? Array.from(requestedRecipientIds).filter((recipientKey) => !candidates.some((row) => row.recipientKey === recipientKey))
      : [];

    return {
      totalTargets: candidates.length,
      reachableTargets: candidates.filter((row) => row.preferredChannel !== "unreachable").length,
      missingContactTargets: candidates.filter((row) => row.preferredChannel === "unreachable").length,
      missingRecipientIds,
      items: candidates.slice(0, input?.limit ?? 8),
    };
  },

  getCommunicationDeliveryStatus(input?: { threadId?: string | null; limit?: number }) {
    const rows = db
      .prepare(
        `
          SELECT
            agent_runs.id,
            agent_runs.thread_id,
            agent_runs.title,
            agent_runs.status,
            agent_runs.approval_required,
            COALESCE(agent_runs.approval_decision, 'pending') AS approval_decision,
            COALESCE(agent_runs.approval_scope, '') AS approval_scope,
            agent_runs.updated_at,
            COALESCE(agent_runs.output_summary, '') AS output_summary
          FROM agent_runs
          JOIN agents ON agents.id = agent_runs.agent_id
          WHERE agent_runs.workspace_id = ?
            AND agents.agent_key = 'communications-agent'
            AND (? IS NULL OR agent_runs.thread_id = ?)
          ORDER BY agent_runs.updated_at DESC
          LIMIT ?
        `,
      )
      .all(workspaceId, input?.threadId ?? null, input?.threadId ?? null, input?.limit ?? 8) as Array<{
      id: string;
      thread_id: string | null;
      title: string;
      status: string;
      approval_required: number;
      approval_decision: string;
      approval_scope: string;
      updated_at: string;
      output_summary: string;
    }>;

    return {
      deliveryEnabled: false,
      executionMode: "draft_only",
      items: rows.map((row) => ({
        runId: row.id,
        threadId: row.thread_id,
        title: row.title,
        status: row.status,
        approvalRequired: row.approval_required === 1,
        approvalDecision: row.approval_decision,
        approvalScope: row.approval_scope || null,
        updatedAt: formatTimelineTimestamp(row.updated_at),
        summary: row.output_summary || "Draft prepared for supervised review.",
      })),
    };
  },

  searchSystemErrors(input?: { query?: string | null; limit?: number }) {
    const failedRuns = db
      .prepare(
        `
          SELECT
            agent_runs.id,
            agent_runs.thread_id,
            agent_runs.title,
            agent_runs.status,
            agent_runs.updated_at,
            COALESCE(agent_runs.output_summary, agent_runs.input_summary, '') AS summary_text,
            COALESCE(agents.display_name, 'Supervisor Agent') AS agent_name
          FROM agent_runs
          LEFT JOIN agents ON agents.id = agent_runs.agent_id
          WHERE agent_runs.workspace_id = ?
            AND agent_runs.status IN ('failed', 'provider_error', 'tool_error', 'structured_error', 'needs_configuration')
          ORDER BY agent_runs.updated_at DESC
          LIMIT 24
        `,
      )
      .all(workspaceId) as Array<{
      id: string;
      thread_id: string | null;
      title: string;
      status: string;
      updated_at: string;
      summary_text: string;
      agent_name: string;
    }>;

    const threadErrors = db
      .prepare(
        `
          SELECT
            assistant_chat_threads.id,
            assistant_chat_threads.title,
            assistant_chat_threads.updated_at,
            assistant_chat_thread_state.last_state,
            COALESCE(assistant_chat_thread_state.last_error_summary, '') AS last_error_summary
          FROM assistant_chat_threads
          JOIN assistant_chat_thread_state ON assistant_chat_thread_state.thread_id = assistant_chat_threads.id
          WHERE assistant_chat_threads.deleted_at IS NULL
            AND assistant_chat_thread_state.last_state IN ('provider_error', 'tool_error', 'structured_error', 'interrupted', 'needs_configuration')
          ORDER BY assistant_chat_threads.updated_at DESC
          LIMIT 24
        `,
      )
      .all() as Array<{
      id: string;
      title: string;
      updated_at: string;
      last_state: string;
      last_error_summary: string;
    }>;

    const providerErrors = db
      .prepare(
        `
          SELECT provider_key, display_name, status, enabled, COALESCE(last_error_summary, '') AS last_error_summary,
                 COALESCE(last_tested_at, updated_at) AS updated_at
          FROM ai_provider_configs
          WHERE workspace_id = ?
            AND status IN ('invalid_key', 'unavailable', 'not_configured')
          ORDER BY updated_at DESC
          LIMIT 12
        `,
      )
      .all(workspaceId) as Array<{
      provider_key: string;
      display_name: string;
      status: string;
      enabled: number;
      last_error_summary: string;
      updated_at: string;
    }>;

    const runtimeErrors = db
      .prepare(
        `
          SELECT
            id,
            source_kind,
            process_label,
            severity,
            error_name,
            message,
            thread_id,
            created_at
          FROM runtime_error_events
          WHERE workspace_id = ?
          ORDER BY created_at DESC
          LIMIT 24
        `,
      )
      .all(workspaceId) as Array<{
      id: string;
      source_kind: string;
      process_label: string;
      severity: string;
      error_name: string;
      message: string;
      thread_id: string | null;
      created_at: string;
    }>;

    return [
      ...failedRuns.map((row) => ({
        id: `run:${row.id}`,
        sourceType: "run",
        title: row.title,
        status: row.status,
        severity: deriveSystemIssueSeverity("run", row.status),
        fingerprint: buildIssueFingerprint("run", row.status, row.title),
        owner: row.agent_name,
        threadId: row.thread_id,
        updatedAtRaw: row.updated_at,
        updatedAt: formatTimelineTimestamp(row.updated_at),
        summary: row.summary_text || "Run failed without a compact summary.",
      })),
      ...threadErrors.map((row) => ({
        id: `thread:${row.id}`,
        sourceType: "thread",
        title: row.title,
        status: row.last_state,
        severity: deriveSystemIssueSeverity("thread", row.last_state),
        fingerprint: buildIssueFingerprint("thread", row.last_state, row.title),
        owner: "Assistant chat",
        threadId: row.id,
        updatedAtRaw: row.updated_at,
        updatedAt: formatTimelineTimestamp(row.updated_at),
        summary: row.last_error_summary || interruptedConversationSummary,
      })),
      ...providerErrors.map((row) => ({
        id: `provider:${row.provider_key}`,
        sourceType: "provider",
        title: row.display_name,
        status: row.status,
        severity: deriveSystemIssueSeverity("provider", row.status),
        fingerprint: buildIssueFingerprint("provider", row.status, row.display_name),
        owner: row.enabled === 1 ? "AI provider" : "Disabled provider",
        threadId: null,
        updatedAtRaw: row.updated_at,
        updatedAt: formatTimelineTimestamp(row.updated_at),
        summary: row.last_error_summary || "Provider is not ready for live requests.",
      })),
      ...runtimeErrors.map((row) => ({
        id: `runtime:${row.id}`,
        sourceType: "runtime",
        title: `${row.process_label} · ${row.error_name}`,
        status: row.source_kind,
        severity: row.severity,
        fingerprint: buildIssueFingerprint("runtime", row.source_kind, `${row.process_label} ${row.error_name}`),
        owner: "Runtime telemetry",
        threadId: row.thread_id,
        updatedAtRaw: row.created_at,
        updatedAt: formatTimelineTimestamp(row.created_at),
        summary: row.message,
      })),
    ]
      .filter((row) => matchesSearch(input?.query ?? undefined, [row.title, row.status, row.owner, row.summary]))
      .sort((left, right) => right.updatedAtRaw.localeCompare(left.updatedAtRaw))
      .map(({ updatedAtRaw: _updatedAtRaw, ...row }) => row)
      .slice(0, input?.limit ?? 8);
  },

  getSystemErrorDetail(issueId: string) {
    if (issueId.startsWith("run:")) {
      const runId = issueId.slice(4);
      const row = db
        .prepare(
          `
            SELECT
              agent_runs.id,
              agent_runs.thread_id,
              agent_runs.title,
              agent_runs.status,
              agent_runs.input_summary,
              agent_runs.output_summary,
              agent_runs.approval_mode,
              agent_runs.approval_required,
              agent_runs.approval_decision,
              agent_runs.approval_scope,
              agent_runs.updated_at,
              COALESCE(agent_runs.details_json, '{}') AS details_json,
              COALESCE(agents.display_name, 'Supervisor Agent') AS agent_name
            FROM agent_runs
            LEFT JOIN agents ON agents.id = agent_runs.agent_id
            WHERE agent_runs.id = ?
            LIMIT 1
          `,
        )
        .get(runId) as
        | {
            id: string;
            thread_id: string | null;
            title: string;
            status: string;
            input_summary: string;
            output_summary: string;
            approval_mode: string;
            approval_required: number;
            approval_decision: string | null;
            approval_scope: string | null;
            updated_at: string;
            details_json: string;
            agent_name: string;
          }
        | undefined;

      if (!row) {
        return null;
      }

      const details = parseJsonObject(row.details_json);
      const activity = loadRunActivityTimeline(db, row.id, 6);

      return {
        id: issueId,
        sourceType: "run",
        title: row.title,
        status: row.status,
        severity: deriveSystemIssueSeverity("run", row.status),
        fingerprint: buildIssueFingerprint("run", row.status, row.title),
        owner: row.agent_name,
        threadId: row.thread_id,
        updatedAt: formatTimelineTimestamp(row.updated_at),
        summary: row.output_summary || row.input_summary,
        details,
        approvalMode: row.approval_mode,
        approvalRequired: row.approval_required === 1,
        approvalDecision: row.approval_decision,
        approvalScope: row.approval_scope,
        relatedActivity: activity.map((event) => ({
          title: event.title,
          body: event.body,
          tone: event.tone,
          timestamp: formatTimelineTimestamp(event.created_at),
        })),
        suggestedChecks: deriveSuggestedChecks({
          sourceType: "run",
          status: row.status,
          details,
        }),
      };
    }

    if (issueId.startsWith("thread:")) {
      const threadId = issueId.slice(7);
      const context = this.getThreadContextSnapshot(threadId, 8);

      if (!context.thread) {
        return null;
      }

      return {
        id: issueId,
        sourceType: "thread",
        title: context.thread.title,
        status: context.thread.lastState,
        severity: deriveSystemIssueSeverity("thread", context.thread.lastState),
        fingerprint: buildIssueFingerprint("thread", context.thread.lastState, context.thread.title),
        owner: "Assistant chat",
        threadId,
        updatedAt: context.thread.updatedAt,
        summary: context.thread.lastErrorSummary ?? context.thread.summaryText,
        details: {
          lastIntent: context.thread.lastIntent,
          messages: context.messages,
        },
        relatedActivity: loadThreadActivityTimeline(db, threadId, 6).map((event) => ({
          title: event.title,
          body: event.body,
          tone: event.tone,
          timestamp: formatTimelineTimestamp(event.created_at),
        })),
        suggestedChecks: deriveSuggestedChecks({
          sourceType: "thread",
          status: context.thread.lastState,
        }),
      };
    }

    if (issueId.startsWith("provider:")) {
      const providerKey = issueId.slice(9);
      const row = db
        .prepare(
          `
            SELECT
              provider_key,
              display_name,
              status,
              enabled,
              default_model_key,
              COALESCE(last_error_summary, '') AS last_error_summary,
              last_tested_at,
              last_success_at
            FROM ai_provider_configs
            WHERE workspace_id = ?
              AND provider_key = ?
            LIMIT 1
          `,
        )
        .get(workspaceId, providerKey) as
        | {
            provider_key: string;
            display_name: string;
            status: string;
            enabled: number;
            default_model_key: string;
            last_error_summary: string;
            last_tested_at: string | null;
            last_success_at: string | null;
          }
        | undefined;

      if (!row) {
        return null;
      }

      return {
        id: issueId,
        sourceType: "provider",
        title: row.display_name,
        status: row.status,
        severity: deriveSystemIssueSeverity("provider", row.status),
        fingerprint: buildIssueFingerprint("provider", row.status, row.display_name),
        owner: row.enabled === 1 ? "AI provider" : "Disabled provider",
        threadId: null,
        updatedAt: formatTimelineTimestamp(row.last_tested_at ?? row.last_success_at ?? new Date().toISOString()),
        summary: row.last_error_summary || "Provider is not ready for live requests.",
        details: {
          providerKey: row.provider_key,
          defaultModelKey: row.default_model_key,
          lastTestedAt: row.last_tested_at ? formatTimelineTimestamp(row.last_tested_at) : null,
          lastSuccessAt: row.last_success_at ? formatTimelineTimestamp(row.last_success_at) : null,
        },
        suggestedChecks: deriveSuggestedChecks({
          sourceType: "provider",
          status: row.status,
        }),
      };
    }

    if (issueId.startsWith("runtime:")) {
      const runtimeId = issueId.slice(8);
      const row = db
        .prepare(
          `
            SELECT
              id,
              source_kind,
              process_label,
              severity,
              error_name,
              message,
              stack,
              fingerprint,
              context_json,
              thread_id,
              created_at
            FROM runtime_error_events
            WHERE workspace_id = ?
              AND id = ?
            LIMIT 1
          `,
        )
        .get(workspaceId, runtimeId) as
        | {
            id: string;
            source_kind: string;
            process_label: string;
            severity: string;
            error_name: string;
            message: string;
            stack: string | null;
            fingerprint: string;
            context_json: string | null;
            thread_id: string | null;
            created_at: string;
          }
        | undefined;

      if (!row) {
        return null;
      }

      const details = parseJsonObject(row.context_json);

      return {
        id: issueId,
        sourceType: "runtime",
        title: `${row.process_label} · ${row.error_name}`,
        status: row.source_kind,
        severity: row.severity,
        fingerprint: row.fingerprint,
        owner: "Runtime telemetry",
        threadId: row.thread_id,
        updatedAt: formatTimelineTimestamp(row.created_at),
        summary: row.message,
        details: {
          ...details,
          stackPreview: row.stack ? truncate(row.stack, 600) : null,
        },
        suggestedChecks: deriveSuggestedChecks({
          sourceType: "runtime",
          status: row.source_kind,
          details,
        }),
      };
    }

    return null;
  },

  getSessionTrace(input?: { threadId?: string | null; issueId?: string | null; limit?: number }) {
    const threadId =
      input?.threadId ??
      (input?.issueId?.startsWith("thread:") ? input.issueId.slice(7) : null) ??
      (input?.issueId?.startsWith("run:")
        ? ((db
            .prepare(
              `
                SELECT thread_id
                FROM agent_runs
                WHERE id = ?
                LIMIT 1
              `,
            )
            .get(input.issueId.slice(4)) as { thread_id: string | null } | undefined)?.thread_id ?? null)
        : input?.issueId?.startsWith("runtime:")
          ? ((db
              .prepare(
                `
                  SELECT thread_id
                  FROM runtime_error_events
                  WHERE id = ?
                  LIMIT 1
                `,
              )
              .get(input.issueId.slice(8)) as { thread_id: string | null } | undefined)?.thread_id ?? null)
        : null);

    if (!threadId) {
      return {
        thread: null,
        messages: [],
        relatedRuns: [],
        note: "No thread trace is available for this issue.",
      };
    }

    const context = this.getThreadContextSnapshot(threadId, input?.limit ?? 8);
    const threadState = db
      .prepare(
        `
          SELECT
            preferred_approval_mode,
            session_approval_agent_id,
            session_approval_granted_at,
            last_state,
            COALESCE(last_error_summary, '') AS last_error_summary
          FROM assistant_chat_thread_state
          WHERE thread_id = ?
          LIMIT 1
        `,
      )
      .get(threadId) as
      | {
          preferred_approval_mode: string;
          session_approval_agent_id: string | null;
          session_approval_granted_at: string | null;
          last_state: string;
          last_error_summary: string;
        }
      | undefined;
    const relatedRuns = db
      .prepare(
        `
          SELECT
            agent_runs.id,
            agent_runs.title,
            agent_runs.status,
            COALESCE(agents.display_name, 'Supervisor Agent') AS agent_name,
            agent_runs.updated_at
          FROM agent_runs
          LEFT JOIN agents ON agents.id = agent_runs.agent_id
          WHERE agent_runs.thread_id = ?
          ORDER BY agent_runs.updated_at DESC
          LIMIT ?
        `,
      )
      .all(threadId, input?.limit ?? 6) as Array<{
      id: string;
      title: string;
      status: string;
      agent_name: string;
      updated_at: string;
    }>;

    return {
      thread: context.thread,
      threadState: threadState
        ? {
            preferredApprovalMode: threadState.preferred_approval_mode,
            sessionApprovalAgentId: threadState.session_approval_agent_id,
            sessionApprovalGrantedAt: threadState.session_approval_granted_at
              ? formatTimelineTimestamp(threadState.session_approval_granted_at)
              : null,
            lastState: threadState.last_state,
            lastErrorSummary: threadState.last_error_summary || null,
          }
        : null,
      messages: context.messages,
      relatedRuns: relatedRuns.map((row) => ({
        runId: row.id,
        title: row.title,
        status: row.status,
        agent: row.agent_name,
        updatedAt: formatTimelineTimestamp(row.updated_at),
      })),
      activity: loadThreadActivityTimeline(db, threadId, input?.limit ?? 8).map((event) => ({
        title: event.title,
        body: event.body,
        tone: event.tone,
        timestamp: formatTimelineTimestamp(event.created_at),
      })),
      reproductionHints: [
        context.thread?.contextKey ? `Open ${context.thread.contextKey} and replay the same chat flow.` : null,
        context.thread?.lastIntent ? `Repeat the request that classified as ${context.thread.lastIntent}.` : null,
        threadState?.last_error_summary ? `Watch for the same error: ${truncate(threadState.last_error_summary, 140)}.` : null,
      ].filter((value): value is string => Boolean(value)),
      note: null,
    };
  },

  getRecentDeploys(limit = 5) {
    return {
      telemetryAvailable: false,
      source: "not_connected",
      items: [] as Array<unknown>,
      note: "Deploy telemetry is not connected yet, so BukowskiOS cannot show recent deploys in this phase.",
      requestedLimit: limit,
    };
  },

  getAgentFailures(input?: { agentKey?: string | null; limit?: number }) {
    const rows = db
      .prepare(
        `
          SELECT
            agent_runs.id,
            agent_runs.thread_id,
            agent_runs.title,
            agent_runs.status,
            agent_runs.updated_at,
            COALESCE(agent_runs.output_summary, agent_runs.input_summary, '') AS summary_text,
            COALESCE(agents.display_name, 'Supervisor Agent') AS agent_name,
            COALESCE(agents.agent_key, 'supervisor-agent') AS agent_key
          FROM agent_runs
          LEFT JOIN agents ON agents.id = agent_runs.agent_id
          WHERE agent_runs.workspace_id = ?
            AND agent_runs.status IN ('failed', 'provider_error', 'tool_error', 'structured_error', 'needs_configuration')
            AND (? IS NULL OR agents.agent_key = ?)
          ORDER BY agent_runs.updated_at DESC
          LIMIT ?
        `,
      )
      .all(workspaceId, input?.agentKey ?? null, input?.agentKey ?? null, input?.limit ?? 8) as Array<{
      id: string;
      thread_id: string | null;
      title: string;
      status: string;
      updated_at: string;
      summary_text: string;
      agent_name: string;
      agent_key: string;
    }>;

    return {
      count: rows.length,
      byStatus: rows.reduce<Record<string, number>>((accumulator, row) => {
        accumulator[row.status] = (accumulator[row.status] ?? 0) + 1;
        return accumulator;
      }, {}),
      items: rows.map((row) => ({
        runId: row.id,
        issueId: `run:${row.id}`,
        threadId: row.thread_id,
        title: row.title,
        status: row.status,
        severity: deriveSystemIssueSeverity("run", row.status),
        agent: row.agent_name,
        agentKey: row.agent_key,
        updatedAt: formatTimelineTimestamp(row.updated_at),
        summary: row.summary_text || "Failure without compact summary.",
      })),
    };
  },

  getUserFeedback(input?: { query?: string | null; limit?: number }) {
    const rows = db
      .prepare(
        `
          SELECT
            id,
            body,
            source_reason,
            confidence,
            agent_id,
            project_id,
            updated_at
          FROM assistant_memory_entries
          WHERE workspace_id = ?
            AND status = 'active'
            AND kind = 'product_feedback'
          ORDER BY updated_at DESC
          LIMIT 24
        `,
      )
      .all(workspaceId) as Array<{
      id: string;
      body: string;
      source_reason: string;
      confidence: number;
      agent_id: string | null;
      project_id: string | null;
      updated_at: string;
    }>;

    return rows
      .filter((row) => matchesSearch(input?.query ?? undefined, [row.body, row.source_reason, row.project_id]))
      .slice(0, input?.limit ?? 8)
      .map((row) => ({
        id: row.id,
        body: row.body,
        sourceReason: row.source_reason,
        confidence: row.confidence,
        agentId: row.agent_id,
        projectId: row.project_id,
        updatedAt: formatTimelineTimestamp(row.updated_at),
      }));
  },

  getFeatureUsage(limit = 6) {
    const rows = db
      .prepare(
        `
          SELECT
            context_key,
            context_label,
            COUNT(*) AS thread_count,
            MAX(updated_at) AS last_seen_at
          FROM assistant_chat_threads
          WHERE deleted_at IS NULL
          GROUP BY context_key, context_label
          ORDER BY thread_count DESC, last_seen_at DESC
          LIMIT ?
        `,
      )
      .all(limit) as Array<{
      context_key: string;
      context_label: string;
      thread_count: number;
      last_seen_at: string | null;
    }>;

    return {
      telemetryAvailable: true,
      source: "assistant_chat_threads",
      note: "This is currently surface usage from durable assistant threads, not full product analytics.",
      items: rows.map((row) => ({
        contextKey: row.context_key,
        contextLabel: row.context_label,
        threadCount: row.thread_count,
        lastSeenAt: row.last_seen_at ? formatTimelineTimestamp(row.last_seen_at) : "—",
      })),
    };
  },

  getFunnelDropoffs(limit = 6) {
    const rows = db
      .prepare(
        `
          SELECT last_state, COUNT(*) AS thread_count
          FROM assistant_chat_thread_state
          GROUP BY last_state
          ORDER BY thread_count DESC
          LIMIT ?
        `,
      )
      .all(limit) as Array<{
      last_state: string;
      thread_count: number;
    }>;

    return {
      telemetryAvailable: true,
      source: "assistant_chat_thread_state",
      note: "This funnel reflects assistant-thread outcomes only, not whole-app onboarding or product conversion.",
      items: rows.map((row) => ({
        state: row.last_state,
        threadCount: row.thread_count,
        isDropoff:
          row.last_state === "provider_error" ||
          row.last_state === "tool_error" ||
          row.last_state === "structured_error" ||
          row.last_state === "interrupted" ||
          row.last_state === "needs_configuration",
      })),
    };
  },

  getBacklogItems(limit = 8) {
    const rows = db
      .prepare(
        `
          SELECT
            agent_runs.id,
            agent_runs.thread_id,
            agent_runs.title,
            agent_runs.status,
            agent_runs.updated_at,
            COALESCE(agent_runs.output_summary, '') AS output_summary,
            COALESCE(agents.display_name, 'Unknown agent') AS agent_name,
            COALESCE(agents.agent_key, '') AS agent_key
          FROM agent_runs
          LEFT JOIN agents ON agents.id = agent_runs.agent_id
          WHERE agent_runs.workspace_id = ?
            AND agents.agent_key IN ('bugs-agent', 'product-agent')
          ORDER BY agent_runs.updated_at DESC
          LIMIT ?
        `,
      )
      .all(workspaceId, limit) as Array<{
      id: string;
      thread_id: string | null;
      title: string;
      status: string;
      updated_at: string;
      output_summary: string;
      agent_name: string;
      agent_key: string;
    }>;

    return rows.map((row) => ({
      runId: row.id,
      threadId: row.thread_id,
      title: row.title,
      status: row.status,
      agent: row.agent_name,
      agentKey: row.agent_key,
      updatedAt: formatTimelineTimestamp(row.updated_at),
      summary: row.output_summary || "Draft item recorded for supervised review.",
    }));
  },

  getProjectFinancials(projectId: string) {
    const detail = this.getProjectDetail(projectId);
    const entries = this.getFinanceEntries({
      search: detail.project?.name ?? "",
      sortBy: "date",
      sortDirection: "desc",
    }).slice(0, 8);

    if (!detail.project) {
      return {
        project: null,
        budget: null,
        recentEntries: [],
      };
    }

    return {
      project: {
        id: detail.project.id,
        name: detail.project.name,
        status: detail.project.status,
      },
      budget: detail.budget,
      recentEntries: entries.filter((entry) => entry.project === detail.project?.name),
    };
  },

  getIncidentCosts(input?: { incidentId?: string | null; projectId?: string | null; limit?: number }) {
    return this.getFinanceCostLinks()
      .filter((row) => !input?.projectId || row.project === (this.getProjectDetail(input.projectId).project?.name ?? row.project))
      .filter((row) => !input?.incidentId || row.incident === (this.getIncidentDetail(input.incidentId)?.title ?? row.incident))
      .slice(0, input?.limit ?? 8);
  },

  getAssetExposure(assetId: string) {
    const detail = this.getAssetDetail(assetId);

    if (!detail.asset) {
      return null;
    }

    const linkedFinance = db
      .prepare(
        `
          SELECT
            id,
            entry_type,
            category,
            amount,
            status,
            entry_date
          FROM financial_entries
          WHERE asset_id = ?
          ORDER BY entry_date DESC
          LIMIT 8
        `,
      )
      .all(assetId) as Array<{
      id: string;
      entry_type: string;
      category: string;
      amount: number;
      status: string;
      entry_date: string;
    }>;

    return {
      asset: detail.asset,
      linkedIncidents: detail.linkedIncidents,
      financeEntries: linkedFinance.map((row) => ({
        id: row.id,
        type: row.entry_type,
        category: row.category,
        amount: formatCurrency(row.amount),
        status: row.status,
        date: formatShortDate(row.entry_date),
      })),
    };
  },

  getOpenInvoices(limit = 8) {
    const rows = db
      .prepare(
        `
          SELECT
            financial_entries.id,
            financial_entries.entry_date,
            financial_entries.amount,
            financial_entries.status,
            COALESCE(projects.name, '—') AS project_name,
            COALESCE(financial_entries.description, financial_entries.category, financial_entries.id) AS label
          FROM financial_entries
          LEFT JOIN projects ON projects.id = financial_entries.project_id
          WHERE financial_entries.entry_type = 'invoice'
            AND financial_entries.status NOT IN ('Paid', 'Cancelled')
          ORDER BY financial_entries.entry_date DESC
          LIMIT ?
        `,
      )
      .all(limit) as Array<{
      id: string;
      entry_date: string;
      amount: number;
      status: string;
      project_name: string;
      label: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      date: formatShortDate(row.entry_date),
      amount: formatCurrency(row.amount),
      status: row.status,
      project: row.project_name,
      label: row.label,
    }));
  },

  getReservesStatus(projectId?: string | null) {
    const rows = db
      .prepare(
        `
          SELECT
            financial_entries.id,
            financial_entries.entry_date,
            financial_entries.amount,
            financial_entries.status,
            COALESCE(projects.name, '—') AS project_name,
            COALESCE(financial_entries.description, financial_entries.category, financial_entries.id) AS label
          FROM financial_entries
          LEFT JOIN projects ON projects.id = financial_entries.project_id
          WHERE financial_entries.entry_type = 'reserve'
            AND (? IS NULL OR financial_entries.project_id = ?)
          ORDER BY financial_entries.entry_date DESC
          LIMIT 12
        `,
      )
      .all(projectId ?? null, projectId ?? null) as Array<{
      id: string;
      entry_date: string;
      amount: number;
      status: string;
      project_name: string;
      label: string;
    }>;

    const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0);

    return {
      totalReserve: formatCurrency(totalAmount),
      items: rows.map((row) => ({
        id: row.id,
        date: formatShortDate(row.entry_date),
        amount: formatCurrency(row.amount),
        status: row.status,
        project: row.project_name,
        label: row.label,
      })),
    };
  },
};
};

export type FoundationReadService = ReturnType<typeof createFoundationReadService>;
