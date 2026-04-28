import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const registeredHandlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
      registeredHandlers.set(channel, handler);
    }),
  },
}));

const assertTrustedIpcSender = vi.fn();
const sanitizeIpcError = vi.fn((error: unknown, fallbackMessage?: string) => {
  if (error instanceof Error && !fallbackMessage) {
    return error;
  }

  return new Error(fallbackMessage ?? "Invalid request payload.");
});

vi.mock("../../electron/main/security/securityConfig", () => ({
  assertTrustedIpcSender,
  sanitizeIpcError,
}));

describe("ipc safe read handler", () => {
  beforeEach(() => {
    registeredHandlers.clear();
    assertTrustedIpcSender.mockReset();
    sanitizeIpcError.mockClear();
  });

  it("passes parsed read args through to the handler", async () => {
    const { safeHandleReadWithSchema } = await import("../../electron/main/ipc/ipcSafeHandler");
    const handler = vi.fn<(id: string, offset?: number) => string>(() => "ok");

    safeHandleReadWithSchema<[string, number?], string>(
      "test:valid-read",
      z.tuple([z.string().min(1), z.number().int().min(0).optional()]),
      (_event, id, offset) => handler(id, offset),
    );

    const registered = registeredHandlers.get("test:valid-read");
    expect(registered).toBeTypeOf("function");

    await expect(registered!({ senderFrame: {} }, "asset-123", 4)).resolves.toBe("ok");
    expect(handler).toHaveBeenCalledWith("asset-123", 4);
    expect(assertTrustedIpcSender).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid read args with a sanitized message", async () => {
    const { safeHandleReadWithSchema } = await import("../../electron/main/ipc/ipcSafeHandler");
    const handler = vi.fn<(input: { query: string }) => string>(() => "should-not-run");

    safeHandleReadWithSchema(
      "test:invalid-read",
      z.tuple([z.object({ query: z.string().max(5) })]),
      (_event, input: { query: string }) => handler(input),
      "The app could not complete that search.",
    );

    const registered = registeredHandlers.get("test:invalid-read");
    expect(registered).toBeTypeOf("function");

    await expect(registered!({ senderFrame: {} }, { query: "this-query-is-way-too-long" })).rejects.toThrow(
      "Some information is missing or invalid.",
    );
    expect(handler).not.toHaveBeenCalled();
  });
});
