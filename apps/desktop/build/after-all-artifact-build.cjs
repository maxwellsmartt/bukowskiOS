const fs = require("node:fs");
const path = require("node:path");

const {
  hasNotaryCredentials,
  isReleaseSigningEnabled,
  notarizeArtifact,
  stapleArtifact,
} = require("./notarize-macos.cjs");

const collectArtifactPaths = (buildResult) => {
  if (Array.isArray(buildResult?.artifactPaths)) {
    return buildResult.artifactPaths;
  }

  if (typeof buildResult?.outDir === "string" && fs.existsSync(buildResult.outDir)) {
    return fs.readdirSync(buildResult.outDir).map((entry) => path.join(buildResult.outDir, entry));
  }

  return [];
};

module.exports = async function afterAllArtifactBuild(buildResult) {
  const platform = buildResult?.platformToTargets ? "darwin" : process.platform;
  if (platform !== "darwin") {
    return;
  }

  if (!isReleaseSigningEnabled()) {
    console.log("[after-all-artifact-build] Skipping notarization because release signing is not enabled.");
    return;
  }

  if (!hasNotaryCredentials()) {
    console.log("[after-all-artifact-build] Skipping notarization because Apple credentials are missing.");
    return;
  }

  const artifactPaths = collectArtifactPaths(buildResult);

  const normalizedArtifacts = artifactPaths
    .map((artifactPath) => path.resolve(artifactPath))
    .filter((artifactPath) => fs.existsSync(artifactPath))
    .filter((artifactPath) => [".dmg", ".zip"].includes(path.extname(artifactPath)));

  for (const artifactPath of normalizedArtifacts) {
    notarizeArtifact(artifactPath);
    stapleArtifact(artifactPath);
  }
};
