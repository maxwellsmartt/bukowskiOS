import { app, BrowserWindow, shell } from "electron";
import fs from "node:fs";
import path from "node:path";

import type {
  AppUpdateActionResult,
  AppUpdateAssetArchitecture,
  AppUpdateCheckCommand,
  AppUpdateStatus,
} from "@contracts";
import { ipcChannels } from "@contracts/ipc/channels";

import { assertPathWithinRoot } from "../../security/pathSafety";
import { getDesktopLogger } from "../logger";
import {
  selectMajorReleaseCandidate,
  type AppUpdateCandidate,
  type GithubRelease,
} from "./appUpdateShared";

const logger = getDesktopLogger("app-update-service");

const DEFAULT_RELEASES_API_URL = "https://api.github.com/repos/maxwellsmartt/bukowskiOS/releases?per_page=10";
const DEFAULT_RELEASES_PAGE_URL = "https://github.com/maxwellsmartt/bukowskiOS/releases/latest";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FAILURE_RETRY_MS = 60 * 60 * 1000;

type PersistedAppUpdateStatus = Pick<
  AppUpdateStatus,
  | "state"
  | "available"
  | "currentVersion"
  | "latestVersion"
  | "releaseName"
  | "releasePageUrl"
  | "assetName"
  | "assetSizeBytes"
  | "assetArchitecture"
  | "progressPercent"
  | "bytesReceived"
  | "bytesTotal"
  | "statusLabel"
  | "downloadedPath"
  | "checkedAt"
  | "errorMessage"
> & {
  assetDownloadUrl?: string | null;
};

const createBaseStatus = (currentVersion: string): AppUpdateStatus => ({
  state: "idle",
  available: false,
  currentVersion,
  latestVersion: null,
  releaseName: null,
  releasePageUrl: null,
  assetName: null,
  assetSizeBytes: null,
  assetArchitecture: null,
  progressPercent: null,
  bytesReceived: 0,
  bytesTotal: null,
  statusLabel: "Sin update pendiente",
  downloadedPath: null,
  checkedAt: null,
  errorMessage: null,
});

const readEnvOverride = (key: string) => {
  const value = process.env[key]?.trim();
  return value && value.length > 0 ? value : null;
};

const getCurrentAppVersion = () => readEnvOverride("BUKOWSKI_UPDATE_CURRENT_VERSION") ?? app.getVersion();

const getReleasesApiUrl = () => readEnvOverride("BUKOWSKI_UPDATE_RELEASES_URL") ?? DEFAULT_RELEASES_API_URL;

const getReleasesPageUrl = () => readEnvOverride("BUKOWSKI_UPDATE_RELEASE_PAGE_URL") ?? DEFAULT_RELEASES_PAGE_URL;

const getDownloadsRoot = () => readEnvOverride("BUKOWSKI_UPDATE_DOWNLOADS_DIR") ?? app.getPath("downloads");

const summarizeDownloadProgress = (bytesReceived: number, bytesTotal: number | null) => {
  if (!bytesTotal || bytesTotal <= 0) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.round((bytesReceived / bytesTotal) * 100)));
};

const isSafeDownloadedFile = (candidatePath: string | null) => {
  if (!candidatePath) return false;
  try {
    const downloadsRoot = getDownloadsRoot();
    const safePath = assertPathWithinRoot(candidatePath, downloadsRoot);
    return fs.existsSync(safePath);
  } catch {
    return false;
  }
};

