import { CheckCircle2, Download, ExternalLink, FolderOpen, RefreshCw, XCircle } from "lucide-react";

import { useAppUpdate } from "@app/providers/AppUpdateProvider";
import { ModalShell } from "@shared/components/ModalShell";

const formatBytes = (value: number | null | undefined) => {
  if (!value || value <= 0) {
    return null;
  }
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  let next = value;
  let index = 0;

  while (next >= 1024 && index < units.length - 1) {
    next /= 1024;
    index += 1;
  }

  const precision = next >= 10 || index === 0 ? 0 : 1;
  return `${next.toFixed(precision)} ${units[index]}`;
};

export const AppUpdateModal = () => {
  const {
    status,
    isModalOpen,
    closeModal,
    downloadUpdate,
    openDownloadedUpdate,
    revealDownloadedUpdate,
  } = useAppUpdate();

  if (!isModalOpen || !status) {
    return null;
  }

  const isDownloading = status.state === "downloading";
  const isDownloaded = status.state === "downloaded";
  const isFailed = status.state === "failed";
  const progressValue = Math.max(0, Math.min(100, status.progressPercent ?? 0));
  const progressLabel =
    status.bytesTotal && status.bytesReceived > 0
      ? `${formatBytes(status.bytesReceived)} / ${formatBytes(status.bytesTotal)}`
      : status.assetSizeBytes
        ? formatBytes(status.assetSizeBytes)
        : null;

  return (
    <ModalShell className="app-update-modal-shell" onClose={closeModal} width={560}>
      <section className="app-update-modal">
        <header className="app-update-modal-header">
          <div className="app-update-modal-title-group">
            <span className={`app-update-modal-badge app-update-modal-badge-${status.state}`}>
              {isDownloaded ? <CheckCircle2 size={14} /> : isFailed ? <XCircle size={14} /> : <Download size={14} />}
              <span>
                {isDownloaded
                  ? "Instalador listo"
                  : isDownloading
                    ? "Descargando update"
                    : isFailed
                      ? "Update pendiente"
                      : "Nueva versión disponible"}
              </span>
            </span>
            <h2>Update de bukowskiOS</h2>
            <p>
              {status.releaseName || status.latestVersion || "Release nueva"}
              {status.currentVersion ? ` · actual ${status.currentVersion}` : ""}
            </p>
          </div>
        </header>

        <div className="app-update-modal-card">
          <div className="app-update-modal-row">
            <span>Estado</span>
            <strong>{status.statusLabel}</strong>
          </div>
          <div className="app-update-modal-row">
            <span>Archivo</span>
            <strong>{status.assetName || "Pendiente"}</strong>
          </div>
          <div className="app-update-modal-row">
            <span>Versión</span>
            <strong>{status.latestVersion || "Sin cambio"}</strong>
          </div>
          <div className="app-update-modal-row">
            <span>Destino</span>
            <strong>Downloads</strong>
          </div>
        </div>

        <div className="app-update-modal-progress-card">
          <div className="app-update-modal-progress-head">
            <strong>Progreso</strong>
            <span>{status.progressPercent != null ? `${progressValue}%` : isDownloaded ? "100%" : "Listo para bajar"}</span>
          </div>
          <div className="app-update-modal-progress-bar" aria-hidden="true">
            <span style={{ width: `${isDownloaded ? 100 : progressValue}%` }} />
          </div>
          <div className="app-update-modal-progress-meta">
            <span>{progressLabel || "El instalador se guardará directo en Downloads."}</span>
            {isDownloading ? <span>Puedes cerrar este modal; la descarga sigue en background.</span> : null}
          </div>
          {status.errorMessage ? <p className="app-update-modal-error">{status.errorMessage}</p> : null}
        </div>

        <footer className="app-update-modal-actions">
          <button className="ghost-control" onClick={closeModal} type="button">
            Cerrar
          </button>

          {isDownloaded ? (
            <>
              <button className="ghost-control" onClick={() => void revealDownloadedUpdate().catch(() => undefined)} type="button">
                <FolderOpen size={14} />
                <span>Mostrar en Downloads</span>
              </button>
              <button
                className="ghost-control app-update-primary-action"
                onClick={() => void openDownloadedUpdate().catch(() => undefined)}
                type="button"
              >
                <ExternalLink size={14} />
                <span>Abrir instalador</span>
              </button>
            </>
          ) : (
            <button
              className="ghost-control app-update-primary-action"
              disabled={isDownloading}
              onClick={() => void downloadUpdate().catch(() => undefined)}
              type="button"
            >
              {isDownloading ? <RefreshCw size={14} className="is-spinning" /> : <Download size={14} />}
              <span>{isDownloading ? "Descargando…" : isFailed ? "Reintentar descarga" : "Descargar update"}</span>
            </button>
          )}
        </footer>
      </section>
    </ModalShell>
  );
};
