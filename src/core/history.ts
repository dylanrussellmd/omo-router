/**
 * Switch history: rolling log of the agent→model mappings each apply
 * displaced.
 *
 * Every `agent-router use <new>` writes the *current* (about-to-be-displaced)
 * mapping here — capture-shaped JSON — under a filename that encodes the
 * timestamp and the from→to transition. `agent-router back` walks this
 * directory's names to compute multi-step reverts.
 *
 * Why filenames carry the metadata (vs. a separate index.json):
 *   - `ls -t history/` already gives chronological order.
 *   - One-file-per-event means concurrent CLIs can't corrupt an index.
 *   - The user can delete history entries manually if they care to.
 */

import { mkdir, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile } from "./atomic-write.js";
import { timestampStamp } from "./backups.js";
import { IOError } from "./errors.js";

export interface HistoryEntry {
  /** Filename without `.json` extension. Sortable: lex order = chronological. */
  readonly id: string;
  /** Absolute path to the JSON content file. */
  readonly path: string;
  /** Timestamp parsed from filename. */
  readonly timestamp: string;
  /** Stack name that *was* active when this snapshot was taken. May be a sentinel. */
  readonly fromStack: string;
  /** Stack name being switched *to* when this snapshot was taken. */
  readonly toStack: string;
}

/**
 * Filename format: `<isoStamp>__<from>-to-<to>.json`.
 *
 * `<isoStamp>` uses dashes instead of `:`/`.` so it's path-safe (see
 * `backups.timestampStamp`). `__` separates timestamp from labels so the
 * parser can find it unambiguously even if stack names contain `-`.
 */
function filename(fromStack: string, toStack: string, when: Date = new Date()): string {
  const stamp = timestampStamp(when);
  // Stack names are user-supplied. Sanitize lightly so filenames stay
  // reasonable. We allow alphanumerics, dash, underscore, dot, and
  // parentheses (for the `(none)` label). Everything else collapses to `_`.
  const safe = (s: string) => s.replace(/[^A-Za-z0-9._()-]/g, "_");
  return `${stamp}__${safe(fromStack)}-to-${safe(toStack)}.json`;
}

/** Parse a filename back into structured metadata. Returns null on mismatch. */
export function parseHistoryFilename(name: string): Omit<HistoryEntry, "path"> | null {
  if (!name.endsWith(".json")) return null;
  const stem = name.slice(0, -".json".length);
  const sep = stem.indexOf("__");
  if (sep < 0) return null;
  const stamp = stem.slice(0, sep);
  const rest = stem.slice(sep + 2);
  const toIdx = rest.lastIndexOf("-to-");
  if (toIdx < 0) return null;
  return {
    id: stem,
    timestamp: stamp,
    fromStack: rest.slice(0, toIdx),
    toStack: rest.slice(toIdx + "-to-".length),
  };
}

/**
 * Append a snapshot of `displacedContent` to history under a deterministic
 * filename derived from `fromStack`/`toStack` and the current time.
 *
 * @returns The id (filename stem) of the created entry.
 */
export async function appendHistory(
  historyDir: string,
  fromStack: string,
  toStack: string,
  displacedContent: string,
): Promise<string> {
  await mkdir(historyDir, { recursive: true });
  const name = filename(fromStack, toStack);
  await atomicWriteFile(path.join(historyDir, name), displacedContent);
  return name.slice(0, -".json".length);
}

/** List history entries newest-first. Returns empty array if dir missing. */
export async function listHistory(historyDir: string): Promise<HistoryEntry[]> {
  let names: string[];
  try {
    names = await readdir(historyDir);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new IOError(`Failed to read history dir: ${(cause as Error).message}`, cause);
  }
  const entries: HistoryEntry[] = [];
  for (const n of names) {
    const parsed = parseHistoryFilename(n);
    if (parsed) entries.push({ ...parsed, path: path.join(historyDir, n) });
  }
  // Sort descending by timestamp (which is in lex-sortable ISO form).
  entries.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));
  return entries;
}

/**
 * Trim history to at most `keep` entries, deleting oldest files first.
 * Default 20 mirrors the plan. Returns the ids of deleted entries.
 */
export async function trimHistory(historyDir: string, keep = 20): Promise<string[]> {
  const all = await listHistory(historyDir);
  if (all.length <= keep) return [];
  const toDelete = all.slice(keep);
  const deleted: string[] = [];
  for (const e of toDelete) {
    try {
      await unlink(e.path);
      deleted.push(e.id);
    } catch (cause) {
      // Best-effort: log silently and keep going. A leftover history file is
      // harmless beyond a bit of disk; failing the whole switch over a stale
      // unlink would be worse UX.
      void cause;
    }
  }
  return deleted;
}
