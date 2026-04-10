import { fileURLToPath } from "node:url";
import path from "node:path";

import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";
import { defineConfig } from "vite";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const sharedAliases = {
  "@app": path.resolve(rootDir, "src/app"),
  "@features": path.resolve(rootDir, "src/features"),
  "@shared": path.resolve(rootDir, "src/shared"),
  "@contracts": path.resolve(rootDir, "../../packages/contracts/src"),
  "@domain": path.resolve(rootDir, "../../packages/domain/src"),
  "@db": path.resolve(rootDir, "../../packages/db/src"),
  "@sync": path.resolve(rootDir, "../../packages/sync/src"),
  "@ui": path.resolve(rootDir, "../../packages/ui/src"),
  "node:sqlite": path.resolve(rootDir, "electron/main/services/data/nodeSqliteShim.ts"),
};

export default defineConfig(async () => {
  const electronPlugins = process.env.VITEST
    ? []
    : await electron({
        main: {
          entry: "electron/main/app.ts",
          vite: {
            build: {
              rollupOptions: {
                external: ["better-sqlite3"],
              },
            },
            resolve: {
              alias: sharedAliases,
            },
          },
        },
        preload: {
          input: "electron/preload/index.ts",
          vite: {
            resolve: {
              alias: sharedAliases,
            },
          },
        },
        renderer: {},
      });

  return {
    plugins: [react(), ...electronPlugins],
    resolve: {
      alias: sharedAliases,
    },
    test: {
      environment: "node",
      include: ["src/test/**/*.test.ts"],
    },
  };
});
