import { describe, expect, it } from "vitest";

import {
  hasNewMajorVersion,
  pickReleaseDmgAsset,
  selectMajorReleaseCandidate,
} from "../../electron/main/services/app/appUpdateShared";

describe("app update service helpers", () => {
  it("only treats a higher major as an available update", () => {
    expect(hasNewMajorVersion("v2.0.0", "1.9.9")).toBe(true);
    expect(hasNewMajorVersion("v1.8.0", "1.7.4")).toBe(false);
    expect(hasNewMajorVersion("v1.7.5", "1.7.4")).toBe(false);
  });

  it("prefers the dmg that matches the current architecture", () => {
    const selected = pickReleaseDmgAsset(
      [
        { name: "bukowskiOS-2.0.0-arm64.dmg", browser_download_url: "https://example.com/arm64.dmg", size: 200 },
        { name: "bukowskiOS-2.0.0-x64.dmg", browser_download_url: "https://example.com/x64.dmg", size: 210 },
      ],
      "arm64",
    );

    expect(selected?.asset.name).toBe("bukowskiOS-2.0.0-arm64.dmg");
    expect(selected?.architecture).toBe("arm64");
  });

  it("ignores draft, prerelease and same-major releases", () => {
    const selected = selectMajorReleaseCandidate(
      [
        {
          tag_name: "v1.9.0",
          name: "1.9.0",
          html_url: "https://example.com/release-1",
          assets: [{ name: "bukowskiOS-1.9.0-arm64.dmg", browser_download_url: "https://example.com/1.9.dmg" }],
        },
        {
          tag_name: "v2.0.0-beta.1",
          name: "2.0.0 beta",
          html_url: "https://example.com/release-2",
          prerelease: true,
          assets: [{ name: "bukowskiOS-2.0.0-beta-arm64.dmg", browser_download_url: "https://example.com/2.0-beta.dmg" }],
        },
        {
          tag_name: "v3.0.0",
          name: "3.0.0",
          html_url: "https://example.com/release-3",
          draft: true,
          assets: [{ name: "bukowskiOS-3.0.0-arm64.dmg", browser_download_url: "https://example.com/3.0.dmg" }],
        },
      ],
      "1.7.4",
      "arm64",
      "https://example.com/releases/latest",
    );

    expect(selected).toBeNull();
  });

  it("selects the first published major release with a valid dmg", () => {
    const selected = selectMajorReleaseCandidate(
      [
        {
          tag_name: "v2.1.0",
          name: "2.1.0",
          html_url: "https://example.com/release-2-1",
          assets: [{ name: "bukowskiOS-2.1.0-notes.txt", browser_download_url: "https://example.com/notes.txt" }],
        },
        {
          tag_name: "v2.0.0",
          name: "2.0.0",
          html_url: "https://example.com/release-2",
          assets: [{ name: "bukowskiOS-2.0.0-universal.dmg", browser_download_url: "https://example.com/2.0.dmg", size: 512 }],
        },
      ],
      "1.6.0",
      "x64",
      "https://example.com/releases/latest",
    );

    expect(selected?.latestVersion).toBe("v2.0.0");
    expect(selected?.assetName).toBe("bukowskiOS-2.0.0-universal.dmg");
    expect(selected?.assetArchitecture).toBe("universal");
  });
});
