import type { AppUpdateAssetArchitecture } from "@contracts";

export type GithubReleaseAsset = {
  name?: string;
  browser_download_url?: string;
  size?: number;
};

export type GithubRelease = {
  tag_name?: string;
  name?: string;
  html_url?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: GithubReleaseAsset[];
};

export type AppUpdateCandidate = {
  latestVersion: string;
  releaseName: string;
  releasePageUrl: string;
  assetName: string;
  assetSizeBytes: number | null;
  assetArchitecture: AppUpdateAssetArchitecture;
  assetDownloadUrl: string;
};

const parseVersionParts = (value: string) =>
  value
    .replace(/^v/i, "")
    .split(".")
    .map((part) => Number.parseInt(part.replace(/[^0-9].*$/, ""), 10) || 0)
    .slice(0, 3);

const getMajorVersion = (value: string) => parseVersionParts(value)[0] ?? 0;

export const hasNewMajorVersion = (candidate: string, current: string) => getMajorVersion(candidate) > getMajorVersion(current);

const normalizeAssetArchitecture = (name: string): AppUpdateAssetArchitecture => {
  const normalized = name.toLowerCase();
  if (normalized.includes("universal")) return "universal";
  if (normalized.includes("arm64") || normalized.includes("aarch64")) return "arm64";
  if (normalized.includes("x64") || normalized.includes("amd64")) return "x64";
  return "unknown";
};

const isMatchingArchitecture = (assetArch: AppUpdateAssetArchitecture, runtimeArch: NodeJS.Architecture) => {
  if (assetArch === "universal") return true;
  if (runtimeArch === "arm64") return assetArch === "arm64";
  if (runtimeArch === "x64") return assetArch === "x64";
  return assetArch === "unknown";
};

export const pickReleaseDmgAsset = (
  assets: GithubReleaseAsset[] | undefined,
  runtimeArch: NodeJS.Architecture,
) => {
  const dmgAssets = (assets ?? [])
    .filter((asset) => typeof asset.name === "string" && asset.name.toLowerCase().endsWith(".dmg"))
    .filter((asset) => typeof asset.browser_download_url === "string" && asset.browser_download_url.trim().length > 0);

  if (dmgAssets.length === 0) {
    return null;
  }

  const ranked = dmgAssets
    .map((asset) => ({
      asset,
      architecture: normalizeAssetArchitecture(asset.name!),
    }))
    .sort((left, right) => {
      const leftScore = isMatchingArchitecture(left.architecture, runtimeArch) ? 0 : left.architecture === "universal" ? 1 : 2;
      const rightScore = isMatchingArchitecture(right.architecture, runtimeArch) ? 0 : right.architecture === "universal" ? 1 : 2;
      return leftScore - rightScore;
    });

  return ranked[0] ?? null;
};

export const selectMajorReleaseCandidate = (
  releases: GithubRelease[],
  currentVersion: string,
  runtimeArch: NodeJS.Architecture,
  releasePageUrlFallback: string,
): AppUpdateCandidate | null => {
  for (const release of releases) {
    const latestVersion = release.tag_name?.trim();
    if (!latestVersion || release.draft || release.prerelease || !hasNewMajorVersion(latestVersion, currentVersion)) {
      continue;
    }

    const selectedAsset = pickReleaseDmgAsset(release.assets, runtimeArch);
    if (!selectedAsset?.asset.name || !selectedAsset.asset.browser_download_url) {
      continue;
    }

    return {
      latestVersion,
      releaseName: release.name?.trim() || latestVersion,
      releasePageUrl: release.html_url?.trim() || releasePageUrlFallback,
      assetName: selectedAsset.asset.name,
      assetSizeBytes: Number.isFinite(selectedAsset.asset.size) ? selectedAsset.asset.size ?? null : null,
      assetArchitecture: selectedAsset.architecture,
      assetDownloadUrl: selectedAsset.asset.browser_download_url,
    };
  }

  return null;
};
