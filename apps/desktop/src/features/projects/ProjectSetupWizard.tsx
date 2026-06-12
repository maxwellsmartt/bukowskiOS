import { AlertTriangle, ChevronDown, ChevronRight, FileDown, Plus, Save, Trash2, X } from "lucide-react";
import type { TFunction } from "i18next";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import type {
  CatalogAssetOptionRow,
  CatalogCrewRow,
  CreateProjectBlueprintInput,
  ListSortDirection,
  ProjectCreationConflictsSnapshot,
  ProjectColorKey,
  ProjectBlueprintCrewDraftInput,
  ProjectBlueprintPackingSeed,
  ProjectBlueprintUnitDepartmentDraftInput,
  ProjectBlueprintUnitDraftInput,
  ProjectBlueprintUnitWindowInput,
  ProjectCardRow,
  StagingPackingSlipRow,
} from "@contracts";
import { useNotifications } from "@app/providers/NotificationsProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { useToast } from "@app/providers/ToastProvider";
import { useCatalogData, exportProjectBlueprintPdf, getProjectCreationConflicts, getStagingPackingSlips } from "@features/projects/useProjectsData";
import { ListToolbar } from "@shared/components/ListToolbar";
import { ProjectColorSelect } from "@shared/components/ProjectColorSelect";
import { RequiredLabel } from "@shared/components/RequiredLabel";
import { SelectField } from "@shared/components/SelectField";
import { StatusBadge } from "@shared/components/StatusBadge";
import { useShellContext } from "@shared/hooks/useShellContext";
import { getUserFacingErrorMessage } from "@shared/lib/errors";
import { notifyExportResult } from "@shared/lib/exportNotifications";

const projectStatusOptions = ["Prep", "Active", "Wrapped", "On hold"] as const;
const additionalUnitPresets = ["Second Unit", "Third Unit", "Splinter Unit", "Insert Unit"] as const;
const additionalUnitPresetOptions = [...additionalUnitPresets, "Custom unit"] as const;

type WizardTab = "general" | "assets" | "crew" | "units" | "summary";
type AssignmentUnitId = "main" | string;
type AssetAvailableSort = "name" | "code" | "category" | "status";
type AssetSelectedSort = "name" | "code" | "category";
type CrewAvailableSort = "name" | "role";
type CrewSelectedSort = "name" | "role" | "startDate";
type AssignmentDepartmentId = string;

type ProjectSetupDraft = {
  generalInfo: {
    code: string;
    name: string;
    clientId: string;
    productionCompanyId: string;
    startDate: string;
    endDate: string;
    hasPreproduction: boolean;
    preproductionStartDate: string;
    preproductionEndDate: string;
    status: string;
    colorKey: string;
    description: string;
    departmentIds: string[];
  };
  mainUnit: ProjectBlueprintUnitDraftInput;
  additionalUnits: ProjectBlueprintUnitDraftInput[];
};

type ProjectSetupWizardProps = {
  activeTab: WizardTab;
  draft: ProjectSetupDraft;
  onChangeDraft: (draft: ProjectSetupDraft) => void;
  onChangeTab: (tab: WizardTab) => void;
  onClose: () => void;
  onDiscardDraft: () => void;
  open: boolean;
};

type SelectedAssetIssue = {
  assetId: string;
  label: string;
  reason: string;
};

const emptyCrewAssignment = (): ProjectBlueprintCrewDraftInput => ({
  crewMemberId: "",
  roleLabel: "",
  startDate: "",
  endDate: "",
  notes: "",
});

const emptyPackingSeed = (): ProjectBlueprintPackingSeed => ({
  mode: "none",
});

const uniqueIds = (values: string[]) => [...new Set(values.filter((value) => value.trim()))];

const createUnitDepartmentDraft = (departmentId: string): ProjectBlueprintUnitDepartmentDraftInput => ({
  departmentId,
  assetIds: [],
  crewAssignments: [],
  packingSeed: emptyPackingSeed(),
});

const syncUnitDepartments = (
  unit: ProjectBlueprintUnitDraftInput,
  nextDepartmentIds: string[],
): ProjectBlueprintUnitDepartmentDraftInput[] => {
  const normalizedDepartmentIds = uniqueIds(nextDepartmentIds);
  return normalizedDepartmentIds.map(
    (departmentId) =>
      unit.unitDepartments.find((bucket) => bucket.departmentId === departmentId) ?? createUnitDepartmentDraft(departmentId),
  );
};

const deriveProjectDepartmentIds = (draft: ProjectSetupDraft) =>
  uniqueIds([
    ...draft.mainUnit.departmentIds,
    ...draft.mainUnit.unitDepartments.map((bucket) => bucket.departmentId),
    ...draft.additionalUnits.flatMap((unit) => [
      ...unit.departmentIds,
      ...unit.unitDepartments.map((bucket) => bucket.departmentId),
    ]),
  ]);

const createEmptyDraft = (): ProjectSetupDraft => ({
  generalInfo: {
    code: "",
    name: "",
    clientId: "",
    productionCompanyId: "",
    startDate: "",
    endDate: "",
    hasPreproduction: false,
    preproductionStartDate: "",
    preproductionEndDate: "",
    status: "Prep",
    colorKey: "",
    description: "",
    departmentIds: [],
  },
  mainUnit: {
    name: "Main Unit",
    suggestedPreset: "Main Unit",
    colorKey: "",
    windows: [],
    departmentIds: [],
    unitDepartments: [],
    notes: "",
  },
  additionalUnits: [],
});

const normalizeOptional = (value?: string | null) => {
  const nextValue = value?.trim() ?? "";
  return nextValue ? nextValue : undefined;
};

const normalizeBucketForSubmit = (bucket: ProjectBlueprintUnitDepartmentDraftInput): ProjectBlueprintUnitDepartmentDraftInput => ({
  departmentId: bucket.departmentId,
  assetIds: [...new Set(bucket.assetIds)],
  crewAssignments: bucket.crewAssignments
    .filter((assignment) => assignment.crewMemberId?.trim())
    .map((assignment) => ({
      crewMemberId: assignment.crewMemberId,
      roleLabel: normalizeOptional(assignment.roleLabel),
      startDate: normalizeOptional(assignment.startDate),
      endDate: normalizeOptional(assignment.endDate),
      notes: normalizeOptional(assignment.notes),
    })),
  packingSeed:
    !bucket.packingSeed || bucket.packingSeed.mode === "none"
      ? { mode: "none" }
      : bucket.packingSeed.mode === "existing"
        ? {
            mode: "existing",
            packingSlipId: bucket.packingSeed.packingSlipId,
          }
        : {
            mode: "draft",
            label: normalizeOptional(bucket.packingSeed.label),
            responsibleUserId: normalizeOptional(bucket.packingSeed.responsibleUserId),
            notes: normalizeOptional(bucket.packingSeed.notes),
          },
});

type ProjectBlueprintDraftSubmitInput = Omit<CreateProjectBlueprintInput, "workspaceId">;

const normalizeDraftForSubmit = (draft: ProjectSetupDraft): ProjectBlueprintDraftSubmitInput => ({
  generalInfo: {
    code: draft.generalInfo.code.trim(),
    name: draft.generalInfo.name.trim(),
    clientId: normalizeOptional(draft.generalInfo.clientId),
    productionCompanyId: normalizeOptional(draft.generalInfo.productionCompanyId),
    startDate: draft.generalInfo.startDate.trim(),
    endDate: draft.generalInfo.endDate.trim(),
    hasPreproduction: draft.generalInfo.hasPreproduction,
    preproductionStartDate: normalizeOptional(draft.generalInfo.preproductionStartDate),
    preproductionEndDate: normalizeOptional(draft.generalInfo.preproductionEndDate),
    status: draft.generalInfo.status.trim(),
    colorKey: draft.generalInfo.colorKey.trim(),
    description: normalizeOptional(draft.generalInfo.description),
    departmentIds: deriveProjectDepartmentIds(draft),
  },
  mainUnit: {
    name: "Main Unit",
    suggestedPreset: "Main Unit",
    colorKey: normalizeOptional(draft.generalInfo.colorKey),
    windows: draft.generalInfo.startDate || draft.generalInfo.endDate ? [{ startDate: normalizeOptional(draft.generalInfo.startDate), endDate: normalizeOptional(draft.generalInfo.endDate), sortOrder: 0 }] : [],
    departmentIds: uniqueIds(draft.mainUnit.departmentIds),
    unitDepartments: syncUnitDepartments(draft.mainUnit, draft.mainUnit.departmentIds).map(normalizeBucketForSubmit),
    notes: normalizeOptional(draft.mainUnit.notes),
  },
  additionalUnits: draft.additionalUnits.map((unit, index) => ({
    id: normalizeOptional(unit.id),
    code: normalizeOptional(unit.code),
    name: unit.name.trim(),
    suggestedPreset: normalizeOptional(unit.suggestedPreset),
    sortOrder: unit.sortOrder ?? index + 1,
    colorKey: normalizeOptional(unit.colorKey),
    windows: unit.windows.map((window, windowIndex) => ({
      id: normalizeOptional(window.id),
      startDate: normalizeOptional(window.startDate),
      endDate: normalizeOptional(window.endDate),
      sortOrder: window.sortOrder ?? windowIndex,
      label: normalizeOptional(window.label),
    })),
    departmentIds: uniqueIds(unit.departmentIds),
    unitDepartments: syncUnitDepartments(unit, unit.departmentIds).map(normalizeBucketForSubmit),
    notes: normalizeOptional(unit.notes),
  })),
});

const isProjectSetupDraftDirty = (draft: ProjectSetupDraft) => JSON.stringify(normalizeDraftForSubmit(draft)) !== JSON.stringify(normalizeDraftForSubmit(createEmptyDraft()));

const buildNewAdditionalUnit = (preset = "Second Unit", index = 0): ProjectBlueprintUnitDraftInput => ({
  name: preset,
  suggestedPreset: preset,
  code: "",
  sortOrder: index + 1,
  colorKey: "",
  windows: [{ startDate: "", endDate: "", sortOrder: 0 }],
  departmentIds: [],
  unitDepartments: [],
  notes: "",
});

const getUnitWindows = (unit: ProjectBlueprintUnitDraftInput) => (unit.windows?.length ? unit.windows : [{ startDate: "", endDate: "", sortOrder: 0 }]);

const getUnitBounds = (unit: ProjectBlueprintUnitDraftInput, fallbackStart?: string | null, fallbackEnd?: string | null) => {
  const datedWindows = getUnitWindows(unit).filter((window) => window.startDate && window.endDate);

  if (!datedWindows.length) {
    return {
      startDate: fallbackStart ?? null,
      endDate: fallbackEnd ?? null,
    };
  }

  return {
    startDate: datedWindows.reduce((current, window) => (!current || (window.startDate ?? "") < current ? window.startDate ?? current : current), datedWindows[0]?.startDate ?? null),
    endDate: datedWindows.reduce((current, window) => (!current || (window.endDate ?? "") > current ? window.endDate ?? current : current), datedWindows[0]?.endDate ?? null),
  };
};

const getWindowsBounds = (windows: Array<{ startDate: string | null; endDate: string | null }>) => {
  const datedWindows = windows.filter((window) => window.startDate && window.endDate);

  if (!datedWindows.length) {
    return {
      startDate: windows[0]?.startDate ?? null,
      endDate: windows[0]?.endDate ?? null,
    };
  }

  return {
    startDate: datedWindows.reduce((current, window) => (!current || (window.startDate ?? "") < current ? window.startDate ?? current : current), datedWindows[0]?.startDate ?? null),
    endDate: datedWindows.reduce((current, window) => (!current || (window.endDate ?? "") > current ? window.endDate ?? current : current), datedWindows[0]?.endDate ?? null),
  };
};

const formatUnitWindowSummary = (
  unit: ProjectBlueprintUnitDraftInput,
  fallbackStart?: string | null,
  fallbackEnd?: string | null,
  t?: TFunction,
) => {
  const openLabel = t?.("projectSetup.units.openDate") ?? "Open";
  const noDatesLabel = t?.("projectSetup.units.noDatesSelected") ?? "No dates selected";
  const windows = getUnitWindows(unit).filter((window) => window.startDate || window.endDate);
  if (!windows.length) {
    if (fallbackStart || fallbackEnd) {
      return `${fallbackStart ?? openLabel} - ${fallbackEnd ?? openLabel}`;
    }

    return noDatesLabel;
  }

  const labels = windows.map((window) => `${window.startDate ?? openLabel} - ${window.endDate ?? openLabel}`);
  if (labels.length === 1) {
    return labels[0] ?? noDatesLabel;
  }

  const preview = labels.slice(0, 3).join(", ");
  return t?.("projectSetup.units.windowSummary", { count: labels.length, preview, more: labels.length > 3 ? "…" : "" }) ?? `${labels.length} windows · ${preview}${labels.length > 3 ? "…" : ""}`;
};

