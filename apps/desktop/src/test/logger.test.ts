import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, expect, test } from "vitest";

import { getDesktopLogger, initializeDesktopLogger, listRecentLogFiles } from "../../electron/main/services/logger";

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
