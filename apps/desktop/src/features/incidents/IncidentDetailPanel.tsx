import { X } from "lucide-react";
import { useEffect, useState } from "react";

import type { CatalogSnapshot, IncidentDetailSnapshot } from "@contracts";
import { useToast } from "@app/providers/ToastProvider";
import { SelectField } from "@shared/components/SelectField";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";
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
const statusOptions = ["Open", "In review", "Resolved"] as const;

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

const fileDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "2-digit",
  year: "numeric",
});

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
  const toast = useToast();
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
      <SurfaceCard title="Incident Details">
        <div className="empty-state">No incident selected.</div>
      </SurfaceCard>
    );
  }

  return (
    <SurfaceCard
      aside={
        <button aria-label="Close incident detail" className="surface-card-action" onClick={onClose} type="button">
          <X size={14} />
        </button>
      }
      title={incident.title}
    >
      <div className="page-stack">
        <div className="entity-detail-status-row">
          <StatusBadge tone={resolveStatusTone(incident.status)}>{incident.status}</StatusBadge>
          <StatusBadge tone={incident.severity === "High" ? "critical" : incident.severity === "Medium" ? "warning" : "neutral"}>
            {incident.severity}
          </StatusBadge>
        </div>

        {incident.assetId ? (
          <div className="incident-repair-handoff">
            <div className="incident-repair-handoff-copy">
              <strong>{repairCase ? "Repair case linked" : "Repair follow-up"}</strong>
              <span>
                {repairCase
                  ? `${repairCase.title} · ${repairCase.status}`
                  : "Create a repair case from this incident and remove the asset from availability while it is reviewed."}
              </span>
            </div>
            {repairCase && onOpenRepairCase ? (
              <button className="ghost-control" onClick={() => onOpenRepairCase?.(repairCase.id)} type="button">
                Open repair case
              </button>
            ) : incident.status !== "Resolved" && onCreateRepairCase ? (
              <button className="ghost-control" onClick={onCreateRepairCase} type="button">
                Create repair case
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="summary-grid compact-summary-grid">
          <div className="summary-row">
            <span className="summary-label">Asset</span>
            <span className="summary-value">{incident.asset}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Project</span>
            <span className="summary-value">{incident.project}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Department</span>
            <span className="summary-value">{incident.department}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Reported</span>
            <span className="summary-value">{incident.reportedAt}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Resolved</span>
            <span className="summary-value">{incident.resolvedAt ?? "Still open"}</span>
          </div>
        </div>

        <div className="action-form-grid">
          <label className="action-field action-field-wide">
            <span className="action-field-label">Title</span>
            <input className="action-field-control" onChange={(event) => setTitle(event.target.value)} value={title} />
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

          <label className="action-field">
            <span className="action-field-label">Severity</span>
            <SelectField onChange={(event) => setSeverity(event.target.value)} value={severity}>
              {severityOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </SelectField>
          </label>

          <label className="action-field">
            <span className="action-field-label">Status</span>
            <SelectField onChange={(event) => setStatus(event.target.value)} value={status}>
              {statusOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </SelectField>
          </label>

          <label className="action-field">
            <span className="action-field-label">Responsible</span>
            <SelectField onChange={(event) => setResponsibleUserId(event.target.value)} value={responsibleUserId}>
              <option value="">Unassigned</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.fullName}
                </option>
              ))}
            </SelectField>
          </label>

          <label className="action-field action-field-wide">
            <span className="action-field-label">Resolution notes</span>
            <textarea
              className="action-field-control action-textarea"
              onChange={(event) => setResolutionNotes(event.target.value)}
              placeholder="What was fixed, who handled it, and what follow-up remains?"
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
                <strong>No repair possible</strong>
                <span>Keep the asset in history, but remove it from assignment and packing availability.</span>
              </span>
            </label>
          ) : null}
        </div>

        <details className="detail-disclosure">
          <summary className="detail-disclosure-summary">More details</summary>
          <div className="detail-disclosure-content">
            <div className="action-form-grid">
              <label className="action-field">
                <span className="action-field-label">Cost estimate</span>
                <input
                  className="action-field-control"
                  inputMode="decimal"
                  onChange={(event) => setCostEstimate(event.target.value)}
                  placeholder="Optional"
                  value={costEstimate}
                />
              </label>

              <label className="action-field">
                <span className="action-field-label">Financial status</span>
                <input
                  className="action-field-control"
                  onChange={(event) => setFinancialStatus(event.target.value)}
                  placeholder="Optional"
                  value={financialStatus}
                />
              </label>

              <label className="action-field action-field-wide">
                <span className="action-field-label">Notes</span>
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
          title="Files"
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
                    toast.success("Files attached", result.summary);
                    await onRefresh();
                  } catch (nextError) {
                    setFilesError(getUserFacingErrorMessage(nextError, "Unable to attach files to this incident."));
                  } finally {
                    setIsUploadingFiles(false);
                  }
                })();
              }}
              type="button"
            >
              {isUploadingFiles ? "Uploading..." : "Attach files"}
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
                      <StatusBadge tone={resolveFileTone(file.status)}>{file.status}</StatusBadge>
                    </div>
                    <div className="entity-file-meta">
                      <span>{file.fileType}</span>
                      <span>{formatByteSize(file.byteSize)}</span>
                      <span>{fileDateFormatter.format(new Date(file.createdAt))}</span>
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
                            setFilesError(getUserFacingErrorMessage(nextError, "Unable to open that incident file."));
                            await onRefresh();
                          } finally {
                            setOpeningFileId(null);
                          }
                        })();
                      }}
                      type="button"
                    >
                      {openingFileId === file.id ? "Opening..." : "Open"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">No files attached.</div>
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
            {isSubmitting ? "Saving..." : "Update incident"}
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
            {isSubmitting ? "Applying..." : status === "Resolved" ? "Already resolved" : "Resolve incident"}
          </button>
        </div>
      </div>
    </SurfaceCard>
  );
};
