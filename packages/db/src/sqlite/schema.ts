import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

export const foundationMigrationPath = path.join(currentDir, "../migrations/0001_foundation.sql");
