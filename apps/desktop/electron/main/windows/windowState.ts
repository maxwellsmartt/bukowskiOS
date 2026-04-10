import { app, type BrowserWindow, type Rectangle } from "electron";
import fs from "node:fs";
import path from "node:path";

type PersistedWindowState = {
  bounds: Rectangle;
  isMaximized: boolean;
};

type DefaultWindowBounds = {
  width: number;
  height: number;
};

const defaultBounds: DefaultWindowBounds = {
  width: 1440,
  height: 920,
};

const stateFilePath = () => path.join(app.getPath("userData"), "window-state.json");

const isValidBounds = (value: unknown): value is Rectangle => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<Rectangle>;

  return (
    typeof candidate.width === "number" &&
    Number.isFinite(candidate.width) &&
    typeof candidate.height === "number" &&
    Number.isFinite(candidate.height)
  );
};

export const readWindowState = (): PersistedWindowState | null => {
  try {
    const rawValue = fs.readFileSync(stateFilePath(), "utf8");
    const parsedValue = JSON.parse(rawValue) as Partial<PersistedWindowState>;

    if (!isValidBounds(parsedValue.bounds)) {
      return null;
    }

    return {
      bounds: parsedValue.bounds,
      isMaximized: parsedValue.isMaximized === true,
    };
  } catch {
    return null;
  }
};

const writeWindowState = (window: BrowserWindow) => {
  const nextState: PersistedWindowState = {
    bounds: window.isMaximized() ? window.getNormalBounds() : window.getBounds(),
    isMaximized: window.isMaximized(),
  };

  try {
    fs.writeFileSync(stateFilePath(), JSON.stringify(nextState, null, 2), "utf8");
  } catch {
    // Keep desktop startup resilient even if local state cannot be written.
  }
};

export const getDefaultWindowBounds = () => defaultBounds;

export const bindWindowStatePersistence = (window: BrowserWindow) => {
  let timeoutId: NodeJS.Timeout | null = null;

  const scheduleWrite = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      writeWindowState(window);
      timeoutId = null;
    }, 140);
  };

  window.on("resize", scheduleWrite);
  window.on("move", scheduleWrite);
  window.on("maximize", scheduleWrite);
  window.on("unmaximize", scheduleWrite);
  window.on("close", () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    writeWindowState(window);
  });
};
