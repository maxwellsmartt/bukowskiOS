import { app, BrowserWindow, Menu, session } from "electron";
import path from "node:path";
import { format } from "date-fns";
import type { CreateProjectBlueprintInput } from "@contracts";

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
    exportFinanceReportPdf: async (query, targetFilePath) => {
      const overview = localDatabase.foundationReads.getFinanceOverview(query);
      const pdf = await documentGeneration.createFinanceReportPdf({
        reportTitle: "Finance operating report",
        periodLabel: overview.activePeriodLabel,
        generatedAt: `Generated ${format(new Date(), "yyyy-MM-dd HH:mm")}`,
        workspaceLabel: "Internal alpha",
        executiveSummary: `${overview.totals.trackedSpend} tracked spend, ${overview.totals.incidentExposure} incident exposure, and ${overview.totals.reserve} reserve coverage in ${overview.activePeriodLabel.toLowerCase()}.`,
        metrics: overview.metrics.map((metric) => ({
          label: metric.label,
          value: metric.value,
        })),
        totals: [
          { label: "Tracked spend", value: overview.totals.trackedSpend, tone: "info" },
          { label: "Incident exposure", value: overview.totals.incidentExposure, tone: "critical" },
          { label: "Reserve coverage", value: overview.totals.reserve, tone: "warning" },
          { label: "Average burn rate", value: overview.totals.burnRateAverage, tone: "neutral" },
        ],
        exposureByProject: overview.exposureByProject,
        categoryBreakdown: overview.categoryBreakdown,
        pendingCostLinks: overview.costLinks.map((row) => ({
          incident: row.incident,
          project: row.project,
          severity: row.severity,
          costEstimate: row.costEstimate,
          financialStatus: row.financialStatus,
        })),
      });

      return {
        ...pdf,
        targetFilePath,
      };
    },
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
    exportProjectBlueprintPdf: async (input: CreateProjectBlueprintInput, targetFilePath: string) => {
      const catalog = localDatabase.foundationReads.getCatalogSnapshot();
      const assets = localDatabase.foundationReads.getAssets({
        search: "",
        sortBy: "name",
        sortDirection: "asc",
      });
      const assetNameById = new Map(assets.map((row) => [row.id, `${row.code} · ${row.name}`] as const));
      const crewNameById = new Map(catalog.crewMembers.map((row) => [row.id, row.fullName] as const));
      const clientName =
        catalog.clients.find((row) => row.id === input.generalInfo.clientId)?.name ??
        input.generalInfo.clientName?.trim() ??
        "No client linked";
      const productionCompanyName =
        catalog.productionCompanies.find((row) => row.id === input.generalInfo.productionCompanyId)?.name ??
        input.generalInfo.productionCompanyName?.trim() ??
        "No production company linked";
      const conflicts = localDatabase.foundationReads.getProjectCreationConflicts(input);
      const additionalUnits = input.additionalUnits.map((unit) => ({
        name: unit.name.trim() || unit.suggestedPreset?.trim() || "Additional Unit",
        dateLabel:
          unit.startDate || unit.endDate ? `${unit.startDate ?? "Open"} - ${unit.endDate ?? "Open"}` : "No dates selected",
        assetCount: unit.assetIds.length,
        crewCount: unit.crewAssignments.length,
        assetNames: unit.assetIds.map((assetId) => assetNameById.get(assetId) ?? assetId),
        crewNames: unit.crewAssignments.map((assignment) => crewNameById.get(assignment.crewMemberId) ?? assignment.crewMemberId),
      }));
      const packingSourceLabel =
        input.packingSelection.mode === "existing"
          ? `Staging slip ${input.packingSelection.packingSlipId}`
          : input.packingSelection.mode === "draft"
            ? "Draft staging slip"
            : "No packing source";
      const pdf = await documentGeneration.createProjectSetupPdf({
        projectCode: input.generalInfo.code.trim().toUpperCase(),
        projectName: input.generalInfo.name.trim(),
        status: input.generalInfo.status?.trim() || "Prep",
        windowLabel:
          input.generalInfo.startDate || input.generalInfo.endDate
            ? `${input.generalInfo.startDate ?? "Open"} - ${input.generalInfo.endDate ?? "Open"}`
            : "No project window selected",
        preproductionLabel:
          input.generalInfo.hasPreproduction && (input.generalInfo.preproductionStartDate || input.generalInfo.preproductionEndDate)
            ? `${input.generalInfo.preproductionStartDate ?? "Open"} - ${input.generalInfo.preproductionEndDate ?? "Open"}`
            : null,
        clientName,
        productionCompanyName,
        description: input.generalInfo.description?.trim() ?? "",
        packingSourceLabel,
        totals: {
          assetCount: input.mainUnit.assetIds.length,
          crewCount: input.mainUnit.crewAssignments.length,
          additionalUnitCount: input.additionalUnits.length,
        },
        mainUnit: {
          assetNames: input.mainUnit.assetIds.map((assetId) => assetNameById.get(assetId) ?? assetId),
          crewNames: input.mainUnit.crewAssignments.map((assignment) => crewNameById.get(assignment.crewMemberId) ?? assignment.crewMemberId),
        },
        additionalUnits,
        conflictGroups: conflicts.groups.map((group) => ({
          title: group.label,
          items: group.items.map((item) => ({
            resourceLabel: item.resourceLabel,
            conflictingProject: item.conflictingProject,
            conflictingUnit: item.conflictingUnit,
            overlapLabel: `${item.overlapStart} - ${item.overlapEnd}`,
          })),
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
