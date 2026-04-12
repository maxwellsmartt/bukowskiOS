const hasExplicitDeveloperSigning = Boolean(
  process.env.CSC_LINK ||
    process.env.CSC_NAME ||
    process.env.CSC_KEY_PASSWORD ||
    process.env.CSC_INSTALLER_LINK,
);

const releaseSigningEnabled =
  hasExplicitDeveloperSigning &&
  !["0", "false", "no", "off"].includes(String(process.env.BUKOWSKI_RELEASE_SIGNING ?? "true").trim().toLowerCase());

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: "com.bukowski.desktop",
  productName: "bukowskiOS",
  afterSign: "build/after-sign.cjs",
  afterAllArtifactBuild: "build/after-all-artifact-build.cjs",
  directories: {
    output: "dist-packaged",
    buildResources: "build",
  },
  files: ["dist/**", "dist-electron/**", "package.json"],
  asar: true,
  npmRebuild: false,
  mac: {
    target: ["dmg", "zip"],
    category: "public.app-category.business",
    artifactName: "${productName}-${version}-${arch}.${ext}",
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.plist",
    gatekeeperAssess: false,
    hardenedRuntime: releaseSigningEnabled,
    identity: releaseSigningEnabled ? undefined : null,
  },
  publish:
    process.env.GH_TOKEN || process.env.GITHUB_TOKEN
      ? [
          {
            provider: "github",
            owner: "maxwellsmartt",
            repo: "bukowskiOS",
          },
        ]
      : undefined,
};
