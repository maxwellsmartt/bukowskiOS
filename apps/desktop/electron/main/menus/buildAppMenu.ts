import { BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from "electron";

import { ipcChannels, type ShellAppAction } from "@contracts";

const getTargetWindow = () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;

const sendShellAction = (action: ShellAppAction) => {
  const targetWindow = getTargetWindow();

  if (!targetWindow || targetWindow.isDestroyed()) {
    return;
  }

  targetWindow.webContents.send(ipcChannels.shell.appAction, action);
};

const navigate = (path: string): MenuItemConstructorOptions["click"] =>
  () => sendShellAction({ type: "navigate", path });

const buildGoItem = (label: string, path: string, accelerator?: string): MenuItemConstructorOptions => ({
  label,
  accelerator,
  click: navigate(path),
});

export const buildAppMenu = () =>
  Menu.buildFromTemplate([
    {
      label: "bukowskiOS",
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          label: "Settings…",
          accelerator: "CmdOrCtrl+,",
          click: navigate("/settings"),
        },
        {
          label: "Workspace settings",
          accelerator: "CmdOrCtrl+Shift+,",
          click: navigate("/settings/workspace"),
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
          label: "New project",
          accelerator: "CmdOrCtrl+N",
          click: navigate("/projects"),
        },
        {
          label: "New asset",
          accelerator: "CmdOrCtrl+Shift+N",
          click: navigate("/assets"),
        },
        {
          label: "New finance entry",
          accelerator: "CmdOrCtrl+Alt+N",
          click: navigate("/finance/entries"),
        },
        { type: "separator" },
        {
          label: "Import catalog (CSV)",
          click: navigate("/catalog"),
        },
        { type: "separator" },
        {
          label: "Settings…",
          accelerator: "CmdOrCtrl+,",
          click: navigate("/settings"),
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
          label: "Search…",
          accelerator: "CmdOrCtrl+K",
          click: () => sendShellAction({ type: "open-search" }),
        },
        { type: "separator" },
        buildGoItem("Projects", "/projects", "CmdOrCtrl+1"),
        buildGoItem("Assets", "/assets", "CmdOrCtrl+2"),
        buildGoItem("Packing slips", "/packing-slips", "CmdOrCtrl+3"),
        buildGoItem("Incidents", "/incidents", "CmdOrCtrl+4"),
        buildGoItem("Repair cases", "/rma", "CmdOrCtrl+5"),
        buildGoItem("Finance", "/finance", "CmdOrCtrl+6"),
        buildGoItem("Agents", "/agents", "CmdOrCtrl+7"),
        { type: "separator" },
        buildGoItem("Catalog", "/catalog"),
        buildGoItem("Compare", "/compare"),
        { type: "separator" },
        buildGoItem("Settings", "/settings"),
        buildGoItem("Sync activity", "/settings/sync"),
      ],
    },
    {
      label: "Workspace",
      submenu: [
        {
          label: "Workspace settings",
          click: navigate("/settings/workspace"),
        },
        {
          label: "Switch workspace…",
          accelerator: "CmdOrCtrl+Shift+W",
          click: () => sendShellAction({ type: "switch-workspace" }),
        },
        {
          label: "Create new workspace…",
          click: navigate("/workspaces/create"),
        },
        { type: "separator" },
        {
          label: "Invite a teammate",
          click: navigate("/settings/workspace"),
        },
        {
          label: "Manage members",
          click: navigate("/settings/workspace"),
        },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        {
          label: "Open assistant chat",
          accelerator: "CmdOrCtrl+/",
          click: () => sendShellAction({ type: "open-assistant-chat" }),
        },
        { type: "separator" },
        { role: "front" },
        { role: "close" },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Replay onboarding tour",
          click: () => sendShellAction({ type: "open-onboarding" }),
        },
        {
          label: "Search anything…",
          accelerator: "CmdOrCtrl+K",
          click: () => sendShellAction({ type: "open-search" }),
        },
        { type: "separator" },
        {
          label: "Workspace settings",
          click: navigate("/settings/workspace"),
        },
        {
          label: "Sync activity",
          click: navigate("/settings/sync"),
        },
        { type: "separator" },
        {
          label: "Report an issue",
          click: () => {
            void shell.openExternal("https://github.com/anthropics/bukowskios/issues/new");
          },
        },
      ],
    },
  ]);
