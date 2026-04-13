import { AlertTriangle, ChevronDown, ChevronRight, FileDown, PackagePlus, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import type {
  CatalogAssetOptionRow,
  CatalogCrewRow,
  CatalogSnapshot,
  CreateProjectBlueprintInput,
  ProjectCreationConflictsSnapshot,
  ProjectColorKey,
  ProjectBlueprintCrewDraftInput,
  ProjectBlueprintPackingSelection,
  ProjectBlueprintUnitDraftInput,
  StagingPackingSlipRow,
} from "@contracts";
import { projectColorPalette } from "@contracts";
import { useCatalogData, exportProjectBlueprintPdf, getProjectCreationConflicts, getStagingPackingSlips } from "@features/projects/useProjectsData";
import { SelectField } from "@shared/components/SelectField";
import { StatusBadge } from "@shared/components/StatusBadge";
import { useShellContext } from "@shared/hooks/useShellContext";

const projectStatusOptions = ["Prep", "Active", "Wrapped", "On hold"] as const;
const additionalUnitPresets = ["Second Unit", "Third Unit", "Splinter Unit", "Insert Unit"] as const;

type WizardTab = "general" | "assets" | "crew" | "units" | "summary";

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
  };
  mainUnit: ProjectBlueprintUnitDraftInput;
  additionalUnits: ProjectBlueprintUnitDraftInput[];
  packingSelection: ProjectBlueprintPackingSelection;
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
  },
  mainUnit: {
    name: "Main Unit",
    suggestedPreset: "Main Unit",
    colorKey: "",
    startDate: "",
    endDate: "",
    notes: "",
    assetIds: [],
    crewAssignments: [],
  },
  additionalUnits: [],
  packingSelection: {
    mode: "none",
  },
});

const normalizeOptional = (value?: string | null) => {
  const nextValue = value?.trim() ?? "";
  return nextValue ? nextValue : undefined;
};

const normalizeDraftForSubmit = (draft: ProjectSetupDraft): CreateProjectBlueprintInput => ({
  generalInfo: {
    code: draft.generalInfo.code.trim(),
    name: draft.generalInfo.name.trim(),
    clientId: normalizeOptional(draft.generalInfo.clientId),
    productionCompanyId: normalizeOptional(draft.generalInfo.productionCompanyId),
    startDate: normalizeOptional(draft.generalInfo.startDate),
    endDate: normalizeOptional(draft.generalInfo.endDate),
    hasPreproduction: draft.generalInfo.hasPreproduction,
    preproductionStartDate: normalizeOptional(draft.generalInfo.preproductionStartDate),
    preproductionEndDate: normalizeOptional(draft.generalInfo.preproductionEndDate),
    status: normalizeOptional(draft.generalInfo.status),
    colorKey: normalizeOptional(draft.generalInfo.colorKey),
    description: normalizeOptional(draft.generalInfo.description),
  },
  mainUnit: {
    name: "Main Unit",
    suggestedPreset: "Main Unit",
    colorKey: normalizeOptional(draft.generalInfo.colorKey),
    startDate: normalizeOptional(draft.generalInfo.startDate),
    endDate: normalizeOptional(draft.generalInfo.endDate),
    notes: normalizeOptional(draft.mainUnit.notes),
    assetIds: [...new Set(draft.mainUnit.assetIds)],
    crewAssignments: draft.mainUnit.crewAssignments
      .filter((assignment) => assignment.crewMemberId.trim())
      .map((assignment) => ({
        crewMemberId: assignment.crewMemberId,
        roleLabel: normalizeOptional(assignment.roleLabel),
        startDate: normalizeOptional(assignment.startDate),
        endDate: normalizeOptional(assignment.endDate),
        notes: normalizeOptional(assignment.notes),
      })),
  },
  additionalUnits: draft.additionalUnits.map((unit, index) => ({
    id: normalizeOptional(unit.id),
    code: normalizeOptional(unit.code),
    name: unit.name.trim(),
    suggestedPreset: normalizeOptional(unit.suggestedPreset),
    sortOrder: unit.sortOrder ?? index + 1,
    colorKey: normalizeOptional(unit.colorKey),
    startDate: normalizeOptional(unit.startDate),
    endDate: normalizeOptional(unit.endDate),
    notes: normalizeOptional(unit.notes),
    assetIds: [...new Set(unit.assetIds)],
    crewAssignments: unit.crewAssignments
      .filter((assignment) => assignment.crewMemberId.trim())
      .map((assignment) => ({
        crewMemberId: assignment.crewMemberId,
        roleLabel: normalizeOptional(assignment.roleLabel),
        startDate: normalizeOptional(assignment.startDate),
        endDate: normalizeOptional(assignment.endDate),
        notes: normalizeOptional(assignment.notes),
      })),
  })),
  packingSelection:
    draft.packingSelection.mode === "existing"
      ? {
          mode: "existing",
          packingSlipId: draft.packingSelection.packingSlipId,
        }
      : draft.packingSelection.mode === "draft"
        ? {
            mode: "draft",
            label: normalizeOptional(draft.packingSelection.label),
            departmentId: normalizeOptional(draft.packingSelection.departmentId),
            responsibleUserId: normalizeOptional(draft.packingSelection.responsibleUserId),
            notes: normalizeOptional(draft.packingSelection.notes),
          }
        : { mode: "none" },
});

