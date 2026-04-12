const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const parseEnvBoolean = (value, fallback = false) => {
  if (value === undefined || value === null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const runCommand = (command, args = [], { allowFailure = false } = {}) => {
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
      return {
        ok: false,
        output: message,
      };
    }
    throw new Error(`${command} ${args.join(" ")} failed:\n${message}`);
  }
};

const resolveAppPath = (context) => {
  const appOutDir = context?.appOutDir;
  const productFilename = context?.packager?.appInfo?.productFilename;
  if (!appOutDir || !productFilename) {
    return null;
  }

  return path.join(appOutDir, `${productFilename}.app`);
};

const hasExplicitDeveloperSigning = () =>
  Boolean(
    process.env.CSC_LINK ||
      process.env.CSC_NAME ||
      process.env.CSC_KEY_PASSWORD ||
      process.env.CSC_INSTALLER_LINK,
  );

module.exports = async function afterSign(context) {
  const platform = context?.electronPlatformName || process.platform;
  if (platform !== "darwin") {
    return;
  }

  const appPath = resolveAppPath(context);
  if (!appPath || !fs.existsSync(appPath)) {
    console.warn("[adhoc-sign] Skipped because the app bundle was not found.");
    return;
  }

  const forceAdhoc = parseEnvBoolean(process.env.FORCE_ADHOC_SIGN, false);
  const enableAdhoc = parseEnvBoolean(process.env.ENABLE_ADHOC_SIGN, true);
  const strictSpctl = parseEnvBoolean(process.env.STRICT_SPCTL, false);

  if (!forceAdhoc && !enableAdhoc) {
    console.log("[adhoc-sign] Skipped because ENABLE_ADHOC_SIGN=false.");
    return;
  }

  if (!forceAdhoc && hasExplicitDeveloperSigning()) {
    console.log("[adhoc-sign] Skipped because explicit developer signing credentials were detected.");
    return;
  }

  console.log(`[adhoc-sign] Signing ${appPath}`);
  runCommand("codesign", ["--force", "--deep", "--sign", "-", "--timestamp=none", appPath]);

  console.log("[adhoc-sign] Verifying codesign signature...");
  runCommand("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);

  console.log("[adhoc-sign] Running spctl assessment...");
  const spctl = runCommand("spctl", ["--assess", "-vv", "--type", "execute", appPath], {
    allowFailure: true,
  });
  if (spctl.ok) {
    console.log("[adhoc-sign] spctl assessment passed.");
    if (spctl.output) {
      console.log(spctl.output);
    }
    return;
  }

  const message = `[adhoc-sign] spctl assessment failed.\n${spctl.output || "(no details)"}`;
  if (strictSpctl) {
    throw new Error(message);
  }

  console.warn(message);
  console.warn("[adhoc-sign] Continuing because this is an internal non-notarized build.");
};
