/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: "com.bukowski.desktop",
  productName: "bukowskiOS",
  afterSign: "build/after-sign.cjs",
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
    hardenedRuntime: false,
    identity: null,
  },
};
