import { z } from "zod";

import { ipcChannels } from "@contracts/ipc/channels";

import {
  getNativeNotificationForegroundState,
  setNativeNotificationDockBadge,
  showNativeNotification,
} from "../services/notifications/nativeNotifier";
import { safeHandle, safeHandleReadWithSchema } from "./ipcSafeHandler";

const nativeNotificationSchema = z.object({
  id: z.string().nullable().optional(),
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().max(400).nullable().optional(),
  linkTo: z.string().trim().max(500).nullable().optional(),
  reminderId: z.string().trim().min(1).max(120).nullable().optional(),
  actions: z.array(z.enum(["mark_done", "snooze_15m", "snooze_1h"])).max(3).optional(),
});

export const registerNotificationIpc = () => {
  safeHandle(
    ipcChannels.notifications.showNative,
    nativeNotificationSchema,
    (_event, input) => showNativeNotification(input),
    "The app could not show this notification.",
  );

  safeHandle(
    ipcChannels.notifications.setDockBadge,
    z.number().int().min(0).max(999),
    (_event, count) => setNativeNotificationDockBadge(count),
    "The app could not update the dock badge.",
  );

  safeHandleReadWithSchema(
    ipcChannels.notifications.getForegroundState,
    z.tuple([]),
    getNativeNotificationForegroundState,
    "The app could not read notification state.",
  );
};
