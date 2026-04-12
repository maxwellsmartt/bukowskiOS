const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

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

const hasExplicitDeveloperSigning = () =>
  Boolean(process.env.CSC_LINK || process.env.CSC_NAME || process.env.CSC_KEY_PASSWORD || process.env.CSC_INSTALLER_LINK);

const hasNotaryCredentials = () =>
  Boolean(process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID);

const isReleaseSigningEnabled = () =>
  hasExplicitDeveloperSigning() && parseEnvBoolean(process.env.BUKOWSKI_RELEASE_SIGNING, true);

const notarizeArtifact = (artifactPath) => {
  if (!hasNotaryCredentials()) {
    console.log(`[notarize-macos] Skipping notarization for ${artifactPath} because Apple credentials are missing.`);
    return false;
  }

  console.log(`[notarize-macos] Submitting ${artifactPath} to Apple notarization...`);
  runCommand("xcrun", [
    "notarytool",
    "submit",
    artifactPath,
    "--apple-id",
    process.env.APPLE_ID,
    "--password",
    process.env.APPLE_APP_SPECIFIC_PASSWORD,
    "--team-id",
    process.env.APPLE_TEAM_ID,
    "--wait",
  ]);
  console.log(`[notarize-macos] Notarization finished for ${artifactPath}.`);
  return true;
};

const stapleArtifact = (artifactPath) => {
  if (!fs.existsSync(artifactPath)) {
    return false;
  }

  const ext = path.extname(artifactPath);
  const canStaple = ext === ".app" || ext === ".dmg";
  if (!canStaple) {
    return false;
  }

  console.log(`[notarize-macos] Stapling ${artifactPath}...`);
  runCommand("xcrun", ["stapler", "staple", artifactPath]);
  return true;
};

module.exports = {
  hasExplicitDeveloperSigning,
  hasNotaryCredentials,
  isReleaseSigningEnabled,
  notarizeArtifact,
  stapleArtifact,
  runCommand,
};