const isProjectSetupDraftDirty = (draft: ProjectSetupDraft) => JSON.stringify(normalizeDraftForSubmit(draft)) !== JSON.stringify(normalizeDraftForSubmit(createEmptyDraft()));

const buildNewAdditionalUnit = (preset = "Second Unit", index = 0): ProjectBlueprintUnitDraftInput => ({
  name: preset,
  suggestedPreset: preset,
  code: "",
  sortOrder: index + 1,
  colorKey: "",
  startDate: "",
  endDate: "",
  notes: "",
  assetIds: [],
  crewAssignments: [],
});

const unitConflictCount = (
  unit: ProjectBlueprintUnitDraftInput,
  conflictSnapshot: ProjectCreationConflictsSnapshot | null,
  draft: ProjectSetupDraft,
) => {
  if (!conflictSnapshot) {
    return 0;
  }

  const relevantAssets = new Set(unit.assetIds);
  const relevantCrew = new Set(unit.crewAssignments.map((assignment) => assignment.crewMemberId).filter(Boolean));

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

  if (!draft.generalInfo.code.trim()) {
    errors.push("Project code is required.");
  }

  if (!draft.generalInfo.name.trim()) {
    errors.push("Project name is required.");
  }

  if (!isValidDateWindow(draft.generalInfo.startDate, draft.generalInfo.endDate)) {
    errors.push("Project end date must be on or after the start date.");
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

    if (!isValidDateWindow(unit.startDate ?? "", unit.endDate ?? "")) {
      errors.push(`Additional unit ${index + 1} has an invalid date window.`);
    }
  });

  return errors;
};

const resolvePackingSourceLabel = (draft: ProjectSetupDraft, stagingSlips: StagingPackingSlipRow[]) => {
  const selection = draft.packingSelection;

  if (selection.mode === "existing") {
    const slip = stagingSlips.find((row) => row.id === selection.packingSlipId);
    return slip ? `${slip.number} · ${slip.itemCount} items` : "Selected staging slip";
  }

  if (selection.mode === "draft") {
    return "Draft staging slip";
  }

  return "No packing source";
};

const updateDraftPackingSelection = (
  draft: ProjectSetupDraft,
  patch:
    | { mode: "none" }
    | { mode: "existing"; packingSlipId: string }
    | { mode: "draft"; label?: string; departmentId?: string; responsibleUserId?: string; notes?: string },
): ProjectSetupDraft["packingSelection"] => {
  if (patch.mode === "none") {
    return { mode: "none" };
  }

  if (patch.mode === "existing") {
    return {
      mode: "existing",
      packingSlipId: patch.packingSlipId,
    };
  }

  return {
    mode: "draft",
    label: patch.label ?? "",
    departmentId: patch.departmentId ?? "",
    responsibleUserId: patch.responsibleUserId ?? "",
    notes: patch.notes ?? "",
  };
};

