import { Archive, Save, X } from "lucide-react";
import { useMemo, useState } from "react";

import type { AssetEditorSnapshot, CatalogSnapshot } from "@contracts";
import { ConfirmDialog } from "@shared/components/ConfirmDialog";
import { SelectField } from "@shared/components/SelectField";
import { StatusBadge } from "@shared/components/StatusBadge";
import { SurfaceCard } from "@shared/components/SurfaceCard";

export type AssetEditorDraft = {
  name: string;
  internalCode: string;
  categoryId: string;
  brand?: string;
  model?: string;
  serialNumber?: string;
  description?: string;
  defaultLocationId?: string;
  conditionStatus: string;
  notes?: string;
  replacementValue?: number;
  ownershipType?: string;
  qrCodeValue?: string;
};

type AssetEditorPanelProps = {
  categories: CatalogSnapshot["categories"];
  error: string | null;
  initialValue?: AssetEditorSnapshot | null;
  isArchiving?: boolean;
  isSubmitting: boolean;
  locations: CatalogSnapshot["locations"];
  mode: "create" | "edit";
  onArchive?: () => Promise<void>;
  onClose: () => void;
  onSubmit: (value: AssetEditorDraft) => Promise<void>;
};

const conditionOptions = ["Good", "Review", "Damaged"] as const;
const ownershipOptions = [
  { value: "owned", label: "Owned" },
  { value: "rented", label: "Rented" },
  { value: "consigned", label: "Consigned" },
] as const;

const normalizeOptional = (value: string) => {
  const nextValue = value.trim();
  return nextValue ? nextValue : undefined;
};