const sanitizePersistedStatus = (raw: unknown, currentVersion: string): PersistedAppUpdateStatus | null => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const value = raw as Record<string, unknown>;
  if (typeof value.currentVersion !== "string" || value.currentVersion !== currentVersion) {
    return null;
  }

  const state = value.state;
  const allowedStates = new Set<AppUpdateStatus["state"]>(["idle", "checking", "available", "downloading", "downloaded", "failed"]);
  if (typeof state !== "string" || !allowedStates.has(state as AppUpdateStatus["state"])) {
    return null;
  }

  const downloadedPath = typeof value.downloadedPath === "string" ? value.downloadedPath : null;
  const safeDownloadedPath = isSafeDownloadedFile(downloadedPath) ? downloadedPath : null;
  const normalizedState =
    state === "downloading"
      ? "idle"
      : state === "downloaded" && !safeDownloadedPath
        ? "available"
        : (state as AppUpdateStatus["state"]);

  return {
    state: normalizedState,
    available: Boolean(value.available),
    currentVersion,
    latestVersion: typeof value.latestVersion === "string" ? value.latestVersion : null,
    releaseName: typeof value.releaseName === "string" ? value.releaseName : null,
    releasePageUrl: typeof value.releasePageUrl === "string" ? value.releasePageUrl : null,
    assetName: typeof value.assetName === "string" ? value.assetName : null,
    assetSizeBytes: typeof value.assetSizeBytes === "number" ? value.assetSizeBytes : null,
    assetArchitecture:
      value.assetArchitecture === "arm64"
      || value.assetArchitecture === "x64"
      || value.assetArchitecture === "universal"
      || value.assetArchitecture === "unknown"
        ? (value.assetArchitecture as AppUpdateAssetArchitecture)
        : null,
    progressPercent: typeof value.progressPercent === "number" ? value.progressPercent : null,
    bytesReceived: typeof value.bytesReceived === "number" ? value.bytesReceived : 0,
    bytesTotal: typeof value.bytesTotal === "number" ? value.bytesTotal : null,
    statusLabel: typeof value.statusLabel === "string" && value.statusLabel.trim().length > 0
      ? value.statusLabel
      : normalizedState === "downloaded"
        ? "Descarga lista"
        : "Sin update pendiente",
    downloadedPath: safeDownloadedPath,
    checkedAt: typeof value.checkedAt === "string" ? value.checkedAt : null,
    errorMessage: typeof value.errorMessage === "string" ? value.errorMessage : null,
    assetDownloadUrl: typeof value.assetDownloadUrl === "string" ? value.assetDownloadUrl : null,
  };
};

const writeJsonFile = (filePath: string, value: unknown) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
};

const readJsonFile = (filePath: string) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  } catch {
    return null;
  }
};

