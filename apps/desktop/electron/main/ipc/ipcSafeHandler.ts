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

const formatValidationError = (error: z.ZodError) => {
  const issue = error.issues[0];
  const field = issue?.path.length ? humanizeFieldPath(issue.path) : "one field";
  const rawIssue = issue as z.ZodIssue & { input?: unknown };
  const detail =
    issue?.code === "invalid_type" && rawIssue.input === undefined
      ? `${field} is required.`
      : issue?.message
        ? `${field}: ${issue.message}`
        : "Some information is missing or has the wrong format.";

  return `Some information is missing or invalid. ${detail} Review the form and try again.`;
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