export const AssetEditorPanel = ({
  categories,
  error,
  initialValue,
  isArchiving = false,
  isSubmitting,
  locations,
  mode,
  onArchive,
  onClose,
  onSubmit,
}: AssetEditorPanelProps) => {
  const [confirmArchiveOpen, setConfirmArchiveOpen] = useState(false);
  const [name, setName] = useState(initialValue?.name ?? "");
  const [internalCode, setInternalCode] = useState(initialValue?.internalCode ?? "");
  const [categoryId, setCategoryId] = useState(initialValue?.categoryId ?? categories[0]?.id ?? "");
  const [brand, setBrand] = useState(initialValue?.brand ?? "");
  const [model, setModel] = useState(initialValue?.model ?? "");
  const [serialNumber, setSerialNumber] = useState(initialValue?.serialNumber ?? "");
  const [description, setDescription] = useState(initialValue?.description ?? "");
  const [defaultLocationId, setDefaultLocationId] = useState(initialValue?.defaultLocationId ?? "");
  const [conditionStatus, setConditionStatus] = useState(initialValue?.conditionStatus ?? "Good");
  const [notes, setNotes] = useState(initialValue?.notes ?? "");
  const [replacementValue, setReplacementValue] = useState(
    typeof initialValue?.replacementValue === "number" ? String(initialValue.replacementValue) : "",
  );
  const [ownershipType, setOwnershipType] = useState(initialValue?.ownershipType ?? "owned");
  const [qrCodeValue, setQrCodeValue] = useState(initialValue?.qrCodeValue ?? initialValue?.primaryCodeValue ?? "");

  const title = mode === "create" ? "New asset" : "Edit asset";
  const primaryCodeValue = useMemo(() => initialValue?.primaryCodeValue || qrCodeValue.trim() || "Will generate on save", [initialValue, qrCodeValue]);

  return (
    <SurfaceCard
      aside={
        <button aria-label="Close asset editor" className="surface-card-action" onClick={onClose} type="button">
          <X size={14} />
        </button>
      }
      title={title}
    >
      <div className="summary-grid compact-summary-grid">
        <div className="summary-row">
          <span className="summary-label">Primary code</span>
          <span className="summary-value">{primaryCodeValue}</span>
        </div>
        <div className="summary-row">
          <span className="summary-label">Status</span>
          <span className="summary-value">
            <StatusBadge tone={initialValue ? (initialValue.isActive ? "success" : "neutral") : "info"}>
              {initialValue ? (initialValue.isActive ? "Active" : "Archived") : "New"}
            </StatusBadge>
          </span>
        </div>
      </div>

      <div className="action-form-grid">
        <label className="action-field">
          <span className="action-field-label">Name</span>
          <input className="action-field-control" onChange={(event) => setName(event.target.value)} value={name} />
        </label>

        <label className="action-field">
          <span className="action-field-label">Asset code</span>
          <input
            className="action-field-control"
            onChange={(event) => setInternalCode(event.target.value.toUpperCase())}
            value={internalCode}
          />
        </label>

        <label className="action-field">
          <span className="action-field-label">Category</span>
          <SelectField onChange={(event) => setCategoryId(event.target.value)} value={categoryId}>
            <option value="">Choose category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.code} · {category.name}
              </option>
            ))}
          </SelectField>
        </label>

        <label className="action-field">
          <span className="action-field-label">Default location</span>
          <SelectField onChange={(event) => setDefaultLocationId(event.target.value)} value={defaultLocationId}>
            <option value="">No default location</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.code} · {location.name}
              </option>
            ))}
          </SelectField>
        </label>

        <label className="action-field">
          <span className="action-field-label">Condition</span>
          <SelectField onChange={(event) => setConditionStatus(event.target.value)} value={conditionStatus}>
            {conditionOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </SelectField>
        </label>

      </div>

      <details className="detail-disclosure">
        <summary className="detail-disclosure-summary">More details</summary>
        <div className="detail-disclosure-content">
          <div className="action-form-grid">
            <label className="action-field">
              <span className="action-field-label">Brand</span>
              <input className="action-field-control" onChange={(event) => setBrand(event.target.value)} value={brand} />
            </label>

            <label className="action-field">
              <span className="action-field-label">Model</span>
              <input className="action-field-control" onChange={(event) => setModel(event.target.value)} value={model} />
            </label>

            <label className="action-field">
              <span className="action-field-label">Serial</span>
              <input className="action-field-control" onChange={(event) => setSerialNumber(event.target.value)} value={serialNumber} />
            </label>

            <label className="action-field">
              <span className="action-field-label">Ownership</span>
              <SelectField onChange={(event) => setOwnershipType(event.target.value)} value={ownershipType}>
                {ownershipOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </SelectField>
            </label>

            <label className="action-field">
              <span className="action-field-label">Replacement value</span>
              <input
                className="action-field-control"
                inputMode="decimal"
                onChange={(event) => setReplacementValue(event.target.value)}
                placeholder="Optional"
                value={replacementValue}
              />
            </label>

            <label className="action-field action-field-wide">
              <span className="action-field-label">QR value</span>
              <input
                className="action-field-control"
                onChange={(event) => setQrCodeValue(event.target.value)}
                placeholder="Leave blank to generate it automatically"
                value={qrCodeValue}
              />
            </label>

            <label className="action-field action-field-wide">
              <span className="action-field-label">Description</span>
              <textarea
                className="action-field-control action-textarea"
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Short description"
                rows={3}
                value={description}
              />
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

      {error ? <div className="action-feedback action-feedback-error">{error}</div> : null}

      <div className="action-panel-actions">
        {mode === "edit" && onArchive ? (
          <button className="ghost-control" disabled={isArchiving} onClick={() => setConfirmArchiveOpen(true)} type="button">
            <Archive size={14} />
            <span>{isArchiving ? "Archiving..." : "Archive asset"}</span>
          </button>
        ) : (
          <button className="ghost-control" onClick={onClose} type="button">
            Cancel
          </button>
        )}

        <button
          className="action-primary-button"
          disabled={isSubmitting}
          onClick={() =>
            void onSubmit({
              name: name.trim(),
              internalCode: internalCode.trim().toUpperCase(),
              categoryId,
              brand: normalizeOptional(brand),
              model: normalizeOptional(model),
              serialNumber: normalizeOptional(serialNumber),
              description: normalizeOptional(description),
              defaultLocationId: normalizeOptional(defaultLocationId),
              conditionStatus,
              notes: normalizeOptional(notes),
              replacementValue: normalizeOptional(replacementValue) ? Number(replacementValue) : undefined,
              ownershipType: normalizeOptional(ownershipType) ?? "owned",
              qrCodeValue: normalizeOptional(qrCodeValue),
            })
          }
          type="button"
        >
          <Save size={14} />
          <span>{isSubmitting ? "Saving..." : mode === "create" ? "Create asset" : "Save asset"}</span>
        </button>
      </div>

      <ConfirmDialog
        body="Archive this asset? It will stay in history, but it will no longer appear in active work."
        confirmLabel="Archive asset"
        isOpen={confirmArchiveOpen}
        isSubmitting={isArchiving}
        onCancel={() => setConfirmArchiveOpen(false)}
        onConfirm={async () => {
          await onArchive?.();
          setConfirmArchiveOpen(false);
        }}
        title="Archive asset"
        tone="danger"
      />
    </SurfaceCard>
  );
};
