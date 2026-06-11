import { app, BrowserWindow, dialog, Menu, session } from "electron";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { format } from "date-fns";
import { DEFAULT_WORKSPACE_ID, ipcChannels, type CreateProjectBlueprintInput, type PackingInsuranceExportOptions, type TreasuryOverviewQuery } from "@contracts";

import { buildContentSecurityPolicy } from "./security/securityConfig";
import { registerAuthIpc } from "./ipc/registerAuthIpc";
import { registerAppIpc } from "./ipc/registerAppIpc";
import { registerFoundationIpc } from "./ipc/registerFoundationIpc";
import { registerNotificationIpc } from "./ipc/registerNotificationIpc";
import { buildAppMenu } from "./menus/buildAppMenu";
import { getDesktopEnvironment } from "./services/appEnvironment";
import { createDocumentGenerationService } from "./services/data/documentGenerationService";
import { initializeLocalDatabaseAsync } from "./services/data/localDatabase";
import { getDesktopLogger, initializeDesktopLogger } from "./services/logger";
import { attachNativeNotificationWindowState, setNativeNotificationDockBadge } from "./services/notifications/nativeNotifier";
import { createMainWindow, loadMainWindowContent } from "./windows/createMainWindow";

type LocalDatabaseInstance = Awaited<ReturnType<typeof initializeLocalDatabaseAsync>>;

const { devServerUrl, preloadPath, rendererDist } = getDesktopEnvironment(import.meta.url);
const isE2E = process.env.BUKOWSKI_E2E === "1";
const logger = getDesktopLogger("app");
const authProtocol = "bukowskios";
const pendingDeepLinks: string[] = [];
const devAuthCallbackHost = "127.0.0.1";
const devAuthCallbackPort = 17654;
let devAuthCallbackServer: Server | null = null;
let devAuthCallbackUrl: string | null = null;

const currencySuffix = (currency: string) => {
  const normalized = currency.trim().toUpperCase();
  if (normalized === "USD") return "US$";
  if (normalized === "EUR") return "€";
  return normalized || currency;
};

const formatReportMoney = (value: number, currency = "DOP") =>
  `${Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currencySuffix(currency)}`;

const categoryLabelsEs: Record<string, string> = {
  uncategorized: "Sin clasificar",
  crew_fees: "Pagos honorarios",
  services: "Pagos servicios",
  taxes: "Impuestos",
  social_security: "Seguridad social (TSS)",
  bank_fees: "Comisiones bancarias",
  bank_fee: "Comisión bancaria",
  credit_card: "Tarjeta de crédito",
  loan_financing: "Préstamos y financiamiento",
  production_income: "Ingresos de producción",
  interest_income: "Intereses",
  internal_transfer: "Transferencias internas",
  other_expenses: "Otros gastos",
  other_small: "Otros menores",
};

const formatCategoryLabel = (value: string | null | undefined) => {
  const normalized = value?.trim();
  if (!normalized) return "Sin clasificar";
  return (
    categoryLabelsEs[normalized] ??
    normalized
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (char) => char.toUpperCase())
  );
};

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
  runtimeDiagnostics: LocalDatabaseInstance["runtimeDiagnostics"],
) => {
  window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    const payload = {
      level,
      line,
      sourceId,
      message,
    };

    if (level >= 2) {
      logger.warn("Renderer console message.", payload);
    }
  });

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
  runtimeDiagnostics: LocalDatabaseInstance["runtimeDiagnostics"],
) => {
  const isTransientPipeError = (error: NodeJS.ErrnoException) =>
    error.code === "EPIPE" || error.code === "EIO" || error.code === "ECONNRESET";

  process.on("uncaughtException", (error: NodeJS.ErrnoException) => {
    if (isTransientPipeError(error)) {
      return;
    }
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
    if (isTransientPipeError(error as NodeJS.ErrnoException)) {
      return;
    }
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

// Writing to a closed stdout/stderr pipe (terminal closed in dev, parent
// process killed) emits EPIPE/EIO. Without a listener Node re-throws it as an
// uncaughtException, which our error handler logs — writing to the same dead
// pipe — re-throwing again in an unbounded loop. Swallowing these at the
// source breaks that spiral. (Real diagnostics still go to the log file.)
const swallowStreamPipeErrors = (stream: NodeJS.WriteStream) => {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE" || error.code === "EIO" || error.code === "ECONNRESET") {
      return;
    }
    throw error;
  });
};
swallowStreamPipeErrors(process.stdout);
swallowStreamPipeErrors(process.stderr);

