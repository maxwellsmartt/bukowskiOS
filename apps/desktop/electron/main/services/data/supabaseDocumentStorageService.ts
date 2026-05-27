import { getDesktopLogger } from "../logger";

const logger = getDesktopLogger("supabase-document-storage");

export type SupabaseDocumentStorageOptions = {
  supabaseUrl: string | undefined;
  bucket: string;
  getAccessToken: () => Promise<string | null | undefined>;
};

/**
 * Thin wrapper over the Supabase Storage REST API for syncing document bytes
 * (invoice images, statement PDFs, …) so they reach other machines/users.
 *
 * Object keys are workspace-scoped (`{workspaceId}/…`); the bucket's RLS
 * policies enforce that only members of that workspace can read/write. All
 * operations are best-effort: when sync is disabled or the user is offline,
 * they return false/null and the caller falls back to the local copy.
 */
export const createSupabaseDocumentStorage = (options: SupabaseDocumentStorageOptions) => {
  const base = options.supabaseUrl?.replace(/\/+$/, "") ?? "";
  const enabled = base.length > 0;
  const objectUrl = (key: string) =>
    `${base}/storage/v1/object/${options.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;

  return {
    enabled,

    async upload(objectKey: string, buffer: Buffer, contentType: string): Promise<boolean> {
      if (!enabled) return false;
      const token = await options.getAccessToken();
      if (!token) return false;
      try {
        const response = await fetch(objectUrl(objectKey), {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": contentType || "application/octet-stream",
            "x-upsert": "true",
            "cache-control": "3600",
          },
          body: new Uint8Array(buffer),
        });
        if (!response.ok) {
          logger.warn("Document upload failed.", { objectKey, status: response.status });
          return false;
        }
        return true;
      } catch (error) {
        logger.warn("Document upload threw.", { objectKey, error: String(error) });
        return false;
      }
    },

    async download(objectKey: string): Promise<Buffer | null> {
      if (!enabled) return null;
      const token = await options.getAccessToken();
      if (!token) return null;
      try {
        const response = await fetch(objectUrl(objectKey), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
          logger.warn("Document download failed.", { objectKey, status: response.status });
          return null;
        }
        return Buffer.from(await response.arrayBuffer());
      } catch (error) {
        logger.warn("Document download threw.", { objectKey, error: String(error) });
        return null;
      }
    },
  };
};

export type SupabaseDocumentStorage = ReturnType<typeof createSupabaseDocumentStorage>;
