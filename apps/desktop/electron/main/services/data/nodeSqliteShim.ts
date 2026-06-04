import { createRequire } from "node:module";
import fs from "node:fs";

import BetterSqlite3 from "better-sqlite3";

const require = createRequire(import.meta.url);

type DatabaseStatementAdapter = {
  all: (...params: unknown[]) => unknown;
  columns?: () => unknown[];
  get: (...params: unknown[]) => unknown;
  iterate?: (...params: unknown[]) => IterableIterator<Record<string, unknown>>;
  raw?: (enabled?: boolean) => unknown;
  run: (...params: unknown[]) => unknown;
  safeIntegers?: (enabled?: boolean) => unknown;
  source?: string;
};

type DatabaseAdapter = {
  aggregate?: (...params: unknown[]) => unknown;
  applyChangeset?: (...params: unknown[]) => boolean;
  createSession?: (...params: unknown[]) => unknown;
  exec: (sql: string) => unknown;
  function?: (...params: unknown[]) => unknown;
  inTransaction?: boolean;
  loadExtension?: (extensionPath: string) => unknown;
  open?: boolean;
  prepare: (sql: string) => DatabaseStatementAdapter;
  close: () => void;
  location?: () => string | null;
  pragma?: (source: string, options?: { simple?: boolean }) => unknown;
  key?: (key: Buffer) => number;
  rekey?: (key: Buffer) => number;
};

type NodeSqliteModule = {
  DatabaseSync: new (databasePath: string) => DatabaseAdapter;
};

type BetterSqlite3MultipleCiphersDatabase = DatabaseAdapter & {
  pragma: (source: string, options?: { simple?: boolean }) => unknown;
  key: (key: Buffer) => number;
  rekey: (key: Buffer) => number;
};

type BetterSqlite3MultipleCiphersConstructor = new (
  databasePath: string,
  options?: {
    fileMustExist?: boolean;
    readonly?: boolean;
  },
) => BetterSqlite3MultipleCiphersDatabase;

export type DatabaseCipherOptions = {
  key?: Buffer | null;
  profile?: "sqlcipher-legacy4";
};

export type SQLInputValue = null | number | bigint | string | NodeJS.ArrayBufferView;
export type SQLOutputValue = null | number | bigint | string | NodeJS.NonSharedUint8Array;
export type StatementResultingChanges = {
  changes: number | bigint;
  lastInsertRowid: number | bigint;
};
type StatementParameters = [Record<string, SQLInputValue>, ...SQLInputValue[]] | SQLInputValue[];

export type DatabaseSyncOptions = {
  cipher?: DatabaseCipherOptions | null;
  fileMustExist?: boolean;
  readonly?: boolean;
};

export class StatementSync {
  constructor(
    private readonly statement: DatabaseStatementAdapter,
    private readonly sql: string,
  ) {}

  all(...anonymousParameters: SQLInputValue[]): Record<string, SQLOutputValue>[];
  all(
    namedParameters: Record<string, SQLInputValue>,
    ...anonymousParameters: SQLInputValue[]
  ): Record<string, SQLOutputValue>[];
  all(...parameters: StatementParameters) {
    return this.statement.all(...(parameters as unknown[])) as Record<string, SQLOutputValue>[];
  }

  columns() {
    return (this.statement.columns?.() ?? []) as Array<{
      column: string | null;
      database: string | null;
      name: string;
      table: string | null;
      type: string | null;
    }>;
  }

  get expandedSQL() {
    return this.sql;
  }

  get(...anonymousParameters: SQLInputValue[]): Record<string, SQLOutputValue> | undefined;
  get(
    namedParameters: Record<string, SQLInputValue>,
    ...anonymousParameters: SQLInputValue[]
  ): Record<string, SQLOutputValue> | undefined;
  get(...parameters: StatementParameters) {
    return this.statement.get(...(parameters as unknown[])) as Record<string, SQLOutputValue> | undefined;
  }

  iterate(...anonymousParameters: SQLInputValue[]): IterableIterator<Record<string, SQLOutputValue>>;
  iterate(
    namedParameters: Record<string, SQLInputValue>,
    ...anonymousParameters: SQLInputValue[]
  ): IterableIterator<Record<string, SQLOutputValue>>;
  iterate(...parameters: StatementParameters) {
    return (this.statement.iterate?.(...(parameters as unknown[])) ??
      [][Symbol.iterator]()) as IterableIterator<Record<string, SQLOutputValue>>;
  }

  run(...anonymousParameters: SQLInputValue[]): StatementResultingChanges;
  run(namedParameters: Record<string, SQLInputValue>, ...anonymousParameters: SQLInputValue[]): StatementResultingChanges;
  run(...parameters: StatementParameters) {
    return this.statement.run(...(parameters as unknown[])) as StatementResultingChanges;
  }

  setAllowBareNamedParameters(_enabled: boolean) {}

  setAllowUnknownNamedParameters(_enabled: boolean) {}

  setReturnArrays(enabled: boolean) {
    this.statement.raw?.(enabled);
  }

  setReadBigInts(enabled: boolean) {
    this.statement.safeIntegers?.(enabled);
  }

  get sourceSQL() {
    return this.sql;
  }
}

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

