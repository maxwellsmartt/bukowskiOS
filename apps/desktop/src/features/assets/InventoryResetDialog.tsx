import { AlertTriangle, CheckCircle2, Info, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { InventoryResetReport } from "@contracts";
import { useToast } from "@app/providers/ToastProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { ModalShell } from "@shared/components/ModalShell";
import { getUserFacingErrorMessage } from "@shared/lib/errors";

const CONFIRM_WORD = "RESET";

// Friendly, human labels for the technical tables shown in the impact preview —
// a non-technical operator should never see raw column/table names.
const FRIENDLY_TABLE_LABELS: Record<string, string> = {
  asset_current_state: "Estado actual",
  asset_events: "Historial de eventos",
  asset_assignments: "Asignaciones",
  asset_files: "Archivos adjuntos",
  kit_assets: "Pertenencia a kits",
  scannable_codes: "Códigos QR / barras",
  incidents: "Incidencias",
  financial_entries: "Asientos financieros",
  packing_slip_items: "Ítems de packing",
  rma_case_assets: "Equipos en RMA",
};

const friendlyTableLabel = (table: string): string =>
  FRIENDLY_TABLE_LABELS[table] ??
  table
    .split("_")
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(" ");

/**
 * Admin-only maintenance action to wipe the entire equipment inventory of the
 * active workspace so it can be re-imported clean. Shows a read-only preview
 * (exact counts) and requires typing RESET before the guarded wipe runs. Pairs
 * with the coordinated reset: wipe the cloud, run this on each machine, re-import.
 */
export const InventoryResetDialog = () => {
  const { t } = useTranslation();
  const toast = useToast();
  const { activeWorkspaceId, activeMembership } = useWorkspace();
  const isAdmin = activeMembership?.roleKey === "admin";

  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<InventoryResetReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [isResetting, setIsResetting] = useState(false);
  const [done, setDone] = useState<InventoryResetReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isAdmin || !window.bukowskiAssets?.resetInventory) {
    return null;
  }

  const openDialog = async () => {
    if (!activeWorkspaceId) return;
    setOpen(true);
    setPreview(null);
    setDone(null);
    setError(null);
    setConfirmText("");
    setIsLoading(true);
    try {
      const report = await window.bukowskiAssets!.previewInventoryReset({ workspaceId: activeWorkspaceId });
      setPreview(report);
    } catch (nextError) {
      setError(getUserFacingErrorMessage(nextError, t("assets.reset.previewFailed", { defaultValue: "No se pudo leer el inventario." })));
    } finally {
      setIsLoading(false);
    }
  };

  const close = () => {
    if (!isResetting) setOpen(false);
  };

  const runReset = async () => {
    if (!activeWorkspaceId || confirmText.trim().toUpperCase() !== CONFIRM_WORD) return;
    setIsResetting(true);
    setError(null);
    try {
      const report = await window.bukowskiAssets!.resetInventory({ workspaceId: activeWorkspaceId });
      setDone(report);
      toast.success(
        t("assets.reset.doneTitle", { defaultValue: "Inventario vaciado" }),
        t("assets.reset.doneBody", { defaultValue: "{{count}} equipos eliminados. Ya puedes re-importar.", count: report.assetCount }),
      );
    } catch (nextError) {
      setError(getUserFacingErrorMessage(nextError, t("assets.reset.failed", { defaultValue: "No se pudo vaciar el inventario." })));
    } finally {
      setIsResetting(false);
    }
  };

  const removedItems = preview
    ? [
        ...preview.references
          .filter((reference) => reference.rowCount > 0 && reference.action === "delete")
          .map((reference) => ({ label: friendlyTableLabel(reference.table), count: reference.rowCount })),
        ...(preview.legacyItems > 0
          ? [{ label: t("assets.reset.legacyRecords", { defaultValue: "Registros de import Rentman" }), count: preview.legacyItems }]
          : []),
        ...(preview.scannableCodes > 0
          ? [{ label: t("assets.reset.codes", { defaultValue: "Códigos QR / barras" }), count: preview.scannableCodes }]
          : []),
      ]
    : [];
  const preservedItems = preview
    ? preview.references
        .filter((reference) => reference.rowCount > 0 && reference.action === "null")
        .map((reference) => ({ label: friendlyTableLabel(reference.table), count: reference.rowCount }))
    : [];
  const confirmReady = confirmText.trim().toUpperCase() === CONFIRM_WORD;

  return (
    <div className="inventory-reset">
      <button type="button" className="ghost-control is-danger inventory-reset-trigger" onClick={() => void openDialog()}>
        <Trash2 size={14} />
        <span>{t("assets.reset.trigger", { defaultValue: "Reset de inventario" })}</span>
      </button>

      {open ? (
        <ModalShell onClose={close} width={620}>
          <div className="inventory-reset-dialog">
            <div className="inventory-reset-head">
              <div className="inventory-reset-head-copy">
                <div className="inventory-reset-headline">
                  <span className="inventory-reset-head-icon"><AlertTriangle size={18} aria-hidden="true" /></span>
                  <div>
                    <strong>{t("assets.reset.title", { defaultValue: "Vaciar todo el inventario" })}</strong>
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="icon-ghost-control inventory-reset-close"
                aria-label={t("common.close", { defaultValue: "Cerrar" })}
                onClick={close}
                disabled={isResetting}
              >
                <X size={16} />
              </button>
            </div>

            {error ? <div className="action-feedback action-feedback-error">{error}</div> : null}

            {done ? (
              <div className="inventory-reset-done">
                <div className="inventory-reset-done-icon">
                  <CheckCircle2 size={18} aria-hidden="true" />
                </div>
                <p>
                  {t("assets.reset.doneDetail", {
                    defaultValue: "Se eliminaron {{count}} equipos. Ahora re-importa los CSV (Rentman + DLC) y sincroniza.",
                    count: done.assetCount,
                  })}
                </p>
                <div className="action-panel-actions action-panel-actions-start">
                  <button type="button" className="action-primary-button" onClick={() => setOpen(false)}>
                    {t("common.close", { defaultValue: "Cerrar" })}
                  </button>
                </div>
              </div>
            ) : isLoading || !preview ? (
              <div className="empty-state">{t("assets.reset.loading", { defaultValue: "Calculando el alcance…" })}</div>
            ) : (
              <>
                <div className="inventory-reset-impact">
                  <div className="inventory-reset-impact-count">
                    <span className="inventory-reset-impact-label">{t("assets.reset.impactLabel", { defaultValue: "Se elimina ahora" })}</span>
                    <strong>{preview.assetCount.toLocaleString()}</strong>
                    <span>{t("assets.reset.assetsToDelete", { defaultValue: "equipos se eliminarán" })}</span>
                  </div>
                  <div className={`inventory-reset-impact-use${preview.inUseCount > 0 ? " is-warning" : " is-safe"}`}>
                    <span className="inventory-reset-impact-icon">
                      {preview.inUseCount > 0 ? <AlertTriangle size={15} aria-hidden="true" /> : <CheckCircle2 size={15} aria-hidden="true" />}
                    </span>
                    <div className="inventory-reset-impact-copy">
                      <span className="inventory-reset-impact-label">{t("assets.reset.usageLabel", { defaultValue: "Estado de uso" })}</span>
                      <strong>{t("assets.reset.inUseCount", { defaultValue: "{{count}} en uso", count: preview.inUseCount })}</strong>
                      <span>
                        {preview.inUseCount > 0
                          ? t("assets.reset.inUseKept", { defaultValue: "se conservan sus vínculos" })
                          : t("assets.reset.inUseSafe", { defaultValue: "nada asignado ni en proyectos" })}
                      </span>
                    </div>
                  </div>
                </div>

                <div className={`inventory-reset-groups${preservedItems.length ? " has-kept" : ""}`}>
                  {removedItems.length ? (
                    <div className="inventory-reset-group">
                      <span className="inventory-reset-group-label">{t("assets.reset.alsoRemoved", { defaultValue: "También se elimina" })}</span>
                      {removedItems.map((item) => (
                        <div key={item.label} className="inventory-reset-row">
                          <span>{item.label}</span>
                          <span className="inventory-reset-row-count">{item.count.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {preservedItems.length ? (
                    <div className="inventory-reset-group is-kept">
                      <span className="inventory-reset-group-label">{t("assets.reset.kept", { defaultValue: "Se conserva (solo se quita el vínculo al equipo)" })}</span>
                      {preservedItems.map((item) => (
                        <div key={item.label} className="inventory-reset-row">
                          <span>{item.label}</span>
                          <span className="inventory-reset-row-count">{item.count.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="inventory-reset-confirm-panel">
                  <p className="inventory-reset-note">
                    <Info size={13} aria-hidden="true" />
                    <span>
                      {t("assets.reset.coordinated", {
                        defaultValue: "Acción coordinada: primero vacía la nube, luego corre esto en cada máquina, luego re-importa.",
                      })}
                    </span>
                  </p>

                  <div className="inventory-reset-confirm">
                    <label htmlFor="inventory-reset-confirm-input">
                      {t("assets.reset.confirmLabel", { defaultValue: "Para confirmar, escribe RESET" })}
                    </label>
                    <input
                      id="inventory-reset-confirm-input"
                      className="inventory-reset-confirm-input"
                      value={confirmText}
                      onChange={(event) => setConfirmText(event.target.value)}
                      placeholder={CONFIRM_WORD}
                      autoComplete="off"
                    />
                  </div>
                </div>

                <div className="action-panel-actions action-panel-actions-end">
                  <button type="button" className="ghost-control" onClick={close} disabled={isResetting}>
                    {t("common.cancel", { defaultValue: "Cancelar" })}
                  </button>
                  <button
                    type="button"
                    className="action-danger-button"
                    disabled={isResetting || !confirmReady}
                    onClick={() => void runReset()}
                  >
                    {isResetting
                      ? t("assets.reset.resetting", { defaultValue: "Vaciando…" })
                      : t("assets.reset.confirm", { defaultValue: "Vaciar inventario" })}
                  </button>
                </div>
              </>
            )}
          </div>
        </ModalShell>
      ) : null}
    </div>
  );
};
