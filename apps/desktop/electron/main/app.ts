import { app, BrowserWindow, Menu, session } from "electron";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { format } from "date-fns";
import { ipcChannels, type CreateProjectBlueprintInput } from "@contracts";

import { buildContentSecurityPolicy } from "./security/securityConfig";
import { registerAuthIpc } from "./ipc/registerAuthIpc";
import { registerAppIpc } from "./ipc/registerAppIpc";
import { registerFoundationIpc } from "./ipc/registerFoundationIpc";
import { registerNotificationIpc } from "./ipc/registerNotificationIpc";
import { buildAppMenu } from "./menus/buildAppMenu";
import { getDesktopEnvironment } from "./services/appEnvironment";
import { createDocumentGenerationService } from "./services/data/documentGenerationService";
import { initializeLocalDatabase } from "./services/data/localDatabase";
import { getDesktopLogger, initializeDesktopLogger } from "./services/logger";
import { attachNativeNotificationWindowState, setNativeNotificationDockBadge } from "./services/notifications/nativeNotifier";
import { createMainWindow, loadMainWindowContent } from "./windows/createMainWindow";

const { devServerUrl, preloadPath, rendererDist } = getDesktopEnvironment(import.meta.url);
const isE2E = process.env.BUKOWSKI_E2E === "1";
const logger = getDesktopLogger("app");
const authProtocol = "bukowskios";
const pendingDeepLinks: string[] = [];
const devAuthCallbackHost = "127.0.0.1";
const devAuthCallbackPort = 17654;
let devAuthCallbackServer: Server | null = null;
let devAuthCallbackUrl: string | null = null;

const createAppWindow = () =>
  createMainWindow({
    devServerUrl,
    preloadPath,
    rendererDist,
  });

const createStartupWindow = () =>
  createMainWindow({
    devServerUrl,
    preloadPath,
    rendererDist,
    deferAppLoad: true,
    showImmediately: true,
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

const focusExistingWindow = () => {
  const existingWindow = BrowserWindow.getAllWindows()[0];

  if (!existingWindow || existingWindow.isDestroyed()) {
    return;
  }

  if (existingWindow.isMinimized()) {
    existingWindow.restore();
  }

  existingWindow.show();
  existingWindow.focus();
};

const createDevAuthCallbackHtml = () => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>bukowskiOS sign in</title>
    <style>
      :root { color-scheme: dark; }
      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
        background: #050607;
        color: #f4f7fb;
        font: 14px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
      }
      main {
        width: min(420px, calc(100vw - 48px));
        padding: 24px;
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 18px;
        background: rgba(18,20,24,0.86);
        box-shadow: 0 24px 70px rgba(0,0,0,0.38);
      }
      h1 { margin: 0 0 8px; font-size: 18px; }
      p { margin: 0; color: rgba(244,247,251,0.68); line-height: 1.5; }
    </style>
  </head>
  <body>
    <main>
      <h1>Returning to bukowskiOS</h1>
      <p>The desktop app is processing your secure sign-in callback. You can close this browser tab.</p>
    </main>
  </body>
</html>`;

const startDevAuthCallbackServer = () => {
  if (!devServerUrl) {
    return null;
  }

  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", `http://${devAuthCallbackHost}:${devAuthCallbackPort}`);

    if (request.method !== "GET" || requestUrl.pathname !== "/auth/callback") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    const forwardedUrl = `${authProtocol}://auth/callback${requestUrl.search}`;
    sendAuthDeepLinkToRenderer(forwardedUrl);
    focusExistingWindow();

    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(createDevAuthCallbackHtml());
  });

  server.on("error", (error) => {
    logger.warn("Dev OAuth callback server could not start; falling back to custom protocol.", error);
    devAuthCallbackUrl = null;
  });

  server.listen(devAuthCallbackPort, devAuthCallbackHost, () => {
    devAuthCallbackUrl = `http://${devAuthCallbackHost}:${devAuthCallbackPort}/auth/callback`;
    logger.info(`Dev OAuth callback server listening on ${devAuthCallbackUrl}.`);
  });

  devAuthCallbackServer = server;
  return server;
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
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(authProtocol, process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient(authProtocol);
  }
}

