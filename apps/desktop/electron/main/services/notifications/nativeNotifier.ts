import { app, BrowserWindow, Notification } from "electron";

import { ipcChannels, type ShowNativeNotificationCommand } from "@contracts";

let isForeground = true;

const fallbackNativeActionLabels: Record<NonNullable<ShowNativeNotificationCommand["actions"]>[number], string> = {
  mark_done: "Done",
  snooze_15m: "Snooze 15m",
  snooze_1h: "Snooze 1h",
  approve_run: "Approve",
};

const focusMainWindow = () => {
  const targetWindow = BrowserWindow.getAllWindows()[0] ?? null;

  if (!targetWindow || targetWindow.isDestroyed()) {
    return null;
  }

  if (targetWindow.isMinimized()) {
    targetWindow.restore();
  }

  targetWindow.show();
  targetWindow.focus();
  return targetWindow;
};

export const attachNativeNotificationWindowState = (window: BrowserWindow) => {
  const markForeground = () => {
    isForeground = true;
  };
  const markBackground = () => {
    isForeground = false;
  };

  window.on("focus", markForeground);
  window.on("show", markForeground);
  window.on("restore", markForeground);
  window.on("blur", markBackground);
  window.on("hide", markBackground);
  window.on("minimize", markBackground);
};

export const getNativeNotificationForegroundState = () => ({
  isForeground,
  isSupported: Notification.isSupported(),
  // Electron does not expose macOS notification authorization state in the
  // main-process Notification API. Keep this explicit so the UI does not
  // pretend it can prove System Settings are enabled.
  permissionStatus: Notification.isSupported() ? "unknown" : "unsupported",
});

export const setNativeNotificationDockBadge = (count: number) => {
  if (process.platform !== "darwin" || !app.dock) {
    return;
  }

  app.dock.setBadge(count > 0 ? String(count) : "");
};

export const showNativeNotification = (input: ShowNativeNotificationCommand) => {
  if (!Notification.isSupported()) {
    return;
  }

  const notification = new Notification({
    title: input.title,
    body: input.body ?? "",
    silent: false,
    actions:
      process.platform === "darwin"
        ? input.actions?.map((action) => ({
            type: "button" as const,
            text: input.actionLabels?.[action] ?? fallbackNativeActionLabels[action],
          }))
        : undefined,
  });

  notification.on("click", () => {
    const targetWindow = focusMainWindow();
    targetWindow?.webContents.send(ipcChannels.shell.appAction, {
      type: "notification-clicked",
      linkTo: input.linkTo ?? null,
    });
  });

  notification.on("action", (_event, index) => {
    const action = input.actions?.[index];
    if (!action) {
      return;
    }

    const targetWindow = focusMainWindow();
    if (action === "approve_run") {
      if (!input.agentRunId || !input.workspaceId) {
        return;
      }
      targetWindow?.webContents.send(ipcChannels.shell.appAction, {
        type: "agent-run-native-action",
        workspaceId: input.workspaceId,
        runId: input.agentRunId,
        decision: "approve",
      });
      return;
    }

    if (!input.reminderId) {
      return;
    }
    targetWindow?.webContents.send(ipcChannels.shell.appAction, {
      type: "reminder-native-action",
      reminderId: input.reminderId,
      action,
    });
  });

  notification.show();
};
