import { BrowserWindow, Menu, type MenuItemConstructorOptions } from "electron";

import { ipcChannels, type ShellAppAction } from "@contracts";

const getTargetWindow = () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;

const sendShellAction = (action: ShellAppAction) => {
  const targetWindow = getTargetWindow();

  if (!targetWindow || targetWindow.isDestroyed()) {
    return;
  }

  targetWindow.webContents.send(ipcChannels.shell.appAction, action);
};

const buildGoItem = (label: string, path: string, accelerator?: string): MenuItemConstructorOptions => ({
  label,
  accelerator,
  click: () => sendShellAction({ type: "navigate", path }),
});

export const buildAppMenu = () =>
  Menu.buildFromTemplate([
    {
      label: "bukowskiOS",
      submenu: [
        { role: "about" },
        {
          label: "Settings…",
          accelerator: "CmdOrCtrl+,",
          click: () => sendShellAction({ type: "navigate", path: "/settings" }),
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        {
          label: "Settings…",
          accelerator: "CmdOrCtrl+,",
          click: () => sendShellAction({ type: "navigate", path: "/settings" }),
        },
        { type: "separator" },
        { role: "close" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { role: "selectAll" },
        { type: "separator" },
        { role: "startSpeaking" },
        { role: "stopSpeaking" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Go",
      submenu: [
        {
          label: "Search",
          accelerator: "CmdOrCtrl+K",
          click: () => sendShellAction({ type: "open-search" }),
        },
        { type: "separator" },
        buildGoItem("Overview", "/assets/overview"),
        buildGoItem("Assets", "/assets"),
        buildGoItem("Finance", "/finance"),
        buildGoItem("Mission Control", "/agents/mission-control"),
        buildGoItem("Agents", "/agents"),
        buildGoItem("Runs", "/agents/runs"),
        buildGoItem("Models", "/agents/models"),
        buildGoItem("Connectors", "/agents/connectors"),
        buildGoItem("Packing Slips", "/packing-slips"),
        buildGoItem("Projects", "/projects"),
        buildGoItem("Incidents", "/incidents"),
        buildGoItem("Catalog", "/catalog"),
        { type: "separator" },
        buildGoItem("Settings", "/settings"),
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }, { role: "close" }],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Search anything",
          accelerator: "CmdOrCtrl+K",
          click: () => sendShellAction({ type: "open-search" }),
        },
      ],
    },
  ]);
