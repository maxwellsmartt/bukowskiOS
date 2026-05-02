import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { projectColorPalette } from "@contracts";
import { useToast } from "@app/providers/ToastProvider";
import { SelectField } from "@shared/components/SelectField";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { useShellContext } from "@shared/hooks/useShellContext";
import { getUserFacingErrorMessage } from "@shared/lib/errors";

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
  const toast = useToast();
  const { data, error, isLoading, reload } = useProjectDetail(projectId);
  const { data: catalog } = useCatalogData();
  const { refreshProjects, updateProject } = useShellContext();

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState("Prep");
  const [clientId, setClientId] = useState("");
  const [productionCompanyId, setProductionCompanyId] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [hasPreproduction, setHasPreproduction] = useState(false);
  const [preproductionStartDate, setPreproductionStartDate] = useState("");
  const [preproductionEndDate, setPreproductionEndDate] = useState("");
  const [colorKey, setColorKey] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
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
    setProductionCompanyId(data.project.productionCompanyId ?? "");
    setDescription(data.project.description);
    setStartDate(data.project.startDate ?? "");
    setEndDate(data.project.endDate ?? "");
    setHasPreproduction(data.project.hasPreproduction);
    setPreproductionStartDate(data.project.preproductionStartDate ?? "");
    setPreproductionEndDate(data.project.preproductionEndDate ?? "");
    setColorKey(data.project.colorKey ?? "");
  }, [data.project]);

  if (error) {
    return <div className="empty-state">Project details unavailable: {error}</div>;
  }

  if (isLoading) {
    return <div className="empty-state">Loading project details…</div>;
  }

  if (!data.project) {
    return <div className="empty-state">Select a project to review its details.</div>;
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
        productionCompanyId: normalizeOptional(productionCompanyId),
        status,
        description,
        startDate: normalizeOptional(startDate),
        endDate: normalizeOptional(endDate),
        hasPreproduction,
        preproductionStartDate: hasPreproduction ? normalizeOptional(preproductionStartDate) : undefined,
        preproductionEndDate: hasPreproduction ? normalizeOptional(preproductionEndDate) : undefined,
        colorKey: normalizeOptional(colorKey),
      });
      await Promise.all([reload(), refreshProjects()]);
      setSaveError(null);
      toast.success("Project saved", "Project details updated.");
    } catch (nextError) {
      setSaveError(getUserFacingErrorMessage(nextError, "Unable to update project details."));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="page-stack page-stack-project">
      <SectionHeader title="Details" />

      <div className="project-workspace-scroll">
        {saveError ? <div className="action-feedback action-feedback-error">{saveError}</div> : null}

        <div className="project-detail-support-grid">
          <SurfaceCard
            className="project-scroll-card"
            title="Project Details"
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
                <span className="action-field-label">Production company</span>
                <SelectField onChange={(event) => setProductionCompanyId(event.target.value)} value={productionCompanyId}>
                  <option value="">No production company linked</option>
                  {catalog.productionCompanies.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.name}
                    </option>
                  ))}
                </SelectField>
              </label>

              <div className="action-field-pair">
                <label className="action-field">
                  <span className="action-field-label">Start date</span>
                  <input
                    className="action-field-control"
                    onChange={(event) => setStartDate(event.target.value)}
                    type="date"
                    value={startDate}
                  />
                </label>

                <label className="action-field">
                  <span className="action-field-label">End date</span>
                  <input className="action-field-control" onChange={(event) => setEndDate(event.target.value)} type="date" value={endDate} />
                </label>
              </div>

              <label className="project-setup-toggle">
                <input checked={hasPreproduction} onChange={(event) => setHasPreproduction(event.target.checked)} type="checkbox" />
                <span>Includes pre-production window</span>
              </label>

              <div />

              {hasPreproduction ? (
                <div className="action-field-pair">
                  <label className="action-field">
                    <span className="action-field-label">Pre-production start</span>
                    <input
                      className="action-field-control"
                      onChange={(event) => setPreproductionStartDate(event.target.value)}
                      type="date"
                      value={preproductionStartDate}
                    />
                  </label>

                  <label className="action-field">
                    <span className="action-field-label">Pre-production end</span>
                    <input
                      className="action-field-control"
                      onChange={(event) => setPreproductionEndDate(event.target.value)}
                      type="date"
                      value={preproductionEndDate}
                    />
                  </label>
                </div>
              ) : null}

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
                {isSubmitting ? "Saving..." : "Save changes"}
              </button>
            </div>
          </SurfaceCard>

          <SurfaceCard className="project-scroll-card" title="Schedule">
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
              <div className="summary-row">
                <span className="summary-label">Start</span>
                <span className="summary-value">{data.schedule?.startDate ?? "No start date"}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">End</span>
                <span className="summary-value">{data.schedule?.endDate ?? "Open-ended"}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Timeline color</span>
                <span className="summary-value">{data.schedule?.colorKey ?? "Default"}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Production company</span>
                <span className="summary-value">{currentProject.productionCompany !== "—" ? currentProject.productionCompany : "Not linked"}</span>
              </div>
              {currentProject.hasPreproduction ? (
                <div className="summary-row">
                  <span className="summary-label">Pre-production</span>
                  <span className="summary-value">
                    {currentProject.preproductionStartDate ?? "Open"} - {currentProject.preproductionEndDate ?? "Open"}
                  </span>
                </div>
              ) : null}
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
