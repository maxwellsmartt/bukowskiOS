import fs from "node:fs";
import path from "node:path";

/**
 * Resolve a target path and assert it lives under an allowed root.
 *
 * Used before any `shell.openPath`, `fs.readFileSync`, or `fs.unlinkSync`
 * on a path that came from user data / SQLite (`storage_path` columns).
 * Without this check, an actor who can modify those rows could point them
 * at `/etc/passwd`, `~/.ssh/id_rsa`, or a symlink pointing outside of
 * `userData`, and the desktop app would open/read/delete it.
 *
 * Returns the resolved real path on success; throws otherwise.
 *
 * Notes:
 * - We resolve symlinks on BOTH the root and the target so that `~/Library →
 *   /Users/...` style mismatches don't cause false positives, and so that
 *   a symlink under the root pointing outside is rejected.
 * - When the target does not yet exist (delete-after-failed-write paths),
 *   we fall back to lexical resolution.
 */
export const assertPathWithinRoot = (targetPath: string, allowedRoot: string): string => {
  const realRoot = fs.realpathSync(allowedRoot);
  const resolvedTarget = path.resolve(targetPath);
  const realTarget = fs.existsSync(resolvedTarget)
    ? fs.realpathSync(resolvedTarget)
    : fs.existsSync(path.dirname(resolvedTarget))
      ? path.join(fs.realpathSync(path.dirname(resolvedTarget)), path.basename(resolvedTarget))
      : resolvedTarget;
  const relative = path.relative(realRoot, realTarget);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Refused to access a file outside its workspace storage.");
  }
  return realTarget;
};
