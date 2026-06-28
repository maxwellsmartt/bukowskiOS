import { AlertTriangle, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { InventoryResetReport } from "@contracts";
import { useToast } from "@app/providers/ToastProvider";
import { useWorkspace } from "@app/providers/WorkspaceProvider";
import { ModalShell } from "@shared/components/ModalShell";
import { getUserFacingErrorMessage } from "@shared/lib/errors";

const CONFIRM_WORD = "RESET";

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

  const dependentRows = (preview?.references ?? []).filter((reference) => reference.rowCount > 0);
  const confirmReady = confirmText.trim().toUpperCase() === CONFIRM_WORD;

  return (
    <div className="inventory-reset">
      <button type="button" className="ghost-control is-danger inventory-reset-trigger" onClick={() => void openDialog()}>
        <Trash2 size={14} />
        <span>{t("assets.reset.trigger", { defaultValue: "Reset de inventario" })}</span>
      </button>

      {open ? (
        <ModalShell onClose={close}>
          <div className="inventory-reset-dialog">
            <div className="inventory-reset-head">
              <span className="inventory-reset-head-icon"><AlertTriangle size={18} aria-hidden="true" /></span>
              <div>
                <strong>{t("assets.reset.title", { defaultValue: "Vaciar todo el inventario" })}</strong>
                <p>{t("assets.reset.subtitle", { defaultValue: "Borra todos los equipos de este workspace para re-importar desde cero (limpieza coordinada)." })}</p>
              </div>
            </div>

            {error ? <div className="action-feedback action-feedback-error">{error}</div> : null}

            {done ? (
              <div className="inventory-reset-done">
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
                <div className="inventory-reset-summary">
                  <div className="inventory-reset-stat">
                    <span>{t("assets.reset.assets", { defaultValue: "Equipos a eliminar" })}</span>
                    <strong>{preview.assetCount}</strong>
                  </div>
                  <div className={`inventory-reset-stat${preview.inUseCount > 0 ? " is-warning" : ""}`}>
                    <span>{t("assets.reset.inUse", { defaultValue: "En uso" })}</span>
                    <strong>{preview.inUseCount}</strong>
                  </div>
                </div>

                {dependentRows.length ? (
                  <div className="inventory-reset-deps">
                    <span className="inventory-reset-deps-label">
                      {t("assets.reset.dependents", { defaultValue: "Registros dependientes" })}
                    </span>
                    {dependentRows.map((reference) => (
                      <div key={`${reference.table}.${reference.column}`} className="inventory-reset-dep">
                        <span>{reference.table}</span>
                        <span>
                          {reference.rowCount} ·{" "}
                          {reference.action === "null"
                            ? t("assets.reset.unlink", { defaultValue: "se desvincula" })
                            : t("assets.reset.delete", { defaultValue: "se borra" })}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}

                <p className="inventory-reset-note">
                  {t("assets.reset.note", {
                    defaultValue: "Acción coordinada: primero vacía la nube, luego corre esto en cada máquina, luego re-importa. Escribe RESET para confirmar.",
                  })}
                </p>
                <input
                  className="inventory-reset-confirm-input"
                  value={confirmText}
                  onChange={(event) => setConfirmText(event.target.value)}
                  placeholder={CONFIRM_WORD}
                  aria-label={t("assets.reset.confirmAria", { defaultValue: "Escribe RESET para confirmar" })}
                />

                <div className="action-panel-actions action-panel-actions-start">
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
