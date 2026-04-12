import { app, BrowserWindow, Menu, session } from "electron";
import path from "node:path";

import { buildContentSecurityPolicy } from "./security/securityConfig";
import { registerAppIpc } from "./ipc/registerAppIpc";
import { registerFoundationIpc } from "./ipc/registerFoundationIpc";
import { buildAppMenu } from "./menus/buildAppMenu";
import { getDesktopEnvironment } from "./services/appEnvironment";
import { initializeLocalDatabase } from "./services/data/localDatabase";
import { createMainWindow } from "./windows/createMainWindow";

const { devServerUrl, preloadPath, rendererDist } = getDesktopEnvironment(import.meta.url);
const isE2E = process.env.BUKOWSKI_E2E === "1";

const createAppWindow = () =>
  createMainWindow({
    devServerUrl,
    preloadPath,
    rendererDist,
  });

const attachWindowRuntimeTelemetry = (
  window: BrowserWindow,
  runtimeDiagnostics: ReturnType<typeof initializeLocalDatabase>["runtimeDiagnostics"],
) => {
  window.webContents.on("render-process-gone", (_event, details) => {
    runtimeDiagnostics.recordRuntimeError({
      sourceKind: "webcontents",
      processLabel: "Renderer host",
      errorName: "render-process-gone",
      message: details.reason,
      severity: "critical",
      context: {
        exitCode: details.exitCode,
      },
    });
  });

  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) {
      return;
    }

    runtimeDiagnostics.recordRuntimeError({
      sourceKind: "webcontents",
      processLabel: "Renderer host",
      errorName: "did-fail-load",
      message: errorDescription,
      severity: "medium",
      context: {
        errorCode,
        validatedURL,
      },
    });
  });
};

const attachProcessRuntimeTelemetry = (
  runtimeDiagnostics: ReturnType<typeof initializeLocalDatabase>["runtimeDiagnostics"],
) => {
  process.on("uncaughtException", (error) => {
    runtimeDiagnostics.recordRuntimeError({
      sourceKind: "main",
      processLabel: "Electron main",
      errorName: error.name || "uncaughtException",
      message: error.message || "Unhandled main process exception.",
      stack: error.stack ?? null,
      severity: "critical",
    });
  });

  process.on("unhandledRejection", (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    runtimeDiagnostics.recordRuntimeError({
      sourceKind: "main",
      processLabel: "Electron main",
      errorName: error.name || "unhandledRejection",
      message: error.message || "Unhandled main process rejection.",
      stack: error.stack ?? null,
      severity: "critical",
    });
  });
};

app.setName("bukowskiOS");
app.setPath("userData", path.join(app.getPath("appData"), "@bukowski/desktop"));

if (!isE2E) {
  const hasSingleInstanceLock = app.requestSingleInstanceLock();

  if (!hasSingleInstanceLock) {
    app.quit();
  }

  app.on("second-instance", () => {
    const existingWindow = BrowserWindow.getAllWindows()[0];

    if (!existingWindow) {
      return;
    }

    if (existingWindow.isMinimized()) {
      existingWindow.restore();
    }

    existingWindow.focus();
  });
}

app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      cancel: false,
      responseHeaders: {
        ...(details.responseHeaders ?? {}),
        "Content-Security-Policy": [buildContentSecurityPolicy(devServerUrl)],
      },
    });
  });

  const localDatabase = initializeLocalDatabase();
  attachProcessRuntimeTelemetry(localDatabase.runtimeDiagnostics);

  registerAppIpc({
    database: localDatabase.database,
    getDiagnosticsSnapshot: localDatabase.getDiagnosticsSnapshot,
    createBackupNow: localDatabase.createBackupNow,
    runIntegrityCheckNow: localDatabase.runIntegrityCheckNow,
    runLocalSyncNow: localDatabase.runLocalSyncNow,
    getSyncOutboxRows: localDatabase.getSyncOutboxRows,
    retrySyncOutboxRow: localDatabase.retrySyncOutboxRow,
    retryAllFailedSyncOutboxRows: localDatabase.retryAllFailedSyncOutboxRows,
  });
  registerFoundationIpc({
    foundationReads: localDatabase.foundationReads,
    agentReads: localDatabase.agentReads,
    projectMutations: localDatabase.projectMutations,
    catalogMutations: localDatabase.catalogMutations,
    assetMutations: localDatabase.assetMutations,
    incidentMutations: localDatabase.incidentMutations,
    financeMutations: localDatabase.financeMutations,
    packingMutations: localDatabase.packingMutations,
    rmaMutations: localDatabase.rmaMutations,
    agentMutations: localDatabase.agentMutations,
    runtimeDiagnostics: localDatabase.runtimeDiagnostics,
  });
  Menu.setApplicationMenu(buildAppMenu());
  attachWindowRuntimeTelemetry(createAppWindow(), localDatabase.runtimeDiagnostics);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      attachWindowRuntimeTelemetry(createAppWindow(), localDatabase.runtimeDiagnostics);
    }
  });
});

if (!app.isPackaged) {
  process.on("message", (message) => {
    if (message !== "electron-vite&type=hot-reload") {
      return;
    }

    console.info("[dev] Electron preload reload");
    BrowserWindow.getAllWindows().forEach((window) => {
      window.webContents.reload();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
