const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const appPathArg = process.argv[2];
const defaultAppPath = path.join(process.cwd(), "dist-packaged", "mac-arm64", "bukowskiOS.app");
const appPath = appPathArg ? path.resolve(appPathArg) : defaultAppPath;
const strictSpctl = ["1", "true", "yes", "on"].includes(String(process.env.STRICT_SPCTL || "").trim().toLowerCase());

if (!fs.existsSync(appPath)) {
  console.error(`[verify-mac-build] App bundle not found at ${appPath}`);
  process.exit(1);
}

const run = (command, args, allowFailure = false) => {
  try {
    const output = execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      ok: true,
      output: (output || "").toString().trim(),
    };
  } catch (error) {
    const stdout = (error?.stdout || "").toString().trim();
    const stderr = (error?.stderr || "").toString().trim();
    const message = [stdout, stderr].filter(Boolean).join("\n").trim() || error?.message || "command failed";
    if (allowFailure) {
      return { ok: false, output: message };
    }
    throw new Error(message);
  }
};

console.log(`[verify-mac-build] Verifying ${appPath}`);

const codesign = run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
console.log("[verify-mac-build] codesign verification passed.");
if (codesign.output) {
  console.log(codesign.output);
}

const spctl = run("spctl", ["--assess", "-vv", "--type", "execute", appPath], true);
if (spctl.ok) {
  console.log("[verify-mac-build] spctl assessment passed.");
  if (spctl.output) {
    console.log(spctl.output);
  }
} else {
  console.warn("[verify-mac-build] spctl assessment failed.");
  console.warn(spctl.output || "(no details)");
  if (strictSpctl) {
    process.exitCode = 2;
  } else {
    console.warn("[verify-mac-build] Continuing because this is an internal non-notarized build.");
  }
}