const formatWindowsList = (windows: Array<{ startDate: string | null; endDate: string | null }>, t?: TFunction) => {
  const openLabel = t?.("projectSetup.units.openDate") ?? "Open";
  const labels = windows
    .filter((window) => window.startDate || window.endDate)
    .map((window) => `${window.startDate ?? openLabel} - ${window.endDate ?? openLabel}`);

  return labels.length ? labels : [t?.("projectSetup.units.noDatesSelected") ?? "No dates selected"];
};

const getUnitDepartmentNames = (
  unit: ProjectBlueprintUnitDraftInput,
  departments: Array<{ id: string; code: string; name: string }>,
) =>
  unit.departmentIds
    .map((departmentId) => departments.find((row) => row.id === departmentId)?.name)
    .filter((value): value is string => Boolean(value));

const getUnitAssetIds = (unit: ProjectBlueprintUnitDraftInput) =>
  uniqueIds(unit.unitDepartments.flatMap((bucket) => bucket.assetIds));

const getUnitCrewAssignments = (unit: ProjectBlueprintUnitDraftInput) =>
  unit.unitDepartments.flatMap((bucket) => bucket.crewAssignments.filter((assignment) => assignment.crewMemberId?.trim()));

const countAssignedCrew = (assignments: ProjectBlueprintCrewDraftInput[]) => assignments.filter((assignment) => Boolean(assignment.crewMemberId?.trim())).length;

const countAssignedCrewForUnit = (unit: ProjectBlueprintUnitDraftInput) => countAssignedCrew(getUnitCrewAssignments(unit));

const unitConflictCount = (
  unit: ProjectBlueprintUnitDraftInput,
  conflictSnapshot: ProjectCreationConflictsSnapshot | null,
) => {
  if (!conflictSnapshot) {
    return 0;
  }

  const relevantAssets = new Set(getUnitAssetIds(unit));
  const relevantCrew = new Set(getUnitCrewAssignments(unit).map((assignment) => assignment.crewMemberId).filter(Boolean));

  return conflictSnapshot.groups.reduce((count, group) => {
    return (
      count +
      group.items.filter((item) => {
        if (group.type === "asset") {
          return relevantAssets.has(item.resourceId);
        }

        if (group.type === "crew") {
          return relevantCrew.has(item.resourceId);
        }

        return false;
      }).length
    );
  }, 0);
};

const isValidDateWindow = (startDate: string, endDate: string) => !startDate || !endDate || startDate <= endDate;

const buildValidationErrors = (draft: ProjectSetupDraft, t: TFunction, existingProjects: ProjectCardRow[]) => {
  const errors: string[] = [];
  const projectDepartmentIds = deriveProjectDepartmentIds(draft);
  const normalizedCode = draft.generalInfo.code.trim().toUpperCase();

  if (!draft.generalInfo.name.trim()) {
    errors.push(t("projectSetup.validation.projectNameRequired"));
  }

  if (normalizedCode && existingProjects.some((project) => project.code.trim().toUpperCase() === normalizedCode)) {
    errors.push(t("projectSetup.validation.projectCodeAlreadyExists", { code: normalizedCode }));
  }

  if (!draft.generalInfo.startDate) {
    errors.push(t("projectSetup.validation.startDateRequired"));
  }

  if (!draft.generalInfo.endDate) {
    errors.push(t("projectSetup.validation.endDateRequired"));
  }

  if (!isValidDateWindow(draft.generalInfo.startDate, draft.generalInfo.endDate)) {
    errors.push(t("projectSetup.validation.projectEndAfterStart"));
  }

  if (!draft.generalInfo.status.trim()) {
    errors.push(t("projectSetup.validation.statusRequired"));
  }

  if (!draft.generalInfo.colorKey.trim()) {
    errors.push(t("projectSetup.validation.timelineColorRequired"));
  }

  if (draft.generalInfo.hasPreproduction) {
    if (!draft.generalInfo.preproductionStartDate || !draft.generalInfo.preproductionEndDate) {
      errors.push(t("projectSetup.validation.preproductionDatesRequired"));
    }

    if (!isValidDateWindow(draft.generalInfo.preproductionStartDate, draft.generalInfo.preproductionEndDate)) {
      errors.push(t("projectSetup.validation.preproductionEndAfterStart"));
    }

    if (
      draft.generalInfo.startDate &&
      draft.generalInfo.preproductionEndDate &&
      draft.generalInfo.preproductionEndDate > draft.generalInfo.startDate
    ) {
      errors.push(t("projectSetup.validation.preproductionBeforeMain"));
    }
  }

  draft.additionalUnits.forEach((unit, index) => {
    if (!unit.name.trim()) {
      errors.push(t("projectSetup.validation.additionalUnitName", { number: index + 1 }));
    }

    getUnitWindows(unit).forEach((window, windowIndex) => {
      if (!isValidDateWindow(window.startDate ?? "", window.endDate ?? "")) {
        errors.push(t("projectSetup.validation.additionalUnitWindow", { unit: index + 1, window: windowIndex + 1 }));
      }
    });

    unit.departmentIds.forEach((departmentId) => {
      if (!projectDepartmentIds.includes(departmentId)) {
        errors.push(t("projectSetup.validation.additionalUnitDepartment", { number: index + 1 }));
      }
    });
  });

  return errors;
};

const normalizeSearch = (value: string) => value.trim().toLowerCase();

const matchesSearch = (searchValue: string, values: Array<string | undefined>) => {
  const query = normalizeSearch(searchValue);
  if (!query) {
    return true;
  }

  return values.some((value) => normalizeSearch(value ?? "").includes(query));
};

const compareValues = (left: string, right: string, direction: ListSortDirection) => {
  const result = left.localeCompare(right, undefined, { sensitivity: "base", numeric: true });
  return direction === "asc" ? result : result * -1;
};

const assignmentHasCrewMember = (assignment: ProjectBlueprintCrewDraftInput) => Boolean(assignment.crewMemberId?.trim());
const isAssetOccupiedForNewProject = (asset: CatalogAssetOptionRow) => Boolean(asset.currentProjectId);
const formatAssetOptionLabel = (asset: Pick<CatalogAssetOptionRow, "code" | "name">) => `${asset.code ? `${asset.code} · ` : ""}${asset.name}`;
const assignableOperationalStatuses = new Set(["ready", "available"]);
const datesOverlap = (leftStart?: string | null, leftEnd?: string | null, rightStart?: string | null, rightEnd?: string | null) =>
  (!leftEnd || !rightStart || leftEnd >= rightStart) && (!rightEnd || !leftStart || rightEnd >= leftStart);
const resolveAssignmentWindow = (
  assignment: ProjectBlueprintCrewDraftInput,
  fallbackStart?: string | null,
  fallbackEnd?: string | null,
) => ({
  startDate: assignment.startDate ?? fallbackStart ?? null,
  endDate: assignment.endDate ?? fallbackEnd ?? null,
});

