import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { z, type ZodTypeAny } from "zod";

import { assertTrustedIpcSender, sanitizeIpcError } from "../security/securityConfig";

type AsyncResult<TResult> = TResult | Promise<TResult>;

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
      throw sanitizeIpcError(parsedInput.error.issues[0]?.message ?? "Invalid request payload.", "Invalid request payload.");
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
      throw sanitizeIpcError(parsedArgs.error.issues[0]?.message ?? "Invalid request payload.", "Invalid request payload.");
    }

    try {
      return await handler(event, ...(parsedArgs.data as TArgs));
    } catch (error) {
      throw sanitizeIpcError(error, fallbackMessage);
    }
  });
};