const WizardChecklist = ({
  rows,
  selectedIds,
  onToggle,
}: {
  rows: Array<{ id: string; title: string; subtitle: string }>;
  selectedIds: string[];
  onToggle: (id: string) => void;
}) => (
  <div className="project-setup-checklist">
    {rows.map((row) => {
      const selected = selectedIds.includes(row.id);

      return (
        <button
          key={row.id}
          className={`project-setup-checklist-row${selected ? " is-selected" : ""}`}
          onClick={() => onToggle(row.id)}
          type="button"
        >
          <span className={`project-setup-checklist-toggle${selected ? " is-selected" : ""}`} />
          <span className="project-setup-checklist-copy">
            <strong>{row.title}</strong>
            <span>{row.subtitle}</span>
          </span>
        </button>
      );
    })}
  </div>
);

const CrewAssignmentsEditor = ({
  assignments,
  crewMembers,
  onChange,
}: {
  assignments: ProjectBlueprintCrewDraftInput[];
  crewMembers: CatalogCrewRow[];
  onChange: (assignments: ProjectBlueprintCrewDraftInput[]) => void;
}) => {
  const updateAssignment = (index: number, patch: Partial<ProjectBlueprintCrewDraftInput>) => {
    onChange(assignments.map((assignment, currentIndex) => (currentIndex === index ? { ...assignment, ...patch } : assignment)));
  };

  const removeAssignment = (index: number) => {
    onChange(assignments.filter((_, currentIndex) => currentIndex !== index));
  };

  return (
    <div className="project-setup-section-stack">
      {assignments.map((assignment, index) => (
        <div key={`${assignment.crewMemberId}-${index}`} className="project-setup-inline-card">
          <div className="project-setup-grid project-setup-grid-compact">
            <label className="action-field">
              <span className="action-field-label">Crew</span>
              <SelectField onChange={(event) => updateAssignment(index, { crewMemberId: event.target.value })} value={assignment.crewMemberId}>
                <option value="">Choose crew member</option>
                {crewMembers.map((crewMember) => (
                  <option key={crewMember.id} value={crewMember.id}>
                    {crewMember.fullName}
                  </option>
                ))}
              </SelectField>
            </label>

            <label className="action-field">
              <span className="action-field-label">Role</span>
              <input
                className="action-field-control"
                onChange={(event) => updateAssignment(index, { roleLabel: event.target.value })}
                placeholder="Optional role"
                value={assignment.roleLabel ?? ""}
              />
            </label>

            <label className="action-field">
              <span className="action-field-label">Start</span>
              <input
                className="action-field-control"
                onChange={(event) => updateAssignment(index, { startDate: event.target.value })}
                type="date"
                value={assignment.startDate ?? ""}
              />
            </label>

            <label className="action-field">
              <span className="action-field-label">End</span>
              <input
                className="action-field-control"
                onChange={(event) => updateAssignment(index, { endDate: event.target.value })}
                type="date"
                value={assignment.endDate ?? ""}
              />
            </label>
          </div>

          <div className="project-setup-card-actions">
            <button className="ghost-control" onClick={() => removeAssignment(index)} type="button">
              Remove
            </button>
          </div>
        </div>
      ))}

      <button className="ghost-control" onClick={() => onChange([...assignments, emptyCrewAssignment()])} type="button">
        <Plus size={14} />
        <span>Add crew</span>
      </button>
    </div>
  );
};

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
    if (!open || draft.packingSelection.mode !== "existing") {
      return;
    }

    if (!window.bukowskiPacking) {
      setSubmitError("Packing bridge unavailable.");
      return;
    }

    void window.bukowskiPacking
      .getDetail(draft.packingSelection.packingSlipId)
      .then((detail) => {
        onChangeDraft({
          ...draft,
          mainUnit: {
            ...draft.mainUnit,
            assetIds: detail.items.map((item) => item.assetId),
          },
        });
      })
      .catch((error: unknown) => {
        setSubmitError(error instanceof Error ? error.message : "Unable to load the selected staging slip.");
      });
  }, [draft.packingSelection, onChangeDraft, open]);

  useEffect(() => {
    if (!open || !draft.generalInfo.code.trim() || !draft.generalInfo.name.trim()) {
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

  if (!open) {
    return null;
  }

  const setGeneralInfo = <K extends keyof ProjectSetupDraft["generalInfo"]>(key: K, value: ProjectSetupDraft["generalInfo"][K]) => {
    onChangeDraft({
      ...draft,
      generalInfo: {
        ...draft.generalInfo,
        [key]: value,
      },
      mainUnit:
        key === "startDate" || key === "endDate"
          ? {
              ...draft.mainUnit,
              startDate: key === "startDate" ? String(value) : draft.mainUnit.startDate,
              endDate: key === "endDate" ? String(value) : draft.mainUnit.endDate,
            }
          : key === "colorKey"
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

  const toggleMainUnitAsset = (assetId: string) => {
    const nextAssetIds = draft.mainUnit.assetIds.includes(assetId)
      ? draft.mainUnit.assetIds.filter((currentId) => currentId !== assetId)
      : [...draft.mainUnit.assetIds, assetId];

    updateMainUnit({ assetIds: nextAssetIds });
  };

  const addAdditionalUnit = (preset?: string) => {
    const unit = buildNewAdditionalUnit(preset ?? additionalUnitPresets[0], draft.additionalUnits.length);
    const nextId = `draft-unit-${Date.now().toString(36)}-${draft.additionalUnits.length}`;
    onChangeDraft({
      ...draft,
      additionalUnits: [...draft.additionalUnits, { ...unit, id: nextId }],
    });
    setExpandedUnitIds((current) => [...current, nextId]);
    onChangeTab("units");
  };

  const updateAdditionalUnit = (unitId: string, patch: Partial<ProjectBlueprintUnitDraftInput>) => {
    onChangeDraft({
      ...draft,
      additionalUnits: draft.additionalUnits.map((unit) => (unit.id === unitId ? { ...unit, ...patch } : unit)),
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
  const packingSourceLabel = resolvePackingSourceLabel(draft, stagingSlips);
  const conflictCount = conflicts?.groups.reduce((count, group) => count + group.items.length, 0) ?? 0;

  const tabItems: Array<{ id: WizardTab; label: string }> = [
    { id: "general", label: "General Info" },
    { id: "assets", label: "Assets" },
    { id: "crew", label: "Crew" },
    { id: "units", label: "Additional Units" },
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
            <button aria-label="Close project setup" className="surface-card-action" onClick={handleRequestClose} type="button">
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
                  <input className="action-field-control" onChange={(event) => setGeneralInfo("code", event.target.value)} value={draft.generalInfo.code} />
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
                <div className="project-setup-inline-card">
                  <div className="project-setup-radio-row">
                    <button
                      className={`project-setup-radio${draft.packingSelection.mode === "none" ? " active" : ""}`}
                      onClick={() => onChangeDraft({ ...draft, packingSelection: updateDraftPackingSelection(draft, { mode: "none" }) })}
                      type="button"
                    >
                      No packing source
                    </button>
                    <button
                      className={`project-setup-radio${draft.packingSelection.mode === "existing" ? " active" : ""}`}
                      onClick={() =>
                        onChangeDraft({
                          ...draft,
                          packingSelection: updateDraftPackingSelection(draft, {
                            mode: "existing",
                            packingSlipId: stagingSlips[0]?.id ?? "",
                          }),
                        })
                      }
                      type="button"
                    >
                      Use staging slip
                    </button>
                    <button
                      className={`project-setup-radio${draft.packingSelection.mode === "draft" ? " active" : ""}`}
                      onClick={() =>
                        onChangeDraft({
                          ...draft,
                          packingSelection: updateDraftPackingSelection(draft, {
                            mode: "draft",
                            label: "",
                            departmentId: "",
                            responsibleUserId: "",
                            notes: "",
                          }),
                        })
                      }
                      type="button"
                    >
                      Draft new staging slip
                    </button>
                  </div>

                  {draft.packingSelection.mode === "existing" ? (
                    <label className="action-field">
                      <span className="action-field-label">Staging slip</span>
                      <SelectField
                        disabled={isLoadingStaging}
                        onChange={(event) =>
                          onChangeDraft({
                            ...draft,
                            packingSelection: updateDraftPackingSelection(draft, {
                              mode: "existing",
                              packingSlipId: event.target.value,
                            }),
                          })
                        }
                        value={draft.packingSelection.packingSlipId}
                      >
                        <option value="">{isLoadingStaging ? "Loading staging slips..." : "Choose staging slip"}</option>
                        {stagingSlips.map((slip) => (
                          <option key={slip.id} value={slip.id}>
                            {slip.number} · {slip.itemCount} items
                          </option>
                        ))}
                      </SelectField>
                    </label>
                  ) : null}

                  {draft.packingSelection.mode === "draft" ? (
                    <div className="project-setup-grid project-setup-grid-compact">
                      <label className="action-field">
                        <span className="action-field-label">Slip label</span>
                        <input
                          className="action-field-control"
                          onChange={(event) =>
                            onChangeDraft({
                              ...draft,
                              packingSelection: updateDraftPackingSelection(draft, {
                                mode: "draft",
                                label: event.target.value,
                                departmentId: draft.packingSelection.mode === "draft" ? draft.packingSelection.departmentId : "",
                                responsibleUserId: draft.packingSelection.mode === "draft" ? draft.packingSelection.responsibleUserId : "",
                                notes: draft.packingSelection.mode === "draft" ? draft.packingSelection.notes : "",
                              }),
                            })
                          }
                          value={draft.packingSelection.label ?? ""}
                        />
                      </label>

                      <label className="action-field">
                        <span className="action-field-label">Department</span>
                        <SelectField
                          onChange={(event) =>
                            onChangeDraft({
                              ...draft,
                              packingSelection: updateDraftPackingSelection(draft, {
                                mode: "draft",
                                label: draft.packingSelection.mode === "draft" ? draft.packingSelection.label : "",
                                departmentId: event.target.value,
                                responsibleUserId: draft.packingSelection.mode === "draft" ? draft.packingSelection.responsibleUserId : "",
                                notes: draft.packingSelection.mode === "draft" ? draft.packingSelection.notes : "",
                              }),
                            })
                          }
                          value={draft.packingSelection.departmentId ?? ""}
                        >
                          <option value="">No department</option>
                          {catalog.departments.map((department) => (
                            <option key={department.id} value={department.id}>
                              {department.code} · {department.name}
                            </option>
                          ))}
                        </SelectField>
                      </label>

                      <label className="action-field">
                        <span className="action-field-label">Responsible</span>
                        <SelectField
                          onChange={(event) =>
                            onChangeDraft({
                              ...draft,
                              packingSelection: updateDraftPackingSelection(draft, {
                                mode: "draft",
                                label: draft.packingSelection.mode === "draft" ? draft.packingSelection.label : "",
                                departmentId: draft.packingSelection.mode === "draft" ? draft.packingSelection.departmentId : "",
                                responsibleUserId: event.target.value,
                                notes: draft.packingSelection.mode === "draft" ? draft.packingSelection.notes : "",
                              }),
                            })
                          }
                          value={draft.packingSelection.responsibleUserId ?? ""}
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
                            onChangeDraft({
                              ...draft,
                              packingSelection: updateDraftPackingSelection(draft, {
                                mode: "draft",
                                label: draft.packingSelection.mode === "draft" ? draft.packingSelection.label : "",
                                departmentId: draft.packingSelection.mode === "draft" ? draft.packingSelection.departmentId : "",
                                responsibleUserId: draft.packingSelection.mode === "draft" ? draft.packingSelection.responsibleUserId : "",
                                notes: event.target.value,
                              }),
                            })
                          }
                          rows={3}
                          value={draft.packingSelection.notes ?? ""}
                        />
                      </label>
                    </div>
                  ) : null}
                </div>

                <div className="project-setup-two-column">
                  <div className="project-setup-inline-card">
                    <div className="project-setup-card-heading">
                      <div>
                        <h3>Main Unit assets</h3>
                        <p>{draft.mainUnit.assetIds.length} selected</p>
                      </div>
                    </div>

                    <WizardChecklist
                      rows={catalog.assetOptions.map((asset) => ({
                        id: asset.id,
                        title: `${asset.code} · ${asset.name}`,
                        subtitle: `${asset.category} · ${asset.status}`,
                      }))}
                      selectedIds={draft.mainUnit.assetIds}
                      onToggle={toggleMainUnitAsset}
                    />
                  </div>

                  <div className="project-setup-inline-card">
                    <div className="project-setup-card-heading">
                      <div>
                        <h3>Selected assets</h3>
                        <p>{packingSourceLabel}</p>
                      </div>
                    </div>
                    <div className="project-setup-pill-list">
                      {draft.mainUnit.assetIds.length ? (
                        draft.mainUnit.assetIds.map((assetId) => {
                          const asset = catalog.assetOptions.find((row) => row.id === assetId);
                          return (
                            <button key={assetId} className="project-setup-pill" onClick={() => toggleMainUnitAsset(assetId)} type="button">
                              {asset ? `${asset.code} · ${asset.name}` : assetId}
                            </button>
                          );
                        })
                      ) : (
                        <p className="project-setup-empty-copy">Choose assets for the main unit or load them from a staging slip.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {activeTab === "crew" ? (
            <div className="project-setup-panel">
              <div className="project-setup-inline-card">
                <div className="project-setup-card-heading">
                  <div>
                    <h3>Main Unit crew</h3>
                    <p>{draft.mainUnit.crewAssignments.filter((assignment) => assignment.crewMemberId.trim()).length} linked</p>
                  </div>
                </div>

                <CrewAssignmentsEditor
                  assignments={draft.mainUnit.crewAssignments}
                  crewMembers={catalog.crewMembers}
                  onChange={(crewAssignments) => updateMainUnit({ crewAssignments })}
                />
              </div>
            </div>
          ) : null}

          {activeTab === "units" ? (
            <div className="project-setup-panel">
              <div className="project-setup-toolbar">
                <div className="project-setup-preset-row">
                  {additionalUnitPresets.map((preset) => (
                    <button key={preset} className="ghost-control" onClick={() => addAdditionalUnit(preset)} type="button">
                      <PackagePlus size={14} />
                      <span>{preset}</span>
                    </button>
                  ))}
                </div>

                <button className="action-primary-button" onClick={() => addAdditionalUnit()} type="button">
                  <Plus size={14} />
                  <span>Add unit</span>
                </button>
              </div>

              <div className="project-setup-section-stack">
                {draft.additionalUnits.length ? (
                  draft.additionalUnits.map((unit, index) => {
                    const expanded = unit.id ? expandedUnitIds.includes(unit.id) : true;
                    const conflictBadgeCount = unitConflictCount(unit, conflicts, draft);

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
                              {(unit.startDate || unit.endDate) ? `${unit.startDate ?? "Open"} - ${unit.endDate ?? "Open"}` : "No dates selected"} · {unit.assetIds.length} assets · {unit.crewAssignments.filter((assignment) => assignment.crewMemberId.trim()).length} crew
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
                                <span className="action-field-label">Start</span>
                                <input
                                  className="action-field-control"
                                  onChange={(event) => updateAdditionalUnit(unit.id!, { startDate: event.target.value })}
                                  type="date"
                                  value={unit.startDate ?? ""}
                                />
                              </label>

                              <label className="action-field">
                                <span className="action-field-label">End</span>
                                <input
                                  className="action-field-control"
                                  onChange={(event) => updateAdditionalUnit(unit.id!, { endDate: event.target.value })}
                                  type="date"
                                  value={unit.endDate ?? ""}
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
                            </div>

                            <div className="project-setup-two-column">
                              <div className="project-setup-inline-card is-nested">
                                <div className="project-setup-card-heading">
                                  <div>
                                    <h3>Assets</h3>
                                    <p>{unit.assetIds.length} selected</p>
                                  </div>
                                </div>
                                <WizardChecklist
                                  rows={catalog.assetOptions.map((asset) => ({
                                    id: asset.id,
                                    title: `${asset.code} · ${asset.name}`,
                                    subtitle: `${asset.category} · ${asset.status}`,
                                  }))}
                                  selectedIds={unit.assetIds}
                                  onToggle={(assetId) =>
                                    updateAdditionalUnit(unit.id!, {
                                      assetIds: unit.assetIds.includes(assetId)
                                        ? unit.assetIds.filter((currentId) => currentId !== assetId)
                                        : [...unit.assetIds, assetId],
                                    })
                                  }
                                />
                              </div>

                              <div className="project-setup-inline-card is-nested">
                                <div className="project-setup-card-heading">
                                  <div>
                                    <h3>Crew</h3>
                                    <p>{unit.crewAssignments.filter((assignment) => assignment.crewMemberId.trim()).length} linked</p>
                                  </div>
                                </div>
                                <CrewAssignmentsEditor
                                  assignments={unit.crewAssignments}
                                  crewMembers={catalog.crewMembers}
                                  onChange={(crewAssignments) => updateAdditionalUnit(unit.id!, { crewAssignments })}
                                />
                              </div>
                            </div>

                            <div className="project-setup-card-actions">
                              <button className="ghost-control" onClick={() => removeAdditionalUnit(unit.id!)} type="button">
                                Remove unit
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
                  <p>{draft.generalInfo.code || "No code"} · {draft.generalInfo.name || "No project name"}</p>
                  <span>{draft.generalInfo.startDate || draft.generalInfo.endDate ? `${draft.generalInfo.startDate ?? "Open"} - ${draft.generalInfo.endDate ?? "Open"}` : "No project window selected"}</span>
                </div>

                <div className="project-setup-summary-card">
                  <h3>Resources</h3>
                  <p>{draft.mainUnit.assetIds.length} assets · {draft.mainUnit.crewAssignments.filter((assignment) => assignment.crewMemberId.trim()).length} crew</p>
                  <span>{draft.additionalUnits.length} additional units</span>
                </div>

                <div className="project-setup-summary-card">
                  <h3>Packing source</h3>
                  <p>{packingSourceLabel}</p>
                  <span>{draft.packingSelection.mode === "none" ? "Assets will save directly into the project blueprint." : "Packing will resolve on final submit."}</span>
                </div>
              </div>

              <div className="project-setup-section-stack">
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
                          <span>{(unit.startDate || unit.endDate) ? `${unit.startDate ?? "Open"} - ${unit.endDate ?? "Open"}` : "No dates selected"}</span>
                          <span>{unit.assetIds.length} assets · {unit.crewAssignments.filter((assignment) => assignment.crewMemberId.trim()).length} crew</span>
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
                                <span>{item.conflictingProject}{item.conflictingUnit ? ` / ${item.conflictingUnit}` : ""}</span>
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
          <div className="action-feedback action-feedback-error">
            {validationErrors[0]}
          </div>
        ) : null}
        {stagingError ? <div className="action-feedback action-feedback-error">{stagingError}</div> : null}
        {submitError ? <div className="action-feedback action-feedback-error">{submitError}</div> : null}
        {submitFeedback ? <div className="action-feedback action-feedback-success">{submitFeedback}</div> : null}

        <footer className="project-setup-footer">
          <button className="ghost-control" onClick={handleRequestClose} type="button">
            Close
          </button>
          <button className="ghost-control" onClick={() => void handleExportPdf()} type="button">
            <FileDown size={14} />
            <span>Export PDF</span>
          </button>
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