export const ProjectSetupWizard = ({
  activeTab,
  draft,
  onChangeDraft,
  onChangeTab,
  onClose,
  onDiscardDraft,
  open,
}: ProjectSetupWizardProps) => {
  const { t } = useTranslation();
  const { data: catalog } = useCatalogData();
  const { activeWorkspaceId } = useWorkspace();
  const toast = useToast();
  const { createNotification } = useNotifications();
  const { createProjectBlueprint, openProject, projects } = useShellContext();
  const [stagingSlips, setStagingSlips] = useState<StagingPackingSlipRow[]>([]);
  const [stagingError, setStagingError] = useState<string | null>(null);
  const [isLoadingStaging, setIsLoadingStaging] = useState(false);
  const [conflicts, setConflicts] = useState<ProjectCreationConflictsSnapshot | null>(null);
  const [conflictsError, setConflictsError] = useState<string | null>(null);
  const [isCheckingConflicts, setIsCheckingConflicts] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [expandedUnitIds, setExpandedUnitIds] = useState<string[]>([]);
  const [additionalUnitPresetValue, setAdditionalUnitPresetValue] = useState("");
  const [activeAssignmentUnitId, setActiveAssignmentUnitId] = useState<AssignmentUnitId>("main");
  const [activeAssignmentDepartmentId, setActiveAssignmentDepartmentId] = useState<AssignmentDepartmentId>("");
  const [assetAvailableSearch, setAssetAvailableSearch] = useState("");
  const [assetSelectedSearch, setAssetSelectedSearch] = useState("");
  const [assetAvailableSort, setAssetAvailableSort] = useState<AssetAvailableSort>("name");
  const [assetSelectedSort, setAssetSelectedSort] = useState<AssetSelectedSort>("name");
  const [assetAvailableDirection, setAssetAvailableDirection] = useState<ListSortDirection>("asc");
  const [assetSelectedDirection, setAssetSelectedDirection] = useState<ListSortDirection>("asc");
  const [crewAvailableSearch, setCrewAvailableSearch] = useState("");
  const [crewSelectedSearch, setCrewSelectedSearch] = useState("");
  const deferredAssetAvailableSearch = useDeferredValue(assetAvailableSearch);
  const deferredAssetSelectedSearch = useDeferredValue(assetSelectedSearch);
  const deferredCrewAvailableSearch = useDeferredValue(crewAvailableSearch);
  const deferredCrewSelectedSearch = useDeferredValue(crewSelectedSearch);
  const [crewAvailableSort, setCrewAvailableSort] = useState<CrewAvailableSort>("name");
  const [crewSelectedSort, setCrewSelectedSort] = useState<CrewSelectedSort>("name");
  const [crewAvailableDirection, setCrewAvailableDirection] = useState<ListSortDirection>("asc");
  const [crewSelectedDirection, setCrewSelectedDirection] = useState<ListSortDirection>("asc");
  const dirty = isProjectSetupDraftDirty(draft);

  const validationErrors = useMemo(() => buildValidationErrors(draft, t, projects), [draft, projects, t]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setIsLoadingStaging(true);
    void getStagingPackingSlips()
      .then((rows) => {
        setStagingSlips(rows);
        setStagingError(null);
      })
      .catch((error) => {
        setStagingSlips([]);
        setStagingError(getUserFacingErrorMessage(error, t("projectSetup.errors.loadStaging")));
      })
      .finally(() => setIsLoadingStaging(false));
  }, [open]);

  useEffect(() => {
    if (
      !open ||
      !draft.generalInfo.name.trim() ||
      !draft.generalInfo.startDate.trim() ||
      !draft.generalInfo.endDate.trim() ||
      !draft.generalInfo.status.trim() ||
      !draft.generalInfo.colorKey.trim()
    ) {
      setConflicts(null);
      setConflictsError(null);
      setIsCheckingConflicts(false);
      return;
    }

    const timeout = window.setTimeout(() => {
      setIsCheckingConflicts(true);
      void getProjectCreationConflicts({ ...normalizeDraftForSubmit(draft), workspaceId: activeWorkspaceId })
        .then((snapshot) => {
          setConflicts(snapshot);
          setConflictsError(null);
        })
        .catch((error) => {
          setConflicts(null);
          setConflictsError(getUserFacingErrorMessage(error, t("projectSetup.errors.checkConflicts")));
        })
        .finally(() => setIsCheckingConflicts(false));
    }, 200);

    return () => window.clearTimeout(timeout);
  }, [activeWorkspaceId, draft, open]);

  useEffect(() => {
    if (activeAssignmentUnitId === "main") {
      return;
    }

    const exists = draft.additionalUnits.some((unit) => unit.id === activeAssignmentUnitId);
    if (!exists) {
      setActiveAssignmentUnitId("main");
    }
  }, [activeAssignmentUnitId, draft.additionalUnits]);

  const setGeneralInfo = <K extends keyof ProjectSetupDraft["generalInfo"]>(key: K, value: ProjectSetupDraft["generalInfo"][K]) => {
    onChangeDraft({
      ...draft,
      generalInfo: {
        ...draft.generalInfo,
        [key]: value,
      },
      mainUnit:
        key === "colorKey"
          ? {
              ...draft.mainUnit,
              colorKey: String(value),
            }
          : draft.mainUnit,
    });
  };

  const updateMainUnit = (patch: Partial<ProjectBlueprintUnitDraftInput>) => {
    onChangeDraft({
      ...draft,
      mainUnit: {
        ...draft.mainUnit,
        ...patch,
      },
    });
  };

  const addAdditionalUnit = (preset?: string) => {
    const resolvedPreset = preset && preset !== "Custom unit" ? preset : "Custom unit";
    const unit = buildNewAdditionalUnit(resolvedPreset, draft.additionalUnits.length);
    const nextId = `draft-unit-${Date.now().toString(36)}-${draft.additionalUnits.length}`;
    onChangeDraft({
      ...draft,
      additionalUnits: [
        ...draft.additionalUnits,
        {
          ...unit,
          id: nextId,
          name: resolvedPreset === "Custom unit" ? "" : unit.name,
          suggestedPreset: resolvedPreset,
          departmentIds: [],
          unitDepartments: [],
        },
      ],
    });
    setExpandedUnitIds((current) => [...current, nextId]);
    setAdditionalUnitPresetValue("");
    onChangeTab("units");
  };

  const updateAdditionalUnit = (unitId: string, patch: Partial<ProjectBlueprintUnitDraftInput>) => {
    onChangeDraft({
      ...draft,
      additionalUnits: draft.additionalUnits.map((unit) => (unit.id === unitId ? { ...unit, ...patch } : unit)),
    });
  };

  const addAdditionalUnitWindow = (unitId: string) => {
    const unit = draft.additionalUnits.find((row) => row.id === unitId);
    if (!unit) {
      return;
    }

    updateAdditionalUnit(unitId, {
      windows: [...getUnitWindows(unit), { startDate: "", endDate: "", sortOrder: getUnitWindows(unit).length }],
    });
  };

  const updateAdditionalUnitWindow = (unitId: string, windowIndex: number, patch: Partial<ProjectBlueprintUnitWindowInput>) => {
    const unit = draft.additionalUnits.find((row) => row.id === unitId);
    if (!unit) {
      return;
    }

    updateAdditionalUnit(unitId, {
      windows: getUnitWindows(unit).map((window, index) => (index === windowIndex ? { ...window, ...patch } : window)),
    });
  };

  const removeAdditionalUnitWindow = (unitId: string, windowIndex: number) => {
    const unit = draft.additionalUnits.find((row) => row.id === unitId);
    if (!unit) {
      return;
    }

    const remainingWindows = getUnitWindows(unit).filter((_, index) => index !== windowIndex);
    updateAdditionalUnit(unitId, {
      windows: remainingWindows.length ? remainingWindows : [{ startDate: "", endDate: "", sortOrder: 0 }],
    });
  };

  const removeAdditionalUnit = (unitId: string) => {
    onChangeDraft({
      ...draft,
      additionalUnits: draft.additionalUnits.filter((unit) => unit.id !== unitId),
    });
    setExpandedUnitIds((current) => current.filter((id) => id !== unitId));
  };

  const toggleAdditionalUnitExpansion = (unitId: string) => {
    setExpandedUnitIds((current) => (current.includes(unitId) ? current.filter((id) => id !== unitId) : [...current, unitId]));
  };

  const assignmentUnitOptions = [
    {
      id: "main" as const,
      label: t("projectSetup.units.mainUnit"),
      dateRange:
        draft.generalInfo.startDate || draft.generalInfo.endDate
          ? `${draft.generalInfo.startDate || t("projectSetup.units.openDate")} - ${draft.generalInfo.endDate || t("projectSetup.units.openDate")}`
          : t("projectSetup.units.noDatesSelected"),
      assetCount: getUnitAssetIds(draft.mainUnit).length,
      crewCount: countAssignedCrewForUnit(draft.mainUnit),
    },
    ...draft.additionalUnits.map((unit, index) => ({
      id: (unit.id ?? `additional-${index}`) as AssignmentUnitId,
      label: unit.name || t("projectSetup.units.additionalUnitName", { number: index + 1 }),
      dateRange: formatUnitWindowSummary(unit, draft.generalInfo.startDate, draft.generalInfo.endDate, t),
      assetCount: getUnitAssetIds(unit).length,
      crewCount: countAssignedCrewForUnit(unit),
    })),
  ];

  const activeAssignmentUnit = activeAssignmentUnitId === "main" ? draft.mainUnit : draft.additionalUnits.find((unit) => unit.id === activeAssignmentUnitId) ?? draft.mainUnit;
  const activeAssignmentUnitMeta = assignmentUnitOptions.find((unit) => unit.id === activeAssignmentUnitId) ?? assignmentUnitOptions[0];
  const activeAssignmentWindows =
    activeAssignmentUnitId === "main"
      ? [{ startDate: draft.generalInfo.startDate || null, endDate: draft.generalInfo.endDate || null }]
      : getUnitWindows(activeAssignmentUnit).map((window) => ({
          startDate: window.startDate ?? draft.generalInfo.startDate ?? null,
          endDate: window.endDate ?? draft.generalInfo.endDate ?? null,
        }));
  const activeAssignmentWindowEntries = activeAssignmentWindows.filter((window) => window.startDate || window.endDate);
  const activeUnitDepartmentIds = activeAssignmentUnit.departmentIds;

  useEffect(() => {
    if (!activeUnitDepartmentIds.length) {
      setActiveAssignmentDepartmentId("");
      return;
    }

    if (!activeUnitDepartmentIds.includes(activeAssignmentDepartmentId)) {
      setActiveAssignmentDepartmentId(activeUnitDepartmentIds[0] ?? "");
    }
  }, [activeAssignmentDepartmentId, activeUnitDepartmentIds]);

  const activeAssignmentDepartment =
    catalog.departments.find((department) => department.id === activeAssignmentDepartmentId) ?? null;
  const activeAssignmentBucket =
    activeAssignmentUnit.unitDepartments.find((bucket) => bucket.departmentId === activeAssignmentDepartmentId) ?? null;
  const renderDepartmentPicker = (unitId: AssignmentUnitId, selectedDepartmentIds: string[]) => (
    <div className="project-setup-department-picker" role="list">
      {catalog.departments.map((department) => {
        const selected = selectedDepartmentIds.includes(department.id);
        return (
          <button
            key={department.id}
            className={`project-setup-checklist-row project-setup-department-option${selected ? " is-selected" : ""}`}
            onClick={() =>
              updateAssignmentUnitDepartmentIds(
                unitId,
                selected
                  ? selectedDepartmentIds.filter((departmentId) => departmentId !== department.id)
                  : [...selectedDepartmentIds, department.id],
              )
            }
            type="button"
          >
            <span className={`project-setup-checklist-toggle${selected ? " is-selected" : ""}`} />
            <span className="project-setup-checklist-copy">
              <strong>{department.name}</strong>
            </span>
          </button>
        );
      })}
    </div>
  );
  const renderAssignmentTargetPanel = (mode: "assets" | "crew") => (
    <div className="project-setup-inline-card project-setup-target-card">
      <div className="project-setup-card-heading">
        <div>
          <h3>{t(`projectSetup.${mode}.assignToUnit`)}</h3>
          <p>{t(`projectSetup.${mode}.assignToUnitHelp`)}</p>
        </div>
      </div>

      <div className="project-setup-assignment-unit-grid" role="list">
        {assignmentUnitOptions.map((unit) => (
          <button
            key={unit.id}
            className={`project-setup-assignment-unit-card${unit.id === activeAssignmentUnitId ? " is-active" : ""}`}
            onClick={() => setActiveAssignmentUnitId(unit.id)}
            type="button"
          >
            <strong>{unit.label}</strong>
            <span>{unit.dateRange}</span>
            <small>
              {t("projectSetup.assets.unitCounts", {
                assets: unit.assetCount,
                crew: unit.crewCount,
              })}
            </small>
          </button>
        ))}
      </div>

      {renderActiveWindowBadges()}

      <div className="project-setup-target-departments">
        <div className="project-setup-card-heading">
          <div>
            <h3>{t(`projectSetup.${mode}.assignToDepartment`)}</h3>
            <p>{t(`projectSetup.${mode}.assignToDepartmentHelp`)}</p>
          </div>
        </div>

        {activeUnitDepartmentIds.length ? (
          <div className="project-setup-department-chip-row" role="list">
            {activeUnitDepartmentIds.map((departmentId) => {
              const department = catalog.departments.find((row) => row.id === departmentId);
              const bucket = activeAssignmentUnit.unitDepartments.find((row) => row.departmentId === departmentId);
              const active = departmentId === activeAssignmentDepartmentId;
              const crewPreview = (bucket?.crewAssignments ?? [])
                .filter(assignmentHasCrewMember)
                .slice(0, 2)
                .map((assignment) => catalog.crewMembers.find((crewMember) => crewMember.id === assignment.crewMemberId)?.fullName ?? t("projectSetup.crew.assignmentFallback"));
              return (
                <button
                  key={departmentId}
                  className={`project-setup-department-chip${mode === "crew" ? " is-crew" : ""}${active ? " is-active" : ""}`}
                  onClick={() => setActiveAssignmentDepartmentId(departmentId)}
                  type="button"
                >
                  <strong>{department?.name ?? departmentId}</strong>
                  <span>
                    {t("projectSetup.assets.departmentCounts", {
                      assets: bucket?.assetIds.length ?? 0,
                      crew: countAssignedCrew(bucket?.crewAssignments ?? []),
                    })}
                  </span>
                  {mode === "crew" ? (
                    <small>
                      {crewPreview.length
                        ? crewPreview.join(", ")
                        : t("projectSetup.crew.emptyDepartment")}
                    </small>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : (
          <span className="project-setup-field-note">{t("projectSetup.assets.noDepartmentBody")}</span>
        )}
      </div>
    </div>
  );
  const renderActiveWindowBadges = () =>
    activeAssignmentWindowEntries.length ? (
      <div className="project-setup-window-badges" role="presentation">
        {activeAssignmentWindowEntries.map((window, index) => (
          <span key={`${window.startDate ?? "open"}-${window.endDate ?? "open"}-${index}`} className={`project-setup-window-badge tone-${(index % 4) + 1}`}>
            <strong>{t("projectSetup.crew.windowNumber", { number: index + 1 })}</strong>
            <span>{`${window.startDate ?? t("projectSetup.units.openDate")} - ${window.endDate ?? t("projectSetup.units.openDate")}`}</span>
          </span>
        ))}
      </div>
    ) : (
      <span className="project-setup-field-note">{t("projectSetup.units.noDatesForUnit")}</span>
    );

  const updateAssignmentUnit = (patch: Partial<ProjectBlueprintUnitDraftInput>) => {
    if (activeAssignmentUnitId === "main") {
      updateMainUnit(patch);
      return;
    }

    updateAdditionalUnit(activeAssignmentUnitId, patch);
  };

  const updateAssignmentUnitDepartmentIds = (unitId: AssignmentUnitId, departmentIds: string[]) => {
    const catalogDepartmentIds = new Set(catalog.departments.map((department) => department.id));
    const normalizedDepartmentIds = uniqueIds(departmentIds.filter((departmentId) => catalogDepartmentIds.has(departmentId)));

    if (unitId === "main") {
      updateMainUnit({
        departmentIds: normalizedDepartmentIds,
        unitDepartments: syncUnitDepartments({ ...draft.mainUnit, departmentIds: normalizedDepartmentIds }, normalizedDepartmentIds),
      });
      return;
    }

    const currentUnit = draft.additionalUnits.find((unit) => unit.id === unitId);
    if (!currentUnit) {
      return;
    }

    updateAdditionalUnit(unitId, {
      departmentIds: normalizedDepartmentIds,
      unitDepartments: syncUnitDepartments({ ...currentUnit, departmentIds: normalizedDepartmentIds }, normalizedDepartmentIds),
    });
  };

  const setAssignmentUnitAssets = (assetIds: string[]) => {
    if (!activeAssignmentDepartmentId) {
      return;
    }

    updateAssignmentUnit({
      unitDepartments: syncUnitDepartments(activeAssignmentUnit, activeAssignmentUnit.departmentIds).map((bucket) =>
        bucket.departmentId === activeAssignmentDepartmentId ? { ...bucket, assetIds } : bucket,
      ),
    });
  };

  const setAssignmentUnitCrewAssignments = (crewAssignments: ProjectBlueprintCrewDraftInput[]) => {
    if (!activeAssignmentDepartmentId) {
      return;
    }

    updateAssignmentUnit({
      unitDepartments: syncUnitDepartments(activeAssignmentUnit, activeAssignmentUnit.departmentIds).map((bucket) =>
        bucket.departmentId === activeAssignmentDepartmentId ? { ...bucket, crewAssignments } : bucket,
      ),
    });
  };

  const setAssignmentUnitPackingSeed = (packingSeed: ProjectBlueprintPackingSeed) => {
    if (!activeAssignmentDepartmentId) {
      return;
    }

    updateAssignmentUnit({
      unitDepartments: syncUnitDepartments(activeAssignmentUnit, activeAssignmentUnit.departmentIds).map((bucket) =>
        bucket.departmentId === activeAssignmentDepartmentId ? { ...bucket, packingSeed } : bucket,
      ),
    });
  };

  const assignedAssetIdsInOtherUnits = new Set(
    [
      ...(activeAssignmentUnitId === "main" ? [] : getUnitAssetIds(draft.mainUnit)),
      ...draft.additionalUnits
        .filter((unit) => unit.id !== activeAssignmentUnitId)
        .flatMap((unit) => getUnitAssetIds(unit)),
    ].filter(Boolean),
  );

  const isAssetLockedInKit = (assetId: string) => {
    const asset = catalog.assetOptions.find((row) => row.id === assetId);
    return Boolean(asset?.linkedKitCount);
  };

  const selectedAssetIdsForSubmit = useMemo(
    () => uniqueIds([getUnitAssetIds(draft.mainUnit), ...draft.additionalUnits.map((unit) => getUnitAssetIds(unit))].flat()),
    [draft.additionalUnits, draft.mainUnit],
  );
  const assetOptionsById = useMemo(() => new Map(catalog.assetOptions.map((asset) => [asset.id, asset] as const)), [catalog.assetOptions]);
  const selectedAssetIssues = useMemo<SelectedAssetIssue[]>(() => {
    return selectedAssetIdsForSubmit
      .map((assetId) => {
        const asset = assetOptionsById.get(assetId);

        if (!asset) {
          return {
            assetId,
            label: assetId,
            reason: t("projectSetup.validation.assetMissing"),
          };
        }

        if (asset.linkedKitCount) {
          return {
            assetId,
            label: formatAssetOptionLabel(asset),
            reason: t("projectSetup.validation.assetInKit", {
              kits: asset.linkedKitCodes.length
                ? asset.linkedKitCodes.join(", ")
                : asset.linkedKitNames.length
                  ? asset.linkedKitNames.join(", ")
                  : t("projectSetup.validation.unknownKit"),
            }),
          };
        }

        if (asset.currentProjectId) {
          return {
            assetId,
            label: formatAssetOptionLabel(asset),
            reason: t("projectSetup.validation.assetAssigned", {
              project: asset.currentProject ?? t("projectSetup.validation.unknownProject"),
              unit: asset.currentUnit ? ` / ${asset.currentUnit}` : "",
            }),
          };
        }

        if (asset.custodyStatus === "checked_out") {
          return {
            assetId,
            label: formatAssetOptionLabel(asset),
            reason: t("projectSetup.validation.assetCheckedOut"),
          };
        }

        if (asset.operationalStatus && !assignableOperationalStatuses.has(asset.operationalStatus)) {
          return {
            assetId,
            label: formatAssetOptionLabel(asset),
            reason: t("projectSetup.validation.assetOperationalStatus", { status: asset.operationalStatus }),
          };
        }

        if (asset.quantity <= 0) {
          return {
            assetId,
            label: formatAssetOptionLabel(asset),
            reason: t("projectSetup.validation.assetNoUnits"),
          };
        }

        if (asset.quantity > 0 && (asset.assignedQuantity > 0 || asset.checkedOutQuantity > 0)) {
          return {
            assetId,
            label: formatAssetOptionLabel(asset),
            reason: t("projectSetup.validation.assetPartialQuantity"),
          };
        }

        return null;
      })
      .filter((issue): issue is SelectedAssetIssue => Boolean(issue));
  }, [assetOptionsById, selectedAssetIdsForSubmit, t]);
  const selectedAssetPreview = selectedAssetIdsForSubmit
    .slice(0, 5)
    .map((assetId) => {
      const asset = assetOptionsById.get(assetId);
      return asset ? formatAssetOptionLabel(asset) : assetId;
    })
    .join(", ");

  const sameSetupAssetAssignmentsById = useMemo(() => {
    const nextMap = new Map<
      string,
      {
        unit: string;
        startDate: string | null;
        endDate: string | null;
      }
    >();

    const otherBuckets = [
      {
        label: t("projectSetup.units.mainUnit"),
        windows: [{ startDate: draft.generalInfo.startDate || null, endDate: draft.generalInfo.endDate || null }],
        buckets: draft.mainUnit.unitDepartments,
        isActiveUnit: activeAssignmentUnitId === "main",
      },
      ...draft.additionalUnits.map((unit, index) => ({
        label: unit.name || t("projectSetup.units.additionalUnitName", { number: index + 1 }),
        windows: getUnitWindows(unit).map((window) => ({
          startDate: window.startDate ?? draft.generalInfo.startDate ?? null,
          endDate: window.endDate ?? draft.generalInfo.endDate ?? null,
        })),
        buckets: unit.unitDepartments,
        isActiveUnit: unit.id === activeAssignmentUnitId,
      })),
    ];

    otherBuckets.forEach((unit) => {
      if (!unit.windows.some((window) => activeAssignmentWindows.some((activeWindow) => datesOverlap(activeWindow.startDate, activeWindow.endDate, window.startDate, window.endDate)))) {
        return;
      }

      unit.buckets.forEach((bucket) => {
        if (unit.isActiveUnit && bucket.departmentId === activeAssignmentDepartmentId) {
          return;
        }

        bucket.assetIds.forEach((assetId) => {
          nextMap.set(assetId, {
            unit: `${unit.label}${catalog.departments.find((row) => row.id === bucket.departmentId)?.name ? ` / ${catalog.departments.find((row) => row.id === bucket.departmentId)?.name}` : ""}`,
            startDate: unit.windows[0]?.startDate ?? null,
            endDate: unit.windows[0]?.endDate ?? null,
          });
        });
      });
    });

    return nextMap;
  }, [activeAssignmentDepartmentId, activeAssignmentUnitId, activeAssignmentWindows, catalog.departments, draft.additionalUnits, draft.generalInfo.endDate, draft.generalInfo.startDate, draft.mainUnit, t]);

  const assetAvailableRows = useMemo(() => {
    return [...catalog.assetOptions]
      .filter((asset) => !(activeAssignmentBucket?.assetIds ?? []).includes(asset.id))
      .filter((asset) => matchesSearch(deferredAssetAvailableSearch, [asset.code, asset.name, asset.category, asset.status]))
      .sort((left, right) => {
        const leftValue = left[assetAvailableSort];
        const rightValue = right[assetAvailableSort];
        return compareValues(leftValue, rightValue, assetAvailableDirection);
      });
  }, [activeAssignmentBucket?.assetIds, assetAvailableDirection, deferredAssetAvailableSearch, assetAvailableSort, catalog.assetOptions]);

  const selectedAssetRows = useMemo(() => {
    return [...catalog.assetOptions]
      .filter((asset) => (activeAssignmentBucket?.assetIds ?? []).includes(asset.id))
      .filter((asset) => matchesSearch(deferredAssetSelectedSearch, [asset.code, asset.name, asset.category]))
      .sort((left, right) => {
        const leftValue = left[assetSelectedSort];
        const rightValue = right[assetSelectedSort];
        return compareValues(leftValue, rightValue, assetSelectedDirection);
      });
  }, [activeAssignmentBucket?.assetIds, assetSelectedDirection, deferredAssetSelectedSearch, assetSelectedSort, catalog.assetOptions]);

  const crewAvailableRows = useMemo(() => {
    return [...catalog.crewMembers]
      .filter((crewMember) => !(activeAssignmentBucket?.crewAssignments ?? []).some((assignment) => assignment.crewMemberId === crewMember.id))
      .filter((crewMember) => matchesSearch(deferredCrewAvailableSearch, [crewMember.fullName, crewMember.roleLabel]))
      .sort((left, right) => {
        const leftDepartmentPriority = left.primaryDepartmentId === activeAssignmentDepartmentId ? 0 : 1;
        const rightDepartmentPriority = right.primaryDepartmentId === activeAssignmentDepartmentId ? 0 : 1;
        if (leftDepartmentPriority !== rightDepartmentPriority) {
          return leftDepartmentPriority - rightDepartmentPriority;
        }

        const leftValue = crewAvailableSort === "role" ? left.roleLabel : left.fullName;
        const rightValue = crewAvailableSort === "role" ? right.roleLabel : right.fullName;
        return compareValues(leftValue, rightValue, crewAvailableDirection);
      });
  }, [activeAssignmentBucket?.crewAssignments, activeAssignmentDepartmentId, catalog.crewMembers, crewAvailableDirection, deferredCrewAvailableSearch, crewAvailableSort]);

  const blockingCrewAssignmentsByMember = useMemo(() => {
    const nextMap = new Map<
      string,
      {
        project: string;
        unit: string;
        department: string | null | undefined;
        startDate: string | null;
        endDate: string | null;
      }
    >();

    catalog.crewMembers.forEach((crewMember) => {
      const blockingAssignment = crewMember.activeAssignments.find((assignment) =>
        activeAssignmentWindows.some((window) => datesOverlap(window.startDate, window.endDate, assignment.startDate, assignment.endDate)),
      );

      if (blockingAssignment) {
        nextMap.set(crewMember.id, blockingAssignment);
      }
    });

    return nextMap;
  }, [activeAssignmentWindows, catalog.crewMembers]);

  const sameSetupCrewAssignmentsByMember = useMemo(() => {
    const nextMap = new Map<
      string,
      {
        unit: string;
        startDate: string | null;
        endDate: string | null;
      }
    >();

    const otherUnits = [
      {
        label: t("projectSetup.units.mainUnit"),
        windows: [{ startDate: draft.generalInfo.startDate || null, endDate: draft.generalInfo.endDate || null }],
        buckets: draft.mainUnit.unitDepartments,
        isActiveUnit: activeAssignmentUnitId === "main",
      },
      ...draft.additionalUnits.map((unit, index) => ({
        label: unit.name || t("projectSetup.units.additionalUnitName", { number: index + 1 }),
        windows: getUnitWindows(unit).map((window) => ({
          startDate: window.startDate ?? draft.generalInfo.startDate ?? null,
          endDate: window.endDate ?? draft.generalInfo.endDate ?? null,
        })),
        buckets: unit.unitDepartments,
        isActiveUnit: unit.id === activeAssignmentUnitId,
      })),
    ];

    otherUnits.forEach((unit) => {
      unit.buckets.forEach((bucket) => {
        if (unit.isActiveUnit && bucket.departmentId === activeAssignmentDepartmentId) {
          return;
        }

        bucket.crewAssignments.forEach((assignment) => {
        if (!assignmentHasCrewMember(assignment)) {
          return;
        }

        const assignmentWindows =
          assignment.startDate || assignment.endDate
            ? [resolveAssignmentWindow(assignment, unit.windows[0]?.startDate ?? null, unit.windows[0]?.endDate ?? null)]
            : unit.windows;
        if (!assignmentWindows.some((assignmentWindow) => activeAssignmentWindows.some((activeWindow) => datesOverlap(activeWindow.startDate, activeWindow.endDate, assignmentWindow.startDate, assignmentWindow.endDate)))) {
          return;
        }

        nextMap.set(assignment.crewMemberId, {
          unit: `${unit.label}${catalog.departments.find((row) => row.id === bucket.departmentId)?.name ? ` / ${catalog.departments.find((row) => row.id === bucket.departmentId)?.name}` : ""}`,
          startDate: assignmentWindows[0]?.startDate ?? null,
          endDate: assignmentWindows[0]?.endDate ?? null,
        });
      });
      });
    });

    return nextMap;
  }, [activeAssignmentDepartmentId, activeAssignmentUnitId, activeAssignmentWindows, catalog.departments, draft.additionalUnits, draft.generalInfo.endDate, draft.generalInfo.startDate, draft.mainUnit, t]);

  const selectedCrewRows = useMemo(() => {
    return (activeAssignmentBucket?.crewAssignments ?? [])
      .map((assignment, sourceIndex) => ({
        assignment,
        sourceIndex,
      }))
      .filter((assignment) => assignmentHasCrewMember(assignment.assignment))
      .filter((assignment) => {
        const crewMember = catalog.crewMembers.find((row) => row.id === assignment.assignment.crewMemberId);
        return matchesSearch(deferredCrewSelectedSearch, [crewMember?.fullName, assignment.assignment.roleLabel, crewMember?.roleLabel]);
      })
      .sort((left, right) => {
        const leftCrew = catalog.crewMembers.find((row) => row.id === left.assignment.crewMemberId);
        const rightCrew = catalog.crewMembers.find((row) => row.id === right.assignment.crewMemberId);
        const leftValue =
          crewSelectedSort === "startDate"
            ? left.assignment.startDate ?? ""
            : crewSelectedSort === "role"
              ? left.assignment.roleLabel || leftCrew?.roleLabel || ""
              : leftCrew?.fullName || "";
        const rightValue =
          crewSelectedSort === "startDate"
            ? right.assignment.startDate ?? ""
            : crewSelectedSort === "role"
              ? right.assignment.roleLabel || rightCrew?.roleLabel || ""
              : rightCrew?.fullName || "";
        return compareValues(leftValue, rightValue, crewSelectedDirection);
      });
  }, [activeAssignmentBucket?.crewAssignments, catalog.crewMembers, crewSelectedDirection, deferredCrewSelectedSearch, crewSelectedSort]);

  if (!open) {
    return null;
  }

  const handleAddAssetToActiveUnit = (assetId: string) => {
    if (isAssetLockedInKit(assetId)) {
      return;
    }

    setAssignmentUnitAssets([...(activeAssignmentBucket?.assetIds ?? []), assetId]);
  };

  const handleRemoveAssetFromActiveUnit = (assetId: string) => {
    setAssignmentUnitAssets((activeAssignmentBucket?.assetIds ?? []).filter((currentId) => currentId !== assetId));
  };

  const handleAddCrewToActiveUnit = (crewMemberId: string) => {
    const unitWindowBounds = getWindowsBounds(activeAssignmentWindows);
    const hasMultipleUnitWindows = activeAssignmentWindows.filter((window) => window.startDate || window.endDate).length > 1;
    setAssignmentUnitCrewAssignments([
      ...(activeAssignmentBucket?.crewAssignments ?? []),
      {
        ...emptyCrewAssignment(),
        crewMemberId,
        startDate: hasMultipleUnitWindows ? "" : unitWindowBounds.startDate ?? "",
        endDate: hasMultipleUnitWindows ? "" : unitWindowBounds.endDate ?? "",
      },
    ]);
  };

  const updateCrewAssignmentForActiveUnit = (index: number, patch: Partial<ProjectBlueprintCrewDraftInput>) => {
    setAssignmentUnitCrewAssignments(
      (activeAssignmentBucket?.crewAssignments ?? []).map((assignment, currentIndex) => (currentIndex === index ? { ...assignment, ...patch } : assignment)),
    );
  };

  const removeCrewAssignmentFromActiveUnit = (index: number) => {
    setAssignmentUnitCrewAssignments((activeAssignmentBucket?.crewAssignments ?? []).filter((_, currentIndex) => currentIndex !== index));
  };

  const handleRequestClose = () => {
    if (!dirty) {
      onClose();
      return;
    }

    setCloseConfirmOpen(true);
  };

  const handleSaveDraft = () => {
    setCloseConfirmOpen(false);
    onClose();
  };

  const handleRequestDiscardDraft = () => {
    if (!dirty) {
      onDiscardDraft();
      onClose();
      return;
    }

    setCloseConfirmOpen(true);
  };

  const handleSubmit = async () => {
    try {
      setIsSubmitting(true);
      setSubmitError(null);
      if (selectedAssetIssues.length) {
        onChangeTab("assets");
        return;
      }
      const createdProject = await createProjectBlueprint(normalizeDraftForSubmit(draft));
      onDiscardDraft();
      onClose();

      if (createdProject) {
        await createNotification({
          kind: "project",
          title: t("projectSetup.notifications.createdTitle", { defaultValue: "Proyecto creado" }),
          body: t("projectSetup.notifications.createdBody", {
            defaultValue: "{{name}} ya está listo para planificación.",
            name: createdProject.name,
          }),
          linkTo: `/projects/${createdProject.id}/info`,
          sourceType: "project",
          sourceRef: { projectId: createdProject.id, action: "created" },
          notifyNow: true,
        });
        openProject(createdProject.id, "info");
      }
    } catch (error) {
      const message = getUserFacingErrorMessage(error, t("projectSetup.errors.createProject"));
      setSubmitError(
        /selected assets.*no longer available/i.test(message)
          ? t("projectSetup.validation.assetsUnavailableBackend", {
              assets: selectedAssetPreview || t("projectSetup.validation.selectedAssetsFallback"),
            })
          : message,
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExportPdf = async () => {
    try {
      setSubmitError(null);
      const result = await exportProjectBlueprintPdf({ ...normalizeDraftForSubmit(draft), workspaceId: activeWorkspaceId });
      notifyExportResult(toast, result, {
        successTitle: t("projectSetup.toasts.exported"),
        cancelledTitle: t("common.exportCancelled"),
        cancelledBody: t("common.exportCancelledBody"),
      });
    } catch (error) {
      setSubmitError(getUserFacingErrorMessage(error, t("projectSetup.errors.exportSummary")));
    }
  };

  const canSubmit = validationErrors.length === 0 && selectedAssetIssues.length === 0 && !conflicts?.hasConflicts && !isCheckingConflicts;
  const conflictCount = conflicts?.groups.reduce((count, group) => count + group.items.length, 0) ?? 0;

  const tabItems: Array<{ id: WizardTab; label: string }> = [
    { id: "general", label: t("projectSetup.tabs.general") },
    { id: "units", label: t("projectSetup.tabs.units") },
    { id: "assets", label: t("projectSetup.tabs.assets") },
    { id: "crew", label: t("projectSetup.tabs.crew") },
    { id: "summary", label: t("projectSetup.tabs.summary") },
  ];

  return createPortal(
    <div className="project-setup-backdrop" role="presentation">
      <section aria-modal="true" className="project-setup-modal" role="dialog">
        <header className="project-setup-header">
          <div>
            <span className="project-setup-step-label">{t("projectSetup.eyebrow")}</span>
            <h2 className="project-setup-title">{t("projectSetup.title")}</h2>
          </div>

          <div className="project-setup-header-actions">
            {dirty ? <StatusBadge tone="warning">{t("projectSetup.badges.draft")}</StatusBadge> : null}
            {conflictCount ? <StatusBadge tone="critical">{t("projectSetup.badges.conflicts", { count: conflictCount })}</StatusBadge> : null}
            <button
              aria-label={t("projectSetup.actions.close")}
              className="project-setup-close-button"
              data-tooltip={t("projectSetup.actions.close")}
              onClick={handleRequestClose}
              type="button"
            >
              <X size={16} />
            </button>
          </div>
        </header>

        <div className="project-setup-tabs">
          {tabItems.map((item) => (
            <button
              key={item.id}
              className={`project-setup-tab${activeTab === item.id ? " active" : ""}`}
              onClick={() => onChangeTab(item.id)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="project-setup-body">
          {activeTab === "general" ? (
            <div className="project-setup-panel">
              <div className="project-setup-grid">
                <label className="action-field">
                  <span className="action-field-label">{t("projectSetup.fields.projectCode")}</span>
                  <input
                    className="action-field-control"
                    onChange={(event) => setGeneralInfo("code", event.target.value)}
                    placeholder={t("projectSetup.placeholders.autoCode")}
                    value={draft.generalInfo.code}
                  />
                </label>

                <label className="action-field">
                  <span className="action-field-label">
                    <RequiredLabel>{t("projectSetup.fields.projectName")}</RequiredLabel>
                  </span>
                  <input aria-required="true" className="action-field-control" onChange={(event) => setGeneralInfo("name", event.target.value)} value={draft.generalInfo.name} />
                </label>

                <label className="action-field">
                  <span className="action-field-label">{t("projectSetup.fields.productionCompany")}</span>
                  <SelectField onChange={(event) => setGeneralInfo("productionCompanyId", event.target.value)} value={draft.generalInfo.productionCompanyId}>
                    <option value="">{t("projectSetup.placeholders.noProductionCompany")}</option>
                    {catalog.productionCompanies.map((company) => (
                      <option key={company.id} value={company.id}>
                        {company.name}
                      </option>
                    ))}
                  </SelectField>
                </label>

                <label className="action-field">
                  <span className="action-field-label">{t("projectSetup.fields.client")}</span>
                  <SelectField onChange={(event) => setGeneralInfo("clientId", event.target.value)} value={draft.generalInfo.clientId}>
                    <option value="">{t("projectSetup.placeholders.noClient")}</option>
                    {catalog.clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </SelectField>
                </label>

                <label className="action-field">
                  <span className="action-field-label">{t("projectSetup.fields.startDate")}</span>
                  <input className="action-field-control" onChange={(event) => setGeneralInfo("startDate", event.target.value)} type="date" value={draft.generalInfo.startDate} />
                </label>

                <label className="action-field">
                  <span className="action-field-label">{t("projectSetup.fields.endDate")}</span>
                  <input
                    className="action-field-control"
                    min={draft.generalInfo.startDate || undefined}
                    onChange={(event) => setGeneralInfo("endDate", event.target.value)}
                    type="date"
                    value={draft.generalInfo.endDate}
                  />
                </label>

                <div className="action-field action-field-wide">
                  <span className="action-field-label">{t("projectSetup.fields.mainUnitDepartments")}</span>
                  <span className="project-setup-field-note">{t("projectSetup.help.mainUnitDepartments")}</span>
                  {renderDepartmentPicker("main", draft.mainUnit.departmentIds)}
                </div>

                <label className="project-setup-toggle">
                  <input
                    checked={draft.generalInfo.hasPreproduction}
                    onChange={(event) => setGeneralInfo("hasPreproduction", event.target.checked)}
                    type="checkbox"
                  />
                  <span>{t("projectSetup.fields.includesPreproduction")}</span>
                </label>

                <div />

                {draft.generalInfo.hasPreproduction ? (
                  <>
                    <label className="action-field">
                      <span className="action-field-label">{t("projectSetup.fields.preproductionStart")}</span>
                      <input
                        className="action-field-control"
                        onChange={(event) => setGeneralInfo("preproductionStartDate", event.target.value)}
                        type="date"
                        value={draft.generalInfo.preproductionStartDate}
                      />
                    </label>

                    <label className="action-field">
                      <span className="action-field-label">{t("projectSetup.fields.preproductionEnd")}</span>
                      <input
                        className="action-field-control"
                        min={draft.generalInfo.preproductionStartDate || undefined}
                        onChange={(event) => setGeneralInfo("preproductionEndDate", event.target.value)}
                        type="date"
                        value={draft.generalInfo.preproductionEndDate}
                      />
                    </label>
                  </>
                ) : null}

                <label className="action-field">
                  <span className="action-field-label">{t("projectSetup.fields.status")}</span>
                  <SelectField onChange={(event) => setGeneralInfo("status", event.target.value)} value={draft.generalInfo.status}>
                    {projectStatusOptions.map((option) => (
                      <option key={option} value={option}>
                        {t(`projects.statuses.${option}`, { defaultValue: option })}
                      </option>
                    ))}
                  </SelectField>
                </label>

                <label className="action-field">
                  <span className="action-field-label">{t("projectSetup.fields.timelineColor")}</span>
                  <ProjectColorSelect
                    onChange={(nextColorKey) => setGeneralInfo("colorKey", nextColorKey)}
                    placeholder={t("projectSetup.placeholders.defaultTone")}
                    value={draft.generalInfo.colorKey as ProjectColorKey | ""}
                  />
                </label>

                <label className="action-field action-field-wide">
                  <span className="action-field-label">{t("projectSetup.fields.description")}</span>
                  <textarea
                    className="action-field-control action-textarea"
                    onChange={(event) => setGeneralInfo("description", event.target.value)}
                    rows={4}
                    value={draft.generalInfo.description}
                  />
                </label>
              </div>
            </div>
          ) : null}

          {activeTab === "assets" ? (
            <div className="project-setup-panel">
              <div className="project-setup-section-stack">
                {renderAssignmentTargetPanel("assets")}

                {activeAssignmentDepartmentId ? (
                  <div className="project-setup-inline-card">
                    <div className="project-setup-card-heading">
                      <div>
                        <h3>{t("projectSetup.assets.packingSeed")}</h3>
                        <p>{activeAssignmentUnitMeta.label}{activeAssignmentDepartment ? ` / ${activeAssignmentDepartment.name}` : ""}</p>
                      </div>
                    </div>

                    <label className="action-field">
                      <span className="action-field-label">{t("projectSetup.assets.packingSource")}</span>
                      <SelectField
                        onChange={(event) => {
                          const nextMode = event.target.value as ProjectBlueprintPackingSeed["mode"];
                          if (nextMode === "existing") {
                            setAssignmentUnitPackingSeed({ mode: "existing", packingSlipId: stagingSlips[0]?.id ?? "" });
                            return;
                          }

                          if (nextMode === "draft") {
                            setAssignmentUnitPackingSeed({ mode: "draft", label: "", responsibleUserId: "", notes: "" });
                            return;
                          }

                          setAssignmentUnitPackingSeed({ mode: "none" });
                        }}
                        value={activeAssignmentBucket?.packingSeed?.mode ?? "none"}
                      >
                        <option value="none">{t("projectSetup.assets.packingModes.none")}</option>
                        <option value="existing">{t("projectSetup.assets.packingModes.existing")}</option>
                        <option value="draft">{t("projectSetup.assets.packingModes.draft")}</option>
                      </SelectField>
                    </label>

                    {activeAssignmentBucket?.packingSeed?.mode === "existing" ? (
                      <label className="action-field">
                        <span className="action-field-label">{t("projectSetup.assets.stagingSlip")}</span>
                        <SelectField
                          disabled={isLoadingStaging}
                          onChange={(event) => {
                            setAssignmentUnitPackingSeed({ mode: "existing", packingSlipId: event.target.value });

                            if (!window.bukowskiPacking || !event.target.value) {
                              return;
                            }

                            void window.bukowskiPacking.getDetail(event.target.value).then((detail) => {
                              setAssignmentUnitAssets(detail.items.map((item) => item.assetId));
                            });
                          }}
                          value={activeAssignmentBucket.packingSeed.packingSlipId}
                        >
                          <option value="">{isLoadingStaging ? t("projectSetup.assets.loadingStaging") : t("projectSetup.assets.chooseStaging")}</option>
                          {stagingSlips
                            .filter((slip) => !activeAssignmentDepartment || slip.department === "—" || slip.department === activeAssignmentDepartment.name)
                            .map((slip) => (
                              <option key={slip.id} value={slip.id}>
                                {t("projectSetup.assets.stagingOption", { number: slip.number, items: slip.itemCount })}
                              </option>
                            ))}
                        </SelectField>
                      </label>
                    ) : null}

                    {activeAssignmentBucket?.packingSeed?.mode === "draft" ? (
                      <div className="project-setup-grid project-setup-grid-compact">
                        <label className="action-field">
                          <span className="action-field-label">{t("projectSetup.assets.slipLabel")}</span>
                          <input
                            className="action-field-control"
                            onChange={(event) =>
                              setAssignmentUnitPackingSeed({
                                mode: "draft",
                                label: event.target.value,
                                responsibleUserId: activeAssignmentBucket.packingSeed?.mode === "draft" ? activeAssignmentBucket.packingSeed.responsibleUserId : "",
                                notes: activeAssignmentBucket.packingSeed?.mode === "draft" ? activeAssignmentBucket.packingSeed.notes : "",
                              })
                            }
                            value={activeAssignmentBucket.packingSeed.label ?? ""}
                          />
                        </label>

                        <label className="action-field">
                          <span className="action-field-label">{t("projectSetup.assets.responsible")}</span>
                          <SelectField
                            onChange={(event) =>
                              setAssignmentUnitPackingSeed({
                                mode: "draft",
                                label: activeAssignmentBucket.packingSeed?.mode === "draft" ? activeAssignmentBucket.packingSeed.label : "",
                                responsibleUserId: event.target.value,
                                notes: activeAssignmentBucket.packingSeed?.mode === "draft" ? activeAssignmentBucket.packingSeed.notes : "",
                              })
                            }
                            value={activeAssignmentBucket.packingSeed.responsibleUserId ?? ""}
                          >
                            <option value="">{t("projectSetup.assets.noResponsible")}</option>
                            {catalog.users.map((user) => (
                              <option key={user.id} value={user.id}>
                                {user.fullName}
                              </option>
                            ))}
                          </SelectField>
                        </label>

                        <label className="action-field action-field-wide">
                          <span className="action-field-label">{t("projectSetup.fields.notes")}</span>
                          <textarea
                            className="action-field-control action-textarea"
                            onChange={(event) =>
                              setAssignmentUnitPackingSeed({
                                mode: "draft",
                                label: activeAssignmentBucket.packingSeed?.mode === "draft" ? activeAssignmentBucket.packingSeed.label : "",
                                responsibleUserId: activeAssignmentBucket.packingSeed?.mode === "draft" ? activeAssignmentBucket.packingSeed.responsibleUserId : "",
                                notes: event.target.value,
                              })
                            }
                            rows={3}
                            value={activeAssignmentBucket.packingSeed.notes ?? ""}
                          />
                        </label>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="project-setup-empty-panel">
                    <p>{t("projectSetup.assets.noDepartmentTitle")}</p>
                    <span>{t("projectSetup.assets.noDepartmentBody")}</span>
                  </div>
                )}

                {activeAssignmentDepartmentId ? (
                <div className="project-setup-two-column project-setup-resource-panels">
                  <div className="project-setup-inline-card">
                    <div className="project-setup-card-heading">
                      <div>
                        <h3>{t("projectSetup.assets.availableAssets")}</h3>
                        <p>{activeAssignmentUnitMeta.label}{activeAssignmentDepartment ? ` / ${activeAssignmentDepartment.name}` : ""}</p>
                      </div>
                    </div>

                    <ListToolbar
                      activeSortLabel={t(`projectSetup.assets.sort.${assetAvailableSort}`)}
                      onSearchValueChange={setAssetAvailableSearch}
                      onSortByChange={setAssetAvailableSort}
                      onToggleSortDirection={() => setAssetAvailableDirection((current) => (current === "asc" ? "desc" : "asc"))}
                      resultCount={assetAvailableRows.length}
                      resultLabel={t("projectSetup.assets.resultLabel")}
                      searchPlaceholder={t("projectSetup.assets.searchAvailable")}
                      searchValue={assetAvailableSearch}
                      sortBy={assetAvailableSort}
                      sortDirection={assetAvailableDirection}
                      sortOptions={[
                        { value: "name", label: t("projectSetup.assets.sort.name") },
                        { value: "code", label: t("projectSetup.assets.sort.code") },
                        { value: "category", label: t("projectSetup.assets.sort.category") },
                        { value: "status", label: t("projectSetup.assets.sort.status") },
                      ]}
                    />

                    <div className="project-setup-resource-list">
                      {assetAvailableRows.length ? (
                        assetAvailableRows.map((asset) => (
                          <div
                            key={asset.id}
                            className={`project-setup-resource-row${isAssetOccupiedForNewProject(asset) || asset.linkedKitCount ? " is-blocked" : ""}`}
                          >
                            <span className="project-setup-resource-copy">
                              <strong>{asset.code} · {asset.name}</strong>
                              <span>{asset.category} · {asset.status}</span>
                              {isAssetOccupiedForNewProject(asset) ? (
                                <span>
                                  {t("projectSetup.assets.inUseOn", {
                                    project: asset.currentProject,
                                    unit: asset.currentUnit ? ` / ${asset.currentUnit}` : "",
                                    department: asset.currentDepartment ? ` / ${asset.currentDepartment}` : "",
                                  })}
                                </span>
                              ) : null}
                              {!isAssetOccupiedForNewProject(asset) && asset.linkedKitCount ? (
                                <span>{t("projectSetup.assets.partOfKit", { kits: asset.linkedKitCodes.join(", ") })}</span>
                              ) : null}
                            </span>
                            <span className="project-setup-resource-meta">
                              {isAssetOccupiedForNewProject(asset) ? <StatusBadge tone="critical">{t("projectSetup.assets.badges.unavailable")}</StatusBadge> : null}
                              {!isAssetOccupiedForNewProject(asset) && asset.linkedKitCount ? <StatusBadge tone="warning">{t("projectSetup.assets.badges.inKit")}</StatusBadge> : null}
                              {!isAssetOccupiedForNewProject(asset) && sameSetupAssetAssignmentsById.has(asset.id) ? (
                                <StatusBadge tone="warning">{t("projectSetup.assets.badges.assignedAnotherUnit")}</StatusBadge>
                              ) : !isAssetOccupiedForNewProject(asset) && assignedAssetIdsInOtherUnits.has(asset.id) ? (
                                <StatusBadge tone="warning">{t("projectSetup.assets.badges.alreadyAssigned")}</StatusBadge>
                              ) : null}
                              {isAssetOccupiedForNewProject(asset) ? (
                                <span className="project-setup-resource-occupancy">
                                  {t("projectSetup.assets.resolveCurrentAssignment")}
                                </span>
                              ) : asset.linkedKitCount ? (
                                <span className="project-setup-resource-occupancy">
                                  {t("projectSetup.assets.removeFromKitFirst", { kits: asset.linkedKitCodes.join(", ") })}
                                </span>
                              ) : sameSetupAssetAssignmentsById.has(asset.id) ? (
                                <span className="project-setup-resource-occupancy">
                                  {t("projectSetup.assets.assignedInSetup", { unit: sameSetupAssetAssignmentsById.get(asset.id)?.unit })}
                                </span>
                              ) : (
                                <button className="ghost-control" onClick={() => handleAddAssetToActiveUnit(asset.id)} type="button">
                                  {t("projectSetup.assets.add")}
                                </button>
                              )}
                            </span>
                          </div>
                        ))
                      ) : (
                        <p className="project-setup-empty-copy">{t("projectSetup.assets.noAvailableMatches")}</p>
                      )}
                    </div>
                  </div>

                    <div className="project-setup-inline-card">
                      <div className="project-setup-card-heading">
                        <div>
                          <h3>{t("projectSetup.assets.selectedAssets")}</h3>
                          <p>
                            {t("projectSetup.assets.selectedSummary", {
                              count: activeAssignmentBucket?.assetIds.length ?? 0,
                              packing:
                                (activeAssignmentBucket?.packingSeed?.mode ?? "none") === "none"
                                  ? t("projectSetup.assets.packingSummary.none")
                                  : activeAssignmentBucket?.packingSeed?.mode === "existing"
                                    ? t("projectSetup.assets.packingSummary.existing")
                                    : t("projectSetup.assets.packingSummary.draft"),
                            })}
                          </p>
                        </div>
                      </div>

                    <ListToolbar
                      activeSortLabel={t(`projectSetup.assets.sort.${assetSelectedSort}`)}
                      onSearchValueChange={setAssetSelectedSearch}
                      onSortByChange={setAssetSelectedSort}
                      onToggleSortDirection={() => setAssetSelectedDirection((current) => (current === "asc" ? "desc" : "asc"))}
                      resultCount={selectedAssetRows.length}
                      resultLabel={t("projectSetup.assets.selectedResultLabel")}
                      searchPlaceholder={t("projectSetup.assets.searchSelected")}
                      searchValue={assetSelectedSearch}
                      sortBy={assetSelectedSort}
                      sortDirection={assetSelectedDirection}
                      sortOptions={[
                        { value: "name", label: t("projectSetup.assets.sort.name") },
                        { value: "code", label: t("projectSetup.assets.sort.code") },
                        { value: "category", label: t("projectSetup.assets.sort.category") },
                      ]}
                    />

                    <div className="project-setup-resource-list">
                      {selectedAssetRows.length ? (
                        selectedAssetRows.map((asset) => (
                          <div key={asset.id} className="project-setup-resource-row is-selected">
                            <span className="project-setup-resource-copy">
                              <strong>{asset.code} · {asset.name}</strong>
                              <span>{asset.category} · {asset.status}</span>
                              {asset.linkedKitCount ? <span>{t("projectSetup.assets.partOfKit", { kits: asset.linkedKitCodes.join(", ") })}</span> : null}
                            </span>
                            <button
                              aria-label={t("projectSetup.assets.removeAssetAria", { asset: asset.name, unit: activeAssignmentUnitMeta.label })}
                              className="icon-danger-control"
                              data-tooltip={t("projectSetup.assets.removeAssetTooltip", { asset: asset.name })}
                              onClick={() => handleRemoveAssetFromActiveUnit(asset.id)}
                              type="button"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))
                      ) : (
                        <p className="project-setup-empty-copy">{t("projectSetup.assets.noSelectedAssets")}</p>
                      )}
                    </div>
                  </div>
                </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {activeTab === "crew" ? (
            <div className="project-setup-panel">
              {renderAssignmentTargetPanel("crew")}

              {activeAssignmentDepartmentId ? (
              <div className="project-setup-two-column project-setup-resource-panels">
                <div className="project-setup-inline-card">
                  <div className="project-setup-card-heading">
                    <div>
                      <h3>{t("projectSetup.crew.availableCrew")}</h3>
                      <p>{activeAssignmentUnitMeta.label}{activeAssignmentDepartment ? ` / ${activeAssignmentDepartment.name}` : ""}</p>
                    </div>
                  </div>

                  <ListToolbar
                    activeSortLabel={t(`projectSetup.crew.sort.${crewAvailableSort}`)}
                    onSearchValueChange={setCrewAvailableSearch}
                    onSortByChange={setCrewAvailableSort}
                    onToggleSortDirection={() => setCrewAvailableDirection((current) => (current === "asc" ? "desc" : "asc"))}
                    resultCount={crewAvailableRows.length}
                    resultLabel={t("projectSetup.crew.resultLabel")}
                    searchPlaceholder={t("projectSetup.crew.searchAvailable")}
                    searchValue={crewAvailableSearch}
                    sortBy={crewAvailableSort}
                    sortDirection={crewAvailableDirection}
                    sortOptions={[
                      { value: "name", label: t("projectSetup.crew.sort.name") },
                      { value: "role", label: t("projectSetup.crew.sort.role") },
                    ]}
                  />

                  <div className="project-setup-resource-list">
                    {crewAvailableRows.length ? (
                      crewAvailableRows.map((crewMember) => (
                        <div
                          key={crewMember.id}
                          className={`project-setup-resource-row${blockingCrewAssignmentsByMember.has(crewMember.id) ? " is-blocked" : ""}`}
                        >
                          <span className="project-setup-resource-copy">
                            <strong>{crewMember.fullName}</strong>
                            <span>{crewMember.roleLabel || t("projectSetup.crew.noDefaultRole")}</span>
                            {blockingCrewAssignmentsByMember.has(crewMember.id) ? (
                              <span>
                                {t("projectSetup.crew.inUseOn", {
                                  project: blockingCrewAssignmentsByMember.get(crewMember.id)?.project,
                                  unit: blockingCrewAssignmentsByMember.get(crewMember.id)?.unit ? ` / ${blockingCrewAssignmentsByMember.get(crewMember.id)?.unit}` : "",
                                  department: blockingCrewAssignmentsByMember.get(crewMember.id)?.department ? ` / ${blockingCrewAssignmentsByMember.get(crewMember.id)?.department}` : "",
                                })}
                              </span>
                            ) : null}
                          </span>
                          <span className="project-setup-resource-meta">
                            {blockingCrewAssignmentsByMember.has(crewMember.id) ? <StatusBadge tone="critical">{t("projectSetup.assets.badges.unavailable")}</StatusBadge> : null}
                            {!blockingCrewAssignmentsByMember.has(crewMember.id) && sameSetupCrewAssignmentsByMember.has(crewMember.id) ? (
                              <StatusBadge tone="warning">{t("projectSetup.assets.badges.assignedAnotherUnit")}</StatusBadge>
                            ) : null}
                            {blockingCrewAssignmentsByMember.has(crewMember.id) ? (
                              <span className="project-setup-resource-occupancy">{t("projectSetup.assets.resolveCurrentAssignment")}</span>
                            ) : sameSetupCrewAssignmentsByMember.has(crewMember.id) ? (
                              <span className="project-setup-resource-occupancy">
                                {t("projectSetup.assets.assignedInSetup", { unit: sameSetupCrewAssignmentsByMember.get(crewMember.id)?.unit })}
                              </span>
                            ) : (
                              <button className="ghost-control" onClick={() => handleAddCrewToActiveUnit(crewMember.id)} type="button">
                                {t("projectSetup.assets.add")}
                              </button>
                            )}
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="project-setup-empty-copy">{t("projectSetup.crew.noAvailableMatches")}</p>
                    )}
                  </div>
                </div>

                <div className="project-setup-inline-card">
                  <div className="project-setup-card-heading">
                    <div>
                      <h3>{t("projectSetup.crew.assignedCrew")}</h3>
                      <p>{t("projectSetup.crew.linkedCount", { count: countAssignedCrew(activeAssignmentBucket?.crewAssignments ?? []) })}</p>
                    </div>
                  </div>

                  <ListToolbar
                    activeSortLabel={t(`projectSetup.crew.sort.${crewSelectedSort}`)}
                    onSearchValueChange={setCrewSelectedSearch}
                    onSortByChange={setCrewSelectedSort}
                    onToggleSortDirection={() => setCrewSelectedDirection((current) => (current === "asc" ? "desc" : "asc"))}
                    resultCount={selectedCrewRows.length}
                    resultLabel={t("projectSetup.crew.assignmentResultLabel")}
                    searchPlaceholder={t("projectSetup.crew.searchAssigned")}
                    searchValue={crewSelectedSearch}
                    sortBy={crewSelectedSort}
                    sortDirection={crewSelectedDirection}
                    sortOptions={[
                      { value: "name", label: t("projectSetup.crew.sort.name") },
                      { value: "role", label: t("projectSetup.crew.sort.role") },
                      { value: "startDate", label: t("projectSetup.crew.sort.startDate") },
                    ]}
                  />

                  <div className="project-setup-section-stack">
                    {selectedCrewRows.length ? (
                      selectedCrewRows.map(({ assignment, sourceIndex }) => {
                        const crewMember = catalog.crewMembers.find((row) => row.id === assignment.crewMemberId);
                        const activeWindowsList = formatWindowsList(activeAssignmentWindows, t);
                        const hasMultipleUnitWindows = activeWindowsList.length > 1;
                        return (
                          <div key={`${assignment.crewMemberId}-${sourceIndex}`} className="project-setup-inline-card is-nested">
                            <div className="project-setup-card-heading">
                              <div>
                                <h3>{crewMember?.fullName ?? t("projectSetup.crew.assignmentFallback")}</h3>
                                <p>{assignment.roleLabel || crewMember?.roleLabel || t("projectSetup.crew.rolePending")}</p>
                              </div>

                              <button
                                aria-label={t("projectSetup.crew.removeAria", {
                                  crew: crewMember?.fullName ?? t("projectSetup.crew.assignmentFallback"),
                                  unit: activeAssignmentUnitMeta.label,
                                })}
                                className="icon-danger-control"
                                data-tooltip={t("projectSetup.crew.removeTooltip", {
                                  crew: crewMember?.fullName ?? t("projectSetup.crew.assignmentFallback"),
                                })}
                                onClick={() => removeCrewAssignmentFromActiveUnit(sourceIndex)}
                                type="button"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>

                            {hasMultipleUnitWindows ? (
                              <div className="project-setup-assignment-windows-note">
                                <strong>{t("projectSetup.crew.unitWindows", { count: activeWindowsList.length })}</strong>
                                <span>{t("projectSetup.crew.inheritsWindows")}</span>
                              </div>
                            ) : null}

                            <div className="project-setup-grid project-setup-grid-compact">
                              <label className="action-field">
                                <span className="action-field-label">{t("projectSetup.fields.role")}</span>
                                <input
                                  className="action-field-control"
                                  onChange={(event) => updateCrewAssignmentForActiveUnit(sourceIndex, { roleLabel: event.target.value })}
                                  placeholder={t("projectSetup.crew.optionalRole")}
                                  value={assignment.roleLabel ?? ""}
                                />
                              </label>

                              {hasMultipleUnitWindows ? (
                                <div className="action-field action-field-wide">
                                  <span className="action-field-label">{t("projectSetup.crew.assignedWindows")}</span>
                                  <div className="project-setup-multi-window-fields">
                                    {activeAssignmentWindowEntries.map((window, windowIndex) => (
                                      <div key={`${window.startDate ?? "open"}-${window.endDate ?? "open"}-${windowIndex}`} className={`project-setup-window-fieldset tone-${(windowIndex % 4) + 1}`}>
                                        <strong>{t("projectSetup.crew.windowNumber", { number: windowIndex + 1 })}</strong>
                                        <div className="project-setup-window-fieldset-grid">
                                          <label className="action-field">
                                            <span className="action-field-label">{t("projectSetup.fields.start")}</span>
                                            <input className="action-field-control" readOnly type="date" value={window.startDate ?? ""} />
                                          </label>
                                          <label className="action-field">
                                            <span className="action-field-label">{t("projectSetup.fields.end")}</span>
                                            <input className="action-field-control" readOnly type="date" value={window.endDate ?? ""} />
                                          </label>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <label className="action-field">
                                    <span className="action-field-label">{t("projectSetup.fields.start")}</span>
                                    <input
                                      className="action-field-control"
                                      onChange={(event) => updateCrewAssignmentForActiveUnit(sourceIndex, { startDate: event.target.value })}
                                      type="date"
                                      value={assignment.startDate ?? ""}
                                    />
                                  </label>

                                  <label className="action-field">
                                    <span className="action-field-label">{t("projectSetup.fields.end")}</span>
                                    <input
                                      className="action-field-control"
                                      min={assignment.startDate ?? undefined}
                                      onChange={(event) => updateCrewAssignmentForActiveUnit(sourceIndex, { endDate: event.target.value })}
                                      type="date"
                                      value={assignment.endDate ?? ""}
                                    />
                                  </label>
                                </>
                              )}

                              <label className="action-field">
                                <span className="action-field-label">{t("projectSetup.fields.notes")}</span>
                                <input
                                  className="action-field-control"
                                  onChange={(event) => updateCrewAssignmentForActiveUnit(sourceIndex, { notes: event.target.value })}
                                  placeholder={t("projectSetup.crew.optionalNotes")}
                                  value={assignment.notes ?? ""}
                                />
                              </label>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <p className="project-setup-empty-copy">{t("projectSetup.crew.noAssignedCrew")}</p>
                    )}
                  </div>
                </div>
              </div>
              ) : null}
            </div>
          ) : null}

          {activeTab === "units" ? (
            <div className="project-setup-panel">
              <div className="project-setup-toolbar">
                <div className="project-setup-toolbar-copy">
                  <strong>{t("projectSetup.units.additionalUnits")}</strong>
                  <span>{t("projectSetup.units.additionalUnitsHelp")}</span>
                </div>

                <div className="project-setup-toolbar-actions">
                  <label className="action-field project-setup-unit-preset-field">
                    <span className="action-field-label">{t("projectSetup.units.addUnit")}</span>
                    <SelectField
                      onChange={(event) => {
                        const value = event.target.value;
                        setAdditionalUnitPresetValue(value);
                        if (value) {
                          addAdditionalUnit(value);
                        }
                      }}
                      value={additionalUnitPresetValue}
                    >
                      <option value="">{t("projectSetup.units.choosePreset")}</option>
                      {additionalUnitPresetOptions.map((preset) => (
                        <option key={preset} value={preset}>
                          {t(`projectSetup.units.presets.${preset}`)}
                        </option>
                      ))}
                    </SelectField>
                  </label>
                </div>
              </div>

              <div className="project-setup-section-stack">
                {draft.additionalUnits.length ? (
                  draft.additionalUnits.map((unit, index) => {
                    const expanded = unit.id ? expandedUnitIds.includes(unit.id) : true;
                    const conflictBadgeCount = unitConflictCount(unit, conflicts);

                    return (
                      <div key={unit.id ?? `${unit.name}-${index}`} className="project-setup-inline-card">
                        <button
                          className="project-setup-unit-header"
                          onClick={() => unit.id && toggleAdditionalUnitExpansion(unit.id)}
                          type="button"
                        >
                          <div className="project-setup-unit-header-copy">
                            <strong>{unit.name || t("projectSetup.units.additionalUnitName", { number: index + 1 })}</strong>
                            <span>
                              {t("projectSetup.units.unitSummaryLine", {
                                window: formatUnitWindowSummary(unit, draft.generalInfo.startDate, draft.generalInfo.endDate, t),
                                departments: getUnitDepartmentNames(unit, catalog.departments).join(", ") || t("projectSetup.units.noDepartments"),
                                assets: getUnitAssetIds(unit).length,
                                crew: countAssignedCrewForUnit(unit),
                              })}
                            </span>
                          </div>

                          <div className="project-setup-unit-header-aside">
                            {conflictBadgeCount ? <StatusBadge tone="warning">{t("projectSetup.badges.conflicts", { count: conflictBadgeCount })}</StatusBadge> : null}
                            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </div>
                        </button>

                        {expanded ? (
                          <div className="project-setup-section-stack">
                            <div className="project-setup-grid project-setup-grid-compact">
                              <label className="action-field">
                                <span className="action-field-label">
                                  <RequiredLabel>{t("projectSetup.units.unitName")}</RequiredLabel>
                                </span>
                                <input
                                  aria-required="true"
                                  className="action-field-control"
                                  onChange={(event) => updateAdditionalUnit(unit.id!, { name: event.target.value })}
                                  value={unit.name}
                                />
                              </label>

                              <label className="action-field">
                                <span className="action-field-label">{t("projectSetup.fields.projectCode")}</span>
                                <input
                                  className="action-field-control"
                                  onChange={(event) => updateAdditionalUnit(unit.id!, { code: event.target.value })}
                                  value={unit.code ?? ""}
                                />
                              </label>

                              <label className="action-field">
                                <span className="action-field-label">{t("projectSetup.units.color")}</span>
                                <ProjectColorSelect
                                  onChange={(nextColorKey) => updateAdditionalUnit(unit.id!, { colorKey: nextColorKey })}
                                  placeholder={t("projectSetup.units.derivedFromProject")}
                                  value={(unit.colorKey ?? "") as ProjectColorKey | ""}
                                />
                              </label>

                              <label className="action-field action-field-wide">
                                <span className="action-field-label">{t("projectSetup.fields.notes")}</span>
                                <textarea
                                  className="action-field-control action-textarea"
                                  onChange={(event) => updateAdditionalUnit(unit.id!, { notes: event.target.value })}
                                  rows={3}
                                  value={unit.notes ?? ""}
                                />
                              </label>

                              <div className="action-field action-field-wide">
                                <span className="action-field-label">{t("projectSetup.units.unitDepartments")}</span>
                                <span className="project-setup-field-note">{t("projectSetup.units.unitDepartmentsHelp")}</span>
                                {renderDepartmentPicker(unit.id!, unit.departmentIds)}
                              </div>
                            </div>

                            <div className="project-setup-inline-card project-setup-inline-card-nested">
                              <div className="project-setup-card-heading">
                                <div>
                                  <h3>{t("projectSetup.units.windows")}</h3>
                                  <p>{t("projectSetup.units.windowsHelp")}</p>
                                </div>
                                <button className="ghost-control" onClick={() => addAdditionalUnitWindow(unit.id!)} type="button">
                                  <Plus size={14} />
                                  <span>{t("projectSetup.units.addDateWindow")}</span>
                                </button>
                              </div>

                              <div className="project-setup-section-stack">
                                {getUnitWindows(unit).map((window, windowIndex) => (
                                  <div key={`${unit.id}-window-${windowIndex}`} className="project-setup-window-row">
                                    <label className="action-field">
                                      <span className="action-field-label">{t("projectSetup.fields.start")}</span>
                                      <input
                                        className="action-field-control"
                                        onChange={(event) => updateAdditionalUnitWindow(unit.id!, windowIndex, { startDate: event.target.value })}
                                        type="date"
                                        value={window.startDate ?? ""}
                                      />
                                    </label>

                                    <label className="action-field">
                                      <span className="action-field-label">{t("projectSetup.fields.end")}</span>
                                      <input
                                        className="action-field-control"
                                        min={window.startDate ?? undefined}
                                        onChange={(event) => updateAdditionalUnitWindow(unit.id!, windowIndex, { endDate: event.target.value })}
                                        type="date"
                                        value={window.endDate ?? ""}
                                      />
                                    </label>

                                    <button
                                      aria-label={t("projectSetup.units.removeWindowAria", {
                                        number: windowIndex + 1,
                                        unit: unit.name || t("projectSetup.units.additionalUnitName", { number: index + 1 }),
                                      })}
                                      className="icon-danger-control"
                                      data-tooltip={t("projectSetup.units.removeWindowTooltip", { number: windowIndex + 1 })}
                                      onClick={() => removeAdditionalUnitWindow(unit.id!, windowIndex)}
                                      type="button"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div className="project-setup-card-actions">
                              <button
                                aria-label={t("projectSetup.units.removeUnitAria", {
                                  unit: unit.name || t("projectSetup.units.additionalUnitName", { number: index + 1 }),
                                })}
                                className="icon-danger-control"
                                data-tooltip={t("projectSetup.units.removeUnitTooltip", {
                                  unit: unit.name || t("projectSetup.units.additionalUnitName", { number: index + 1 }),
                                })}
                                onClick={() => removeAdditionalUnit(unit.id!)}
                                type="button"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                ) : (
                  <div className="project-setup-empty-panel">
                    <p>{t("projectSetup.units.noAdditionalUnitsTitle")}</p>
                    <span>{t("projectSetup.units.noAdditionalUnitsBody")}</span>
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {activeTab === "summary" ? (
            <div className="project-setup-panel">
              <div className="project-setup-summary-grid">
                <div className="project-setup-summary-card">
                  <h3>{t("projectSetup.summary.generalInfo")}</h3>
                  <p>{draft.generalInfo.code || t("projectSetup.summary.codeAutoGenerated")} · {draft.generalInfo.name || t("projectSetup.summary.noProjectName")}</p>
                  <span>
                    {draft.generalInfo.startDate || draft.generalInfo.endDate
                      ? `${draft.generalInfo.startDate ?? t("projectSetup.units.openDate")} - ${draft.generalInfo.endDate ?? t("projectSetup.units.openDate")}`
                      : t("projectSetup.summary.noProjectWindow")}
                  </span>
                </div>

                <div className="project-setup-summary-card">
                  <h3>{t("projectSetup.summary.resources")}</h3>
                  <p>
                    {t("projectSetup.summary.resourceCounts", {
                      assets: getUnitAssetIds(draft.mainUnit).length + draft.additionalUnits.reduce((count, unit) => count + getUnitAssetIds(unit).length, 0),
                      crew:
                        countAssignedCrewForUnit(draft.mainUnit) +
                        draft.additionalUnits.reduce(
                          (count, unit) => count + countAssignedCrewForUnit(unit),
                          0,
                        ),
                    })}
                  </p>
                  <span>
                    {t("projectSetup.summary.unitDepartmentCounts", {
                      units: draft.additionalUnits.length,
                      departments: deriveProjectDepartmentIds(draft).length,
                    })}
                  </span>
                </div>

                <div className="project-setup-summary-card">
                  <h3>{t("projectSetup.assets.packingPlan")}</h3>
                  <p>
                    {t("projectSetup.summary.configuredBuckets", {
                      count: [
                        ...draft.mainUnit.unitDepartments,
                        ...draft.additionalUnits.flatMap((unit) => unit.unitDepartments),
                      ].filter((bucket) => bucket.packingSeed?.mode && bucket.packingSeed.mode !== "none").length,
                    })}
                  </p>
                  <span>{t("projectSetup.summary.packingOptional")}</span>
                </div>
              </div>

              <div className="project-setup-section-stack">
                <div className="project-setup-inline-card">
                  <div className="project-setup-card-heading">
                    <div>
                      <h3>{t("projectSetup.units.mainUnit")}</h3>
                      <p>{t("projectSetup.summary.mainUnitHelp")}</p>
                    </div>
                  </div>

                  <div className="project-setup-summary-row">
                    <strong>{t("projectSetup.units.mainUnit")}</strong>
                    <span>
                      {draft.generalInfo.startDate || draft.generalInfo.endDate
                        ? `${draft.generalInfo.startDate || t("projectSetup.units.openDate")} - ${draft.generalInfo.endDate || t("projectSetup.units.openDate")}`
                        : t("projectSetup.units.noDatesSelected")}
                    </span>
                    <span>
                      {t("projectSetup.summary.unitResourceLine", {
                        departments: getUnitDepartmentNames(draft.mainUnit, catalog.departments).join(", ") || t("projectSetup.units.noDepartments"),
                        assets: getUnitAssetIds(draft.mainUnit).length,
                        crew: countAssignedCrewForUnit(draft.mainUnit),
                      })}
                    </span>
                  </div>
                </div>

                <div className="project-setup-inline-card">
                  <div className="project-setup-card-heading">
                    <div>
                      <h3>{t("projectSetup.units.additionalUnits")}</h3>
                      <p>{draft.additionalUnits.length ? t("projectSetup.summary.compactReview") : t("projectSetup.summary.noExtraUnits")}</p>
                    </div>
                  </div>

                  {draft.additionalUnits.length ? (
                    <div className="project-setup-summary-list">
                      {draft.additionalUnits.map((unit, index) => (
                        <div key={unit.id ?? `${unit.name}-${index}`} className="project-setup-summary-row">
                          <strong>{unit.name}</strong>
                          <span>{formatUnitWindowSummary(unit, draft.generalInfo.startDate, draft.generalInfo.endDate, t)}</span>
                          <span>
                            {t("projectSetup.summary.unitResourceLine", {
                              departments: getUnitDepartmentNames(unit, catalog.departments).join(", ") || t("projectSetup.units.noDepartments"),
                              assets: getUnitAssetIds(unit).length,
                              crew: countAssignedCrewForUnit(unit),
                            })}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="project-setup-empty-copy">{t("projectSetup.summary.noAdditionalUnits")}</p>
                  )}
                </div>

                <div className="project-setup-inline-card">
                  <div className="project-setup-card-heading">
                    <div>
                      <h3>{t("projectSetup.summary.conflictReview")}</h3>
                      <p>{conflicts?.hasConflicts ? t("projectSetup.summary.resolveConflicts") : t("projectSetup.summary.noBlockingConflicts")}</p>
                    </div>

                    {isCheckingConflicts ? <StatusBadge tone="info">{t("projectSetup.summary.checking")}</StatusBadge> : null}
                  </div>

                  {conflictsError ? <div className="action-feedback action-feedback-error">{conflictsError}</div> : null}

                  {conflicts?.groups.some((group) => group.items.length > 0) ? (
                    <div className="project-setup-conflict-groups">
                      {conflicts.groups.map((group) =>
                        group.items.length ? (
                          <div key={group.type} className="project-setup-conflict-group">
                            <strong>{group.label}</strong>
                            {group.items.map((item, index) => (
                            <div key={`${item.resourceId}-${index}`} className="project-setup-conflict-row">
                              <span>{item.resourceLabel}</span>
                              <span>
                                {item.conflictingProject}
                                {item.conflictingUnit ? ` / ${item.conflictingUnit}` : ""}
                                {item.conflictingDepartment ? ` / ${item.conflictingDepartment}` : ""}
                              </span>
                              <span>{item.overlapStart} - {item.overlapEnd}</span>
                            </div>
                          ))}
                          </div>
                        ) : null,
                      )}
                    </div>
                  ) : (
                    <p className="project-setup-empty-copy">{t("projectSetup.summary.noOverlaps")}</p>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {validationErrors.length ? (
          <div className="action-feedback action-feedback-error project-setup-feedback">
            {validationErrors[0]}
          </div>
        ) : null}
        {selectedAssetIssues.length ? (
          <div className="action-feedback action-feedback-error project-setup-feedback project-setup-asset-issues">
            <div>
              <strong>{t("projectSetup.validation.assetsUnavailableTitle")}</strong>
              <ul>
                {selectedAssetIssues.slice(0, 5).map((issue) => (
                  <li key={issue.assetId}>
                    {t("projectSetup.validation.assetsUnavailableItem", {
                      asset: issue.label,
                      reason: issue.reason,
                    })}
                  </li>
                ))}
              </ul>
              {selectedAssetIssues.length > 5 ? (
                <span>{t("projectSetup.validation.assetsUnavailableMore", { count: selectedAssetIssues.length - 5 })}</span>
              ) : null}
            </div>
          </div>
        ) : null}
        {stagingError ? <div className="action-feedback action-feedback-error project-setup-feedback">{stagingError}</div> : null}
        {submitError ? <div className="action-feedback action-feedback-error project-setup-feedback">{submitError}</div> : null}
        <footer className="project-setup-footer">
          {activeTab === "summary" ? (
            <button className="ghost-control" onClick={() => void handleExportPdf()} type="button">
              <FileDown size={14} />
              <span>{t("projectSetup.actions.exportPdf")}</span>
            </button>
          ) : (
            <div />
          )}
          <div className="project-setup-footer-actions">
            <button className="project-setup-footer-button" disabled={!dirty || isSubmitting} onClick={handleSaveDraft} type="button">
              <Save size={15} />
              <span>{t("projectSetup.actions.saveDraft")}</span>
            </button>
            <button className="project-setup-footer-button is-danger" disabled={isSubmitting} onClick={handleRequestDiscardDraft} type="button">
              <Trash2 size={15} />
              <span>{t("projectSetup.actions.discardChanges")}</span>
            </button>
            <button
              className="project-setup-footer-button is-primary"
              disabled={isSubmitting || !canSubmit}
              onClick={() => void handleSubmit()}
              type="button"
            >
              <Plus size={15} />
              <span>{isSubmitting ? t("projectSetup.actions.creating") : t("projectSetup.actions.createProject")}</span>
            </button>
          </div>
        </footer>
      </section>

      {closeConfirmOpen ? (
        <div aria-modal="true" className="project-setup-close-dialog-backdrop" role="dialog">
          <div className="project-setup-close-dialog">
            <div className="project-setup-close-dialog-header">
              <span className="confirm-dialog-icon confirm-dialog-icon-default">
                <AlertTriangle size={16} />
              </span>
              <div className="confirm-dialog-copy">
                <strong>{t("projectSetup.closeDialog.title")}</strong>
                <p>{t("projectSetup.closeDialog.body")}</p>
              </div>
            </div>

            <div className="project-setup-close-dialog-actions">
              <button
                className="ghost-control"
                onClick={() => {
                  handleSaveDraft();
                }}
                type="button"
              >
                {t("projectSetup.closeDialog.keep")}
              </button>
              <button
                className="ghost-control"
                onClick={() => {
                  setCloseConfirmOpen(false);
                  onDiscardDraft();
                  onClose();
                }}
                type="button"
              >
                {t("projectSetup.closeDialog.discard")}
              </button>
              <button className="action-primary-button" onClick={() => setCloseConfirmOpen(false)} type="button">
                {t("projectSetup.closeDialog.continue")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>,
    document.body,
  );
};

export { createEmptyDraft as createEmptyProjectSetupDraft, isProjectSetupDraftDirty };
export type { ProjectSetupDraft, WizardTab };
