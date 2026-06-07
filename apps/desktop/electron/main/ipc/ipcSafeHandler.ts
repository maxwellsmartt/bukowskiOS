import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { z, type ZodTypeAny } from "zod";

import { assertTrustedIpcSender, sanitizeIpcError } from "../security/securityConfig";

type AsyncResult<TResult> = TResult | Promise<TResult>;

const humanizeFieldPath = (path: PropertyKey[]) =>
  path
    .map((segment) => String(segment).replace(/([a-z])([A-Z])/g, "$1 $2"))
    .join(" ")
    .trim()
    .toLowerCase();

const capitalize = (value: string) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : value);

const formatValidationError = (error: z.ZodError) => {
  const issue = error.issues[0];
  const field = issue?.path.length ? capitalize(humanizeFieldPath(issue.path)) : null;
  const rawIssue = issue as z.ZodIssue & { input?: unknown };

  // Keep the message human and specific instead of the robotic "Some information
  // is missing or invalid. one field is required." prefix dump.
  if (issue?.code === "invalid_type" && rawIssue.input === undefined) {
    return field ? `${field} is required.` : "A required field is missing.";
  }
  if (field && issue?.message) {
    return `${field}: ${issue.message}`;
  }
  return "Please review the highlighted fields and try again.";
};

export const safeHandle = <TSchema extends ZodTypeAny, TResult>(
  channel: string,
  schema: TSchema,
  handler: (event: IpcMainInvokeEvent, input: z.infer<TSchema>) => AsyncResult<TResult>,
  fallbackMessage?: string,
) => {
  ipcMain.handle(channel, async (event, input) => {
    assertTrustedIpcSender(event);

    const parsedInput = schema.safeParse(input);
    if (!parsedInput.success) {
      throw sanitizeIpcError(formatValidationError(parsedInput.error), "Some information is missing or invalid.");
    }

    try {
      return await handler(event, parsedInput.data);
    } catch (error) {
      throw sanitizeIpcError(error, fallbackMessage);
    }
  });
};

export const safeHandleRead = <TArgs extends unknown[], TResult>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: TArgs) => AsyncResult<TResult>,
  fallbackMessage?: string,
) => {
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrustedIpcSender(event);

    try {
      return await handler(event, ...(args as TArgs));
    } catch (error) {
      throw sanitizeIpcError(error, fallbackMessage);
    }
  });
};

export const safeHandleReadWithSchema = <TArgs extends unknown[], TResult>(
  channel: string,
  schema: ZodTypeAny,
  handler: (event: IpcMainInvokeEvent, ...args: TArgs) => AsyncResult<TResult>,
  fallbackMessage?: string,
) => {
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrustedIpcSender(event);

    const parsedArgs = schema.safeParse(args);
    if (!parsedArgs.success) {
      throw sanitizeIpcError(formatValidationError(parsedArgs.error), "Some information is missing or invalid.");
    }

    try {
      return await handler(event, ...(parsedArgs.data as TArgs));
    } catch (error) {
      throw sanitizeIpcError(error, fallbackMessage);
    }
  });
};
