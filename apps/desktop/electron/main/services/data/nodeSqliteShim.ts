import { createRequire } from "node:module";

import BetterSqlite3 from "better-sqlite3";

const require = createRequire(import.meta.url);

type DatabaseAdapter = {
  exec: (sql: string) => unknown;
  prepare: (sql: string) => {
    all: (...params: unknown[]) => unknown;
    get: (...params: unknown[]) => unknown;
    run: (...params: unknown[]) => unknown;
  };
  close: () => void;
};

type NodeSqliteModule = {
  DatabaseSync: new (databasePath: string) => DatabaseAdapter;
};

let didReportFallback = false;

const withSuppressedSqliteWarning = <T>(callback: () => T) => {
  const originalEmitWarning = process.emitWarning.bind(process);

  process.emitWarning = ((warning: Error | string, ...args: unknown[]) => {
    const warningText =
      typeof warning === "string" ? warning : warning instanceof Error ? `${warning.name} ${warning.message}` : "";

    if (warningText.toLowerCase().includes("sqlite")) {
      return;
    }

    return (originalEmitWarning as (...params: unknown[]) => void)(warning, ...args);
  }) as typeof process.emitWarning;

  try {
    return callback();
  } finally {
    process.emitWarning = originalEmitWarning;
  }
};

const createNodeSqliteAdapter = (databasePath: string) => {
  return withSuppressedSqliteWarning(() => {
    const { DatabaseSync: NativeDatabaseSync } = require("node:sqlite") as NodeSqliteModule;
    return new NativeDatabaseSync(databasePath);
  });
};

export class DatabaseSync {
  private readonly connection: DatabaseAdapter;

  constructor(databasePath: string) {
    try {
      this.connection = new BetterSqlite3(databasePath) as unknown as DatabaseAdapter;
    } catch (error) {
      if (!didReportFallback) {
        didReportFallback = true;
        console.info("Electron runtime is using the local node:sqlite fallback for storage until a matching better-sqlite3 build is available.");
      }

      this.connection = createNodeSqliteAdapter(databasePath);
    }
  }

  exec(sql: string) {
    this.connection.exec(sql);
    return this;
  }

  prepare(sql: string) {
    return this.connection.prepare(sql);
  }

  close() {
    this.connection.close();
  }
}
