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

const appendImageSource = (policy: string, source: string | null) => {
  if (!source) return policy;
  // Find the existing img-src directive and add the source if it isn't there.
  const imgRegex = /img-src([^;]*)/;
  const match = policy.match(imgRegex);
  if (!match) {
    return `${policy.replace(/;\s*$/, "")}; img-src 'self' data: blob: ${source}`;
  }
  if (match[1]?.includes(source)) return policy;
  return policy.replace(imgRegex, (m) => `${m} ${source}`);
};

const toWebSocketOrigin = (value: string | undefined) => {
  const origin = toHttpsOrigin(value);
  return origin ? origin.replace(/^https:/, "wss:") : null;
};

const trustedRemoteImageOrigins = [
  "https://lh3.googleusercontent.com",
  "https://avatars.githubusercontent.com",
  "https://secure.gravatar.com",
];

const rendererManualChunks = (id: string) => {
  if (!id.includes("node_modules")) return undefined;
  if (id.includes("bwip-js")) return "vendor-barcodes";
  if (id.includes("pdfjs-dist")) return "vendor-pdfjs";
  if (id.includes("recharts")) return "vendor-charts";
  if (id.includes("@supabase")) return "vendor-supabase";
  if (id.includes("lucide-react")) return "vendor-icons";
  if (id.includes("i18next")) return "vendor-i18n";
  return "vendor";
};

export default defineConfig(async ({ mode }) => {
  const env = loadEnv(mode, rootDir, "VITE_");
  const supabaseOrigin = toHttpsOrigin(env.VITE_SUPABASE_URL);
  let htmlCsp = appendConnectSource(env.VITE_HTML_CSP ?? "", supabaseOrigin);
  htmlCsp = appendConnectSource(htmlCsp, toWebSocketOrigin(env.VITE_SUPABASE_URL));
  htmlCsp = appendImageSource(htmlCsp, supabaseOrigin);
  for (const imageOrigin of trustedRemoteImageOrigins) {
    htmlCsp = appendImageSource(htmlCsp, imageOrigin);
  }
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
                external: [
                  "@napi-rs/canvas",
                  "better-sqlite3",
                  "better-sqlite3-multiple-ciphers",
                  "bwip-js",
                  "keytar",
                  "qrcode",
                  "pdfkit",
                ],
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
    server: {
      watch: {
        // electron-builder drops the packaged .app (and its DMG staging) into
        // dist-packaged; chokidar follows symlinks, so watching it can leak
        // outside the repo (an Applications symlink once pulled all of
        // /Applications and /System into the watcher and exhausted file
        // descriptors with EMFILE). Build outputs never need HMR.
        ignored: ["**/dist-packaged/**", "**/dist-electron/**", "**/dist/**"],
      },
    },
    build: {
      // The barcode renderer is intentionally lazy-loaded and large. We split
      // vendor islands so the app shell stays readable in build output, then
      // keep the warning threshold above that known barcode chunk.
      chunkSizeWarningLimit: 1100,
      rollupOptions: {
        output: {
          manualChunks: rendererManualChunks,
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
