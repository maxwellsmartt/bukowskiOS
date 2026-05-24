import { BrowserWindow, shell } from "electron";
import fs from "node:fs";
import path from "node:path";

import { assertAllowedExternalUrl } from "../security/securityConfig";
import { bindWindowStatePersistence, getDefaultWindowBounds, readWindowState } from "./windowState";

type CreateMainWindowOptions = {
  devServerUrl?: string;
  preloadPath: string;
  rendererDist: string;
  deferAppLoad?: boolean;
  showImmediately?: boolean;
};

export const loadMainWindowContent = (window: BrowserWindow, devServerUrl: string | undefined, rendererDist: string) => {
  const rendererIndexPath = path.join(rendererDist, "index.html");
  const loadBuiltRenderer = () => {
    if (window.isDestroyed()) {
      return Promise.resolve();
    }

    return window.loadFile(rendererIndexPath).catch((error: unknown) => {
      if (window.isDestroyed()) {
        return;
      }

      throw error;
    });
  };

  if (devServerUrl) {
    return window.loadURL(devServerUrl).catch((error: unknown) => {
      if (window.isDestroyed()) {
        return;
      }
      if (!fs.existsSync(rendererIndexPath)) {
        throw error;
      }

      console.warn(
        `[desktop] Dev renderer ${devServerUrl} was unavailable; loading built renderer from ${rendererIndexPath}.`,
      );
      return loadBuiltRenderer();
    });
  }

  return loadBuiltRenderer();
};

const escapeHtmlAttribute = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

const readStartupLogoDataUrl = () => {
  const candidates = [
    path.join(process.resourcesPath, "startup-logo.png"),
    path.join(process.cwd(), "src/shared/assets/inbox/logos/bukowskiOS-desktop-logo.png"),
    path.join(process.cwd(), "apps/desktop/src/shared/assets/inbox/logos/bukowskiOS-desktop-logo.png"),
  ];
  const logoPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!logoPath) return null;

  try {
    return `data:image/png;base64,${fs.readFileSync(logoPath).toString("base64")}`;
  } catch {
    return null;
  }
};

const createStartupHtml = () => {
  const logoDataUrl = readStartupLogoDataUrl();
  const logoMarkup = logoDataUrl
    ? `<img class="logo" src="${escapeHtmlAttribute(logoDataUrl)}" alt="bukowskiOS" />`
    : `<div class="mark">b</div>`;

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      :root { color-scheme: dark; }
      html, body {
        width: 100%;
        height: 100%;
        margin: 0;
        background:
          radial-gradient(ellipse 64% 46% at 50% 48%, rgba(246,188,188,0.028) 0%, rgba(246,188,188,0.012) 42%, transparent 78%),
          radial-gradient(ellipse 78% 56% at 52% 52%, rgba(154,183,229,0.022) 0%, rgba(154,183,229,0.008) 48%, transparent 84%),
          linear-gradient(145deg, #050607 0%, #080a0d 58%, #050607 100%);
        color: #f4f7fb;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
        overflow: hidden;
      }
      body {
        display: grid;
        place-items: center;
      }
      .shell {
        display: grid;
        gap: 12px;
        width: min(360px, calc(100vw - 56px));
        text-align: center;
        justify-items: center;
      }
      .mark {
        width: 68px;
        height: 68px;
        margin: 0 auto 8px;
        border-radius: 18px;
        background: rgba(255,255,255,0.08);
        border: 1px solid rgba(255,255,255,0.12);
        display: grid;
        place-items: center;
        font-weight: 800;
        font-size: 28px;
      }
      .logo {
        width: 76px;
        height: 76px;
        object-fit: contain;
        filter: drop-shadow(0 18px 36px rgba(0,0,0,0.55));
      }
      .title {
        margin-top: 4px;
        font-size: 17px;
        font-weight: 750;
        letter-spacing: 0;
      }
      .copy {
        min-height: 18px;
        font-size: 13px;
        color: rgba(244,247,251,0.62);
      }
      .progress {
        position: relative;
        width: min(248px, 70vw);
        height: 5px;
        margin-top: 8px;
        overflow: hidden;
        border-radius: 999px;
        background: rgba(255,255,255,0.09);
        box-shadow: inset 0 0 0 1px rgba(255,255,255,0.06);
      }
      .progress::before {
        content: "";
        position: absolute;
        inset: 0;
        width: 42%;
        border-radius: inherit;
        background: linear-gradient(90deg, rgba(154,183,229,0), rgba(154,183,229,0.95), rgba(154,183,229,0));
        animation: loading 1.25s ease-in-out infinite;
      }
      .hint {
        max-width: 300px;
        margin-top: 2px;
        font-size: 11px;
        line-height: 1.5;
        color: rgba(244,247,251,0.38);
      }
      @keyframes loading {
        0% { transform: translateX(-110%); }
        100% { transform: translateX(245%); }
      }
      @media (prefers-reduced-motion: reduce) {
        .progress::before { animation: none; width: 100%; opacity: 0.55; }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      ${logoMarkup}
      <div class="title">Starting bukowskiOS</div>
      <div class="copy" id="startup-copy">Preparing local workspace data...</div>
      <div class="progress" aria-label="Loading"></div>
      <div class="hint">First launch can take a little longer while the local database is prepared.</div>
    </main>
    <script>
      const messages = [
        "Preparing local workspace data...",
        "Checking local database health...",
        "Loading workspace tools...",
        "Almost ready..."
      ];
      let index = 0;
      window.setInterval(() => {
        index = (index + 1) % messages.length;
        const copy = document.getElementById("startup-copy");
        if (copy) copy.textContent = messages[index];
      }, 2800);
    </script>
  </body>
</html>`;
};

export const createMainWindow = ({ devServerUrl, preloadPath, rendererDist, deferAppLoad, showImmediately }: CreateMainWindowOptions) => {
  const savedWindowState = readWindowState();
  const fallbackBounds = getDefaultWindowBounds();
  let didShowWindow = false;
  const window = new BrowserWindow({
    width: savedWindowState?.bounds.width ?? fallbackBounds.width,
    height: savedWindowState?.bounds.height ?? fallbackBounds.height,
    x: savedWindowState?.bounds.x,
    y: savedWindowState?.bounds.y,
    minWidth: 880,
    minHeight: 600,
    show: false,
    center: !savedWindowState,
    resizable: true,
    movable: true,
    maximizable: true,
    fullscreenable: true,
    backgroundColor: "#0f1113",
    title: "bukowskiOS",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 13 },
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  bindWindowStatePersistence(window);

  if (deferAppLoad) {
    void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(createStartupHtml())}`);
  } else {
    void loadMainWindowContent(window, devServerUrl, rendererDist);
  }

  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      assertAllowedExternalUrl(url);
      void shell.openExternal(url);
    } catch {
      // Ignore blocked external URLs and keep the navigation denied.
    }

    return { action: "deny" };
  });

  const showWindow = () => {
    if (didShowWindow || window.isDestroyed()) {
      return;
    }

    didShowWindow = true;
    if (savedWindowState?.isMaximized) {
      window.maximize();
    }
    window.show();
    window.focus();
  };

  window.once("ready-to-show", showWindow);

  const fallbackShowTimeout = setTimeout(showWindow, 2500);
  fallbackShowTimeout.unref?.();
  window.once("closed", () => clearTimeout(fallbackShowTimeout));

  if (showImmediately) {
    showWindow();
  }

  return window;
};
