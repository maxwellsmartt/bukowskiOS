import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "@playwright/test";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: path.resolve(currentDir, "e2e"),
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
});
