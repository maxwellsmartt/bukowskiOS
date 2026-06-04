import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test } from "vitest";

import { getDesktopLogger, initializeDesktopLogger, listRecentLogFiles, redactSensitiveText } from "../../electron/main/services/logger";

const tempDirectories: string[] = [];

afterEach(() => {
  tempDirectories.splice(0).forEach((directoryPath) => {
    fs.rmSync(directoryPath, { recursive: true, force: true });
  });
});

test("desktop logger writes a local file and redacts sensitive values", async () => {
  const logsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "bukowski-logs-"));
  tempDirectories.push(logsDirectory);
  initializeDesktopLogger(logsDirectory);

  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.fakeSignatureValue123";

  const logger = getDesktopLogger("test");
  logger.info("Support check", {
    token: "Bearer super-secret-token-value",
    apiKey: "sk-12345678901234567890",
    accessToken: jwt,
  });

  await new Promise((resolve) => setTimeout(resolve, 50));

  const recentFiles = listRecentLogFiles();
  expect(recentFiles.length).toBeGreaterThan(0);

  const content = fs.readFileSync(recentFiles[0]!.path, "utf8");
  expect(content).toContain("Support check");
  expect(content).not.toContain("super-secret-token-value");
  expect(content).not.toContain("sk-12345678901234567890");
  expect(content).not.toContain(jwt);
});

test("desktop logger redacts Anthropic keys, Telegram bot tokens, JSON secret fields and URL query secrets", async () => {
  const logsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "bukowski-logs-"));
  tempDirectories.push(logsDirectory);
  initializeDesktopLogger(logsDirectory);

  const anthropicKey = "sk-ant-api03-abcdefghijklmnopqrstuvwx";
  const telegramToken = "123456789:AAEhBP0av1234567890_ABCDEFGHIJKLMNopq";
  const shortApiKey = "tiny-12-chars";
  const signedUrl = "https://example.test/file?token=verylongopaquesecretvalue123&user=u1";

  const logger = getDesktopLogger("test");
  logger.warn("Multi-provider check", {
    apiKey: shortApiKey,
    anthropic: anthropicKey,
    telegram: telegramToken,
    url: signedUrl,
  });

  await new Promise((resolve) => setTimeout(resolve, 50));

  const recentFiles = listRecentLogFiles();
  const content = fs.readFileSync(recentFiles[0]!.path, "utf8");

  expect(content).not.toContain(anthropicKey);
  expect(content).not.toContain(telegramToken);
  // Short API keys are caught by name via the JSON-field redactor.
  expect(content).not.toContain(`"apiKey":"${shortApiKey}"`);
  // URL token query gets redacted but the host stays for debugging.
  expect(content).not.toContain("verylongopaquesecretvalue123");
  expect(content).toContain("example.test");
});

test("desktop logger redacts local absolute paths when preparing support-safe text", () => {
  const text = redactSensitiveText('Open /Users/ernestomaxwell/Library/Application Support/bukowskiOS/db.sqlite and C:\\Users\\Ernesto\\Desktop\\dump.json');

  expect(text).not.toContain("/Users/ernestomaxwell/");
  expect(text).not.toContain("C:\\Users\\Ernesto\\");
  expect(text).toContain("[redacted-path]");
});
