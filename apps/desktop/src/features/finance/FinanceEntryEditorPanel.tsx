import { Save, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { AssetListRow, FinanceEntryRow, FinancialDocumentRow, IncidentListRow, ProjectCardRow } from "@contracts";
import { SelectField } from "@shared/components/SelectField";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";

export type FinanceEntryEditorDraft = {
  entryType: string;
  category: string;
  amount: number;
  currency: string;
  status: string;
  projectId?: string | null;
  assetId?: string | null;
  incidentId?: string | null;
  entryDate: string;
  description?: string | null;
  notes?: string | null;
};

type FinanceEntryEditorPanelProps = {
  assets: AssetListRow[];
  documents: FinancialDocumentRow[];
  incidents: IncidentListRow[];
  projects: ProjectCardRow[];
  error: string | null;
  feedback: string | null;
  initialValue?: FinanceEntryRow | null;
  isSubmitting: boolean;
  isUploadingDocuments: boolean;
  mode: "create" | "edit";
  onAttachDocuments: () => Promise<void>;
  onClose: () => void;
  onOpenDocument: (fileId: string) => Promise<void>;
  onSubmit: (value: FinanceEntryEditorDraft) => Promise<void>;
};

const entryTypeOptions = ["reserve", "exposure", "invoice", "incident_cost", "estimated_cost", "replacement_value"];
const statusOptions = ["Draft", "Linked", "Approved", "Booked", "Paid", "Cancelled"];

const normalizeOptional = (value: string) => {
  const nextValue = value.trim();
  return nextValue ? nextValue : null;
};

const resolveDefaultDate = () => new Date().toISOString().slice(0, 10);
const formatBytes = (value: number) => {
  if (!value) {
    return "0 B";
  }

  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${value} B`;
};

export const FinanceEntryEditorPanel = ({
  assets,
  documents,
  incidents,
  projects,
  error,
  feedback,
  initialValue,
  isSubmitting,
  isUploadingDocuments,
  mode,
  onAttachDocuments,
  onClose,
  onOpenDocument,
  onSubmit,
}: FinanceEntryEditorPanelProps) => {
  const [entryType, setEntryType] = useState("reserve");
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [status, setStatus] = useState("Draft");
  const [projectId, setProjectId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [incidentId, setIncidentId] = useState("");
  const [entryDate, setEntryDate] = useState(resolveDefaultDate);
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!initialValue) {
      setEntryType("reserve");
      setCategory("");
      setAmount("");
      setCurrency("USD");
      setStatus("Draft");
      setProjectId("");
      setAssetId("");
      setIncidentId("");
      setEntryDate(resolveDefaultDate());
      setDescription("");
      setNotes("");
      return;
    }

    setEntryType(initialValue.type);
    setCategory(initialValue.category);
    setAmount(initialValue.amountValue !== undefined ? String(initialValue.amountValue) : "");
    setCurrency(initialValue.currency ?? "USD");
    setStatus(initialValue.status);
    setProjectId(initialValue.projectId ?? "");
    setAssetId(initialValue.assetId ?? "");
    setIncidentId(initialValue.incidentId ?? "");
    setEntryDate(initialValue.date);
    setDescription(initialValue.description ?? "");
    setNotes(initialValue.notes ?? "");
  }, [initialValue]);

  const selectedProjectLabel = useMemo(
    () => projects.find((project) => project.id === projectId)?.name ?? null,
    [projectId, projects],
  );
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);

  useEffect(() => {
    if (!documents.length) {
      setSelectedDocumentId(null);
      return;
    }

    if (selectedDocumentId && documents.some((document) => document.id === selectedDocumentId)) {
      return;
    }

    const previewable = documents.find((document) => document.previewDataUrl);
    setSelectedDocumentId(previewable?.id ?? documents[0]?.id ?? null);
  }, [documents, selectedDocumentId]);

  const selectedDocument = useMemo(
    () => documents.find((document) => document.id === selectedDocumentId) ?? null,
    [documents, selectedDocumentId],
  );

  return (
    <SurfaceCard
      aside={
        <button aria-label="Close finance editor" className="surface-card-action" onClick={onClose} type="button">
          <X size={14} />
        </button>
      }
      title={mode === "create" ? "New finance entry" : "Edit finance entry"}
    >
      <div className="summary-grid compact-summary-grid">
        <div className="summary-row">
          <span className="summary-label">Mode</span>
          <span className="summary-value">
            <StatusBadge tone={mode === "create" ? "success" : "info"}>{mode === "create" ? "Create" : "Edit"}</StatusBadge>
          </span>
        </div>
        {selectedProjectLabel ? (
          <div className="summary-row">
            <span className="summary-label">Project</span>
            <span className="summary-value">{selectedProjectLabel}</span>
          </div>
        ) : null}
      </div>

      {error ? <div className="form-inline-error">{error}</div> : null}
      {feedback ? <div className="action-feedback action-feedback-success">{feedback}</div> : null}

      <div className="action-form-grid">
        <label className="action-field">
          <span className="action-field-label">Entry type</span>
          <SelectField onChange={(event) => setEntryType(event.target.value)} value={entryType}>
            {entryTypeOptions.map((option) => (
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

        <label className="action-field action-field-wide">
          <span className="action-field-label">Category</span>
          <input
            className="action-field-control"
            onChange={(event) => setCategory(event.target.value)}
            placeholder="Repairs, invoice, travel"
            value={category}
          />
        </label>

        <label className="action-field">
          <span className="action-field-label">Amount</span>
          <input
            className="action-field-control"
            inputMode="decimal"
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.00"
            value={amount}
          />
        </label>

        <label className="action-field">
          <span className="action-field-label">Entry date</span>
          <input className="action-field-control" onChange={(event) => setEntryDate(event.target.value)} type="date" value={entryDate} />
        </label>

        <label className="action-field">
          <span className="action-field-label">Project</span>
          <SelectField onChange={(event) => setProjectId(event.target.value)} value={projectId}>
            <option value="">Unlinked</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.code} · {project.name}
              </option>
            ))}
          </SelectField>
        </label>

        <label className="action-field">
          <span className="action-field-label">Currency</span>
          <input className="action-field-control" onChange={(event) => setCurrency(event.target.value)} value={currency} />
        </label>

        <label className="action-field action-field-wide">
          <span className="action-field-label">Description</span>
          <textarea
            className="action-field-control action-textarea"
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What is this for?"
            rows={3}
            value={description}
          />
        </label>
      </div>

      <details className="detail-disclosure">
        <summary className="detail-disclosure-summary">More details</summary>
        <div className="detail-disclosure-content">
          <div className="action-form-grid">
            <label className="action-field">
              <span className="action-field-label">Asset</span>
              <SelectField onChange={(event) => setAssetId(event.target.value)} value={assetId}>
                <option value="">Unlinked</option>
                {assets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.code} · {asset.name}
                  </option>
                ))}
              </SelectField>
            </label>

            <label className="action-field">
              <span className="action-field-label">Incident</span>
              <SelectField onChange={(event) => setIncidentId(event.target.value)} value={incidentId}>
                <option value="">Unlinked</option>
                {incidents.map((incident) => (
                  <option key={incident.id} value={incident.id}>
                    {incident.title}
                  </option>
                ))}
              </SelectField>
            </label>

            <label className="action-field action-field-wide">
              <span className="action-field-label">Notes</span>
              <textarea
                className="action-field-control action-textarea"
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Optional note"
                rows={3}
                value={notes}
              />
            </label>
          </div>
        </div>
      </details>

      {mode === "edit" ? (
        <SurfaceCard title="Documents">
          <div className="action-panel-actions action-panel-actions-inline">
            <button className="ghost-control" disabled={isUploadingDocuments} onClick={() => void onAttachDocuments()} type="button">
              <span>{isUploadingDocuments ? "Attaching..." : "Attach documents"}</span>
            </button>
            {documents.length ? <StatusBadge tone="info">{`${documents.length} attached`}</StatusBadge> : null}
          </div>

          {documents.length ? (
            <div className="finance-documents-grid">
              <div className="finance-documents-list">
                {documents.map((document) => (
                  <button
                    key={document.id}
                    className={`finance-document-row${selectedDocumentId === document.id ? " is-active" : ""}`}
                    onClick={() => setSelectedDocumentId(document.id)}
                    type="button"
                  >
                    <div className="finance-document-row-copy">
                      <span className="finance-document-row-title">{document.originalName}</span>
                      <span className="finance-document-row-meta">
                        {document.fileType} · {formatBytes(document.byteSize)} · {document.status}
                      </span>
                    </div>
                  </button>
                ))}
              </div>

              <div className="finance-document-preview-card">
                {selectedDocument ? (
                  <>
                    <div className="finance-document-preview-header">
                      <div className="finance-document-row-copy">
                        <span className="finance-document-row-title">{selectedDocument.originalName}</span>
                        <span className="finance-document-row-meta">
                          {selectedDocument.mimeType} · {new Date(selectedDocument.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <button
                        className="ghost-control"
                        disabled={selectedDocument.status !== "available"}
                        onClick={() => void onOpenDocument(selectedDocument.id)}
                        type="button"
                      >
                        Open file
                      </button>
                    </div>

                    {selectedDocument.previewDataUrl ? (
                      selectedDocument.mimeType === "application/pdf" ? (
                        <iframe className="finance-document-preview-frame" src={selectedDocument.previewDataUrl} title={selectedDocument.originalName} />
                      ) : (
                        <img
                          alt={selectedDocument.originalName}
                          className="finance-document-preview-image"
                          src={selectedDocument.previewDataUrl}
                        />
                      )
                    ) : (
                      <div className="guided-empty-state guided-empty-state-subtle">
                        <div className="guided-empty-state-copy">
                          <span className="guided-empty-state-title">Preview unavailable</span>
                          <p className="guided-empty-state-body">Open the file to review it outside the app.</p>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="guided-empty-state guided-empty-state-subtle">
                    <div className="guided-empty-state-copy">
                      <span className="guided-empty-state-title">No documents yet</span>
                      <p className="guided-empty-state-body">Attach invoices, receipts or contracts here.</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="guided-empty-state guided-empty-state-subtle">
              <div className="guided-empty-state-copy">
                <span className="guided-empty-state-title">No documents attached</span>
                <p className="guided-empty-state-body">Add PDFs or images once the entry is saved.</p>
              </div>
            </div>
          )}
        </SurfaceCard>
      ) : null}

      <div className="action-panel-actions">
        <button
          className="action-primary-button"
          disabled={isSubmitting}
          onClick={() =>
            void onSubmit({
              entryType,
              category,
              amount: Number(amount || 0),
              currency,
              status,
              projectId: normalizeOptional(projectId),
              assetId: normalizeOptional(assetId),
              incidentId: normalizeOptional(incidentId),
              entryDate,
              description: normalizeOptional(description),
              notes: normalizeOptional(notes),
            })
          }
          type="button"
        >
          <Save size={14} />
          <span>{isSubmitting ? "Saving..." : mode === "create" ? "Create entry" : "Save changes"}</span>
        </button>
        <button className="ghost-control cancel-control" disabled={isSubmitting} onClick={onClose} type="button">
          Cancel
        </button>
      </div>
    </SurfaceCard>
  );
};
