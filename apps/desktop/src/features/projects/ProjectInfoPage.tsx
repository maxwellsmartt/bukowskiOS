import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import type { ProjectColorKey, ProjectDetailSnapshot } from "@contracts";
import { useNotifications } from "@app/providers/NotificationsProvider";
import { useToast } from "@app/providers/ToastProvider";
import { ConfirmDialog } from "@shared/components/ConfirmDialog";
import { SelectField } from "@shared/components/SelectField";
import { ProjectColorSelect } from "@shared/components/ProjectColorSelect";
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

const isValidDateWindow = (start: string, end: string) => !start || !end || start <= end;

export const ProjectInfoPage = () => {
  const { t } = useTranslation();
  const { project, projectId } = useProjectMode();
  const [searchParams] = useSearchParams();
  const toast = useToast();
  const { createNotification } = useNotifications();
  const { data, error, isLoading, reload } = useProjectDetail(projectId);
  const { data: catalog } = useCatalogData();
  const { refreshProjects, updateProject } = useShellContext();
  const [visibleData, setVisibleData] = useState<ProjectDetailSnapshot | null>(null);

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
  const [dateChangeConfirmOpen, setDateChangeConfirmOpen] = useState(false);
  const focusedUnitId = searchParams.get("unit");

  useEffect(() => {
    if (!data.project) {
      return;
    }

    setVisibleData(data);
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

  const validationErrors = useMemo(() => {
    const errors: string[] = [];

    if (!name.trim()) {
      errors.push(t("projects.info.validation.nameRequired"));
    }

    if (!status.trim()) {
      errors.push(t("projects.info.validation.statusRequired"));
    }

    if (!isValidDateWindow(startDate, endDate)) {
      errors.push(t("projects.info.validation.projectEndAfterStart"));
    }

    if (hasPreproduction) {
      if (!preproductionStartDate || !preproductionEndDate) {
        errors.push(t("projects.info.validation.preproductionDatesRequired"));
      }

      if (!isValidDateWindow(preproductionStartDate, preproductionEndDate)) {
        errors.push(t("projects.info.validation.preproductionEndAfterStart"));
      }

      if (startDate && preproductionEndDate && preproductionEndDate > startDate) {
        errors.push(t("projects.info.validation.preproductionBeforeMain"));
      }
    }

    return errors;
  }, [endDate, hasPreproduction, name, preproductionEndDate, preproductionStartDate, startDate, status, t]);

  const displayData = visibleData?.project?.id === projectId ? visibleData : data;

  if (error && !displayData.project) {
    return <div className="empty-state">{t("projects.info.unavailable", { message: error })}</div>;
  }

  if (isLoading && !displayData.project) {
    return <div className="empty-state">{t("projects.info.loading")}</div>;
  }

  if (!displayData.project) {
    return <div className="empty-state">{t("projects.info.empty")}</div>;
  }

  const currentProject = displayData.project;
  const activeUnits = displayData.timelineSummary?.activeUnits ?? 0;
  const plannedUnits = displayData.timelineSummary?.plannedUnits ?? 0;
  const wrappedUnits = displayData.timelineSummary?.wrappedUnits ?? 0;
  const cancelledUnits = displayData.timelineSummary?.cancelledUnits ?? 0;
  const totalScheduledUnits = activeUnits + plannedUnits + wrappedUnits + cancelledUnits;
  const wrappedRatio = totalScheduledUnits ? Math.round((wrappedUnits / totalScheduledUnits) * 100) : 0;
  const scheduleWindow = displayData.schedule?.windowLabel ?? t("projects.fallbacks.unscheduled");
  const scheduleStart = displayData.schedule?.startDate ?? t("projects.info.schedule.noStartDate");
  const scheduleEnd = displayData.schedule?.endDate ?? t("projects.info.schedule.openEnded");
  const scheduleStats = [
    { label: t("projects.info.schedule.activeUnits"), value: activeUnits },
    { label: t("projects.info.schedule.plannedUnits"), value: plannedUnits },
    { label: t("projects.info.schedule.wrappedUnits"), value: wrappedUnits },
    { label: t("projects.info.schedule.cancelledUnits"), value: cancelledUnits },
  ];

  const persistProject = async (cascadeDates: boolean) => {
    if (validationErrors.length) {
      setSaveError(t("projects.info.validation.fixBeforeSaving"));
      return;
    }

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
        cascadeDates,
      });
      await Promise.all([reload(), refreshProjects()]);
      setSaveError(null);
      toast.success(t("projects.info.toasts.savedTitle"), t("projects.info.toasts.savedBody"));
      await createNotification({
        kind: "project",
        title: t("projects.info.notifications.updatedTitle", { defaultValue: "Proyecto actualizado" }),
        body: t("projects.info.notifications.updatedBody", {
          defaultValue: "{{name}} recibió cambios de información, fechas o estado.",
          name,
        }),
        linkTo: `/projects/${currentProject.id}/info`,
        sourceType: "project",
        sourceRef: { projectId: currentProject.id, action: "updated" },
        notifyNow: true,
      });
    } catch (nextError) {
      setSaveError(getUserFacingErrorMessage(nextError, t("projects.info.toasts.updateFailed")));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSave = async () => {
    if (validationErrors.length) {
      setSaveError(t("projects.info.validation.fixBeforeSaving"));
      return;
    }
    const datesChanged = startDate !== (currentProject.startDate ?? "") || endDate !== (currentProject.endDate ?? "");
    if (datesChanged && displayData.units.length) {
      setDateChangeConfirmOpen(true);
      return;
    }
    await persistProject(false);
  };

  return (
    <div className="page-stack page-stack-project">
      <SectionHeader title={t("projects.info.title")} />

      <div className="project-workspace-scroll">
        {saveError ? <div className="action-feedback action-feedback-error">{saveError}</div> : null}
        {validationErrors.length ? (
          <div className="action-feedback action-feedback-warning">
            <strong>{t("projects.info.validation.title")}</strong>
            <ul className="action-feedback-list">
              {validationErrors.map((validationError) => (
                <li key={validationError}>{validationError}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="project-info-layout">
          <div className="project-info-layout-column project-info-layout-column-details">
            <SurfaceCard
              className="project-scroll-card project-info-card"
              title={t("projects.info.cardTitle")}
              aside={<StatusBadge>{t(`projects.statuses.${currentProject.status}`, { defaultValue: currentProject.status })}</StatusBadge>}
            >
              <div className="project-info-summary" aria-label={t("projects.info.schedule.title")}>
                <div className="project-info-summary-window">
                  <span>{t("projects.info.schedule.window")}</span>
                  <strong>{scheduleWindow}</strong>
                  <small>
                    {scheduleStart} - {scheduleEnd}
                  </small>
                </div>

                {currentProject.hasPreproduction ? (
                  <div className="project-info-summary-window project-info-summary-preproduction">
                    <span>{t("projects.info.schedule.preproduction")}</span>
                    <strong>
                      {currentProject.preproductionStartDate ?? t("projects.info.schedule.noStartDate")} → {currentProject.preproductionEndDate ?? t("projects.info.schedule.openEnded")}
                    </strong>
                    <small>
                      {currentProject.preproductionStartDate ?? t("projects.info.schedule.noStartDate")} - {currentProject.preproductionEndDate ?? t("projects.info.schedule.openEnded")}
                    </small>
                  </div>
                ) : null}

                <div className="project-info-summary-progress">
                  <div className="project-info-summary-progress-copy">
                    <span>{t("projects.info.schedule.completion")}</span>
                    <strong>
                      {totalScheduledUnits
                        ? t("projects.info.schedule.completionValue", { wrapped: wrappedUnits, total: totalScheduledUnits })
                        : t("projects.info.schedule.noUnits")}
                    </strong>
                  </div>
                  <div className="project-info-summary-progress-track" aria-hidden="true">
                    <span style={{ width: `${wrappedRatio}%` }} />
                  </div>
                </div>

                <div className="project-info-summary-stats">
                  {scheduleStats.map((stat) => (
                    <div key={stat.label}>
                      <span>{stat.label}</span>
                      <strong>{stat.value}</strong>
                    </div>
                  ))}
                </div>
              </div>

              <div className="action-form-grid">
                <label className="action-field">
                  <span className="action-field-label">{t("projects.info.fields.code")}</span>
                  <input className="action-field-control" onChange={(event) => setCode(event.target.value.toUpperCase())} value={code} />
                </label>

                <label className="action-field">
                  <span className="action-field-label">{t("projects.info.fields.name")}</span>
                  <input className="action-field-control" onChange={(event) => setName(event.target.value)} value={name} />
                </label>

                <label className="action-field">
                  <span className="action-field-label">{t("projects.info.fields.status")}</span>
                  <SelectField onChange={(event) => setStatus(event.target.value)} value={status}>
                    {projectStatusOptions.map((option) => (
                      <option key={option} value={option}>
                        {t(`projects.statuses.${option}`, { defaultValue: option })}
                      </option>
                    ))}
                  </SelectField>
                </label>

                <label className="action-field">
                  <span className="action-field-label">{t("projects.info.fields.client")}</span>
                  <SelectField onChange={(event) => setClientId(event.target.value)} value={clientId}>
                    <option value="">{t("projects.info.fields.noClient")}</option>
                    {catalog.clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </SelectField>
                </label>

                <label className="action-field">
                  <span className="action-field-label">{t("projects.info.fields.productionCompany")}</span>
                  <SelectField onChange={(event) => setProductionCompanyId(event.target.value)} value={productionCompanyId}>
                    <option value="">{t("projects.info.fields.noProductionCompany")}</option>
                    {catalog.productionCompanies.map((company) => (
                      <option key={company.id} value={company.id}>
                        {company.name}
                      </option>
                    ))}
                  </SelectField>
                </label>

                <label className="action-field">
                  <span className="action-field-label">{t("projects.info.fields.timelineColor")}</span>
                  <ProjectColorSelect
                    onChange={(nextColorKey) => setColorKey(nextColorKey)}
                    placeholder={t("projects.info.fields.defaultSystemTone")}
                    value={colorKey as ProjectColorKey | ""}
                  />
                </label>

                <div className="action-field-pair">
                  <label className="action-field">
                    <span className="action-field-label">{t("projects.info.fields.startDate")}</span>
                    <input
                      className="action-field-control"
                      onChange={(event) => setStartDate(event.target.value)}
                      type="date"
                      value={startDate}
                    />
                  </label>

                  <label className="action-field">
                    <span className="action-field-label">{t("projects.info.fields.endDate")}</span>
                    <input
                      className="action-field-control"
                      min={startDate || undefined}
                      onChange={(event) => setEndDate(event.target.value)}
                      type="date"
                      value={endDate}
                    />
                  </label>
                </div>

                <div className="project-info-section-divider" role="separator" />

                <label className="project-setup-toggle">
                  <input checked={hasPreproduction} onChange={(event) => setHasPreproduction(event.target.checked)} type="checkbox" />
                  <span>{t("projects.info.fields.hasPreproduction")}</span>
                </label>

                {hasPreproduction ? (
                  <div className="action-field-pair">
                    <label className="action-field">
                      <span className="action-field-label">{t("projects.info.fields.preproductionStart")}</span>
                      <input
                        className="action-field-control"
                        onChange={(event) => setPreproductionStartDate(event.target.value)}
                        type="date"
                        value={preproductionStartDate}
                      />
                    </label>

                    <label className="action-field">
                      <span className="action-field-label">{t("projects.info.fields.preproductionEnd")}</span>
                      <input
                        className="action-field-control"
                        min={preproductionStartDate || undefined}
                        onChange={(event) => setPreproductionEndDate(event.target.value)}
                        type="date"
                        value={preproductionEndDate}
                      />
                    </label>
                  </div>
                ) : null}

                <label className="action-field action-field-wide">
                  <span className="action-field-label">{t("projects.info.fields.description")}</span>
                  <textarea
                    className="action-field-control action-textarea"
                    onChange={(event) => setDescription(event.target.value)}
                    rows={4}
                    value={description}
                  />
                </label>
              </div>

              <div className="action-panel-actions">
                <button className="action-primary-button" disabled={isSubmitting || validationErrors.length > 0} onClick={() => void handleSave()} type="button">
                  {isSubmitting ? t("common.saving") : t("projects.info.saveChanges")}
                </button>
              </div>
            </SurfaceCard>
          </div>

          <div className="project-info-layout-column project-info-layout-column-units">
            <ProjectUnitsManager
              crewMembers={catalog.crewMembers}
              departments={catalog.departments}
              focusedUnitId={focusedUnitId}
              onChanged={(snapshot) => {
                setVisibleData(snapshot);
                void refreshProjects();
              }}
              projectId={currentProject.id}
              units={displayData.units}
            />
          </div>
        </div>
      </div>
      <ConfirmDialog
        isOpen={dateChangeConfirmOpen}
        title={t("projects.info.dateCascade.title")}
        body={t("projects.info.dateCascade.body")}
        details={t("projects.info.dateCascade.details")}
        confirmLabel={t("projects.info.dateCascade.confirm")}
        cancelLabel={t("common.cancel")}
        isSubmitting={isSubmitting}
        onConfirm={async () => {
          setDateChangeConfirmOpen(false);
          await persistProject(true);
        }}
        onCancel={() => setDateChangeConfirmOpen(false)}
      />
    </div>
  );
};
