import { app, BrowserWindow, Menu, session } from "electron";
import path from "node:path";

import { buildContentSecurityPolicy } from "./security/securityConfig";
import { registerAppIpc } from "./ipc/registerAppIpc";
import { registerFoundationIpc } from "./ipc/registerFoundationIpc";
import { buildAppMenu } from "./menus/buildAppMenu";
import { getDesktopEnvironment } from "./services/appEnvironment";
import { createDocumentGenerationService } from "./services/data/documentGenerationService";
import { initializeLocalDatabase } from "./services/data/localDatabase";
import { getDesktopLogger, initializeDesktopLogger } from "./services/logger";
import { createMainWindow } from "./windows/createMainWindow";

const { devServerUrl, preloadPath, rendererDist } = getDesktopEnvironment(import.meta.url);
const isE2E = process.env.BUKOWSKI_E2E === "1";
const logger = getDesktopLogger("app");

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
    logger.error("Main process uncaught exception.", error);
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
    logger.error("Main process unhandled rejection.", error);
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
  initializeDesktopLogger();
  logger.info("Electron main ready.");
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
  const documentGeneration = createDocumentGenerationService();
  attachProcessRuntimeTelemetry(localDatabase.runtimeDiagnostics);

  registerAppIpc({
    database: localDatabase.database,
    getDiagnosticsSnapshot: localDatabase.getDiagnosticsSnapshot,
    getSupportSnapshot: localDatabase.getSupportSnapshot,
    createBackupNow: localDatabase.createBackupNow,
    runIntegrityCheckNow: localDatabase.runIntegrityCheckNow,
    runLocalSyncNow: localDatabase.runLocalSyncNow,
    getSyncOutboxRows: localDatabase.getSyncOutboxRows,
    retrySyncOutboxRow: localDatabase.retrySyncOutboxRow,
    retryAllFailedSyncOutboxRows: localDatabase.retryAllFailedSyncOutboxRows,
    exportRecentLogs: localDatabase.exportRecentLogs,
    exportSupportBundle: localDatabase.exportSupportBundle,
  });
  registerFoundationIpc({
    foundationReads: localDatabase.foundationReads,
    agentReads: localDatabase.agentReads,
    projectMutations: localDatabase.projectMutations,
    catalogMutations: localDatabase.catalogMutations,
    assetMutations: localDatabase.assetMutations,
    fileUploads: localDatabase.fileUploads,
    incidentMutations: localDatabase.incidentMutations,
    financeMutations: localDatabase.financeMutations,
    packingMutations: localDatabase.packingMutations,
    exportPackingSlipPdf: async (packingSlipId, targetFilePath) => {
      const detail = localDatabase.foundationReads.getPackingSlipDetail(packingSlipId);
      if (!detail.slip) {
        throw new Error("Packing slip was not found.");
      }

      const pdf = await documentGeneration.createPackingSlipPdf({
        slipNumber: detail.slip.number,
        projectName: detail.slip.project,
        departmentName: detail.slip.department,
        responsibleName: detail.slip.responsible,
        preparedByName: detail.slip.preparedBy,
        issueDate: detail.slip.issueDate,
        dueDate: detail.slip.dueDate,
        status: detail.slip.status,
        notes: detail.slip.notes ?? "",
        primaryCodeValue: detail.slip.primaryCodeValue,
        summary: {
          itemCount: detail.slip.itemCount,
          returnedCount: detail.slip.returnedCount,
          pendingCount: detail.slip.pendingCount,
        },
        items: detail.items.map((item) => ({
          code: item.code,
          name: item.asset,
          quantity: item.quantity,
          conditionOut: item.conditionOut,
          conditionIn: item.conditionIn,
          location: item.location,
          responsible: item.responsible,
          status: item.status,
        })),
      });

      return {
        ...pdf,
        targetFilePath,
      };
    },
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
    logger.info("Electron preload reload.");
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
