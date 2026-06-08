import { Archive, Save, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

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
  purchasePrice?: number;
  additionalCosts?: number;
  replacementValue?: number;
  currentBookValue?: number;
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
const ownershipValues = ["owned", "rented", "consigned"] as const;

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
  const { t } = useTranslation();
  const [confirmArchiveOpen, setConfirmArchiveOpen] = useState(false);
  const [name, setName] = useState(initialValue?.name ?? "");
  const [internalCode, setInternalCode] = useState(initialValue?.internalCode ?? "");
  const [categoryId, setCategoryId] = useState(initialValue?.categoryId ?? categories[0]?.id ?? "");
  const [brand, setBrand] = useState(initialValue?.brand ?? "");
  const [model, setModel] = useState(initialValue?.model ?? "");
  const [serialNumber, setSerialNumber] = useState(initialValue?.serialNumber ?? "");
  const [description, setDescription] = useState(initialValue?.description ?? "");
  // Guard against orphaned/legacy location references (e.g. left by the Rentman
  // 2021 import): if the stored location is no longer in the catalog, start the
  // field empty so the displayed placeholder matches what actually gets saved.
  const [defaultLocationId, setDefaultLocationId] = useState(
    initialValue?.defaultLocationId && locations.some((location) => location.id === initialValue.defaultLocationId)
      ? initialValue.defaultLocationId
      : "",
  );
  const [conditionStatus, setConditionStatus] = useState(initialValue?.conditionStatus ?? "Good");
  const [notes, setNotes] = useState(initialValue?.notes ?? "");
  const [purchasePrice, setPurchasePrice] = useState(
    typeof initialValue?.purchasePrice === "number" ? String(initialValue.purchasePrice) : "",
  );
  const [additionalCosts, setAdditionalCosts] = useState(
    typeof initialValue?.additionalCosts === "number" ? String(initialValue.additionalCosts) : "",
  );
  const [replacementValue, setReplacementValue] = useState(
    typeof initialValue?.replacementValue === "number" ? String(initialValue.replacementValue) : "",
  );
  const [currentBookValue, setCurrentBookValue] = useState(
    typeof initialValue?.currentBookValue === "number" ? String(initialValue.currentBookValue) : "",
  );
  const [ownershipType, setOwnershipType] = useState(initialValue?.ownershipType ?? "owned");
  const [qrCodeValue, setQrCodeValue] = useState(initialValue?.qrCodeValue ?? initialValue?.primaryCodeValue ?? "");

  const title = mode === "create" ? t("assets.editor.titleNew") : t("assets.editor.titleEdit");
  const primaryCodeValue = useMemo(
    () => initialValue?.primaryCodeValue || qrCodeValue.trim() || t("assets.editor.willGenerate"),
    [initialValue, qrCodeValue, t],
  );

  return (
    <SurfaceCard
      aside={
        <button aria-label={t("assets.editor.close")} className="surface-card-action" onClick={onClose} type="button">
          <X size={14} />
        </button>
      }
      title={title}
    >
      {mode === "edit" ? (
        <div className="summary-grid compact-summary-grid">
          <div className="summary-row">
            <span className="summary-label">{t("assets.editor.primaryCode")}</span>
            <span className="summary-value">{primaryCodeValue}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">{t("assets.editor.status")}</span>
            <span className="summary-value">
              <StatusBadge tone={initialValue?.isActive ? "success" : "neutral"}>
                {initialValue?.isActive ? t("assets.editor.active") : t("assets.editor.archived")}
              </StatusBadge>
            </span>
          </div>
        </div>
      ) : null}

      <div className="action-form-grid">
        <label className="action-field">
          <span className="action-field-label">{t("assets.editor.name")}</span>
          <input className="action-field-control" onChange={(event) => setName(event.target.value)} value={name} />
        </label>

        <label className="action-field">
          <span className="action-field-label">{t("assets.editor.assetCode")}</span>
          <input
            className="action-field-control"
            onChange={(event) => setInternalCode(event.target.value.toUpperCase())}
            value={internalCode}
          />
        </label>

        <label className="action-field">
          <span className="action-field-label">{t("assets.editor.category")}</span>
          <SelectField onChange={(event) => setCategoryId(event.target.value)} value={categoryId}>
            <option value="">{t("assets.editor.chooseCategory")}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.code} · {category.name}
              </option>
            ))}
          </SelectField>
        </label>

        <label className="action-field">
          <span className="action-field-label">{t("assets.editor.defaultLocation")}</span>
          <SelectField onChange={(event) => setDefaultLocationId(event.target.value)} value={defaultLocationId}>
            <option value="">{t("assets.editor.noDefaultLocation")}</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.code} · {location.name}
              </option>
            ))}
          </SelectField>
        </label>

        <label className="action-field">
          <span className="action-field-label">{t("assets.editor.condition")}</span>
          <SelectField onChange={(event) => setConditionStatus(event.target.value)} value={conditionStatus}>
            {conditionOptions.map((option) => (
              <option key={option} value={option}>
                {t(`assets.editor.conditions.${option}`)}
              </option>
            ))}
          </SelectField>
        </label>

      </div>

      <details className="detail-disclosure">
        <summary className="detail-disclosure-summary">{t("assets.editor.moreDetails")}</summary>
        <div className="detail-disclosure-content">
          <div className="action-form-grid">
            <label className="action-field">
              <span className="action-field-label">{t("assets.editor.brand")}</span>
              <input className="action-field-control" onChange={(event) => setBrand(event.target.value)} value={brand} />
            </label>

            <label className="action-field">
              <span className="action-field-label">{t("assets.editor.model")}</span>
              <input className="action-field-control" onChange={(event) => setModel(event.target.value)} value={model} />
            </label>

            <label className="action-field">
              <span className="action-field-label">{t("assets.editor.serial")}</span>
              <input className="action-field-control" onChange={(event) => setSerialNumber(event.target.value)} value={serialNumber} />
            </label>

            <label className="action-field">
              <span className="action-field-label">{t("assets.editor.ownership")}</span>
              <SelectField onChange={(event) => setOwnershipType(event.target.value)} value={ownershipType}>
                {ownershipValues.map((value) => (
                  <option key={value} value={value}>
                    {t(`assets.editor.ownershipTypes.${value}`)}
                  </option>
                ))}
              </SelectField>
            </label>

            <div className="action-form-section-label action-field-wide">{t("assets.editor.insuranceValues")}</div>

            <label className="action-field">
              <span className="action-field-label">{t("assets.editor.purchasePrice")}</span>
              <input
                className="action-field-control"
                inputMode="decimal"
                onChange={(event) => setPurchasePrice(event.target.value)}
                placeholder={t("assets.editor.placeholders.optional")}
                value={purchasePrice}
              />
            </label>

            <label className="action-field">
              <span className="action-field-label">{t("assets.editor.additionalCosts")}</span>
              <input
                className="action-field-control"
                inputMode="decimal"
                onChange={(event) => setAdditionalCosts(event.target.value)}
                placeholder={t("assets.editor.placeholders.shippingCustoms")}
                value={additionalCosts}
              />
            </label>

            <label className="action-field">
              <span className="action-field-label">{t("assets.editor.currentValue")}</span>
              <input
                className="action-field-control"
                inputMode="decimal"
                onChange={(event) => setCurrentBookValue(event.target.value)}
                placeholder={t("assets.editor.placeholders.manualInsured")}
                value={currentBookValue}
              />
            </label>

            <label className="action-field">
              <span className="action-field-label">{t("assets.editor.replacementValue")}</span>
              <input
                className="action-field-control"
                inputMode="decimal"
                onChange={(event) => setReplacementValue(event.target.value)}
                placeholder="Optional"
                value={replacementValue}
              />
            </label>

            <label className="action-field action-field-wide">
              <span className="action-field-label">{t("assets.editor.qrValue")}</span>
              <input
                className="action-field-control"
                onChange={(event) => setQrCodeValue(event.target.value)}
                placeholder={t("assets.editor.placeholders.qrAuto")}
                value={qrCodeValue}
              />
            </label>

            <label className="action-field action-field-wide">
              <span className="action-field-label">{t("assets.editor.description")}</span>
              <textarea
                className="action-field-control action-textarea"
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t("assets.editor.placeholders.shortDescription")}
                rows={3}
                value={description}
              />
            </label>

            <label className="action-field action-field-wide">
              <span className="action-field-label">{t("assets.editor.notes")}</span>
              <textarea
                className="action-field-control action-textarea"
                onChange={(event) => setNotes(event.target.value)}
                placeholder={t("assets.editor.placeholders.optionalNote")}
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
            <span>{isArchiving ? t("assets.editor.archiving") : t("assets.editor.archiveAsset")}</span>
          </button>
        ) : (
          <button className="ghost-control cancel-control" onClick={onClose} type="button">
            {t("assets.editor.cancel")}
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
              purchasePrice: normalizeOptional(purchasePrice) ? Number(purchasePrice) : undefined,
              additionalCosts: normalizeOptional(additionalCosts) ? Number(additionalCosts) : undefined,
              replacementValue: normalizeOptional(replacementValue) ? Number(replacementValue) : undefined,
              currentBookValue: normalizeOptional(currentBookValue) ? Number(currentBookValue) : undefined,
              ownershipType: normalizeOptional(ownershipType) ?? "owned",
              qrCodeValue: normalizeOptional(qrCodeValue),
            })
          }
          type="button"
        >
          <Save size={14} />
          <span>{isSubmitting ? t("assets.editor.saving") : mode === "create" ? t("assets.editor.createAsset") : t("assets.editor.saveAsset")}</span>
        </button>
      </div>

      <ConfirmDialog
        body={t("assets.editor.archiveConfirmBody")}
        confirmLabel={t("assets.editor.archiveAsset")}
        isOpen={confirmArchiveOpen}
        isSubmitting={isArchiving}
        onCancel={() => setConfirmArchiveOpen(false)}
        onConfirm={async () => {
          await onArchive?.();
          setConfirmArchiveOpen(false);
        }}
        title={t("assets.editor.archiveAsset")}
        tone="danger"
      />
    </SurfaceCard>
  );
};
