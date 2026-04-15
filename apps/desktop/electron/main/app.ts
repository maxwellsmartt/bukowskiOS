import { app, BrowserWindow, Menu, session } from "electron";
import path from "node:path";
import { format } from "date-fns";
import { ipcChannels, type CreateProjectBlueprintInput } from "@contracts";

import { buildContentSecurityPolicy } from "./security/securityConfig";
import { registerAuthIpc } from "./ipc/registerAuthIpc";
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
const authProtocol = "bukowskios";
const pendingDeepLinks: string[] = [];

const createAppWindow = () =>
  createMainWindow({
    devServerUrl,
    preloadPath,
    rendererDist,
  });

const isBukowskiDeepLink = (value: string | undefined) => {
  if (!value) {
    return false;
  }

  try {
    return new URL(value).protocol === `${authProtocol}:`;
  } catch {
    return false;
  }
};

const sendAuthDeepLinkToRenderer = (url: string) => {
  const targetWindow = BrowserWindow.getAllWindows()[0] ?? null;

  if (!targetWindow || targetWindow.isDestroyed() || targetWindow.webContents.isLoading()) {
    pendingDeepLinks.push(url);
    return;
  }

  targetWindow.webContents.send(ipcChannels.shell.appAction, {
    type: "auth-deep-link",
    url,
  });
};

const flushPendingDeepLinks = () => {
  const queuedLinks = pendingDeepLinks.splice(0);
  queuedLinks.forEach((url) => sendAuthDeepLinkToRenderer(url));
};

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
  app.setAsDefaultProtocolClient(authProtocol);
}

if (!isE2E) {
  const hasSingleInstanceLock = app.requestSingleInstanceLock();

  if (!hasSingleInstanceLock) {
    app.quit();
  }

  app.on("second-instance", (_event, argv) => {
    const existingWindow = BrowserWindow.getAllWindows()[0];

    if (!existingWindow) {
      return;
    }

    if (existingWindow.isMinimized()) {
      existingWindow.restore();
    }

    existingWindow.focus();

    const deepLink = argv.find(isBukowskiDeepLink);
    if (deepLink) {
      sendAuthDeepLinkToRenderer(deepLink);
    }
  });
}

app.on("open-url", (event, url) => {
  event.preventDefault();

  if (isBukowskiDeepLink(url)) {
    sendAuthDeepLinkToRenderer(url);
  }
});

