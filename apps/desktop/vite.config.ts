import { fileURLToPath } from "node:url";
import path from "node:path";

import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron/simple";
import { defineConfig, loadEnv, type Plugin } from "vite";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const sharedAliases = {
  "@app": path.resolve(rootDir, "src/app"),
  "@features": path.resolve(rootDir, "src/features"),
  "@shared": path.resolve(rootDir, "src/shared"),
  "@contracts": path.resolve(rootDir, "../../packages/contracts/src"),
  "@domain": path.resolve(rootDir, "../../packages/domain/src"),
  "@db": path.resolve(rootDir, "../../packages/db/src"),
  "@bukowski/supabase-client": path.resolve(rootDir, "../../packages/supabase-client/src"),
  "@sync": path.resolve(rootDir, "../../packages/sync/src"),
  "@ui": path.resolve(rootDir, "../../packages/ui/src"),
  "node:sqlite": path.resolve(rootDir, "electron/main/services/data/nodeSqliteShim.ts"),
};

const toHttpsOrigin = (value: string | undefined) => {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
};

const appendConnectSource = (policy: string, source: string | null) => {
  if (!source || policy.includes(source)) {
    return policy;
  }

  return policy.replace(/connect-src([^;]*)/, (match) => `${match} ${source}`);
};

export default defineConfig(async ({ mode }) => {
  const env = loadEnv(mode, rootDir, "VITE_");
  const htmlCsp = appendConnectSource(env.VITE_HTML_CSP ?? "", toHttpsOrigin(env.VITE_SUPABASE_URL));
  const htmlCspPlugin: Plugin = {
    name: "bukowski-html-csp",
    transformIndexHtml: {
      order: "pre",
      handler(html: string) {
        return html.replace("%VITE_HTML_CSP%", htmlCsp);
      },
    },
  };
  const electronPlugins = process.env.VITEST
    ? []
    : await electron({
        main: {
          entry: "electron/main/app.ts",
          onstart: async ({ startup }) => {
            const processWithElectron = process as NodeJS.Process & { electronApp?: unknown };
            console.info(
              processWithElectron.electronApp ? "[dev] Electron main restart" : "[dev] Electron main start",
            );
            await startup(["."]);
          },
          vite: {
            build: {
              rollupOptions: {
                external: ["better-sqlite3", "bwip-js", "keytar", "qrcode", "pdfkit"],
              },
            },
            define: {
              "process.env.VITE_SUPABASE_URL": JSON.stringify(env.VITE_SUPABASE_URL ?? ""),
              "process.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(env.VITE_SUPABASE_ANON_KEY ?? ""),
              "process.env.VITE_SUPABASE_SYNC_ENABLED": JSON.stringify(env.VITE_SUPABASE_SYNC_ENABLED ?? ""),
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
    plugins: [
      htmlCspPlugin,
      react(),
      ...electronPlugins,
    ],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (!id.includes("node_modules")) {
              return undefined;
            }

            if (
              id.includes("/react/") ||
              id.includes("/react-dom/") ||
              id.includes("/react-router/") ||
              id.includes("/react-router-dom/")
            ) {
              return "react-vendor";
            }

            if (id.includes("/lucide-react/")) {
              return "icons";
            }

            return "vendor";
          },
        },
      },
    },
    resolve: {
      alias: sharedAliases,
    },
    test: {
      environment: "node",
      include: ["src/test/**/*.test.ts"],
    },
  };
});
