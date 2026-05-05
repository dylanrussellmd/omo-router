/**
 * Atomic file writes via tmp-then-rename.
 *
 * Why atomic? The user's `oh-my-openagent.json` may be read concurrently by:
 *   - the running `oh-my-openagent` plugin during opencode startup,
 *   - a parallel `omo-router` invocation in another terminal,
 *   - the upstream installer.
 *
 * A non-atomic `writeFile` truncates first, so a crash mid-write leaves an
 * empty / partial file and the next opencode startup blows up. Tmp-then-rename
 * guarantees readers see either the old contents or the new contents — never
 * a half-written file. POSIX rename(2) is atomic on the same filesystem.
 *
 * The tmp file lives next to the destination (same dir = same FS) and has a
 * `.omotmp-<pid>-<rand>` suffix so concurrent writers don't collide.
 */

import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { IOError } from "./errors.js";

/**
 * Write `contents` to `destPath` atomically. Creates parent directories if
 * missing. On failure cleans up the tmp file (best-effort).
 *
 * @param destPath Absolute destination path.
 * @param contents UTF-8 string to write. Use `JSON.stringify` for JSON.
 */
export async function atomicWriteFile(destPath: string, contents: string): Promise<void> {
  const dir = path.dirname(destPath);
  await mkdir(dir, { recursive: true });

  const tmp = path.join(
    dir,
    `.${path.basename(destPath)}.omotmp-${process.pid}-${randomBytes(4).toString("hex")}`,
  );

  try {
    await writeFile(tmp, contents, { encoding: "utf8", mode: 0o644 });
    await rename(tmp, destPath);
  } catch (cause) {
    await unlink(tmp).catch(() => {
      // Best-effort cleanup. The tmp suffix means leftover files are
      // recognizable (`.omotmp-*`) and harmless if we miss one.
    });
    throw new IOError(`Atomic write failed for ${destPath}: ${(cause as Error).message}`, cause);
  }
}

/**
 * Convenience: stringify with 2-space indent + trailing newline (POSIX
 * text-file convention; also keeps `git diff` clean), then atomic-write.
 */
export async function atomicWriteJson(destPath: string, value: unknown): Promise<void> {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  await atomicWriteFile(destPath, text);
}
