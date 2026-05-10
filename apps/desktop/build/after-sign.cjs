const fs = require("node:fs");
const path = require("node:path");
const {
  hasExplicitDeveloperSigning,
  isReleaseSigningEnabled,
  runCommand,
} = require("./notarize-macos.cjs");

const resolveAppPath = (context) => {
  const appOutDir = context?.appOutDir;
  const productFilename = context?.packager?.appInfo?.productFilename;
  if (!appOutDir || !productFilename) {
    return null;
  }

  return path.join(appOutDir, `${productFilename}.app`);
};

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

  const forceAdhoc = ["1", "true", "yes", "on"].includes(String(process.env.FORCE_ADHOC_SIGN || "").trim().toLowerCase());
  const enableAdhoc = !["0", "false", "no", "off"].includes(String(process.env.ENABLE_ADHOC_SIGN ?? "true").trim().toLowerCase());
  const strictSpctl = ["1", "true", "yes", "on"].includes(String(process.env.STRICT_SPCTL || "").trim().toLowerCase());

  if (!forceAdhoc && !enableAdhoc) {
    console.log("[adhoc-sign] Skipped because ENABLE_ADHOC_SIGN=false.");
    return;
  }

  if (!forceAdhoc && isReleaseSigningEnabled()) {
    console.log("[adhoc-sign] Skipped because release signing is enabled and a developer identity is expected.");
    return;
  }

  const infoPlistPath = path.join(appPath, "Contents", "Info.plist");
  if (fs.existsSync(infoPlistPath)) {
    console.log("[adhoc-sign] Hardening App Transport Security.");
    runCommand("plutil", ["-replace", "NSAppTransportSecurity.NSAllowsArbitraryLoads", "-bool", "NO", infoPlistPath]);
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
