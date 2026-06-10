import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { CatalogSnapshot, IncidentDetailSnapshot } from "@contracts";
import { useToast } from "@app/providers/ToastProvider";
import { SelectField } from "@shared/components/SelectField";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
import { useLocale } from "@shared/hooks/useLocale";
import { getUserFacingErrorMessage } from "@shared/lib/errors";
import { openIncidentFile, uploadIncidentFiles } from "./useIncidentsData";

type IncidentDetailPanelProps = {
  detail: IncidentDetailSnapshot;
  error: string | null;
  isSubmitting: boolean;
  repairCase?: { id: string; title: string; status: string } | null;
  users: CatalogSnapshot["users"];
  onClose: () => void;
  onCreateRepairCase?: () => void;
  onOpenRepairCase?: (repairCaseId: string) => void;
  onRefresh: () => void | Promise<void>;
  onResolve: (value: {
    resolutionNotes?: string;
    costEstimate?: number;
    financialStatus?: string;
    resolvedByUserId?: string;
    retireAsset?: boolean;
  }) => Promise<void>;
  onUpdate: (value: {
    title: string;
    description: string;
    severity: string;
    status: string;
    responsibleUserId?: string | null;
    costEstimate?: number | null;
    financialStatus?: string | null;
    notes?: string | null;
  }) => Promise<void>;
};

const severityOptions = ["Low", "Medium", "High"] as const;
// "Resolved" is intentionally NOT offered here: resolving must go through the
// Resolve button so resolution notes, financial closure and asset retirement
// run together. It is only rendered when the incident is already resolved, so
// the select stays valid and the incident can be explicitly reopened.
const editableStatusOptions = ["Open", "In review"] as const;

const normalizeOptionalText = (value: string) => {
  const nextValue = value.trim();
  return nextValue ? nextValue : null;
};

const resolveStatusTone = (status: string) => {
  if (status === "Resolved") {
    return "success" as const;
  }

  if (status === "In review") {
    return "info" as const;
  }

  return "warning" as const;
};

const FILE_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "2-digit",
  year: "numeric",
};

