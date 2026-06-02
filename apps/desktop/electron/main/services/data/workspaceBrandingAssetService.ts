import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

import type { SupabaseDocumentStorage } from "./supabaseDocumentStorageService";
import { assertPathWithinRoot } from "../../security/pathSafety";

export type WorkspaceBrandingAssetKey = "logo" | "seal" | "signature";

type WorkspaceBrandingAssetServiceOptions = {
  userDataPath: string;
  getStorageRoot?: () => string | null | undefined;
  storage?: Pick<SupabaseDocumentStorage, "download" | "enabled">;
};

type CachedBrandingAssetRow = {
  storage_path: string | null;
  source_url: string | null;
};

const ensureWorkspaceBrandingAssetSchema = (db: DatabaseSync) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_branding_assets (
      workspace_id TEXT NOT NULL,
      asset_key TEXT NOT NULL,
      source_url TEXT,
      storage_object_key TEXT,
      mime_type TEXT,
      original_name TEXT,
      storage_path TEXT,
      byte_size INTEGER NOT NULL DEFAULT 0,
      content_hash TEXT,
      status TEXT NOT NULL DEFAULT 'available',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, asset_key)
    );
    CREATE INDEX IF NOT EXISTS idx_workspace_branding_assets_source
      ON workspace_branding_assets(source_url);
  `);
};

const inferExtension = (url: string, mimeType: string | null | undefined) => {
  const cleanPath = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  })();
  const fromPath = path.extname(cleanPath).replace(".", "").toLowerCase();
  if (fromPath && fromPath.length <= 8) return fromPath;
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/svg+xml") return "svg";
  return "png";
};

const dataUrlToBuffer = (url: string) => {
  const [metadata = "", payload = ""] = url.split(",", 2);
  if (!metadata.startsWith("data:") || !payload) return null;
  const mimeType = metadata.slice(5).split(";")[0] || "application/octet-stream";
  const buffer = Buffer.from(payload, metadata.includes(";base64") ? "base64" : "utf8");
  return { buffer, mimeType };
};

const parseWorkspaceAssetsObjectKey = (url: string | null | undefined) => {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const markerOptions = [
      "/storage/v1/object/public/workspace-assets/",
      "/storage/v1/object/workspace-assets/",
      "/storage/v1/object/sign/workspace-assets/",
    ];
    for (const marker of markerOptions) {
      const index = parsed.pathname.indexOf(marker);
      if (index >= 0) {
        return decodeURIComponent(parsed.pathname.slice(index + marker.length));
      }
    }
  } catch {
    return null;
  }
  return null;
};

const fetchPublicAsset = async (url: string) => {
  if (url.startsWith("data:")) {
    return dataUrlToBuffer(url);
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
  } catch {
    return null;
  }

  const response = await fetch(url);
  if (!response.ok) return null;
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    mimeType: response.headers.get("content-type") ?? "application/octet-stream",
  };
};

export const createWorkspaceBrandingAssetService = (
  db: DatabaseSync,
  options: WorkspaceBrandingAssetServiceOptions,
) => {
  ensureWorkspaceBrandingAssetSchema(db);

  const storageRoot = () => options.getStorageRoot?.() || options.userDataPath;
  const localDirectory = (workspaceId: string) => path.join(storageRoot(), "workspace-branding-assets", workspaceId);
  const resolveCachedPath = (storagePath: string) => {
    try {
      return assertPathWithinRoot(storagePath, storageRoot());
    } catch {
      return null;
    }
  };

  const cacheAsset = (
    workspaceId: string,
    assetKey: WorkspaceBrandingAssetKey,
    sourceUrl: string,
    objectKey: string | null,
    buffer: Buffer,
    mimeType: string | null | undefined,
  ) => {
    const now = new Date().toISOString();
    const hash = createHash("sha256").update(buffer).digest("hex");
    const extension = inferExtension(sourceUrl, mimeType);
    const directory = localDirectory(workspaceId);
    fs.mkdirSync(directory, { recursive: true });
    const storagePath = path.join(directory, `${assetKey}-${hash.slice(0, 16)}.${extension}`);
    fs.writeFileSync(storagePath, buffer);
    db.prepare(
      `
        INSERT INTO workspace_branding_assets (
          workspace_id, asset_key, source_url, storage_object_key, mime_type,
          original_name, storage_path, byte_size, content_hash, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?, ?)
        ON CONFLICT(workspace_id, asset_key) DO UPDATE SET
          source_url = excluded.source_url,
          storage_object_key = excluded.storage_object_key,
          mime_type = excluded.mime_type,
          original_name = excluded.original_name,
          storage_path = excluded.storage_path,
          byte_size = excluded.byte_size,
          content_hash = excluded.content_hash,
          status = excluded.status,
          updated_at = excluded.updated_at
      `,
    ).run(
      workspaceId,
      assetKey,
      sourceUrl,
      objectKey,
      mimeType ?? "application/octet-stream",
      path.basename(storagePath),
      storagePath,
      buffer.length,
      hash,
      now,
      now,
    );
    return storagePath;
  };

  const resolveAssetBuffer = async (
    workspaceId: string,
    assetKey: WorkspaceBrandingAssetKey,
    sourceUrl: string | null | undefined,
  ): Promise<Buffer | null> => {
    if (!sourceUrl) return null;

    const cached = db
      .prepare(
        `
          SELECT storage_path, source_url
          FROM workspace_branding_assets
          WHERE workspace_id = ? AND asset_key = ? AND status = 'available'
          LIMIT 1
        `,
      )
      .get(workspaceId, assetKey) as CachedBrandingAssetRow | undefined;
    if (cached?.storage_path && cached.source_url === sourceUrl) {
      const safePath = resolveCachedPath(cached.storage_path);
      if (safePath && fs.existsSync(safePath)) {
        return fs.readFileSync(safePath);
      }
    }

    const objectKey = parseWorkspaceAssetsObjectKey(sourceUrl);
    let downloaded: { buffer: Buffer; mimeType: string | null | undefined } | null = null;

    try {
      downloaded = await fetchPublicAsset(sourceUrl);
    } catch {
      downloaded = null;
    }

    if (!downloaded && objectKey && options.storage?.enabled) {
      const buffer = await options.storage.download(objectKey);
      if (buffer) {
        downloaded = { buffer, mimeType: "application/octet-stream" };
      }
    }

    if (!downloaded) return null;
    cacheAsset(workspaceId, assetKey, sourceUrl, objectKey, downloaded.buffer, downloaded.mimeType);
    return downloaded.buffer;
  };

  return {
    resolveAssetBuffer,
  };
};

export type WorkspaceBrandingAssetService = ReturnType<typeof createWorkspaceBrandingAssetService>;
