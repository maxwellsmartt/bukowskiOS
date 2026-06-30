import { Boxes, PackagePlus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { CatalogKitRow } from "@contracts";
import { SelectField } from "@shared/components/SelectField";
import { SurfaceCard } from "@shared/components/SurfaceCard";

import { mergeKitAssetSelections } from "./kitMergeSelection";

export type AssignToKitAssetRow = {
  id: string;
  name: string;
  code: string;
  quantity: number;
};

export type AssignToKitFormValue = {
  mode: "existing" | "new";
  kitId?: string;
  name?: string;
  code?: string;
  description?: string;
};

type AssignToKitPanelProps = {
  error: string | null;
  isSubmitting: boolean;
  kits: CatalogKitRow[];
  onClose: () => void;
  onSubmit: (value: AssignToKitFormValue) => Promise<void>;
  selectedAssets: AssignToKitAssetRow[];
  selectedCount: number;
};

const suggestKitCode = (name: string) =>
  name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

export const AssignToKitPanel = ({
  error,
  isSubmitting,
  kits,
  onClose,
  onSubmit,
  selectedAssets,
  selectedCount,
}: AssignToKitPanelProps) => {
  const { t } = useTranslation();
  const hasKits = kits.length > 0;
  const [mode, setMode] = useState<"existing" | "new">(hasKits ? "existing" : "new");
  const [kitId, setKitId] = useState(hasKits ? kits[0]!.id : "");
  const [name, setName] = useState("");
  const [codeTouched, setCodeTouched] = useState(false);
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");

  const selectedSelections = useMemo(
    () => selectedAssets.map((asset) => ({ assetId: asset.id, quantity: Math.max(1, asset.quantity) })),
    [selectedAssets],
  );

  const targetKit = useMemo(() => kits.find((kit) => kit.id === kitId) ?? null, [kits, kitId]);
  const mergedMemberCount = useMemo(() => {
    if (mode !== "existing" || !targetKit) {
      return selectedSelections.length;
    }
    return mergeKitAssetSelections(targetKit.assetSelections, selectedSelections).length;
  }, [mode, targetKit, selectedSelections]);

  const handleNameChange = (value: string) => {
    setName(value);
    if (!codeTouched) {
      setCode(suggestKitCode(value));
    }
  };

  const canSubmit =
    !isSubmitting &&
    (mode === "existing" ? Boolean(kitId) : name.trim().length > 0 && code.trim().length > 0);

  const handleSubmit = async () => {
    if (mode === "existing") {
      await onSubmit({ mode: "existing", kitId });
    } else {
      await onSubmit({
        mode: "new",
        name: name.trim(),
        code: code.trim().toUpperCase(),
        description: description.trim() || undefined,
      });
    }
  };

  return (
    <SurfaceCard
      aside={
        <button
          aria-label={t("assets.assignKit.close", { defaultValue: "Cerrar" })}
          className="icon-ghost-control"
          onClick={onClose}
          type="button"
        >
          <X size={14} />
        </button>
      }
      title={t("assets.assignKit.title", { defaultValue: "Asignar a Kit" })}
      subtitle={t("assets.assignKit.subtitle", {
        defaultValue: "Amarra estos equipos en un paquete que viaja como una unidad.",
      })}
    >
      <div className="action-panel-summary">
        <span>{t("assets.assignKit.selected", { defaultValue: "{{count}} equipos seleccionados", count: selectedCount })}</span>
        <span>{t("assets.assignKit.resultingMembers", { defaultValue: "{{count}} en el kit", count: mergedMemberCount })}</span>
      </div>

      <div className="packing-builder-selection-list">
        {selectedAssets.map((asset) => (
          <div className="packing-builder-selection-row" key={asset.id}>
            <div className="packing-builder-selection-copy">
              <span className="packing-builder-selection-title">{asset.name}</span>
              <span className="packing-builder-selection-meta">{asset.code}</span>
            </div>
          </div>
        ))}
      </div>

      {hasKits ? (
        <div className="action-mode-toggle" role="tablist" aria-label={t("assets.assignKit.modeAria", { defaultValue: "Modo de asignación" })}>
          <button
            className={`action-mode-button${mode === "existing" ? " active" : ""}`}
            onClick={() => setMode("existing")}
            type="button"
          >
            <Boxes size={14} />
            <span>{t("assets.assignKit.existing", { defaultValue: "Kit existente" })}</span>
          </button>
          <button
            className={`action-mode-button${mode === "new" ? " active" : ""}`}
            onClick={() => setMode("new")}
            type="button"
          >
            <PackagePlus size={14} />
            <span>{t("assets.assignKit.createNew", { defaultValue: "Crear kit nuevo" })}</span>
          </button>
        </div>
      ) : null}

      <div className="action-form-grid">
        {mode === "existing" ? (
          <label className="action-field action-field-wide">
            <span className="action-field-label">{t("assets.assignKit.selectKit", { defaultValue: "Kit" })}</span>
            <SelectField onChange={(event) => setKitId(event.target.value)} value={kitId}>
              {kits.map((kit) => (
                <option key={kit.id} value={kit.id}>
                  {kit.code} · {kit.name} · {t("assets.assignKit.memberCount", { defaultValue: "{{count}} equipos", count: kit.assetCount })}
                </option>
              ))}
            </SelectField>
          </label>
        ) : (
          <>
            <label className="action-field action-field-wide">
              <span className="action-field-label">{t("assets.assignKit.kitName", { defaultValue: "Nombre del kit" })}</span>
              <input
                autoFocus
                className="action-field-control"
                onChange={(event) => handleNameChange(event.target.value)}
                placeholder={t("assets.assignKit.kitNamePlaceholder", { defaultValue: "Ej. Teradek 1500 4K Package" })}
                value={name}
              />
            </label>
            <label className="action-field">
              <span className="action-field-label">{t("assets.assignKit.kitCode", { defaultValue: "Código" })}</span>
              <input
                className="action-field-control"
                onChange={(event) => {
                  setCodeTouched(true);
                  setCode(event.target.value);
                }}
                placeholder="TERADEK-1500-4K"
                value={code}
              />
            </label>
            <label className="action-field action-field-wide">
              <span className="action-field-label">{t("assets.assignKit.kitDescription", { defaultValue: "Descripción (opcional)" })}</span>
              <textarea
                className="action-field-control action-textarea"
                onChange={(event) => setDescription(event.target.value)}
                rows={2}
                value={description}
              />
            </label>
          </>
        )}
      </div>

      {error ? <div className="action-feedback action-feedback-error">{error}</div> : null}

      <div className="action-panel-actions">
        <button className="ghost-control cancel-control" onClick={onClose} type="button">
          {t("common.cancel", { defaultValue: "Cancelar" })}
        </button>
        <button className="action-primary-button" disabled={!canSubmit} onClick={() => void handleSubmit()} type="button">
          {isSubmitting
            ? t("assets.assignKit.applying", { defaultValue: "Asignando…" })
            : t("assets.assignKit.apply", { defaultValue: "Asignar a Kit" })}
        </button>
      </div>
    </SurfaceCard>
  );
};
