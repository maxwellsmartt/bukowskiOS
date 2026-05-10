const fs = require("node:fs");
const path = require("node:path");

const envFileOrder = [".env", ".env.production", ".env.local", ".env.production.local"];

const parseEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const entries = {};
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    entries[key] = value;
  }
  return entries;
};

const envFromFiles = envFileOrder.reduce(
  (acc, fileName) => ({ ...acc, ...parseEnvFile(path.join(process.cwd(), fileName)) }),
  {},
);

const readEnv = (key) => process.env[key] || envFromFiles[key] || "";
const allowLocalOnly = ["1", "true", "yes", "on"].includes(
  String(process.env.BUKOWSKI_ALLOW_LOCAL_ONLY_PACKAGE || "").trim().toLowerCase(),
);

const missing = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"].filter((key) => !readEnv(key).trim());

if (missing.length && !allowLocalOnly) {
  console.error("[verify-package-env] Missing required packaged-app environment:");
  for (const key of missing) {
    console.error(`  - ${key}`);
  }
  console.error(
    "[verify-package-env] Add them to apps/desktop/.env.local or export them before packaging. " +
      "Use BUKOWSKI_ALLOW_LOCAL_ONLY_PACKAGE=1 only for an intentional local-only test build.",
  );
  process.exit(1);
}

console.log(
  missing.length
    ? "[verify-package-env] Local-only package override enabled."
    : "[verify-package-env] Supabase package environment present.",
);