const formatByteSize = (byteSize: number) => {
  if (!byteSize) {
    return "0 B";
  }

  if (byteSize < 1024) {
    return `${byteSize} B`;
  }

  if (byteSize < 1024 * 1024) {
    return `${(byteSize / 1024).toFixed(1)} KB`;
  }

  return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`;
};

const resolveFileTone = (status: "available" | "missing" | "deleted") => {
  if (status === "available") {
    return "success" as const;
  }

  if (status === "missing") {
    return "warning" as const;
  }

  return "critical" as const;
};

export const IncidentDetailPanel = ({
  detail,
  error,
  isSubmitting,
  repairCase,
  users,
  onClose,
  onCreateRepairCase,
  onOpenRepairCase,
  onRefresh,
  onResolve,
  onUpdate,
}: IncidentDetailPanelProps) => {
  const { t } = useTranslation();
  const toast = useToast();
  const { formatDate } = useLocale();
  const incident = detail.incident;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState("Medium");
  const [status, setStatus] = useState("Open");
  const [responsibleUserId, setResponsibleUserId] = useState("");
  const [costEstimate, setCostEstimate] = useState("");
  const [financialStatus, setFinancialStatus] = useState("");
  const [notes, setNotes] = useState("");
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [retireAsset, setRetireAsset] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);
  const [openingFileId, setOpeningFileId] = useState<string | null>(null);

  useEffect(() => {
    if (!incident) {
      return;
    }

    setTitle(incident.title);
    setDescription(incident.description);
    setSeverity(incident.severity);
    setStatus(incident.status);
    setResponsibleUserId(incident.responsibleUserId ?? "");
    setCostEstimate(incident.costEstimateValue !== null ? String(incident.costEstimateValue) : "");
    setFinancialStatus(incident.financialStatus === "Estimate missing" ? "" : incident.financialStatus);
    setNotes(incident.notes ?? "");
    setResolutionNotes("");
    setRetireAsset(false);
  }, [incident]);

  if (!incident) {
    return (
      <SurfaceCard className="incident-detail-card detail-rail-card" title={t("incidents.detail.emptyTitle")}>
        <div className="empty-state">{t("incidents.detail.emptyBody")}</div>
      </SurfaceCard>
    );
  }

  return (
    <SurfaceCard
      className="incident-detail-card detail-rail-card"
      subtitle={[incident.asset, incident.project].filter((value) => value && value !== "—").join(" · ") || undefined}
      aside={
        <div className="detail-header-actions detail-header-actions-stacked">
          <button aria-label={t("incidents.detail.close")} className="icon-ghost-control" onClick={onClose} type="button">
            <X size={14} />
          </button>
          <div className="detail-header-chips">
            <StatusBadge tone={resolveStatusTone(incident.status)}>
              {t(`incidents.statuses.${incident.status}`, { defaultValue: incident.status })}
            </StatusBadge>
            <StatusBadge tone={incident.severity === "High" ? "critical" : incident.severity === "Medium" ? "warning" : "neutral"}>
              {t(`incidents.severity.${incident.severity}`, { defaultValue: incident.severity })}
            </StatusBadge>
          </div>
        </div>
      }
      title={incident.title}
    >
      <div className="page-stack">
        {incident.assetId ? (
          <div className="incident-repair-handoff">
            <div className="incident-repair-handoff-copy">
              <strong>{repairCase ? t("incidents.detail.repairLinked") : t("incidents.detail.repairFollowUp")}</strong>
              <span>
                {repairCase
                  ? `${repairCase.title} · ${t(`rma.statuses.${repairCase.status}`, { defaultValue: repairCase.status })}`
                  : t("incidents.detail.repairFollowUpBody")}
              </span>
            </div>
            {repairCase && onOpenRepairCase ? (
              <button className="ghost-control" onClick={() => onOpenRepairCase?.(repairCase.id)} type="button">
                {t("incidents.detail.openRepairCase")}
              </button>
            ) : incident.status !== "Resolved" && onCreateRepairCase ? (
              <button className="ghost-control" onClick={onCreateRepairCase} type="button">
                {t("incidents.detail.createRepairCase")}
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="detail-hero-grid detail-operations-grid">
          <div className="summary-row">
            <span className="summary-label">{t("incidents.detail.asset")}</span>
            <span className="summary-value">{incident.asset}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">{t("incidents.detail.project")}</span>
            <span className="summary-value">{incident.project}</span>
            <span className="summary-meta">{incident.department}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">{t("incidents.detail.reported")}</span>
            <span className="summary-value">{incident.reportedAt}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">{t("incidents.detail.resolved")}</span>
            <span className="summary-value">{incident.resolvedAt ?? t("incidents.detail.stillOpen")}</span>
          </div>
        </div>

        <div className="action-form-grid">
          <label className="action-field action-field-wide">
            <span className="action-field-label">{t("incidents.detail.title")}</span>
            <input className="action-field-control" onChange={(event) => setTitle(event.target.value)} value={title} />
          </label>

          <label className="action-field action-field-wide">
            <span className="action-field-label">{t("incidents.detail.description")}</span>
            <textarea
              className="action-field-control action-textarea"
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
              value={description}
            />
          </label>

          <label className="action-field">
            <span className="action-field-label">{t("incidents.detail.severity")}</span>
            <SelectField onChange={(event) => setSeverity(event.target.value)} value={severity}>
              {severityOptions.map((option) => (
                <option key={option} value={option}>
                  {t(`incidents.severity.${option}`, { defaultValue: option })}
                </option>
              ))}
            </SelectField>
          </label>

          <label className="action-field">
            <span className="action-field-label">{t("incidents.detail.status")}</span>
            <SelectField onChange={(event) => setStatus(event.target.value)} value={status}>
              {[...editableStatusOptions, ...(incident.status === "Resolved" ? (["Resolved"] as const) : [])].map((option) => (
                <option key={option} value={option}>
                  {t(`incidents.statuses.${option}`, { defaultValue: option })}
                </option>
              ))}
            </SelectField>
          </label>

          <label className="action-field">
            <span className="action-field-label">{t("incidents.detail.responsible")}</span>
            <SelectField onChange={(event) => setResponsibleUserId(event.target.value)} value={responsibleUserId}>
              <option value="">{t("incidents.detail.unassigned")}</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.fullName}
                </option>
              ))}
            </SelectField>
          </label>

          <label className="action-field action-field-wide">
            <span className="action-field-label">{t("incidents.detail.resolutionNotes")}</span>
            <textarea
              className="action-field-control action-textarea"
              onChange={(event) => setResolutionNotes(event.target.value)}
              placeholder={t("incidents.detail.resolutionPlaceholder")}
              rows={3}
              value={resolutionNotes}
            />
          </label>

          {incident.assetId && incident.status !== "Resolved" ? (
            <label className="incident-retire-option">
              <input
                checked={retireAsset}
                className="table-checkbox"
                onChange={(event) => setRetireAsset(event.target.checked)}
                type="checkbox"
              />
              <span className="incident-retire-option-copy">
                <strong>{t("incidents.detail.noRepairPossible")}</strong>
                <span>{t("incidents.detail.noRepairBody")}</span>
              </span>
            </label>
          ) : null}
        </div>

        <details className="detail-disclosure">
          <summary className="detail-disclosure-summary">{t("incidents.detail.moreDetails")}</summary>
          <div className="detail-disclosure-content">
            <div className="action-form-grid">
              <label className="action-field">
                  <span className="action-field-label">{t("incidents.detail.costEstimate")}</span>
                <input
                  className="action-field-control"
                  inputMode="decimal"
                  onChange={(event) => setCostEstimate(event.target.value)}
                  placeholder={t("common.optional")}
                  value={costEstimate}
                />
              </label>

              <label className="action-field">
                  <span className="action-field-label">{t("incidents.detail.financialStatus")}</span>
                <input
                  className="action-field-control"
                  onChange={(event) => setFinancialStatus(event.target.value)}
                  placeholder={t("common.optional")}
                  value={financialStatus}
                />
              </label>

              <label className="action-field action-field-wide">
                  <span className="action-field-label">{t("incidents.detail.notes")}</span>
                <textarea
                  className="action-field-control action-textarea"
                  onChange={(event) => setNotes(event.target.value)}
                  rows={3}
                  value={notes}
                />
              </label>
            </div>
          </div>
        </details>

        <SurfaceCard
          title={t("incidents.files.title")}
          aside={
            <button
              className="surface-card-action-text"
              disabled={isUploadingFiles}
              onClick={() => {
                setFilesError(null);
                void (async () => {
                  try {
                    setIsUploadingFiles(true);
                    const result = await uploadIncidentFiles(incident.id);
                    toast.success(t("incidents.files.attached"), result.summary);
                    await onRefresh();
                  } catch (nextError) {
                    setFilesError(getUserFacingErrorMessage(nextError, t("incidents.files.attachFailed")));
                  } finally {
                    setIsUploadingFiles(false);
                  }
                })();
              }}
              type="button"
            >
              {isUploadingFiles ? t("incidents.files.uploading") : t("incidents.files.attach")}
            </button>
          }
        >
          {detail.files.length ? (
            <div className="entity-file-list entity-detail-compact-list">
              {detail.files.map((file) => (
                <div key={file.id} className="entity-file-row">
                  <div className="entity-file-main">
                    <div className="entity-file-head">
                      <span className="entity-file-name">{file.originalName}</span>
                      <StatusBadge tone={resolveFileTone(file.status)}>
                        {t(`incidents.files.statuses.${file.status}`, { defaultValue: file.status })}
                      </StatusBadge>
                    </div>
                    <div className="entity-file-meta">
                      <span>{file.fileType}</span>
                      <span>{formatByteSize(file.byteSize)}</span>
                      <span>{formatDate(file.createdAt, FILE_DATE_FORMAT)}</span>
                    </div>
                  </div>
                  <div className="entity-file-actions">
                    <button
                      className="ghost-control"
                      disabled={file.status !== "available" || openingFileId === file.id}
                      onClick={() => {
                        setFilesError(null);
                        void (async () => {
                          try {
                            setOpeningFileId(file.id);
                            await openIncidentFile(file.id);
                          } catch (nextError) {
                            setFilesError(getUserFacingErrorMessage(nextError, t("incidents.files.openFailed")));
                            await onRefresh();
                          } finally {
                            setOpeningFileId(null);
                          }
                        })();
                      }}
                      type="button"
                    >
                      {openingFileId === file.id ? t("incidents.files.opening") : t("incidents.files.open")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">{t("incidents.files.empty")}</div>
          )}
        </SurfaceCard>

        {filesError ? <div className="action-feedback action-feedback-error">{filesError}</div> : null}

        {error ? <div className="action-feedback action-feedback-error">{error}</div> : null}

        <div className="action-panel-actions">
          <button
            className="ghost-control"
            disabled={isSubmitting}
            onClick={() =>
              void onUpdate({
                title,
                description,
                severity,
                status,
                responsibleUserId: normalizeOptionalText(responsibleUserId),
                costEstimate: normalizeOptionalText(costEstimate) ? Number(costEstimate) : null,
                financialStatus: normalizeOptionalText(financialStatus),
                notes: normalizeOptionalText(notes),
              })
            }
            type="button"
          >
            {isSubmitting ? t("common.saving") : t("incidents.detail.update")}
          </button>
          <button
            className="action-primary-button"
            disabled={isSubmitting || status === "Resolved"}
            onClick={() =>
              void onResolve({
                resolutionNotes: normalizeOptionalText(resolutionNotes) ?? undefined,
                costEstimate: normalizeOptionalText(costEstimate) ? Number(costEstimate) : undefined,
                financialStatus: normalizeOptionalText(financialStatus) ?? undefined,
                resolvedByUserId: normalizeOptionalText(responsibleUserId) ?? undefined,
                retireAsset,
              })
            }
            type="button"
          >
            {isSubmitting
              ? t("incidents.detail.applying")
              : status === "Resolved"
                ? t("incidents.detail.alreadyResolved")
                : t("incidents.detail.resolve")}
          </button>
        </div>
      </div>
    </SurfaceCard>
  );
};
