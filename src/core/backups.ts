/**
 * One-shot timestamped backups of opencode config files.
 *
 * Mirrors the convention the user already employs (the `bunx oh-my-opencode
 * install` workflow drops backups under `~/.config/opencode/.backups/<stamp>/`),
 * so files dropped here are recognizable to the user and to that tool.
 */

import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { IOError } from "./errors.js";

/** Format: `2026-05-04T13-22-01-000Z` — ISO with `:` and `.` swapped to `-` so it's path-safe. */
export function timestampStamp(date: Date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

/**
 * Copy `files` (those that exist) into `${backupsRoot}/<stamp>/`.
 *
 * @param backupsRoot Typically `${opencodeConfigDir}/.backups`.
 * @param files Absolute paths to back up. Missing files are skipped silently.
 * @returns Absolute path of the timestamped backup directory.
 */
export async function backupFiles(
  backupsRoot: string,
  files: ReadonlyArray<string>,
): Promise<string> {
  const stamp = timestampStamp();
  const dir = path.join(backupsRoot, stamp);
  await mkdir(dir, { recursive: true });

  for (const f of files) {
    if (!existsSync(f)) continue;
    try {
      await copyFile(f, path.join(dir, path.basename(f)));
    } catch (cause) {
      throw new IOError(`Backup copy failed for ${f}: ${(cause as Error).message}`, cause);
    }
  }
  return dir;
}