export const createAppUpdateService = () => {
  const currentVersion = getCurrentAppVersion();
  const persistenceFile = path.join(app.getPath("userData"), "app-update-status.json");
  let persistedStatus = sanitizePersistedStatus(readJsonFile(persistenceFile), currentVersion);
  let status: AppUpdateStatus = persistedStatus
    ? {
        state: persistedStatus.state,
        available: persistedStatus.available,
        currentVersion: persistedStatus.currentVersion,
        latestVersion: persistedStatus.latestVersion,
        releaseName: persistedStatus.releaseName,
        releasePageUrl: persistedStatus.releasePageUrl,
        assetName: persistedStatus.assetName,
        assetSizeBytes: persistedStatus.assetSizeBytes,
        assetArchitecture: persistedStatus.assetArchitecture,
        progressPercent: persistedStatus.progressPercent,
        bytesReceived: persistedStatus.bytesReceived,
        bytesTotal: persistedStatus.bytesTotal,
        statusLabel: persistedStatus.statusLabel,
        downloadedPath: persistedStatus.downloadedPath,
        checkedAt: persistedStatus.checkedAt,
        errorMessage: persistedStatus.errorMessage,
      }
    : createBaseStatus(currentVersion);
  let cachedDownloadUrl = persistedStatus?.assetDownloadUrl ?? null;
  let currentDownloadPromise: Promise<AppUpdateActionResult> | null = null;

  const broadcastStatus = () => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) continue;
      window.webContents.send(ipcChannels.app.appUpdateStatusChanged, status);
    }
  };

  const persistStatus = () => {
    try {
      writeJsonFile(persistenceFile, {
        ...status,
        assetDownloadUrl: cachedDownloadUrl,
      } satisfies PersistedAppUpdateStatus);
    } catch (error) {
      logger.warn("Failed to persist app update status.", { error: String(error) });
    }
  };

  const setStatus = (next: AppUpdateStatus, downloadUrl?: string | null) => {
    status = next;
    if (downloadUrl !== undefined) {
      cachedDownloadUrl = downloadUrl;
    }
    persistStatus();
    broadcastStatus();
  };

  const patchStatus = (patch: Partial<AppUpdateStatus>, downloadUrl?: string | null) => {
    setStatus({ ...status, ...patch }, downloadUrl);
  };

  const shouldSkipCheck = (force = false) => {
    if (force || !status.checkedAt) {
      return false;
    }
    const checkedAt = Date.parse(status.checkedAt);
    if (!Number.isFinite(checkedAt)) {
      return false;
    }
    const windowMs = status.state === "failed" ? FAILURE_RETRY_MS : CHECK_INTERVAL_MS;
    return Date.now() - checkedAt < windowMs;
  };

  const applyCandidateStatus = (candidate: AppUpdateCandidate | null) => {
    const checkedAt = new Date().toISOString();

    if (!candidate) {
      setStatus(
        {
          ...createBaseStatus(currentVersion),
          checkedAt,
          statusLabel: "Tu app ya está al día",
        },
        null,
      );
      return status;
    }

    const downloadedPath =
      status.downloadedPath && status.assetName === candidate.assetName && isSafeDownloadedFile(status.downloadedPath)
        ? status.downloadedPath
        : null;
    const nextState: AppUpdateStatus = {
      state: downloadedPath ? "downloaded" : "available",
      available: true,
      currentVersion,
      latestVersion: candidate.latestVersion,
      releaseName: candidate.releaseName,
      releasePageUrl: candidate.releasePageUrl,
      assetName: candidate.assetName,
      assetSizeBytes: candidate.assetSizeBytes,
      assetArchitecture: candidate.assetArchitecture,
      progressPercent: downloadedPath ? 100 : null,
      bytesReceived: downloadedPath ? candidate.assetSizeBytes ?? 0 : 0,
      bytesTotal: candidate.assetSizeBytes,
      statusLabel: downloadedPath ? "Descarga lista para instalar" : `Update ${candidate.releaseName} disponible`,
      downloadedPath,
      checkedAt,
      errorMessage: null,
    };

    setStatus(nextState, candidate.assetDownloadUrl);
    return nextState;
  };

  const getStatus = () => status;

  const checkForUpdate = async (command?: AppUpdateCheckCommand) => {
    if (status.state === "downloading") {
      return status;
    }
    if (shouldSkipCheck(command?.force ?? false)) {
      return status;
    }

    patchStatus({
      state: "checking",
      statusLabel: "Buscando updates",
      errorMessage: null,
    });

    try {
      const response = await fetch(getReleasesApiUrl(), {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "bukowskiOS Desktop",
        },
      });

      if (!response.ok) {
        throw new Error(`GitHub respondió ${response.status}.`);
      }

      const releases = (await response.json()) as GithubRelease[];
      return applyCandidateStatus(selectMajorReleaseCandidate(releases, currentVersion, process.arch, getReleasesPageUrl()));
    } catch (error) {
      logger.warn("App update check failed.", { error: String(error) });
      const checkedAt = new Date().toISOString();
      patchStatus({
        state: status.available ? status.state : "failed",
        checkedAt,
        statusLabel: status.available ? status.statusLabel : "No se pudo revisar updates",
        errorMessage: error instanceof Error ? error.message : "No se pudo revisar updates.",
      });
      return status;
    }
  };

  const getDownloadedPath = () => {
    if (!status.downloadedPath) {
      throw new Error("No hay un instalador descargado todavía.");
    }
    const downloadsRoot = getDownloadsRoot();
    const safePath = assertPathWithinRoot(status.downloadedPath, downloadsRoot);
    if (!fs.existsSync(safePath)) {
      throw new Error("El instalador descargado ya no existe en Downloads.");
    }
    return safePath;
  };

  const downloadUpdate = async () => {
    if (currentDownloadPromise) {
      return currentDownloadPromise;
    }

    currentDownloadPromise = (async () => {
      if (!status.available || !status.assetName || !cachedDownloadUrl) {
        await checkForUpdate({ force: true });
      }
      if (!status.available || !status.assetName || !cachedDownloadUrl) {
        throw new Error("No hay un update descargable disponible ahora mismo.");
      }

      const downloadsRoot = getDownloadsRoot();
      fs.mkdirSync(downloadsRoot, { recursive: true });
      const finalPath = assertPathWithinRoot(path.join(downloadsRoot, path.basename(status.assetName)), downloadsRoot);
      const tempPath = assertPathWithinRoot(`${finalPath}.download`, downloadsRoot);

      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }

      patchStatus({
        state: "downloading",
        statusLabel: "Conectando con GitHub",
        progressPercent: 0,
        bytesReceived: 0,
        bytesTotal: status.assetSizeBytes,
        errorMessage: null,
      });

      try {
        const response = await fetch(cachedDownloadUrl, {
          headers: {
            Accept: "application/octet-stream",
            "User-Agent": "bukowskiOS Desktop",
          },
          redirect: "follow",
        });

        if (!response.ok || !response.body) {
          throw new Error(`No se pudo descargar el instalador (${response.status}).`);
        }

        const totalBytes = Number.parseInt(response.headers.get("content-length") ?? "", 10);
        const bytesTotal = Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : status.assetSizeBytes;
        const writer = fs.createWriteStream(tempPath);
        const reader = response.body.getReader();
        let bytesReceived = 0;

        patchStatus({
          statusLabel: "Descargando instalador",
          bytesTotal,
        });

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          if (!value) {
            continue;
          }

          writer.write(Buffer.from(value));
          bytesReceived += value.byteLength;
          patchStatus({
            statusLabel: "Descargando instalador",
            bytesReceived,
            bytesTotal,
            progressPercent: summarizeDownloadProgress(bytesReceived, bytesTotal),
          });
        }

        await new Promise<void>((resolve, reject) => {
          writer.once("finish", () => resolve());
          writer.once("error", reject);
          writer.end();
        });

        patchStatus({
          statusLabel: "Verificando descarga",
          progressPercent: 100,
          bytesReceived: bytesTotal ?? bytesReceived,
          bytesTotal,
        });

        if (fs.existsSync(finalPath)) {
          fs.unlinkSync(finalPath);
        }
        fs.renameSync(tempPath, finalPath);

        const nextStatus: AppUpdateStatus = {
          ...status,
          state: "downloaded",
          statusLabel: "Descarga completada",
          progressPercent: 100,
          downloadedPath: finalPath,
          bytesReceived: bytesTotal ?? bytesReceived,
          bytesTotal,
          errorMessage: null,
        };
        setStatus(nextStatus);
        return {
          summary: `Instalador descargado en ${path.basename(finalPath)}.`,
          status: nextStatus,
        } satisfies AppUpdateActionResult;
      } catch (error) {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
        logger.warn("App update download failed.", { error: String(error) });
        const message = error instanceof Error ? error.message : "La descarga del update falló.";
        patchStatus({
          state: "failed",
          statusLabel: "La descarga falló",
          errorMessage: message,
          progressPercent: null,
          bytesReceived: 0,
        });
        throw error;
      } finally {
        currentDownloadPromise = null;
      }
    })();

    return currentDownloadPromise;
  };

  const openDownloadedUpdate = async () => {
    const filePath = getDownloadedPath();
    const openResult = await shell.openPath(filePath);
    if (openResult) {
      throw new Error(openResult);
    }
    return {
      summary: `Instalador abierto: ${path.basename(filePath)}.`,
      status: getStatus(),
    } satisfies AppUpdateActionResult;
  };

  const revealDownloadedUpdate = async () => {
    const filePath = getDownloadedPath();
    shell.showItemInFolder(filePath);
    return {
      summary: `Instalador mostrado en Downloads: ${path.basename(filePath)}.`,
      status: getStatus(),
    } satisfies AppUpdateActionResult;
  };

  return {
    getStatus,
    checkForUpdate,
    downloadUpdate,
    openDownloadedUpdate,
    revealDownloadedUpdate,
  };
};
