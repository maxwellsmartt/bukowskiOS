import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import type { AppDiagnosticsSnapshot, AppExportResult, AppInfo, AppSupportSnapshot } from "@contracts";

import type { RuntimeDiagnosticsService } from "./runtimeDiagnosticsService";
import { listRecentLogFiles, readCombinedRecentLogs } from "../logger";

type CreateSupportDiagnosticsServiceOptions = {
  database: DatabaseSync;
  getDiagnosticsSnapshot: () => AppDiagnosticsSnapshot;
  getAppInfo: () => AppInfo;
  runtimeDiagnostics: RuntimeDiagnosticsService;
};

const writeJsonFile = (filePath: string, value: unknown) => {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

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
      const supportSnapshot = getSupportSnapshot();

      writeJsonFile(path.join(directoryPath, "support-summary.json"), {
        exportedAt: new Date().toISOString(),
        supportSnapshot,
      });

      fs.writeFileSync(
        path.join(directoryPath, "recent-logs.txt"),
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
        .all();

      writeJsonFile(path.join(directoryPath, "runtime-errors.json"), runtimeErrorRows);

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
