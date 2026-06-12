import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import type { ProjectColorKey } from "@contracts";
import { useNotifications } from "@app/providers/NotificationsProvider";
import { useToast } from "@app/providers/ToastProvider";
import { SelectField } from "@shared/components/SelectField";
import { ProjectColorSelect } from "@shared/components/ProjectColorSelect";
import { SectionHeader } from "@shared/components/SectionHeader";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { useShellContext } from "@shared/hooks/useShellContext";
import { getUserFacingErrorMessage } from "@shared/lib/errors";
import { resolveProjectColor } from "@shared/lib/projectColors";

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

  if (error) {
    return <div className="empty-state">{t("projects.info.unavailable", { message: error })}</div>;
  }

  if (isLoading) {
    return <div className="empty-state">{t("projects.info.loading")}</div>;
  }

  if (!data.project) {
    return <div className="empty-state">{t("projects.info.empty")}</div>;
  }

  const currentProject = data.project;
  const activeUnits = data.timelineSummary?.activeUnits ?? 0;
  const plannedUnits = data.timelineSummary?.plannedUnits ?? 0;
  const wrappedUnits = data.timelineSummary?.wrappedUnits ?? 0;
  const cancelledUnits = data.timelineSummary?.cancelledUnits ?? 0;
  const totalScheduledUnits = activeUnits + plannedUnits + wrappedUnits + cancelledUnits;
  const wrappedRatio = totalScheduledUnits ? Math.round((wrappedUnits / totalScheduledUnits) * 100) : 0;
  const scheduleWindow = data.schedule?.windowLabel ?? t("projects.fallbacks.unscheduled");
  const scheduleStart = data.schedule?.startDate ?? t("projects.info.schedule.noStartDate");
  const scheduleEnd = data.schedule?.endDate ?? t("projects.info.schedule.openEnded");
  const scheduleColor = resolveProjectColor(data.schedule?.colorKey);

  const handleSave = async () => {
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

        <div className="project-detail-support-grid">
          <SurfaceCard
            className="project-scroll-card"
            title={t("projects.info.cardTitle")}
            aside={<StatusBadge>{t(`projects.statuses.${currentProject.status}`, { defaultValue: currentProject.status })}</StatusBadge>}
          >
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
                  <input className="action-field-control" onChange={(event) => setEndDate(event.target.value)} type="date" value={endDate} />
                </label>
              </div>

              <label className="project-setup-toggle">
                <input checked={hasPreproduction} onChange={(event) => setHasPreproduction(event.target.checked)} type="checkbox" />
                <span>{t("projects.info.fields.hasPreproduction")}</span>
              </label>

              <div />

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
                      onChange={(event) => setPreproductionEndDate(event.target.value)}
                      type="date"
                      value={preproductionEndDate}
                    />
                  </label>
                </div>
              ) : null}

              <label className="action-field">
                <span className="action-field-label">{t("projects.info.fields.timelineColor")}</span>
                <ProjectColorSelect
                  onChange={(nextColorKey) => setColorKey(nextColorKey)}
                  placeholder={t("projects.info.fields.defaultSystemTone")}
                  value={colorKey as ProjectColorKey | ""}
                />
              </label>

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

          <SurfaceCard className="project-scroll-card project-agenda-card" title={t("projects.info.schedule.title")}>
            <div className="project-agenda-hero">
              <div className="project-agenda-window">
                <span>{t("projects.info.schedule.window")}</span>
                <strong>{scheduleWindow}</strong>
                <small>
                  {scheduleStart} - {scheduleEnd}
                </small>
              </div>
              <div className="project-agenda-color">
                <span aria-hidden="true" className="project-agenda-color-dot" style={{ background: scheduleColor }} />
                <span>{data.schedule?.colorKey ?? t("projects.fallbacks.default")}</span>
              </div>
            </div>

            <div className="project-agenda-progress">
              <div className="project-agenda-progress-copy">
                <span>{t("projects.info.schedule.completion")}</span>
                <strong>
                  {totalScheduledUnits
                    ? t("projects.info.schedule.completionValue", { wrapped: wrappedUnits, total: totalScheduledUnits })
                    : t("projects.info.schedule.noUnits")}
                </strong>
              </div>
              <div className="project-agenda-progress-track" aria-hidden="true">
                <span style={{ width: `${wrappedRatio}%` }} />
              </div>
            </div>

            <div className="project-agenda-stats">
              <div>
                <span>{t("projects.info.schedule.activeUnits")}</span>
                <strong>{activeUnits}</strong>
              </div>
              <div>
                <span>{t("projects.info.schedule.plannedUnits")}</span>
                <strong>{plannedUnits}</strong>
              </div>
              <div>
                <span>{t("projects.info.schedule.wrappedUnits")}</span>
                <strong>{wrappedUnits}</strong>
              </div>
              <div>
                <span>{t("projects.info.schedule.cancelledUnits")}</span>
                <strong>{cancelledUnits}</strong>
              </div>
            </div>

            <div className="project-agenda-meta">
              <span>
                {t("projects.info.schedule.productionCompany")}
                <strong>{currentProject.productionCompany !== "—" ? currentProject.productionCompany : t("projects.info.schedule.notLinked")}</strong>
              </span>
              {currentProject.hasPreproduction ? (
                <span>
                  {t("projects.info.schedule.preproduction")}
                  <strong>
                    {currentProject.preproductionStartDate ?? t("projects.fallbacks.open")} - {currentProject.preproductionEndDate ?? t("projects.fallbacks.open")}
                  </strong>
                </span>
              ) : null}
            </div>
          </SurfaceCard>
        </div>

        <ProjectUnitsManager
          crewMembers={catalog.crewMembers}
          departments={catalog.departments}
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
