import { AlertTriangle, ChevronDown, ChevronRight, FileDown, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

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
  StagingPackingSlipRow,
} from "@contracts";
import { projectColorPalette } from "@contracts";
import { useCatalogData, exportProjectBlueprintPdf, getProjectCreationConflicts, getStagingPackingSlips } from "@features/projects/useProjectsData";
import { ListToolbar } from "@shared/components/ListToolbar";
import { SelectField } from "@shared/components/SelectField";
import { StatusBadge } from "@shared/components/StatusBadge";
import { useShellContext } from "@shared/hooks/useShellContext";

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

const normalizeDraftForSubmit = (draft: ProjectSetupDraft): CreateProjectBlueprintInput => ({
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
    departmentIds: uniqueIds(draft.generalInfo.departmentIds),
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

const formatUnitWindowSummary = (unit: ProjectBlueprintUnitDraftInput, fallbackStart?: string | null, fallbackEnd?: string | null) => {
  const windows = getUnitWindows(unit).filter((window) => window.startDate || window.endDate);
  if (!windows.length) {
    if (fallbackStart || fallbackEnd) {
      return `${fallbackStart ?? "Open"} - ${fallbackEnd ?? "Open"}`;
    }

    return "No dates selected";
  }

  const labels = windows.map((window) => `${window.startDate ?? "Open"} - ${window.endDate ?? "Open"}`);
  if (labels.length === 1) {
    return labels[0] ?? "No dates selected";
  }

  const preview = labels.slice(0, 3).join(", ");
  return `${labels.length} windows · ${preview}${labels.length > 3 ? "…" : ""}`;
};

const formatWindowsList = (windows: Array<{ startDate: string | null; endDate: string | null }>) => {
  const labels = windows
    .filter((window) => window.startDate || window.endDate)
    .map((window) => `${window.startDate ?? "Open"} - ${window.endDate ?? "Open"}`);

  return labels.length ? labels : ["No dates selected"];
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

const buildValidationErrors = (draft: ProjectSetupDraft) => {
  const errors: string[] = [];

  if (!draft.generalInfo.name.trim()) {
    errors.push("Project name is required.");
  }

  if (!draft.generalInfo.startDate) {
    errors.push("Project start date is required.");
  }

  if (!draft.generalInfo.endDate) {
    errors.push("Project end date is required.");
  }

  if (!isValidDateWindow(draft.generalInfo.startDate, draft.generalInfo.endDate)) {
    errors.push("Project end date must be on or after the start date.");
  }

  if (!draft.generalInfo.status.trim()) {
    errors.push("Project status is required.");
  }

  if (!draft.generalInfo.colorKey.trim()) {
    errors.push("Timeline color is required.");
  }

  if (draft.generalInfo.hasPreproduction) {
    if (!draft.generalInfo.preproductionStartDate || !draft.generalInfo.preproductionEndDate) {
      errors.push("Pre-production requires both start and end dates.");
    }

    if (!isValidDateWindow(draft.generalInfo.preproductionStartDate, draft.generalInfo.preproductionEndDate)) {
      errors.push("Pre-production end date must be on or after the start date.");
    }

    if (
      draft.generalInfo.startDate &&
      draft.generalInfo.preproductionEndDate &&
      draft.generalInfo.preproductionEndDate > draft.generalInfo.startDate
    ) {
      errors.push("Pre-production must end on or before the main project start date.");
    }
  }

  draft.additionalUnits.forEach((unit, index) => {
    if (!unit.name.trim()) {
      errors.push(`Additional unit ${index + 1} needs a name.`);
    }

    getUnitWindows(unit).forEach((window, windowIndex) => {
      if (!isValidDateWindow(window.startDate ?? "", window.endDate ?? "")) {
        errors.push(`Additional unit ${index + 1} window ${windowIndex + 1} has an invalid date window.`);
      }
    });

    unit.departmentIds.forEach((departmentId) => {
      if (!draft.generalInfo.departmentIds.includes(departmentId)) {
        errors.push(`Additional unit ${index + 1} uses a department outside the project pool.`);
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
  const { data: catalog } = useCatalogData();
  const { createProjectBlueprint, openProject } = useShellContext();
  const [stagingSlips, setStagingSlips] = useState<StagingPackingSlipRow[]>([]);
  const [stagingError, setStagingError] = useState<string | null>(null);
  const [isLoadingStaging, setIsLoadingStaging] = useState(false);
  const [conflicts, setConflicts] = useState<ProjectCreationConflictsSnapshot | null>(null);
  const [conflictsError, setConflictsError] = useState<string | null>(null);
  const [isCheckingConflicts, setIsCheckingConflicts] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitFeedback, setSubmitFeedback] = useState<string | null>(null);
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
  const [crewAvailableSort, setCrewAvailableSort] = useState<CrewAvailableSort>("name");
  const [crewSelectedSort, setCrewSelectedSort] = useState<CrewSelectedSort>("name");
  const [crewAvailableDirection, setCrewAvailableDirection] = useState<ListSortDirection>("asc");
  const [crewSelectedDirection, setCrewSelectedDirection] = useState<ListSortDirection>("asc");
  const dirty = isProjectSetupDraftDirty(draft);

  const validationErrors = useMemo(() => buildValidationErrors(draft), [draft]);

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
        setStagingError(error instanceof Error ? error.message : "Unable to load staging packing slips.");
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
      void getProjectCreationConflicts(normalizeDraftForSubmit(draft))
        .then((snapshot) => {
          setConflicts(snapshot);
          setConflictsError(null);
        })
        .catch((error) => {
          setConflicts(null);
          setConflictsError(error instanceof Error ? error.message : "Unable to check conflicts.");
        })
        .finally(() => setIsCheckingConflicts(false));
    }, 200);

    return () => window.clearTimeout(timeout);
  }, [draft, open]);

  useEffect(() => {
    if (activeAssignmentUnitId === "main") {
      return;
    }

    const exists = draft.additionalUnits.some((unit) => unit.id === activeAssignmentUnitId);
    if (!exists) {
      setActiveAssignmentUnitId("main");
    }
  }, [activeAssignmentUnitId, draft.additionalUnits]);

  const projectDepartmentIds = draft.generalInfo.departmentIds;

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

  const setProjectDepartmentIds = (departmentIds: string[]) => {
    const nextProjectDepartmentIds = uniqueIds(departmentIds);
    const nextMainDepartmentIds = draft.mainUnit.departmentIds.filter((departmentId) => nextProjectDepartmentIds.includes(departmentId));

    onChangeDraft({
      ...draft,
      generalInfo: {
        ...draft.generalInfo,
        departmentIds: nextProjectDepartmentIds,
      },
      mainUnit: {
        ...draft.mainUnit,
        departmentIds: nextMainDepartmentIds,
        unitDepartments: syncUnitDepartments({ ...draft.mainUnit, departmentIds: nextMainDepartmentIds }, nextMainDepartmentIds),
      },
      additionalUnits: draft.additionalUnits.map((unit) => {
        const nextUnitDepartmentIds = unit.departmentIds.filter((departmentId) => nextProjectDepartmentIds.includes(departmentId));
        return {
          ...unit,
          departmentIds: nextUnitDepartmentIds,
          unitDepartments: syncUnitDepartments({ ...unit, departmentIds: nextUnitDepartmentIds }, nextUnitDepartmentIds),
        };
      }),
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
          departmentIds: [...draft.generalInfo.departmentIds],
          unitDepartments: syncUnitDepartments({ ...unit, departmentIds: [...draft.generalInfo.departmentIds] }, [...draft.generalInfo.departmentIds]),
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
      label: "Main Unit",
      dateRange:
        draft.generalInfo.startDate || draft.generalInfo.endDate
          ? `${draft.generalInfo.startDate || "Open"} - ${draft.generalInfo.endDate || "Open"}`
          : "No dates selected",
      assetCount: getUnitAssetIds(draft.mainUnit).length,
      crewCount: countAssignedCrewForUnit(draft.mainUnit),
    },
    ...draft.additionalUnits.map((unit, index) => ({
      id: (unit.id ?? `additional-${index}`) as AssignmentUnitId,
      label: unit.name || `Additional Unit ${index + 1}`,
      dateRange: formatUnitWindowSummary(unit, draft.generalInfo.startDate, draft.generalInfo.endDate),
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
  const renderActiveWindowBadges = () =>
    activeAssignmentWindowEntries.length ? (
      <div className="project-setup-window-badges" role="presentation">
        {activeAssignmentWindowEntries.map((window, index) => (
          <span key={`${window.startDate ?? "open"}-${window.endDate ?? "open"}-${index}`} className={`project-setup-window-badge tone-${(index % 4) + 1}`}>
            <strong>{`${index + 1}${index === 0 ? "st" : index === 1 ? "nd" : index === 2 ? "rd" : "th"} window`}</strong>
            <span>{`${window.startDate ?? "Open"} - ${window.endDate ?? "Open"}`}</span>
          </span>
        ))}
      </div>
    ) : (
      <span className="project-setup-field-note">No dates selected for this unit yet.</span>
    );

  const updateAssignmentUnit = (patch: Partial<ProjectBlueprintUnitDraftInput>) => {
    if (activeAssignmentUnitId === "main") {
      updateMainUnit(patch);
      return;
    }

    updateAdditionalUnit(activeAssignmentUnitId, patch);
  };

  const updateAssignmentUnitDepartmentIds = (unitId: AssignmentUnitId, departmentIds: string[]) => {
    const normalizedDepartmentIds = uniqueIds(departmentIds.filter((departmentId) => projectDepartmentIds.includes(departmentId)));

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
        label: "Main Unit",
        windows: [{ startDate: draft.generalInfo.startDate || null, endDate: draft.generalInfo.endDate || null }],
        buckets: draft.mainUnit.unitDepartments,
        isActiveUnit: activeAssignmentUnitId === "main",
      },
      ...draft.additionalUnits.map((unit, index) => ({
        label: unit.name || `Additional Unit ${index + 1}`,
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
  }, [activeAssignmentDepartmentId, activeAssignmentUnitId, activeAssignmentWindows, catalog.departments, draft.additionalUnits, draft.generalInfo.endDate, draft.generalInfo.startDate, draft.mainUnit]);

  const assetAvailableRows = useMemo(() => {
    return [...catalog.assetOptions]
      .filter((asset) => !(activeAssignmentBucket?.assetIds ?? []).includes(asset.id))
      .filter((asset) => matchesSearch(assetAvailableSearch, [asset.code, asset.name, asset.category, asset.status]))
      .sort((left, right) => {
        const leftValue = left[assetAvailableSort];
        const rightValue = right[assetAvailableSort];
        return compareValues(leftValue, rightValue, assetAvailableDirection);
      });
  }, [activeAssignmentBucket?.assetIds, assetAvailableDirection, assetAvailableSearch, assetAvailableSort, catalog.assetOptions]);

  const selectedAssetRows = useMemo(() => {
    return [...catalog.assetOptions]
      .filter((asset) => (activeAssignmentBucket?.assetIds ?? []).includes(asset.id))
      .filter((asset) => matchesSearch(assetSelectedSearch, [asset.code, asset.name, asset.category]))
      .sort((left, right) => {
        const leftValue = left[assetSelectedSort];
        const rightValue = right[assetSelectedSort];
        return compareValues(leftValue, rightValue, assetSelectedDirection);
      });
  }, [activeAssignmentBucket?.assetIds, assetSelectedDirection, assetSelectedSearch, assetSelectedSort, catalog.assetOptions]);

  const crewAvailableRows = useMemo(() => {
    return [...catalog.crewMembers]
      .filter((crewMember) => !(activeAssignmentBucket?.crewAssignments ?? []).some((assignment) => assignment.crewMemberId === crewMember.id))
      .filter((crewMember) => matchesSearch(crewAvailableSearch, [crewMember.fullName, crewMember.roleLabel]))
      .sort((left, right) => {
        const leftValue = crewAvailableSort === "role" ? left.roleLabel : left.fullName;
        const rightValue = crewAvailableSort === "role" ? right.roleLabel : right.fullName;
        return compareValues(leftValue, rightValue, crewAvailableDirection);
      });
  }, [activeAssignmentBucket?.crewAssignments, catalog.crewMembers, crewAvailableDirection, crewAvailableSearch, crewAvailableSort]);

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
        label: "Main Unit",
        windows: [{ startDate: draft.generalInfo.startDate || null, endDate: draft.generalInfo.endDate || null }],
        buckets: draft.mainUnit.unitDepartments,
        isActiveUnit: activeAssignmentUnitId === "main",
      },
      ...draft.additionalUnits.map((unit, index) => ({
        label: unit.name || `Additional Unit ${index + 1}`,
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
  }, [activeAssignmentDepartmentId, activeAssignmentUnitId, activeAssignmentWindows, catalog.departments, draft.additionalUnits, draft.generalInfo.endDate, draft.generalInfo.startDate, draft.mainUnit]);

  const selectedCrewRows = useMemo(() => {
    return (activeAssignmentBucket?.crewAssignments ?? [])
      .map((assignment, sourceIndex) => ({
        assignment,
        sourceIndex,
      }))
      .filter((assignment) => assignmentHasCrewMember(assignment.assignment))
      .filter((assignment) => {
        const crewMember = catalog.crewMembers.find((row) => row.id === assignment.assignment.crewMemberId);
        return matchesSearch(crewSelectedSearch, [crewMember?.fullName, assignment.assignment.roleLabel, crewMember?.roleLabel]);
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
  }, [activeAssignmentBucket?.crewAssignments, catalog.crewMembers, crewSelectedDirection, crewSelectedSearch, crewSelectedSort]);

  if (!open) {
    return null;
  }

  const handleAddAssetToActiveUnit = (assetId: string) => {
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

  const handleSubmit = async () => {
    try {
      setIsSubmitting(true);
      setSubmitError(null);
      const createdProject = await createProjectBlueprint(normalizeDraftForSubmit(draft));
      onDiscardDraft();
      onClose();

      if (createdProject) {
        openProject(createdProject.id, "overview");
      }
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Unable to create project setup.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExportPdf = async () => {
    try {
      setSubmitError(null);
      const result = await exportProjectBlueprintPdf(normalizeDraftForSubmit(draft));
      setSubmitFeedback(result.summary);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Unable to export project setup summary.");
    }
  };

  const canSubmit = validationErrors.length === 0 && !conflicts?.hasConflicts && !isCheckingConflicts;
  const conflictCount = conflicts?.groups.reduce((count, group) => count + group.items.length, 0) ?? 0;

  const tabItems: Array<{ id: WizardTab; label: string }> = [
    { id: "general", label: "General Info" },
    { id: "units", label: "Set Additional Units" },
    { id: "assets", label: "Assign Assets" },
    { id: "crew", label: "Assign Crew" },
    { id: "summary", label: "Summary" },
  ];

  return createPortal(
    <div className="project-setup-backdrop" role="presentation">
      <section aria-modal="true" className="project-setup-modal" role="dialog">
        <header className="project-setup-header">
          <div>
            <span className="project-setup-step-label">Project setup wizard</span>
            <h2 className="project-setup-title">Create new project</h2>
          </div>

          <div className="project-setup-header-actions">
            {dirty ? <StatusBadge tone="warning">Draft in progress</StatusBadge> : null}
            {conflictCount ? <StatusBadge tone="critical">{`${conflictCount} conflicts`}</StatusBadge> : null}
            <button
              aria-label="Close project setup"
              className="project-setup-close-button"
              data-tooltip="Close project setup"
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
                  <span className="action-field-label">Project code</span>
                  <input
                    className="action-field-control"
                    onChange={(event) => setGeneralInfo("code", event.target.value)}
                    placeholder="Leave blank to auto-generate code"
                    value={draft.generalInfo.code}
                  />
                </label>

                <label className="action-field">
                  <span className="action-field-label">Project name</span>
                  <input className="action-field-control" onChange={(event) => setGeneralInfo("name", event.target.value)} value={draft.generalInfo.name} />
                </label>

                <label className="action-field">
                  <span className="action-field-label">Production company</span>
                  <SelectField onChange={(event) => setGeneralInfo("productionCompanyId", event.target.value)} value={draft.generalInfo.productionCompanyId}>
                    <option value="">No production company linked</option>
                    {catalog.productionCompanies.map((company) => (
                      <option key={company.id} value={company.id}>
                        {company.name}
                      </option>
                    ))}
                  </SelectField>
                </label>

                <label className="action-field">
                  <span className="action-field-label">Client</span>
                  <SelectField onChange={(event) => setGeneralInfo("clientId", event.target.value)} value={draft.generalInfo.clientId}>
                    <option value="">No client linked</option>
                    {catalog.clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </SelectField>
                </label>

                <label className="action-field">
                  <span className="action-field-label">Start date</span>
                  <input className="action-field-control" onChange={(event) => setGeneralInfo("startDate", event.target.value)} type="date" value={draft.generalInfo.startDate} />
                </label>

                <label className="action-field">
                  <span className="action-field-label">End date</span>
                  <input className="action-field-control" onChange={(event) => setGeneralInfo("endDate", event.target.value)} type="date" value={draft.generalInfo.endDate} />
                </label>

                <div className="action-field action-field-wide">
                  <span className="action-field-label">Project departments</span>
                  <div className="project-setup-checkbox-grid">
                    {catalog.departments.map((department) => {
                      const checked = draft.generalInfo.departmentIds.includes(department.id);
                      return (
                        <label key={department.id} className="project-setup-toggle">
                          <input
                            checked={checked}
                            onChange={(event) =>
                              setProjectDepartmentIds(
                                event.target.checked
                                  ? [...draft.generalInfo.departmentIds, department.id]
                                  : draft.generalInfo.departmentIds.filter((departmentId) => departmentId !== department.id),
                              )
                            }
                            type="checkbox"
                          />
                          <span>{department.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="action-field action-field-wide">
                  <span className="action-field-label">Main Unit departments</span>
                  <div className="project-setup-checkbox-grid">
                    {draft.generalInfo.departmentIds.length ? (
                      catalog.departments
                        .filter((department) => draft.generalInfo.departmentIds.includes(department.id))
                        .map((department) => {
                          const checked = draft.mainUnit.departmentIds.includes(department.id);
                          return (
                            <label key={department.id} className="project-setup-toggle">
                              <input
                                checked={checked}
                                onChange={(event) =>
                                  updateAssignmentUnitDepartmentIds(
                                    "main",
                                    event.target.checked
                                      ? [...draft.mainUnit.departmentIds, department.id]
                                      : draft.mainUnit.departmentIds.filter((departmentId) => departmentId !== department.id),
                                  )
                                }
                                type="checkbox"
                              />
                              <span>{department.name}</span>
                            </label>
                          );
                        })
                    ) : (
                      <span className="project-setup-field-note">Select project departments first to seed the Main Unit.</span>
                    )}
                  </div>
                </div>

                <label className="project-setup-toggle">
                  <input
                    checked={draft.generalInfo.hasPreproduction}
                    onChange={(event) => setGeneralInfo("hasPreproduction", event.target.checked)}
                    type="checkbox"
                  />
                  <span>Includes pre-production window</span>
                </label>

                <div />

                {draft.generalInfo.hasPreproduction ? (
                  <>
                    <label className="action-field">
                      <span className="action-field-label">Pre-production start</span>
                      <input
                        className="action-field-control"
                        onChange={(event) => setGeneralInfo("preproductionStartDate", event.target.value)}
                        type="date"
                        value={draft.generalInfo.preproductionStartDate}
                      />
                    </label>

                    <label className="action-field">
                      <span className="action-field-label">Pre-production end</span>
                      <input
                        className="action-field-control"
                        onChange={(event) => setGeneralInfo("preproductionEndDate", event.target.value)}
                        type="date"
                        value={draft.generalInfo.preproductionEndDate}
                      />
                    </label>
                  </>
                ) : null}

                <label className="action-field">
                  <span className="action-field-label">Status</span>
                  <SelectField onChange={(event) => setGeneralInfo("status", event.target.value)} value={draft.generalInfo.status}>
                    {projectStatusOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </SelectField>
                </label>

                <label className="action-field">
                  <span className="action-field-label">Timeline color</span>
                  <SelectField onChange={(event) => setGeneralInfo("colorKey", event.target.value)} value={draft.generalInfo.colorKey}>
                    <option value="">Default system tone</option>
                    {projectColorPalette.map((color) => (
                      <option key={color.key} value={color.key}>
                        {color.label}
                      </option>
                    ))}
                  </SelectField>
                </label>

                <label className="action-field action-field-wide">
                  <span className="action-field-label">Description</span>
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
                {assignmentUnitOptions.length > 1 ? (
                  <div className="project-setup-inline-card">
                    <div className="project-setup-card-heading">
                      <div>
                        <h3>Assign to unit</h3>
                        <p>Select which unit receives the assets in this step.</p>
                      </div>
                    </div>

                    <label className="action-field">
                      <span className="action-field-label">Target unit</span>
                      <SelectField onChange={(event) => setActiveAssignmentUnitId(event.target.value)} value={activeAssignmentUnitId}>
                        {assignmentUnitOptions.map((unit) => (
                          <option key={unit.id} value={unit.id}>
                            {unit.label} · {unit.dateRange} · {unit.assetCount} assets · {unit.crewCount} crew
                          </option>
                        ))}
                      </SelectField>
                    </label>
                    {renderActiveWindowBadges()}
                  </div>
                ) : null}

                {activeUnitDepartmentIds.length > 1 ? (
                  <div className="project-setup-inline-card">
                    <div className="project-setup-card-heading">
                      <div>
                        <h3>Assign to department</h3>
                        <p>Select which department bucket receives the assets.</p>
                      </div>
                    </div>

                    <label className="action-field">
                      <span className="action-field-label">Target department</span>
                      <SelectField onChange={(event) => setActiveAssignmentDepartmentId(event.target.value)} value={activeAssignmentDepartmentId}>
                        {activeUnitDepartmentIds.map((departmentId) => {
                          const department = catalog.departments.find((row) => row.id === departmentId);
                          const bucket = activeAssignmentUnit.unitDepartments.find((row) => row.departmentId === departmentId);
                          return (
                            <option key={departmentId} value={departmentId}>
                              {(department?.name ?? departmentId)} · {(bucket?.assetIds.length ?? 0)} assets · {countAssignedCrew(bucket?.crewAssignments ?? [])} crew
                            </option>
                          );
                        })}
                      </SelectField>
                    </label>
                    {renderActiveWindowBadges()}
                  </div>
                ) : null}

                {activeAssignmentDepartmentId ? (
                  <div className="project-setup-inline-card">
                    <div className="project-setup-card-heading">
                      <div>
                        <h3>Packing seed</h3>
                        <p>{activeAssignmentUnitMeta.label}{activeAssignmentDepartment ? ` / ${activeAssignmentDepartment.name}` : ""}</p>
                      </div>
                    </div>

                    <label className="action-field">
                      <span className="action-field-label">Packing source</span>
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
                        <option value="none">No packing source</option>
                        <option value="existing">Use staging slip</option>
                        <option value="draft">Draft new staging slip</option>
                      </SelectField>
                    </label>

                    {activeAssignmentBucket?.packingSeed?.mode === "existing" ? (
                      <label className="action-field">
                        <span className="action-field-label">Staging slip</span>
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
                          <option value="">{isLoadingStaging ? "Loading staging slips..." : "Choose staging slip"}</option>
                          {stagingSlips
                            .filter((slip) => !activeAssignmentDepartment || slip.department === "—" || slip.department === activeAssignmentDepartment.name)
                            .map((slip) => (
                              <option key={slip.id} value={slip.id}>
                                {slip.number} · {slip.itemCount} items
                              </option>
                            ))}
                        </SelectField>
                      </label>
                    ) : null}

                    {activeAssignmentBucket?.packingSeed?.mode === "draft" ? (
                      <div className="project-setup-grid project-setup-grid-compact">
                        <label className="action-field">
                          <span className="action-field-label">Slip label</span>
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
                          <span className="action-field-label">Responsible</span>
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
                            <option value="">No responsible</option>
                            {catalog.users.map((user) => (
                              <option key={user.id} value={user.id}>
                                {user.fullName}
                              </option>
                            ))}
                          </SelectField>
                        </label>

                        <label className="action-field action-field-wide">
                          <span className="action-field-label">Notes</span>
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
                    <p>No department selected for this unit.</p>
                    <span>Pick at least one department first so we can assign assets and optionally seed packing.</span>
                  </div>
                )}

                <div className="project-setup-two-column project-setup-resource-panels">
                  <div className="project-setup-inline-card">
                    <div className="project-setup-card-heading">
                      <div>
                        <h3>Available assets</h3>
                        <p>{activeAssignmentUnitMeta.label}{activeAssignmentDepartment ? ` / ${activeAssignmentDepartment.name}` : ""}</p>
                      </div>
                    </div>

                    <ListToolbar
                      activeSortLabel={assetAvailableSort}
                      onSearchValueChange={setAssetAvailableSearch}
                      onSortByChange={setAssetAvailableSort}
                      onToggleSortDirection={() => setAssetAvailableDirection((current) => (current === "asc" ? "desc" : "asc"))}
                      resultCount={assetAvailableRows.length}
                      resultLabel="assets"
                      searchPlaceholder="Search available assets"
                      searchValue={assetAvailableSearch}
                      sortBy={assetAvailableSort}
                      sortDirection={assetAvailableDirection}
                      sortOptions={[
                        { value: "name", label: "Name" },
                        { value: "code", label: "Code" },
                        { value: "category", label: "Category" },
                        { value: "status", label: "Status" },
                      ]}
                    />

                    <div className="project-setup-resource-list">
                      {assetAvailableRows.length ? (
                        assetAvailableRows.map((asset) => (
                          <div key={asset.id} className={`project-setup-resource-row${isAssetOccupiedForNewProject(asset) ? " is-blocked" : ""}`}>
                            <span className="project-setup-resource-copy">
                              <strong>{asset.code} · {asset.name}</strong>
                              <span>{asset.category} · {asset.status}</span>
                              {isAssetOccupiedForNewProject(asset) ? (
                                <span>
                                  In use on {asset.currentProject}
                                  {asset.currentUnit ? ` / ${asset.currentUnit}` : ""}
                                  {asset.currentDepartment ? ` / ${asset.currentDepartment}` : ""}
                                </span>
                              ) : null}
                            </span>
                            <span className="project-setup-resource-meta">
                              {isAssetOccupiedForNewProject(asset) ? <StatusBadge tone="critical">Unavailable</StatusBadge> : null}
                              {!isAssetOccupiedForNewProject(asset) && sameSetupAssetAssignmentsById.has(asset.id) ? (
                                <StatusBadge tone="warning">Assigned to another unit</StatusBadge>
                              ) : !isAssetOccupiedForNewProject(asset) && assignedAssetIdsInOtherUnits.has(asset.id) ? (
                                <StatusBadge tone="warning">Already assigned in this setup</StatusBadge>
                              ) : null}
                              {isAssetOccupiedForNewProject(asset) ? (
                                <span className="project-setup-resource-occupancy">
                                  Resolve current assignment first
                                </span>
                              ) : sameSetupAssetAssignmentsById.has(asset.id) ? (
                                <span className="project-setup-resource-occupancy">
                                  Assigned in this setup / {sameSetupAssetAssignmentsById.get(asset.id)?.unit}
                                </span>
                              ) : (
                                <button className="ghost-control" onClick={() => handleAddAssetToActiveUnit(asset.id)} type="button">
                                  Add
                                </button>
                              )}
                            </span>
                          </div>
                        ))
                      ) : (
                        <p className="project-setup-empty-copy">No assets match the current filters.</p>
                      )}
                    </div>
                  </div>

                    <div className="project-setup-inline-card">
                      <div className="project-setup-card-heading">
                        <div>
                          <h3>Selected assets</h3>
                          <p>{(activeAssignmentBucket?.assetIds.length ?? 0)} selected · {(activeAssignmentBucket?.packingSeed?.mode ?? "none") === "none" ? "No packing seed" : activeAssignmentBucket?.packingSeed?.mode === "existing" ? "Using staging slip" : "Draft packing seed"}</p>
                        </div>
                      </div>

                    <ListToolbar
                      activeSortLabel={assetSelectedSort}
                      onSearchValueChange={setAssetSelectedSearch}
                      onSortByChange={setAssetSelectedSort}
                      onToggleSortDirection={() => setAssetSelectedDirection((current) => (current === "asc" ? "desc" : "asc"))}
                      resultCount={selectedAssetRows.length}
                      resultLabel="selected assets"
                      searchPlaceholder="Search selected assets"
                      searchValue={assetSelectedSearch}
                      sortBy={assetSelectedSort}
                      sortDirection={assetSelectedDirection}
                      sortOptions={[
                        { value: "name", label: "Name" },
                        { value: "code", label: "Code" },
                        { value: "category", label: "Category" },
                      ]}
                    />

                    <div className="project-setup-resource-list">
                      {selectedAssetRows.length ? (
                        selectedAssetRows.map((asset) => (
                          <div key={asset.id} className="project-setup-resource-row is-selected">
                            <span className="project-setup-resource-copy">
                              <strong>{asset.code} · {asset.name}</strong>
                              <span>{asset.category} · {asset.status}</span>
                            </span>
                            <button
                              aria-label={`Remove ${asset.name} from ${activeAssignmentUnitMeta.label}`}
                              className="icon-danger-control"
                              data-tooltip={`Remove ${asset.name}`}
                              onClick={() => handleRemoveAssetFromActiveUnit(asset.id)}
                              type="button"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))
                      ) : (
                        <p className="project-setup-empty-copy">No assets assigned to this unit yet.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {activeTab === "crew" ? (
            <div className="project-setup-panel">
              {assignmentUnitOptions.length > 1 ? (
                <div className="project-setup-inline-card">
                  <div className="project-setup-card-heading">
                    <div>
                      <h3>Assign to unit</h3>
                      <p>Select which unit receives crew in this step.</p>
                    </div>
                  </div>

                  <label className="action-field">
                    <span className="action-field-label">Target unit</span>
                    <SelectField onChange={(event) => setActiveAssignmentUnitId(event.target.value)} value={activeAssignmentUnitId}>
                      {assignmentUnitOptions.map((unit) => (
                        <option key={unit.id} value={unit.id}>
                          {unit.label} · {unit.dateRange} · {unit.assetCount} assets · {unit.crewCount} crew
                        </option>
                      ))}
                    </SelectField>
                  </label>
                  {renderActiveWindowBadges()}
                  </div>
                ) : null}

              {activeUnitDepartmentIds.length > 1 ? (
                <div className="project-setup-inline-card">
                  <div className="project-setup-card-heading">
                    <div>
                      <h3>Assign to department</h3>
                      <p>Select which department bucket receives crew.</p>
                    </div>
                  </div>

                  <label className="action-field">
                    <span className="action-field-label">Target department</span>
                    <SelectField onChange={(event) => setActiveAssignmentDepartmentId(event.target.value)} value={activeAssignmentDepartmentId}>
                      {activeUnitDepartmentIds.map((departmentId) => {
                        const department = catalog.departments.find((row) => row.id === departmentId);
                        const bucket = activeAssignmentUnit.unitDepartments.find((row) => row.departmentId === departmentId);
                        return (
                          <option key={departmentId} value={departmentId}>
                            {(department?.name ?? departmentId)} · {(bucket?.assetIds.length ?? 0)} assets · {countAssignedCrew(bucket?.crewAssignments ?? [])} crew
                          </option>
                        );
                      })}
                    </SelectField>
                  </label>
                  {renderActiveWindowBadges()}
                </div>
              ) : null}

              <div className="project-setup-two-column project-setup-resource-panels">
                <div className="project-setup-inline-card">
                  <div className="project-setup-card-heading">
                    <div>
                      <h3>Available crew</h3>
                      <p>{activeAssignmentUnitMeta.label}{activeAssignmentDepartment ? ` / ${activeAssignmentDepartment.name}` : ""}</p>
                    </div>
                  </div>

                  <ListToolbar
                    activeSortLabel={crewAvailableSort}
                    onSearchValueChange={setCrewAvailableSearch}
                    onSortByChange={setCrewAvailableSort}
                    onToggleSortDirection={() => setCrewAvailableDirection((current) => (current === "asc" ? "desc" : "asc"))}
                    resultCount={crewAvailableRows.length}
                    resultLabel="crew members"
                    searchPlaceholder="Search available crew"
                    searchValue={crewAvailableSearch}
                    sortBy={crewAvailableSort}
                    sortDirection={crewAvailableDirection}
                    sortOptions={[
                      { value: "name", label: "Name" },
                      { value: "role", label: "Role" },
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
                            <span>{crewMember.roleLabel || "No default role"}</span>
                            {blockingCrewAssignmentsByMember.has(crewMember.id) ? (
                              <span>
                                In use on {blockingCrewAssignmentsByMember.get(crewMember.id)?.project}
                                {blockingCrewAssignmentsByMember.get(crewMember.id)?.unit ? ` / ${blockingCrewAssignmentsByMember.get(crewMember.id)?.unit}` : ""}
                                {blockingCrewAssignmentsByMember.get(crewMember.id)?.department ? ` / ${blockingCrewAssignmentsByMember.get(crewMember.id)?.department}` : ""}
                              </span>
                            ) : null}
                          </span>
                          <span className="project-setup-resource-meta">
                            {blockingCrewAssignmentsByMember.has(crewMember.id) ? <StatusBadge tone="critical">Unavailable</StatusBadge> : null}
                            {!blockingCrewAssignmentsByMember.has(crewMember.id) && sameSetupCrewAssignmentsByMember.has(crewMember.id) ? (
                              <StatusBadge tone="warning">Assigned to another unit</StatusBadge>
                            ) : null}
                            {blockingCrewAssignmentsByMember.has(crewMember.id) ? (
                              <span className="project-setup-resource-occupancy">Resolve current assignment first</span>
                            ) : sameSetupCrewAssignmentsByMember.has(crewMember.id) ? (
                              <span className="project-setup-resource-occupancy">
                                Assigned in this setup / {sameSetupCrewAssignmentsByMember.get(crewMember.id)?.unit}
                              </span>
                            ) : (
                              <button className="ghost-control" onClick={() => handleAddCrewToActiveUnit(crewMember.id)} type="button">
                                Add
                              </button>
                            )}
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="project-setup-empty-copy">No crew matches the current filters.</p>
                    )}
                  </div>
                </div>

                <div className="project-setup-inline-card">
                  <div className="project-setup-card-heading">
                    <div>
                      <h3>Assigned crew</h3>
                      <p>{countAssignedCrew(activeAssignmentBucket?.crewAssignments ?? [])} linked</p>
                    </div>
                  </div>

                  <ListToolbar
                    activeSortLabel={crewSelectedSort}
                    onSearchValueChange={setCrewSelectedSearch}
                    onSortByChange={setCrewSelectedSort}
                    onToggleSortDirection={() => setCrewSelectedDirection((current) => (current === "asc" ? "desc" : "asc"))}
                    resultCount={selectedCrewRows.length}
                    resultLabel="assignments"
                    searchPlaceholder="Search assigned crew"
                    searchValue={crewSelectedSearch}
                    sortBy={crewSelectedSort}
                    sortDirection={crewSelectedDirection}
                    sortOptions={[
                      { value: "name", label: "Name" },
                      { value: "role", label: "Role" },
                      { value: "startDate", label: "Start date" },
                    ]}
                  />

                  <div className="project-setup-section-stack">
                    {selectedCrewRows.length ? (
                      selectedCrewRows.map(({ assignment, sourceIndex }) => {
                        const crewMember = catalog.crewMembers.find((row) => row.id === assignment.crewMemberId);
                        const activeWindowsList = formatWindowsList(activeAssignmentWindows);
                        const hasMultipleUnitWindows = activeWindowsList.length > 1;
                        return (
                          <div key={`${assignment.crewMemberId}-${sourceIndex}`} className="project-setup-inline-card is-nested">
                            <div className="project-setup-card-heading">
                              <div>
                                <h3>{crewMember?.fullName ?? "Crew assignment"}</h3>
                                <p>{assignment.roleLabel || crewMember?.roleLabel || "Role pending"}</p>
                              </div>

                              <button
                                aria-label={`Remove ${crewMember?.fullName ?? "crew assignment"} from ${activeAssignmentUnitMeta.label}`}
                                className="icon-danger-control"
                                data-tooltip={`Remove ${crewMember?.fullName ?? "crew assignment"}`}
                                onClick={() => removeCrewAssignmentFromActiveUnit(sourceIndex)}
                                type="button"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>

                            {hasMultipleUnitWindows ? (
                              <div className="project-setup-assignment-windows-note">
                                <strong>{`${activeWindowsList.length} unit windows`}</strong>
                                <span>The crew member inherits these active windows from the selected unit.</span>
                              </div>
                            ) : null}

                            <div className="project-setup-grid project-setup-grid-compact">
                              <label className="action-field">
                                <span className="action-field-label">Role</span>
                                <input
                                  className="action-field-control"
                                  onChange={(event) => updateCrewAssignmentForActiveUnit(sourceIndex, { roleLabel: event.target.value })}
                                  placeholder="Optional role"
                                  value={assignment.roleLabel ?? ""}
                                />
                              </label>

                              {hasMultipleUnitWindows ? (
                                <div className="action-field action-field-wide">
                                  <span className="action-field-label">Assigned windows</span>
                                  <div className="project-setup-multi-window-fields">
                                    {activeAssignmentWindowEntries.map((window, windowIndex) => (
                                      <div key={`${window.startDate ?? "open"}-${window.endDate ?? "open"}-${windowIndex}`} className={`project-setup-window-fieldset tone-${(windowIndex % 4) + 1}`}>
                                        <strong>{`${windowIndex + 1}${windowIndex === 0 ? "st" : windowIndex === 1 ? "nd" : windowIndex === 2 ? "rd" : "th"} window`}</strong>
                                        <div className="project-setup-window-fieldset-grid">
                                          <label className="action-field">
                                            <span className="action-field-label">Start</span>
                                            <input className="action-field-control" readOnly type="date" value={window.startDate ?? ""} />
                                          </label>
                                          <label className="action-field">
                                            <span className="action-field-label">End</span>
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
                                    <span className="action-field-label">Start</span>
                                    <input
                                      className="action-field-control"
                                      onChange={(event) => updateCrewAssignmentForActiveUnit(sourceIndex, { startDate: event.target.value })}
                                      type="date"
                                      value={assignment.startDate ?? ""}
                                    />
                                  </label>

                                  <label className="action-field">
                                    <span className="action-field-label">End</span>
                                    <input
                                      className="action-field-control"
                                      onChange={(event) => updateCrewAssignmentForActiveUnit(sourceIndex, { endDate: event.target.value })}
                                      type="date"
                                      value={assignment.endDate ?? ""}
                                    />
                                  </label>
                                </>
                              )}

                              <label className="action-field">
                                <span className="action-field-label">Notes</span>
                                <input
                                  className="action-field-control"
                                  onChange={(event) => updateCrewAssignmentForActiveUnit(sourceIndex, { notes: event.target.value })}
                                  placeholder="Optional notes"
                                  value={assignment.notes ?? ""}
                                />
                              </label>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <p className="project-setup-empty-copy">No crew assigned to this unit yet.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {activeTab === "units" ? (
            <div className="project-setup-panel">
              <div className="project-setup-toolbar">
                <div className="project-setup-toolbar-copy">
                  <strong>Additional units</strong>
                  <span>Create units from presets or start a custom one.</span>
                </div>

                <div className="project-setup-toolbar-actions">
                  <label className="action-field project-setup-unit-preset-field">
                    <span className="action-field-label">Add unit</span>
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
                      <option value="">Choose preset</option>
                      {additionalUnitPresetOptions.map((preset) => (
                        <option key={preset} value={preset}>
                          {preset}
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
                            <strong>{unit.name || `Additional Unit ${index + 1}`}</strong>
                            <span>
                              {formatUnitWindowSummary(unit, draft.generalInfo.startDate, draft.generalInfo.endDate)} · {getUnitDepartmentNames(unit, catalog.departments).join(", ") || "No departments"} · {getUnitAssetIds(unit).length} assets · {countAssignedCrewForUnit(unit)} crew
                            </span>
                          </div>

                          <div className="project-setup-unit-header-aside">
                            {conflictBadgeCount ? <StatusBadge tone="warning">{`${conflictBadgeCount} conflicts`}</StatusBadge> : null}
                            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </div>
                        </button>

                        {expanded ? (
                          <div className="project-setup-section-stack">
                            <div className="project-setup-grid project-setup-grid-compact">
                              <label className="action-field">
                                <span className="action-field-label">Unit name</span>
                                <input
                                  className="action-field-control"
                                  onChange={(event) => updateAdditionalUnit(unit.id!, { name: event.target.value })}
                                  value={unit.name}
                                />
                              </label>

                              <label className="action-field">
                                <span className="action-field-label">Code</span>
                                <input
                                  className="action-field-control"
                                  onChange={(event) => updateAdditionalUnit(unit.id!, { code: event.target.value })}
                                  value={unit.code ?? ""}
                                />
                              </label>

                              <label className="action-field">
                                <span className="action-field-label">Color</span>
                                <SelectField onChange={(event) => updateAdditionalUnit(unit.id!, { colorKey: event.target.value as ProjectColorKey | "" })} value={unit.colorKey ?? ""}>
                                  <option value="">Derived from project</option>
                                  {projectColorPalette.map((color) => (
                                    <option key={color.key} value={color.key}>
                                      {color.label}
                                    </option>
                                  ))}
                                </SelectField>
                              </label>

                              <label className="action-field action-field-wide">
                                <span className="action-field-label">Notes</span>
                                <textarea
                                  className="action-field-control action-textarea"
                                  onChange={(event) => updateAdditionalUnit(unit.id!, { notes: event.target.value })}
                                  rows={3}
                                  value={unit.notes ?? ""}
                                />
                              </label>

                              <div className="action-field action-field-wide">
                                <span className="action-field-label">Departments</span>
                                <div className="project-setup-checkbox-grid">
                                  {draft.generalInfo.departmentIds.length ? (
                                    catalog.departments
                                      .filter((department) => draft.generalInfo.departmentIds.includes(department.id))
                                      .map((department) => {
                                        const checked = unit.departmentIds.includes(department.id);
                                        return (
                                          <label key={department.id} className="project-setup-toggle">
                                            <input
                                              checked={checked}
                                              onChange={(event) =>
                                                updateAssignmentUnitDepartmentIds(
                                                  unit.id!,
                                                  event.target.checked
                                                    ? [...unit.departmentIds, department.id]
                                                    : unit.departmentIds.filter((departmentId) => departmentId !== department.id),
                                                )
                                              }
                                              type="checkbox"
                                            />
                                            <span>{department.name}</span>
                                          </label>
                                        );
                                      })
                                  ) : (
                                    <span className="project-setup-field-note">Select project departments in General Info first.</span>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="project-setup-inline-card project-setup-inline-card-nested">
                              <div className="project-setup-card-heading">
                                <div>
                                  <h3>Windows</h3>
                                  <p>Add one or many active windows for this unit.</p>
                                </div>
                                <button className="ghost-control" onClick={() => addAdditionalUnitWindow(unit.id!)} type="button">
                                  <Plus size={14} />
                                  <span>Add date window</span>
                                </button>
                              </div>

                              <div className="project-setup-section-stack">
                                {getUnitWindows(unit).map((window, windowIndex) => (
                                  <div key={`${unit.id}-window-${windowIndex}`} className="project-setup-window-row">
                                    <label className="action-field">
                                      <span className="action-field-label">Start</span>
                                      <input
                                        className="action-field-control"
                                        onChange={(event) => updateAdditionalUnitWindow(unit.id!, windowIndex, { startDate: event.target.value })}
                                        type="date"
                                        value={window.startDate ?? ""}
                                      />
                                    </label>

                                    <label className="action-field">
                                      <span className="action-field-label">End</span>
                                      <input
                                        className="action-field-control"
                                        onChange={(event) => updateAdditionalUnitWindow(unit.id!, windowIndex, { endDate: event.target.value })}
                                        type="date"
                                        value={window.endDate ?? ""}
                                      />
                                    </label>

                                    <button
                                      aria-label={`Remove window ${windowIndex + 1} from ${unit.name || `Additional Unit ${index + 1}`}`}
                                      className="icon-danger-control"
                                      data-tooltip={`Remove window ${windowIndex + 1}`}
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
                                aria-label={`Remove ${unit.name || `Additional Unit ${index + 1}`}`}
                                className="icon-danger-control"
                                data-tooltip={`Remove ${unit.name || `Additional Unit ${index + 1}`}`}
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
                    <p>No additional units configured yet.</p>
                    <span>Add one only if this project needs simultaneous units beyond the main unit.</span>
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {activeTab === "summary" ? (
            <div className="project-setup-panel">
              <div className="project-setup-summary-grid">
                <div className="project-setup-summary-card">
                  <h3>General info</h3>
                  <p>{draft.generalInfo.code || "Code auto-generated"} · {draft.generalInfo.name || "No project name"}</p>
                  <span>{draft.generalInfo.startDate || draft.generalInfo.endDate ? `${draft.generalInfo.startDate ?? "Open"} - ${draft.generalInfo.endDate ?? "Open"}` : "No project window selected"}</span>
                </div>

                <div className="project-setup-summary-card">
                  <h3>Resources</h3>
                  <p>
                    {getUnitAssetIds(draft.mainUnit).length + draft.additionalUnits.reduce((count, unit) => count + getUnitAssetIds(unit).length, 0)} assets ·{" "}
                    {countAssignedCrewForUnit(draft.mainUnit) +
                      draft.additionalUnits.reduce(
                        (count, unit) => count + countAssignedCrewForUnit(unit),
                        0,
                      )}{" "}
                    crew
                  </p>
                  <span>{draft.additionalUnits.length} additional units · {draft.generalInfo.departmentIds.length} project departments</span>
                </div>

                <div className="project-setup-summary-card">
                  <h3>Packing seed</h3>
                  <p>
                    {[
                      ...draft.mainUnit.unitDepartments,
                      ...draft.additionalUnits.flatMap((unit) => unit.unitDepartments),
                    ].filter((bucket) => bucket.packingSeed?.mode && bucket.packingSeed.mode !== "none").length} configured buckets
                  </p>
                  <span>Packing is optional and can be completed later.</span>
                </div>
              </div>

              <div className="project-setup-section-stack">
                <div className="project-setup-inline-card">
                  <div className="project-setup-card-heading">
                    <div>
                      <h3>Main Unit</h3>
                      <p>Primary project window and operational base.</p>
                    </div>
                  </div>

                  <div className="project-setup-summary-row">
                    <strong>Main Unit</strong>
                    <span>{draft.generalInfo.startDate || draft.generalInfo.endDate ? `${draft.generalInfo.startDate || "Open"} - ${draft.generalInfo.endDate || "Open"}` : "No dates selected"}</span>
                    <span>{getUnitDepartmentNames(draft.mainUnit, catalog.departments).join(", ") || "No departments"} · {getUnitAssetIds(draft.mainUnit).length} assets · {countAssignedCrewForUnit(draft.mainUnit)} crew</span>
                  </div>
                </div>

                <div className="project-setup-inline-card">
                  <div className="project-setup-card-heading">
                    <div>
                      <h3>Additional units</h3>
                      <p>{draft.additionalUnits.length ? "Compact review before creation." : "No extra units in this setup."}</p>
                    </div>
                  </div>

                  {draft.additionalUnits.length ? (
                    <div className="project-setup-summary-list">
                      {draft.additionalUnits.map((unit, index) => (
                        <div key={unit.id ?? `${unit.name}-${index}`} className="project-setup-summary-row">
                          <strong>{unit.name}</strong>
                          <span>{formatUnitWindowSummary(unit, draft.generalInfo.startDate, draft.generalInfo.endDate)}</span>
                          <span>{getUnitDepartmentNames(unit, catalog.departments).join(", ") || "No departments"} · {getUnitAssetIds(unit).length} assets · {countAssignedCrewForUnit(unit)} crew</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="project-setup-empty-copy">No additional units configured.</p>
                  )}
                </div>

                <div className="project-setup-inline-card">
                  <div className="project-setup-card-heading">
                    <div>
                      <h3>Conflict review</h3>
                      <p>{conflicts?.hasConflicts ? "Resolve every conflict before creating the project." : "No blocking conflicts detected."}</p>
                    </div>

                    {isCheckingConflicts ? <StatusBadge tone="info">Checking...</StatusBadge> : null}
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
                    <p className="project-setup-empty-copy">No asset or crew overlaps are blocking this setup right now.</p>
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
        {stagingError ? <div className="action-feedback action-feedback-error project-setup-feedback">{stagingError}</div> : null}
        {submitError ? <div className="action-feedback action-feedback-error project-setup-feedback">{submitError}</div> : null}
        {submitFeedback ? <div className="action-feedback action-feedback-success project-setup-feedback">{submitFeedback}</div> : null}

        <footer className="project-setup-footer">
          {activeTab === "summary" ? (
            <button className="ghost-control" onClick={() => void handleExportPdf()} type="button">
              <FileDown size={14} />
              <span>Export PDF</span>
            </button>
          ) : (
            <div />
          )}
          <button className="action-primary-button" disabled={isSubmitting || !canSubmit} onClick={() => void handleSubmit()} type="button">
            {isSubmitting ? "Creating..." : "Create project"}
          </button>
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
                <strong>Keep this draft?</strong>
                <p>This setup has unsaved work. You can keep the draft for later, discard it now, or continue editing.</p>
              </div>
            </div>

            <div className="project-setup-close-dialog-actions">
              <button
                className="ghost-control"
                onClick={() => {
                  setCloseConfirmOpen(false);
                  onClose();
                }}
                type="button"
              >
                Keep draft for later
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
                Discard draft
              </button>
              <button className="action-primary-button" onClick={() => setCloseConfirmOpen(false)} type="button">
                Continue editing
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
