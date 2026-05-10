const fs = require("node:fs");
const path = require("node:path");

const allowedTargets = new Set(["dist", "dist-electron", "dist-packaged"]);
const targets = process.argv.slice(2);

if (!targets.length) {
  console.error("[clean-build-output] Pass one or more generated output directories to clean.");
  process.exit(1);
}

for (const target of targets) {
  if (!allowedTargets.has(target)) {
    console.error(`[clean-build-output] Refusing to clean unexpected target: ${target}`);
    process.exit(1);
  }
}

for (const target of targets) {
  const targetPath = path.join(process.cwd(), target);
  fs.rmSync(targetPath, { force: true, recursive: true });
  console.log(`[clean-build-output] Cleaned ${target}`);
}
