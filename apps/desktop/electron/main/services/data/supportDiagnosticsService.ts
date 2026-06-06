import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import type { AppDiagnosticsSnapshot, AppExportResult, AppInfo, AppSupportEventSummary, AppSupportSnapshot } from "@contracts";

import type { RuntimeDiagnosticsService } from "./runtimeDiagnosticsService";
import { listRecentLogFiles, readCombinedRecentLogs, redactSensitiveText } from "../logger";

type CreateSupportDiagnosticsServiceOptions = {
  database: DatabaseSync;
  getDiagnosticsSnapshot: () => AppDiagnosticsSnapshot;
  getAppInfo: () => AppInfo;
  runtimeDiagnostics: RuntimeDiagnosticsService;
};

const writeJsonFile = (filePath: string, value: unknown) => {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const sanitizeStructuredValue = <T>(value: T): T => {
  try {
    return JSON.parse(redactSensitiveText(JSON.stringify(value))) as T;
  } catch {
    return value;
  }
};

const buildExportManifest = (directoryPath: string, fileNames: string[]) => ({
  generatedAt: new Date().toISOString(),
  files: fileNames.map((fileName) => {
    const filePath = path.join(directoryPath, fileName);
    const buffer = fs.readFileSync(filePath);
    return {
      name: fileName,
      sizeBytes: buffer.byteLength,
      sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    };
  }),
});

const sanitizeSupportEvent = (event: AppSupportEventSummary | null): AppSupportEventSummary | null => {
  if (!event) {
    return null;
  }

  return {
    ...event,
    processLabel: redactSensitiveText(event.processLabel),
    errorName: redactSensitiveText(event.errorName),
    message: redactSensitiveText(event.message),
    fingerprint: redactSensitiveText(event.fingerprint),
  };
};

const sanitizeSupportSnapshot = (snapshot: AppSupportSnapshot): AppSupportSnapshot =>
  sanitizeStructuredValue({
    ...snapshot,
    logStorageLabel: redactSensitiveText(snapshot.logStorageLabel),
    lastCrash: sanitizeSupportEvent(snapshot.lastCrash),
    lastError: sanitizeSupportEvent(snapshot.lastError),
    lastLoadFailure: sanitizeSupportEvent(snapshot.lastLoadFailure),
    recentCriticalEvents: snapshot.recentCriticalEvents.map((event) => sanitizeSupportEvent(event)!),
  });

const sanitizeRuntimeErrorRows = (rows: Array<Record<string, unknown>>) => sanitizeStructuredValue(rows);

export const createSupportDiagnosticsService = ({
  database,
  getDiagnosticsSnapshot,
  getAppInfo,
  runtimeDiagnostics,
}: CreateSupportDiagnosticsServiceOptions) => {
  const getSupportSnapshot = (): AppSupportSnapshot => {
    return {
      diagnostics: getDiagnosticsSnapshot(),
      appInfo: getAppInfo(),
      recentLogFiles: listRecentLogFiles().map((file) => ({
        name: file.name,
        sizeBytes: file.sizeBytes,
        updatedAt: file.updatedAt,
      })),
      logStorageLabel: "Stored in the local desktop app support directory.",
      ...runtimeDiagnostics.getSupportSnapshot(),
    };
  };

  return {
    getSupportSnapshot,

    exportRecentLogs(filePath: string): AppExportResult {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, readCombinedRecentLogs() || "No recent logs were available.\n", "utf8");

      return {
        saved: true,
        fileName: path.basename(filePath),
        savedPath: filePath,
        summary: `Exported recent desktop logs to ${path.basename(filePath)}.`,
      };
    },

    exportSupportBundle(directoryPath: string): AppExportResult {
      fs.mkdirSync(directoryPath, { recursive: true });
      const supportSnapshot = sanitizeSupportSnapshot(getSupportSnapshot());

      const supportSummaryFileName = "support-summary.json";
      const recentLogsFileName = "recent-logs.txt";
      const runtimeErrorsFileName = "runtime-errors.json";
      const manifestFileName = "support-manifest.json";

      writeJsonFile(path.join(directoryPath, supportSummaryFileName), {
        exportedAt: new Date().toISOString(),
        supportSnapshot,
      });

      fs.writeFileSync(
        path.join(directoryPath, recentLogsFileName),
        readCombinedRecentLogs() || "No recent logs were available.\n",
        "utf8",
      );

      const runtimeErrorRows = database
        .prepare(
          `
          SELECT
            id,
            source_kind,
            process_label,
            severity,
            error_name,
            message,
            fingerprint,
            created_at
          FROM runtime_error_events
          ORDER BY created_at DESC
          LIMIT 25
        `,
        )
        .all() as Array<Record<string, unknown>>;

      writeJsonFile(path.join(directoryPath, runtimeErrorsFileName), sanitizeRuntimeErrorRows(runtimeErrorRows));
      writeJsonFile(
        path.join(directoryPath, manifestFileName),
        buildExportManifest(directoryPath, [supportSummaryFileName, recentLogsFileName, runtimeErrorsFileName]),
      );

      return {
        saved: true,
        fileName: path.basename(directoryPath),
        savedPath: directoryPath,
        summary: `Exported support bundle to ${path.basename(directoryPath)}.`,
      };
    },
  };
};

export type SupportDiagnosticsService = ReturnType<typeof createSupportDiagnosticsService>;
