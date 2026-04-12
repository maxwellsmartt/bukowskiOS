import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { projectColorPalette } from "@contracts";
import { SelectField } from "@shared/components/SelectField";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { useShellContext } from "@shared/hooks/useShellContext";

import { ProjectUnitsManager } from "./ProjectUnitsManager";
import { useProjectMode } from "./useProjectMode";
import { useCatalogData, useProjectDetail } from "./useProjectsData";

const projectStatusOptions = ["Prep", "Active", "Wrapped", "On hold"] as const;

const normalizeOptional = (value: string) => {
  const trimmedValue = value.trim();
  return trimmedValue ? trimmedValue : undefined;
};

export const ProjectInfoPage = () => {
  const { project, projectId } = useProjectMode();
  const [searchParams] = useSearchParams();
  const { data, error, isLoading, reload } = useProjectDetail(projectId);
  const { data: catalog } = useCatalogData();
  const { refreshProjects, updateProject } = useShellContext();

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState("Prep");
  const [clientId, setClientId] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [colorKey, setColorKey] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const focusedUnitId = searchParams.get("unit");

  useEffect(() => {
    if (!data.project) {
      return;
    }

    setCode(data.project.code);
    setName(data.project.name);
    setStatus(data.project.status);
    setClientId(data.project.clientId ?? "");
    setDescription(data.project.description);
    setStartDate(data.project.startDate ?? "");
    setEndDate(data.project.endDate ?? "");
    setColorKey(data.project.colorKey ?? "");
  }, [data.project]);

  if (error) {
    return <div className="empty-state">Project info unavailable: {error}</div>;
  }

  if (isLoading) {
    return <div className="empty-state">Loading project info...</div>;
  }

  if (!data.project) {
    return <div className="empty-state">Select a project to inspect its info, context and responsibles.</div>;
  }

  const currentProject = data.project;

  const handleSave = async () => {
    try {
      setIsSubmitting(true);
      await updateProject({
        projectId: currentProject.id,
        code,
        name,
        clientId: normalizeOptional(clientId),
        status,
        description,
        startDate: normalizeOptional(startDate),
        endDate: normalizeOptional(endDate),
        colorKey: normalizeOptional(colorKey),
      });
      await Promise.all([reload(), refreshProjects()]);
      setSaveError(null);
      setSaveFeedback("Project schedule and context updated.");
    } catch (nextError) {
      setSaveError(nextError instanceof Error ? nextError.message : "Unable to update project info.");
      setSaveFeedback(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="page-stack page-stack-project">
      <SectionHeader title="Info" />

      <div className="project-workspace-scroll">
        {saveFeedback ? <div className="action-feedback action-feedback-success">{saveFeedback}</div> : null}
        {saveError ? <div className="action-feedback action-feedback-error">{saveError}</div> : null}

        <div className="project-detail-support-grid">
          <SurfaceCard
            className="project-scroll-card"
            title="Project base"
            aside={<StatusBadge>{currentProject.status}</StatusBadge>}
          >
            <div className="action-form-grid">
              <label className="action-field">
                <span className="action-field-label">Code</span>
                <input className="action-field-control" onChange={(event) => setCode(event.target.value.toUpperCase())} value={code} />
              </label>

              <label className="action-field">
                <span className="action-field-label">Name</span>
                <input className="action-field-control" onChange={(event) => setName(event.target.value)} value={name} />
              </label>

              <label className="action-field">
                <span className="action-field-label">Status</span>
                <SelectField onChange={(event) => setStatus(event.target.value)} value={status}>
                  {projectStatusOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </SelectField>
              </label>

              <label className="action-field">
                <span className="action-field-label">Client</span>
                <SelectField onChange={(event) => setClientId(event.target.value)} value={clientId}>
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
                <input className="action-field-control" onChange={(event) => setStartDate(event.target.value)} type="date" value={startDate} />
              </label>

              <label className="action-field">
                <span className="action-field-label">End date</span>
                <input className="action-field-control" onChange={(event) => setEndDate(event.target.value)} type="date" value={endDate} />
              </label>

              <label className="action-field">
                <span className="action-field-label">Timeline color</span>
                <SelectField onChange={(event) => setColorKey(event.target.value)} value={colorKey}>
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
                  onChange={(event) => setDescription(event.target.value)}
                  rows={4}
                  value={description}
                />
              </label>
            </div>

            <div className="action-panel-actions">
              <button className="action-primary-button" disabled={isSubmitting} onClick={() => void handleSave()} type="button">
                {isSubmitting ? "Saving..." : "Save project info"}
              </button>
            </div>
          </SurfaceCard>

          <SurfaceCard
            className="project-scroll-card"
            title="Schedule summary"
          >
            <div className="summary-grid">
              <div className="summary-row">
                <span className="summary-label">Window</span>
                <span className="summary-value">{data.schedule?.windowLabel ?? "Unscheduled"}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Active units</span>
                <span className="summary-value">{data.timelineSummary?.activeUnits ?? 0}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Planned units</span>
                <span className="summary-value">{data.timelineSummary?.plannedUnits ?? 0}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Wrapped units</span>
                <span className="summary-value">{data.timelineSummary?.wrappedUnits ?? 0}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Cancelled units</span>
                <span className="summary-value">{data.timelineSummary?.cancelledUnits ?? 0}</span>
              </div>
            </div>

            <div className="chip-row">
              <StatusBadge tone="info">{data.schedule?.startDate ?? "No start date"}</StatusBadge>
              <StatusBadge tone="warning">{data.schedule?.endDate ?? "Open-ended"}</StatusBadge>
              <StatusBadge>{data.schedule?.colorKey ?? "Default color"}</StatusBadge>
            </div>
          </SurfaceCard>
        </div>

        <ProjectUnitsManager
          crewMembers={catalog.crewMembers}
          focusedUnitId={focusedUnitId}
          onChanged={async () => {
            await Promise.all([reload(), refreshProjects()]);
          }}
          projectId={currentProject.id}
          units={data.units}
        />
      </div>
    </div>
  );
};
