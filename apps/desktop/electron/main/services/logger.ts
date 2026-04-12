import { app } from "electron";
import electronLog from "electron-log/main";
import fs from "node:fs";
import path from "node:path";

type LogLevel = "debug" | "info" | "warn" | "error";

export type DesktopLogger = {
  debug: (message: string, metadata?: unknown) => void;
  info: (message: string, metadata?: unknown) => void;
  warn: (message: string, metadata?: unknown) => void;
  error: (message: string, metadata?: unknown) => void;
};

export type AppLogFileDescriptor = {
  name: string;
  path: string;
  sizeBytes: number;
  updatedAt: string;
};

let isInitialized = false;
let logsDirectoryPath: string | null = null;
const isElectronAppAvailable = () => typeof app !== "undefined" && app !== null;

const redactText = (value: string) =>
  value
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[redacted-secret]")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[redacted-token]")
    .replace(/\b[A-Za-z0-9+/]{24,}={0,2}\b/g, "[redacted-value]");

const serializeMetadata = (metadata: unknown) => {
  if (metadata === undefined) {
    return "";
  }

  if (metadata instanceof Error) {
    return redactText(
      JSON.stringify({
        name: metadata.name,
        message: metadata.message,
        stack: metadata.stack ?? null,
      }),
    );
  }

  if (typeof metadata === "string") {
    return redactText(metadata);
  }

  try {
    return redactText(JSON.stringify(metadata));
  } catch {
    return redactText(String(metadata));
  }
};

const resolveLogsDirectory = (customPath?: string) => {
  if (customPath) {
    return customPath;
  }

  if (logsDirectoryPath) {
    return logsDirectoryPath;
  }

  if (!isElectronAppAvailable() || !app.isReady()) {
    return null;
  }

  return path.join(app.getPath("userData"), "logs");
};

const fallbackConsole = (level: LogLevel, scope: string, message: string, metadata?: unknown) => {
  const line = [`[${scope}]`, redactText(message), serializeMetadata(metadata)].filter(Boolean).join(" ");
  const writer =
    level === "error"
      ? console.error
      : level === "warn"
        ? console.warn
        : level === "debug"
          ? console.debug
          : console.info;
  writer(line);
};

export const initializeDesktopLogger = (customLogsDirectory?: string) => {
  const nextLogsDirectory = resolveLogsDirectory(customLogsDirectory);

  if (!nextLogsDirectory) {
    return null;
  }

  fs.mkdirSync(nextLogsDirectory, { recursive: true });
  logsDirectoryPath = nextLogsDirectory;

  if (!isInitialized) {
    electronLog.initialize();
    isInitialized = true;
  }

  const isPackagedBuild = isElectronAppAvailable() ? app.isPackaged : false;

  electronLog.transports.file.level = isPackagedBuild ? "info" : "debug";
  electronLog.transports.file.maxSize = 2 * 1024 * 1024;
  electronLog.transports.file.format = "[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {scope} {text}";
  electronLog.transports.file.resolvePathFn = () =>
    path.join(nextLogsDirectory, `bukowski-${new Date().toISOString().slice(0, 10)}.log`);
  electronLog.transports.console.level = isPackagedBuild ? false : "debug";
  electronLog.transports.console.format = "[{h}:{i}:{s}.{ms}] [{level}] {scope} {text}";

  return nextLogsDirectory;
};

export const getDesktopLogsDirectory = () => resolveLogsDirectory() ?? null;

export const listRecentLogFiles = (limit = 5): AppLogFileDescriptor[] => {
  const logsDirectory = resolveLogsDirectory();

  if (!logsDirectory || !fs.existsSync(logsDirectory)) {
    return [];
  }

  return fs
    .readdirSync(logsDirectory)
    .filter((entry) => entry.endsWith(".log"))
    .map((entry) => {
      const filePath = path.join(logsDirectory, entry);
      const stats = fs.statSync(filePath);

      return {
        name: entry,
        path: filePath,
        sizeBytes: stats.size,
        updatedAt: new Date(stats.mtimeMs).toISOString(),
      };
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, limit);
};

export const readCombinedRecentLogs = (limit = 5) =>
  listRecentLogFiles(limit)
    .map((file) => `===== ${file.name} (${file.updatedAt}) =====\n${fs.readFileSync(file.path, "utf8")}`)
    .join("\n\n");

export const getDesktopLogger = (scope: string): DesktopLogger => {
  const write = (level: LogLevel, message: string, metadata?: unknown) => {
    const sanitizedMessage = redactText(message);
    const serializedMetadata = serializeMetadata(metadata);
    const text = [sanitizedMessage, serializedMetadata].filter(Boolean).join(" ");

    try {
      if (!isInitialized) {
        initializeDesktopLogger();
      }

      if (!isInitialized) {
        fallbackConsole(level, scope, sanitizedMessage, metadata);
        return;
      }

      const scopedLogger = electronLog.scope(scope);
      scopedLogger[level](text);
    } catch {
      fallbackConsole(level, scope, sanitizedMessage, metadata);
    }
  };

  return {
    debug: (message, metadata) => write("debug", message, metadata),
    info: (message, metadata) => write("info", message, metadata),
    warn: (message, metadata) => write("warn", message, metadata),
    error: (message, metadata) => write("error", message, metadata),
  };
};