app.setName("bukowskiOS");
const e2eUserDataPath = process.env.BUKOWSKI_E2E_USER_DATA_PATH?.trim();
app.setPath("userData", isE2E && e2eUserDataPath ? e2eUserDataPath : path.join(app.getPath("appData"), "@bukowski/desktop"));

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

app.whenReady().then(async () => {
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
  const startupStartedAt = Date.now();
  const mainWindow = createStartupWindow();
  logger.info("Startup window created before local database initialization.");

  let localDatabase: LocalDatabaseInstance;
  const databaseStartedAt = Date.now();
  try {
    localDatabase = await initializeLocalDatabaseAsync();
    logger.info("Local database initialized; loading renderer.", {
      durationMs: Date.now() - databaseStartedAt,
      startupDurationMs: Date.now() - startupStartedAt,
    });
  } catch (error) {
    logger.error("Local database initialization failed before renderer load.", {
      durationMs: Date.now() - databaseStartedAt,
      startupDurationMs: Date.now() - startupStartedAt,
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    // A key-integrity failure is recoverable by the user (wrong app name /
    // keychain entry) but fatal if "recovered" automatically. Tell them what
    // to do and quit instead of crashing into the recovery path.
    if (error instanceof Error && error.name === "DatabaseKeyIntegrityError") {
      dialog.showErrorBox(
        "No se pudo abrir la base de datos local",
        "La base de datos está cifrada pero la llave del Keychain no corresponde.\n\n" +
          "Esto suele pasar cuando el app corre con otro nombre (por ejemplo un build de desarrollo " +
          "lanzado desde otra carpeta), porque macOS resuelve otra entrada del Keychain.\n\n" +
          "Abre el app con el nombre correcto (bukowskiOS). NO borres la base de datos ni el archivo " +
          "bukowski-db-key.json: tus datos están intactos.\n\nDetalle: " +
          error.message,
      );
      app.exit(1);
      return;
    }

    throw error;
  }
  const documentGeneration = createDocumentGenerationService();
  const createFinanceSummaryReportPdf = async (query: TreasuryOverviewQuery | undefined, targetFilePath: string) => {
    const workspaceId = query?.workspaceId ?? DEFAULT_WORKSPACE_ID;
    const reportQuery: TreasuryOverviewQuery = {
      workspaceId,
      period: query?.period ?? "month",
      customStartDate: query?.customStartDate ?? null,
      customEndDate: query?.customEndDate ?? null,
      reportCurrency: query?.reportCurrency ?? "DOP",
    };
    const overview = localDatabase.treasuryReads.getOverview(reportQuery);
    const collaboratorSummary = localDatabase.collaboratorFeeReads.getSummary({ workspaceId });
    const settings = localDatabase.currencyReads.getSettings(workspaceId);
    const logoBuffer = await localDatabase.workspaceBrandingAssets.resolveAssetBuffer(
      workspaceId,
      "logo",
      settings.workspaceLogoUrl,
    );
    const moneyCurrency = overview.reportCurrency === "mixed" ? "DOP" : overview.reportCurrency;
    const summaryParts = [
      `${formatReportMoney(overview.totalIncome, moneyCurrency)} en ingresos reales`,
      `${formatReportMoney(overview.totalExpense, moneyCurrency)} en gastos reales`,
      `${formatReportMoney(overview.net, moneyCurrency)} neto`,
    ];
    if (collaboratorSummary.pendingAmount > 0) {
      summaryParts.push(`${formatReportMoney(collaboratorSummary.pendingAmount, "DOP")} pendiente en honorarios`);
    }
    const pdf = await documentGeneration.createFinanceReportPdf({
      reportTitle: "Resumen financiero real",
      periodLabel: overview.activePeriodLabel,
      generatedAt: `Generado ${format(new Date(), "yyyy-MM-dd HH:mm")}`,
      workspaceLabel: localDatabase.foundationReads.getShellBootstrap().workspaceName,
      logoBuffer,
      executiveSummary: `${summaryParts.join(" · ")} en ${overview.activePeriodLabel.toLowerCase()}.`,
      totals: [
        { label: "Ingreso real", value: formatReportMoney(overview.totalIncome, moneyCurrency), tone: "success" },
        { label: "Gasto real", value: formatReportMoney(overview.totalExpense, moneyCurrency), tone: "critical" },
        { label: "Neto", value: formatReportMoney(overview.net, moneyCurrency), tone: overview.net >= 0 ? "warning" : "critical" },
        { label: "Gasto deducible", value: formatReportMoney(overview.totalDeductibleExpense, moneyCurrency), tone: "info" },
        { label: "Honorarios pendientes", value: formatReportMoney(collaboratorSummary.pendingAmount, "DOP"), tone: "warning" },
        { label: "Transferencias excluidas", value: formatReportMoney(overview.excludedTransferTotal, moneyCurrency), tone: "neutral" },
      ],
      signals: [
        {
          label: "Sin clasificar",
          value: String(overview.unclassifiedCount),
          body: "Movimientos que todavía no alimentan correctamente gráficos y reportes.",
          tone: overview.unclassifiedCount > 0 ? "warning" : "success",
        },
        {
          label: "Revisión fiscal",
          value: String(overview.pendingReviewCount),
          body: "Gastos pendientes de aceptar, reducir o rechazar para DGII.",
          tone: overview.pendingReviewCount > 0 ? "warning" : "success",
        },
        {
          label: "Crew con balance",
          value: String(collaboratorSummary.collaboratorsWithBalance),
          body: "Colaboradores con honorarios pendientes de pago.",
          tone: collaboratorSummary.collaboratorsWithBalance > 0 ? "critical" : "success",
        },
        {
          label: "Conversión pendiente",
          value: String(overview.conversionMissingCount),
          body: "Movimientos sin tasa para consolidar en moneda de reporte.",
          tone: overview.conversionMissingCount > 0 ? "warning" : "success",
        },
      ],
      monthly: overview.monthly.map((row) => ({
        month: row.month,
        income: formatReportMoney(row.income, moneyCurrency),
        expense: formatReportMoney(row.expense, moneyCurrency),
        net: formatReportMoney(row.net, moneyCurrency),
      })),
      categoryBreakdown: overview.expenseByCategory.map((row) => ({
        category: formatCategoryLabel(row.category),
        amount: formatReportMoney(row.amount, moneyCurrency),
        percentage: row.percentage,
      })),
      crewBalances: collaboratorSummary.byCollaborator.map((row) => ({
        collaborator: row.crewMemberName,
        pending: formatReportMoney(row.pendingAmount, row.currency),
        paid: formatReportMoney(row.paidAmount, row.currency),
      })),
    });

    return {
      ...pdf,
      targetFilePath,
    };
  };
  attachProcessRuntimeTelemetry(localDatabase.runtimeDiagnostics);
  attachWindowRuntimeTelemetry(mainWindow, localDatabase.runtimeDiagnostics);
  attachNativeNotificationWindowState(mainWindow);

  registerAuthIpc({
    getOAuthRedirectUrl: () => devAuthCallbackUrl ?? "bukowskios://auth/callback",
  });
  registerNotificationIpc(localDatabase.notifications);
  registerAppIpc({
    database: localDatabase.database,
    appSettings: localDatabase.appSettings,
    getDiagnosticsSnapshot: localDatabase.getDiagnosticsSnapshot,
    getSupportSnapshot: localDatabase.getSupportSnapshot,
    getUsersSnapshot: (query) => localDatabase.userAdmin.getSnapshot(query),
    createUser: (input) => localDatabase.userAdmin.createUser(input),
    updateUser: (input) => localDatabase.userAdmin.updateUser(input),
    setUserActive: (input) => localDatabase.userAdmin.setUserActive(input),
    revokeTelegramLink: (input) => localDatabase.userAdmin.revokeTelegramLink(input),
    deleteUser: (input) => localDatabase.userAdmin.deleteUser(input),
    createBackupNow: localDatabase.createBackupNow,
    restoreFromBackupNow: () => {
      const snapshot = localDatabase.restoreFromBackupNow();
      // Give the IPC reply time to reach the renderer before restarting.
      setTimeout(() => {
        app.relaunch();
        app.exit(0);
      }, 600);
      return snapshot;
    },
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
    applyRemoteTreasuryRows: localDatabase.applyRemoteTreasuryRows,
    applyRemoteCollaboratorPaymentRows: localDatabase.applyRemoteCollaboratorPaymentRows,
    applyRemoteFinanceBusinessRows: localDatabase.applyRemoteFinanceBusinessRows,
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
    collaboratorFeeMutations: localDatabase.collaboratorFeeMutations,
    collaboratorFeeReads: localDatabase.collaboratorFeeReads,
    currencyMutations: localDatabase.currencyMutations,
    currencyReads: localDatabase.currencyReads,
    currencyRateProviders: localDatabase.currencyRateProviders,
    quoteMutations: localDatabase.quoteMutations,
    quoteReads: localDatabase.quoteReads,
    invoiceMutations: localDatabase.invoiceMutations,
    invoiceReads: localDatabase.invoiceReads,
    treasuryMutations: localDatabase.treasuryMutations,
    treasuryReads: localDatabase.treasuryReads,
    invoiceInbox: localDatabase.invoiceInbox,
    softwareLicenses: localDatabase.softwareLicenses,
    exportInvoicePdf: async (workspaceId: string, invoiceId: string) => {
      const detail = localDatabase.invoiceReads.getInvoiceDetail(workspaceId, invoiceId);
      if (!detail) {
        throw new Error("Invoice not found.");
      }
      const settings = localDatabase.currencyReads.getSettings(workspaceId);
      const { buildInvoicePdfPayload } = await import("./services/data/invoicePdfPayloadBuilder");

      const logoBuffer = await localDatabase.workspaceBrandingAssets.resolveAssetBuffer(
        workspaceId,
        "logo",
        settings.workspaceLogoUrl,
      );
      const sourceQuote = detail.sourceQuoteId
        ? localDatabase.quoteReads.getQuoteDetail(workspaceId, detail.sourceQuoteId)
        : null;
      const payload = buildInvoicePdfPayload({
        invoice: detail,
        currencySettings: settings,
        logoBuffer,
        sourceQuoteNumber: sourceQuote?.quoteNumber ?? null,
      });

      return documentGeneration.createInvoicePdf(payload);
    },
    exportQuotePdf: async (workspaceId: string, quoteId: string) => {
      const detail = localDatabase.quoteReads.getQuoteDetail(workspaceId, quoteId);
      if (!detail) {
        throw new Error("Quote not found.");
      }
      const settings = localDatabase.currencyReads.getSettings(workspaceId);
      const { buildQuotePdfPayload } = await import("./services/data/quotePdfPayloadBuilder");

      const [logoBuffer, sealBuffer, signatureBuffer] = await Promise.all([
        localDatabase.workspaceBrandingAssets.resolveAssetBuffer(workspaceId, "logo", settings.workspaceLogoUrl),
        localDatabase.workspaceBrandingAssets.resolveAssetBuffer(workspaceId, "seal", settings.workspaceSealUrl),
        localDatabase.workspaceBrandingAssets.resolveAssetBuffer(workspaceId, "signature", settings.workspaceSignatureUrl),
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
    exportFinanceReportPdf: async (query, targetFilePath) => createFinanceSummaryReportPdf(query, targetFilePath),
    exportTreasuryOverviewPdf: async (query, targetFilePath) => createFinanceSummaryReportPdf(query, targetFilePath),
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
    exportPackingSlipInsurancePdf: async (packingSlipId, targetFilePath, options?: PackingInsuranceExportOptions | null) => {
      const detail = localDatabase.foundationReads.getPackingSlipDetail(packingSlipId);
      if (!detail.slip) {
        throw new Error("Packing slip was not found.");
      }
      const resolvedCurrency = options ?? {
        outputCurrency: "USD" as const,
        exchangeRate: 1,
        exchangeRateSource: "manual" as const,
        exchangeRateType: "manual" as const,
        exchangeRateEffectiveDate: null,
        exchangeRateSourceLabel: "No conversion",
        mode: "manual" as const,
      };
      const convertInsuranceAmount = (value: number | null | undefined) =>
        typeof value === "number"
          ? resolvedCurrency.outputCurrency === "USD"
            ? value
            : value * resolvedCurrency.exchangeRate
          : null;
      const insuredTotal = detail.items.reduce((total, item) => total + (convertInsuranceAmount(item.insuredTotalAmount) ?? 0), 0);
      const insuredTotalLabel =
        insuredTotal > 0
          ? new Intl.NumberFormat("en-US", {
              style: "currency",
              currency: resolvedCurrency.outputCurrency,
              maximumFractionDigits: 0,
            }).format(insuredTotal)
          : "Pending";

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
          insuredTotal: insuredTotalLabel,
        },
        currency: {
          sourceCurrency: "USD",
          outputCurrency: resolvedCurrency.outputCurrency,
          exchangeRate: resolvedCurrency.exchangeRate,
          exchangeRateSource: resolvedCurrency.exchangeRateSourceLabel ?? resolvedCurrency.exchangeRateSource,
          exchangeRateType: resolvedCurrency.exchangeRateType,
          exchangeRateEffectiveDate: resolvedCurrency.exchangeRateEffectiveDate ?? null,
          mode: resolvedCurrency.mode,
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
  const rendererLoadStartedAt = Date.now();
  mainWindow.webContents.once("did-finish-load", () => {
    logger.info("Renderer finished loading.", {
      durationMs: Date.now() - rendererLoadStartedAt,
      startupDurationMs: Date.now() - startupStartedAt,
    });
    flushPendingDeepLinks();
  });
  void loadMainWindowContent(mainWindow, devServerUrl, rendererDist).catch((error: unknown) => {
    logger.error("Renderer failed to load.", {
      durationMs: Date.now() - rendererLoadStartedAt,
      startupDurationMs: Date.now() - startupStartedAt,
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  });

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