if (!isE2E) {
  const hasSingleInstanceLock = app.requestSingleInstanceLock();

  if (!hasSingleInstanceLock) {
    app.quit();
  }

  app.on("second-instance", (_event, argv) => {
    focusExistingWindow();

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

const initialDeepLink = process.argv.find(isBukowskiDeepLink);
if (initialDeepLink) {
  pendingDeepLinks.push(initialDeepLink);
}

app.whenReady().then(() => {
  initializeDesktopLogger();
  logger.info("Electron main ready.");
  startDevAuthCallbackServer();
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    if (permission !== "media") {
      callback(false);
      return;
    }

    const mediaTypes = (details as { mediaTypes?: string[] } | undefined)?.mediaTypes ?? [];
    callback(!mediaTypes.length || mediaTypes.includes("audio"));
  });
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

  Menu.setApplicationMenu(buildAppMenu());
  const mainWindow = createStartupWindow();
  logger.info("Startup window created before local database initialization.");

  let localDatabase: ReturnType<typeof initializeLocalDatabase>;
  try {
    localDatabase = initializeLocalDatabase();
    logger.info("Local database initialized; loading renderer.");
  } catch (error) {
    logger.error("Local database initialization failed before renderer load.", error);
    throw error;
  }
  const documentGeneration = createDocumentGenerationService();
  attachProcessRuntimeTelemetry(localDatabase.runtimeDiagnostics);
  attachWindowRuntimeTelemetry(mainWindow, localDatabase.runtimeDiagnostics);
  attachNativeNotificationWindowState(mainWindow);

  registerAuthIpc({
    getOAuthRedirectUrl: () => devAuthCallbackUrl ?? "bukowskios://auth/callback",
  });
  registerNotificationIpc();
  registerAppIpc({
    database: localDatabase.database,
    getDiagnosticsSnapshot: localDatabase.getDiagnosticsSnapshot,
    getSupportSnapshot: localDatabase.getSupportSnapshot,
    getUsersSnapshot: (query) => localDatabase.userAdmin.getSnapshot(query),
    createUser: (input) => localDatabase.userAdmin.createUser(input),
    updateUser: (input) => localDatabase.userAdmin.updateUser(input),
    setUserActive: (input) => localDatabase.userAdmin.setUserActive(input),
    revokeTelegramLink: (input) => localDatabase.userAdmin.revokeTelegramLink(input),
    deleteUser: (input) => localDatabase.userAdmin.deleteUser(input),
    createBackupNow: localDatabase.createBackupNow,
    runIntegrityCheckNow: localDatabase.runIntegrityCheckNow,
    ensureLocalWorkspaces: localDatabase.ensureLocalWorkspaces,
    getLocalWorkspaces: localDatabase.getLocalWorkspaces,
    runLocalSyncNow: localDatabase.runLocalSyncNow,
    getSyncOutboxRows: localDatabase.getSyncOutboxRows,
    getSyncPullCursors: localDatabase.getSyncPullCursors,
    retrySyncOutboxRow: localDatabase.retrySyncOutboxRow,
    retryAllFailedSyncOutboxRows: localDatabase.retryAllFailedSyncOutboxRows,
    backfillOperationalSnapshots: localDatabase.backfillOperationalSnapshots,
    exportRecentLogs: localDatabase.exportRecentLogs,
    exportSupportBundle: localDatabase.exportSupportBundle,
    applyRemoteCatalogRows: localDatabase.applyRemoteCatalogRows,
    applyRemoteExchangeRates: localDatabase.applyRemoteExchangeRates,
    applyRemoteAssetSnapshots: localDatabase.applyRemoteAssetSnapshots,
    applyRemoteOperationalSnapshots: localDatabase.applyRemoteOperationalSnapshots,
  });
  registerFoundationIpc({
    foundationReads: localDatabase.foundationReads,
    agentReads: localDatabase.agentReads,
    projectMutations: localDatabase.projectMutations,
    catalogMutations: localDatabase.catalogMutations,
    assetMutations: localDatabase.assetMutations,
    workspaceAccess: localDatabase.workspaceAccess,
    fileUploads: localDatabase.fileUploads,
    incidentMutations: localDatabase.incidentMutations,
    financeMutations: localDatabase.financeMutations,
    currencyMutations: localDatabase.currencyMutations,
    currencyReads: localDatabase.currencyReads,
    currencyRateProviders: localDatabase.currencyRateProviders,
    quoteMutations: localDatabase.quoteMutations,
    quoteReads: localDatabase.quoteReads,
    invoiceMutations: localDatabase.invoiceMutations,
    invoiceReads: localDatabase.invoiceReads,
    exportQuotePdf: async (workspaceId: string, quoteId: string) => {
      const detail = localDatabase.quoteReads.getQuoteDetail(workspaceId, quoteId);
      if (!detail) {
        throw new Error("Quote not found.");
      }
      const settings = localDatabase.currencyReads.getSettings(workspaceId);
      const { buildQuotePdfPayload } = await import("./services/data/quotePdfPayloadBuilder");

      // Best-effort fetch of branding assets. Failures fall back to the text
      // logo / blank seal/firma — the PDF is still valid and printable.
      const fetchOptional = async (url: string | null): Promise<Buffer | null> => {
        if (!url) return null;
        try {
          const response = await fetch(url);
          if (!response.ok) return null;
          const arrayBuffer = await response.arrayBuffer();
          return Buffer.from(arrayBuffer);
        } catch {
          return null;
        }
      };

      const [logoBuffer, sealBuffer, signatureBuffer] = await Promise.all([
        fetchOptional(settings.workspaceLogoUrl),
        fetchOptional(settings.workspaceSealUrl),
        fetchOptional(settings.workspaceSignatureUrl),
      ]);

      const payload = buildQuotePdfPayload({
        quote: detail,
        currencySettings: settings,
        logoBuffer,
        sealBuffer,
        signatureBuffer,
      });
      return documentGeneration.createQuotePdf(payload);
    },
    packingMutations: localDatabase.packingMutations,
    assistantAudioTranscription: localDatabase.assistantAudioTranscription,
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
        projectCode: detail.slip.projectCode,
        projectName: detail.slip.project,
        departmentCode: detail.slip.departmentCode,
        departmentName: detail.slip.department,
        responsibleName: detail.slip.responsible,
        preparedByName: detail.slip.preparedBy,
        issueDate: detail.slip.issueDate,
        issueDateCompact: detail.slip.issueDateCompact,
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
    exportPackingSlipInsurancePdf: async (packingSlipId, targetFilePath) => {
      const detail = localDatabase.foundationReads.getPackingSlipDetail(packingSlipId);
      if (!detail.slip) {
        throw new Error("Packing slip was not found.");
      }

      const pdf = await documentGeneration.createPackingSlipInsurancePdf({
        slipNumber: detail.slip.number,
        projectCode: detail.slip.projectCode,
        projectName: detail.slip.project,
        departmentCode: detail.slip.departmentCode,
        departmentName: detail.slip.department,
        responsibleName: detail.slip.responsible,
        preparedByName: detail.slip.preparedBy,
        issueDate: detail.slip.issueDate,
        issueDateCompact: detail.slip.issueDateCompact,
        dueDate: detail.slip.dueDate,
        status: detail.slip.status,
        notes: detail.slip.notes ?? "",
        primaryCodeValue: detail.slip.primaryCodeValue,
        summary: {
          itemCount: detail.slip.itemCount,
          returnedCount: detail.slip.returnedCount,
          pendingCount: detail.slip.pendingCount,
          insuredTotal: detail.slip.insuredTotal,
        },
        items: detail.items.map((item) => ({
          code: item.code,
          name: item.asset,
          serialNumber: item.serialNumber,
          quantity: item.quantity,
          purchasePriceAmount: item.purchasePriceAmount,
          additionalCostsAmount: item.additionalCostsAmount,
          unitInsuredValueAmount: item.unitInsuredValueAmount,
          insuredTotalAmount: item.insuredTotalAmount,
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
      const catalog = localDatabase.foundationReads.getCatalogSnapshot({ workspaceId: input.workspaceId });
      const assets = localDatabase.foundationReads.getAssets({
        workspaceId: input.workspaceId,
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
  void loadMainWindowContent(mainWindow, devServerUrl, rendererDist);
  mainWindow.webContents.once("did-finish-load", flushPendingDeepLinks);

  app.on("activate", () => {
    const existingWindow = BrowserWindow.getAllWindows()[0];
    if (existingWindow) {
      if (existingWindow.isMinimized()) {
        existingWindow.restore();
      }
      existingWindow.show();
      existingWindow.focus();
      return;
    }

    if (BrowserWindow.getAllWindows().length === 0) {
      const activatedWindow = createAppWindow();
      attachWindowRuntimeTelemetry(activatedWindow, localDatabase.runtimeDiagnostics);
      attachNativeNotificationWindowState(activatedWindow);
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

app.on("before-quit", () => {
  setNativeNotificationDockBadge(0);
  devAuthCallbackServer?.close();
  devAuthCallbackServer = null;
  devAuthCallbackUrl = null;
});