const createNodeSqliteAdapter = (databasePath: string, options: DatabaseSyncOptions) => {
  if (options.fileMustExist && !fs.existsSync(databasePath)) {
    throw new Error(`SQLite database does not exist at ${databasePath}.`);
  }

  return withSuppressedSqliteWarning(() => {
    const { DatabaseSync: NativeDatabaseSync } = require("node:sqlite") as NodeSqliteModule;
    return new NativeDatabaseSync(databasePath);
  });
};

const getMultipleCiphersModule = () =>
  require("better-sqlite3-multiple-ciphers") as BetterSqlite3MultipleCiphersConstructor;

const applyCipherProfile = (database: BetterSqlite3MultipleCiphersDatabase, cipher: DatabaseCipherOptions) => {
  const profile = cipher.profile ?? "sqlcipher-legacy4";

  if (profile === "sqlcipher-legacy4") {
    database.pragma("cipher='sqlcipher'");
    database.pragma("legacy=4");
  }

  if (cipher.key) {
    database.key(cipher.key);
  }
};

const createEncryptedAdapter = (databasePath: string, options: DatabaseSyncOptions) => {
  const DatabaseConstructor = getMultipleCiphersModule();
  const database = new DatabaseConstructor(databasePath, {
    fileMustExist: Boolean(options.fileMustExist),
    readonly: Boolean(options.readonly),
  });

  if (!options.cipher) {
    throw new Error("Encrypted SQLite adapter requires a cipher configuration.");
  }

  applyCipherProfile(database, options.cipher);
  return database;
};

export class DatabaseSync {
  private readonly connection: DatabaseAdapter;
  private readonly databasePath: string;
  private closed = false;

  constructor(databasePath: string, options: DatabaseSyncOptions = {}) {
    this.databasePath = databasePath;
    if (options.cipher) {
      this.connection = createEncryptedAdapter(databasePath, options);
      return;
    }

    try {
      this.connection = new BetterSqlite3(databasePath, {
        fileMustExist: options.fileMustExist,
        readonly: options.readonly,
      }) as unknown as DatabaseAdapter;
    } catch (error) {
      this.connection = createNodeSqliteAdapter(databasePath, options);
    }
  }

  exec(sql: string) {
    this.connection.exec(sql);
    return this;
  }

  prepare(sql: string) {
    return new StatementSync(this.connection.prepare(sql), sql);
  }

  pragma(source: string, options?: { simple?: boolean }) {
    if (typeof this.connection.pragma === "function") {
      return this.connection.pragma(source, options);
    }

    if (!options?.simple) {
      this.connection.exec(`PRAGMA ${source};`);
      return [];
    }

    const row = this.connection.prepare(`PRAGMA ${source};`).get() as Record<string, unknown> | undefined;
    return row ? Object.values(row)[0] : undefined;
  }

  key(key: Buffer) {
    if (typeof this.connection.key !== "function") {
      throw new Error("SQLite encryption is unavailable in the active database adapter.");
    }

    return this.connection.key(key);
  }

  rekey(key: Buffer) {
    if (typeof this.connection.rekey !== "function") {
      throw new Error("SQLite encryption is unavailable in the active database adapter.");
    }

    return this.connection.rekey(key);
  }

  close() {
    this.closed = true;
    this.connection.close();
  }

  aggregate(name: string, options: unknown) {
    if (typeof this.connection.aggregate !== "function") {
      throw new Error(`SQLite aggregate registration is unavailable for ${name}.`);
    }

    this.connection.aggregate(name, options);
  }

  loadExtension(extensionPath: string) {
    if (typeof this.connection.loadExtension !== "function") {
      throw new Error("SQLite extension loading is unavailable in the active database adapter.");
    }

    this.connection.loadExtension(extensionPath);
  }

  enableLoadExtension(allow: boolean) {
    if (!allow) {
      return;
    }

    throw new Error("SQLite extension loading cannot be enabled by this shim.");
  }

  location(_dbName = "main") {
    return this.connection.location?.() ?? this.databasePath;
  }

  function(name: string, optionsOrFunction: unknown, maybeFunction?: unknown) {
    if (typeof this.connection.function !== "function") {
      throw new Error(`SQLite function registration is unavailable for ${name}.`);
    }

    if (typeof maybeFunction === "undefined") {
      this.connection.function(name, optionsOrFunction);
      return;
    }

    this.connection.function(name, optionsOrFunction, maybeFunction);
  }

  get isOpen() {
    return typeof this.connection.open === "boolean" ? this.connection.open : !this.closed;
  }

  get isTransaction() {
    return Boolean(this.connection.inTransaction);
  }

  open() {
    throw new Error("Reopening SQLite connections is unsupported by the desktop shim.");
  }

  createSession(options?: unknown) {
    if (typeof this.connection.createSession !== "function") {
      throw new Error("SQLite sessions are unavailable in the active database adapter.");
    }

    return this.connection.createSession(options);
  }

  applyChangeset(changeset: Uint8Array, options?: unknown) {
    if (typeof this.connection.applyChangeset !== "function") {
      throw new Error("SQLite changesets are unavailable in the active database adapter.");
    }

    return this.connection.applyChangeset(changeset, options);
  }

  [Symbol.dispose]() {
    if (this.isOpen) {
      this.close();
    }
  }
}
