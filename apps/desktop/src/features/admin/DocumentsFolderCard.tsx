import { Folder, FolderOpen, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { SurfaceCard } from "@shared/components/SurfaceCard";

type RootInfo = { root: string; isCustom: boolean; defaultRoot: string };

/**
 * Per-machine setting for where uploaded documents (invoices, statements,
 * future cédulas/company docs) are stored locally. Pointing this at an
 * iCloud/Drive folder lets a single user's machines share the files. Cloud
 * sync of file bytes (cross-user) is handled separately by Supabase Storage.
 */
export const DocumentsFolderCard = () => {
  const { t } = useTranslation();
  const [info, setInfo] = useState<RootInfo | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.bukowskiApp?.getDocumentsRoot().then(setInfo).catch(() => undefined);
  }, []);

  const choose = async () => {
    if (!window.bukowskiApp) return;
    setBusy(true);
    try {
      const next = await window.bukowskiApp.chooseDocumentsRoot();
      setInfo(next);
      if (next.isCustom) {
        toast.success(t("settings.workspace.documentsFolder.saved", { defaultValue: "Carpeta de documentos actualizada." }));
      }
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!window.bukowskiApp) return;
    setBusy(true);
    try {
      setInfo(await window.bukowskiApp.resetDocumentsRoot());
      toast.success(t("settings.workspace.documentsFolder.reset", { defaultValue: "Se restableció la carpeta por defecto." }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SurfaceCard
      title={t("settings.workspace.documentsFolder.title", { defaultValue: "Carpeta de documentos (este equipo)" })}
      aside={
        <div style={{ display: "inline-flex", gap: 6 }}>
          {info?.isCustom ? (
            <button className="ghost-control" disabled={busy} onClick={() => void reset()} type="button">
              <RotateCcw size={13} />
              <span>{t("settings.workspace.documentsFolder.resetAction", { defaultValue: "Restablecer" })}</span>
            </button>
          ) : null}
          <button className="action-primary-button" disabled={busy} onClick={() => void choose()} type="button">
            <FolderOpen size={13} />
            <span>{t("settings.workspace.documentsFolder.choose", { defaultValue: "Cambiar carpeta" })}</span>
          </button>
        </div>
      }
    >
      <p className="surface-card-subtitle">
        {t("settings.workspace.documentsFolder.subtitle", {
          defaultValue:
            "Dónde se guardan localmente las facturas, estados de cuenta y otros documentos. Apunta a una carpeta de iCloud/Drive para sincronizar tus archivos entre tus máquinas. Aplica a documentos nuevos.",
        })}
      </p>
      <div className="documents-folder-path">
        <Folder size={14} />
        <code title={info?.root}>{info?.root ?? "…"}</code>
        {info && !info.isCustom ? (
          <span className="text-muted">
            {t("settings.workspace.documentsFolder.defaultTag", { defaultValue: "(por defecto)" })}
          </span>
        ) : null}
      </div>
    </SurfaceCard>
  );
};