app.whenReady().then(() => {
  initializeDesktopLogger();
  logger.info("Electron main ready.");
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      cancel: false,
      responseHeaders: {
        ...(details.responseHeaders ?? {}),
        "Content-Security-Policy": [
          buildContentSecurityPolicy(devServerUrl, [process.env.VITE_SUPABASE_URL, process.env.SUPABASE_URL]),
        ],
      },
    });
  });

  const localDatabase = initializeLocalDatabase();
  const documentGeneration = createDocumentGenerationService();
  attachProcessRuntimeTelemetry(localDatabase.runtimeDiagnostics);

  registerAuthIpc();
  registerAppIpc({
    database: localDatabase.database,
    getDiagnosticsSnapshot: localDatabase.getDiagnosticsSnapshot,
    getSupportSnapshot: localDatabase.getSupportSnapshot,
    getUsersSnapshot: () => localDatabase.userAdmin.getSnapshot(),
    createUser: (input) => localDatabase.userAdmin.createUser(input),
    updateUser: (input) => localDatabase.userAdmin.updateUser(input),
    setUserActive: (input) => localDatabase.userAdmin.setUserActive(input),
    revokeTelegramLink: (input) => localDatabase.userAdmin.revokeTelegramLink(input),
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
          serialNumber: item.serialNumber,
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
      const departmentNameById = new Map(catalog.departments.map((row) => [row.id, row.name] as const));
      const summarizeUnitDepartments = (unit: CreateProjectBlueprintInput["mainUnit"] | CreateProjectBlueprintInput["additionalUnits"][number]) =>
        (unit.departmentIds ?? []).map((departmentId) => departmentNameById.get(departmentId) ?? departmentId);
      const summarizeBucketAssets = (
        unit: CreateProjectBlueprintInput["mainUnit"] | CreateProjectBlueprintInput["additionalUnits"][number],
      ) => [...new Set((unit.unitDepartments ?? []).flatMap((bucket) => bucket.assetIds))];
      const summarizeBucketCrew = (
        unit: CreateProjectBlueprintInput["mainUnit"] | CreateProjectBlueprintInput["additionalUnits"][number],
      ) =>
        (unit.unitDepartments ?? []).flatMap((bucket) =>
          bucket.crewAssignments.filter((assignment) => assignment.crewMemberId?.trim()),
        );
      const packingSourceLabels = [
        ...(input.mainUnit.unitDepartments ?? []).map((bucket) =>
          bucket.packingSeed?.mode && bucket.packingSeed.mode !== "none"
            ? `${departmentNameById.get(bucket.departmentId) ?? bucket.departmentId} · ${
                bucket.packingSeed.mode === "existing" ? `Staging slip ${bucket.packingSeed.packingSlipId}` : "Draft packing seed"
              }`
            : null,
        ),
        ...input.additionalUnits.flatMap((unit) =>
          (unit.unitDepartments ?? []).map((bucket) =>
            bucket.packingSeed?.mode && bucket.packingSeed.mode !== "none"
              ? `${unit.name.trim() || "Additional Unit"} / ${departmentNameById.get(bucket.departmentId) ?? bucket.departmentId} · ${
                  bucket.packingSeed.mode === "existing" ? `Staging slip ${bucket.packingSeed.packingSlipId}` : "Draft packing seed"
                }`
              : null,
          ),
        ),
      ].filter((value): value is string => Boolean(value));
      const additionalUnits = input.additionalUnits.map((unit) => ({
        name: unit.name.trim() || unit.suggestedPreset?.trim() || "Additional Unit",
        dateLabel:
          unit.windows.length
            ? unit.windows
                .map((window) => `${window.startDate ?? "Open"} - ${window.endDate ?? "Open"}`)
                .slice(0, 3)
                .join(", ")
            : "No dates selected",
        assetCount: summarizeBucketAssets(unit).length,
        crewCount: summarizeBucketCrew(unit).length,
        assetNames: summarizeBucketAssets(unit).map((assetId) => assetNameById.get(assetId) ?? assetId),
        crewNames: summarizeBucketCrew(unit).map((assignment) => crewNameById.get(assignment.crewMemberId) ?? assignment.crewMemberId),
      }));
      const pdf = await documentGeneration.createProjectSetupPdf({
        projectCode: input.generalInfo.code?.trim().toUpperCase() || "Auto-generated",
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
        packingSourceLabel: packingSourceLabels.length ? packingSourceLabels.join(" · ") : "No packing configured yet",
        totals: {
          assetCount: summarizeBucketAssets(input.mainUnit).length,
          crewCount: summarizeBucketCrew(input.mainUnit).length,
          additionalUnitCount: input.additionalUnits.length,
        },
        mainUnit: {
          assetNames: summarizeBucketAssets(input.mainUnit).map((assetId) => assetNameById.get(assetId) ?? assetId),
          crewNames: summarizeBucketCrew(input.mainUnit).map((assignment) => crewNameById.get(assignment.crewMemberId) ?? assignment.crewMemberId),
        },
        additionalUnits,
        conflictGroups: conflicts.groups.map((group) => ({
          title: group.label,
          items: group.items.map((item) => ({
            resourceLabel: item.resourceLabel,
            conflictingProject: item.conflictingProject,
            conflictingUnit:
              item.conflictingUnit && item.conflictingDepartment
                ? `${item.conflictingUnit} / ${item.conflictingDepartment}`
                : item.conflictingUnit ?? item.conflictingDepartment,
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
  const mainWindow = createAppWindow();
  attachWindowRuntimeTelemetry(mainWindow, localDatabase.runtimeDiagnostics);
  mainWindow.webContents.once("did-finish-load", flushPendingDeepLinks);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const activatedWindow = createAppWindow();
      attachWindowRuntimeTelemetry(activatedWindow, localDatabase.runtimeDiagnostics);
      activatedWindow.webContents.once("did-finish-load", flushPendingDeepLinks);
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
