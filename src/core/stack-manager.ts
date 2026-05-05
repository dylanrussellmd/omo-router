/**
 * The orchestration layer. Composes paths + state + history + validator + I/O
 * into the operations the CLI and plugin tools call.
 *
 * Public surface:
 *   - `listStacks`             list available stack names
 *   - `readStack`              parse a stack file
 *   - `getActiveStackName`     read state.json
 *   - `switchTo`               the big one: validate + snapshot-back + history + write live + update state
 *   - `back`                   compute target from state.previousActive and call switchTo
 *   - `restoreFromHistory`     copy a history snapshot back to live + history-append + update state
 *   - `addStack` / `removeStack` / `importStack` / `exportStack`
 *
 * Every write goes through `atomicWriteJson` / `atomicWriteFile` so concurrent
 * readers see consistent state.
 */

import { copyFile, mkdir, readFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { atomicWriteFile, atomicWriteJson } from "./atomic-write.js";
import {
  IOError,
  StackNotFoundError,
  UserError,
  ValidationError,
  type OmoError,
} from "./errors.js";
import { appendHistory, readHistoryEntry, trimHistory } from "./history.js";
import type { OmoPaths } from "./paths.js";
import {
  RESTORED_SENTINEL_PREFIX,
  StackFileSchema,
  type StackFile,
} from "./schema.js";
import { readState, writeState } from "./state.js";
import { validateStackOrThrow, type ValidateOptions } from "./validator.js";

/* ------------------------------------------------------------------------- *
 * read-only helpers                                                          *
 * ------------------------------------------------------------------------- */

export async function listStacks(paths: OmoPaths): Promise<string[]> {
  if (!existsSync(paths.stacksDir)) return [];
  let names: string[];
  try {
    names = await readdir(paths.stacksDir);
  } catch (cause) {
    throw new IOError(`Failed to read stacks dir: ${(cause as Error).message}`, cause);
  }
  return names
    .filter((n) => n.endsWith(".json"))
    .map((n) => n.slice(0, -".json".length))
    .sort();
}

export function stackPath(paths: OmoPaths, name: string): string {
  return path.join(paths.stacksDir, `${name}.json`);
}

/** Read and validate a stack file. Throws `StackNotFoundError` or `ValidationError`. */
export async function readStack(paths: OmoPaths, name: string): Promise<StackFile> {
  const filePath = stackPath(paths, name);
  if (!existsSync(filePath)) {
    throw new StackNotFoundError(name, await listStacks(paths));
  }
  const raw = await readFile(filePath, "utf8").catch((cause: Error) => {
    throw new IOError(`Failed to read ${filePath}: ${cause.message}`, cause);
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new ValidationError(
      `Stack "${name}" is not valid JSON: ${(cause as Error).message}`,
      filePath,
    );
  }
  const result = StackFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new ValidationError(
      `Stack "${name}" failed validation: ${result.error.issues.map((i) => i.message).join("; ")}`,
      filePath,
      result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }
  return result.data;
}

/** Raw file contents (string) — used when we want to forward bytes verbatim. */
export async function readStackRaw(paths: OmoPaths, name: string): Promise<string> {
  const filePath = stackPath(paths, name);
  if (!existsSync(filePath)) {
    throw new StackNotFoundError(name, await listStacks(paths));
  }
  return readFile(filePath, "utf8");
}

export async function getActiveStackName(paths: OmoPaths): Promise<string | null> {
  const state = await readState(paths.statePath);
  return state?.active ?? null;
}

/* ------------------------------------------------------------------------- *
 * switchTo — the central operation                                           *
 * ------------------------------------------------------------------------- */

export interface SwitchOptions {
  /** Default true. Set false to skip the pre-switch model-validation gate. */
  readonly validate?: boolean;
  /** Default false. When true, switch even if validation finds missing models. */
  readonly forceInvalid?: boolean;
  /** Default true. Set false to skip writing live→stacks/<prevActive>.json. */
  readonly snapshotBack?: boolean;
  /** Plumbed to validator for tests / mocks. */
  readonly validateOptions?: ValidateOptions;
}

export interface SwitchResult {
  readonly previous: string | null;
  readonly current: string;
  readonly snapshottedFrom: string | null;
  readonly historyId: string;
  readonly restartRequired: true;
}

/**
 * Switch active stack to `name`. See `docs/Architecture.md` for the full
 * algorithm; the short version:
 *
 *   1. Read target stack (throws if missing).
 *   2. Validate target's model IDs (unless --no-validate).
 *   3. Append current live config to history.
 *   4. Snapshot-back: if live drifted from prev source stack, write live
 *      content back to that source stack first.
 *   5. Atomic-write target stack content to live.
 *   6. Update state.json.
 *   7. Trim history to 20.
 */
export async function switchTo(
  paths: OmoPaths,
  name: string,
  options: SwitchOptions = {},
): Promise<SwitchResult> {
  const validate = options.validate ?? true;
  const snapshotBack = options.snapshotBack ?? true;
  const forceInvalid = options.forceInvalid ?? false;

  // Step 1: load target. Throws StackNotFoundError if it doesn't exist.
  const target = await readStack(paths, name);
  const targetRaw = await readStackRaw(paths, name);

  // Step 2: pre-switch model validation gate.
  if (validate && !forceInvalid) {
    await validateStackOrThrow(name, target, options.validateOptions);
  }

  const prevState = await readState(paths.statePath);
  const prevActive = prevState?.active ?? null;
  const liveExists = existsSync(paths.liveConfigPath);
  const liveRaw = liveExists ? await readFile(paths.liveConfigPath, "utf8") : "";

  // Step 3: history append (snapshot of what we're displacing).
  const historyId = await appendHistory(
    paths.historyDir,
    prevActive ?? "(none)",
    name,
    liveRaw,
  );

  // Step 4: snapshot-back. Only meaningful when:
  //   - we have a prev active stack name on disk, AND
  //   - the prev active is a real stack (not a (restored:...) sentinel), AND
  //   - the live content actually differs from the source stack file.
  let snapshottedFrom: string | null = null;
  if (snapshotBack && prevActive && !prevActive.startsWith(RESTORED_SENTINEL_PREFIX) && liveExists) {
    const prevStackFile = stackPath(paths, prevActive);
    if (existsSync(prevStackFile)) {
      const prevRaw = await readFile(prevStackFile, "utf8");
      if (jsonEqual(prevRaw, liveRaw) === false) {
        await atomicWriteFile(prevStackFile, liveRaw);
        snapshottedFrom = prevActive;
      }
    }
  }

  // Step 5: write live config (target stack content, byte-for-byte).
  await atomicWriteFile(paths.liveConfigPath, targetRaw);

  // Step 6: update state.
  await writeState(paths.statePath, {
    version: 1,
    active: name,
    previousActive: prevActive,
    lastSwitchedAt: new Date().toISOString(),
    lastSnapshottedFrom: snapshottedFrom,
  });

  // Step 7: trim history (best-effort; never blocks the switch).
  await trimHistory(paths.historyDir).catch(() => {});

  return {
    previous: prevActive,
    current: name,
    snapshottedFrom,
    historyId,
    restartRequired: true,
  };
}

/**
 * Compare two JSON-text blobs ignoring formatting (whitespace + key order).
 * Returns false on parse error so we never miss a snapshot-back over a
 * malformed file.
 */
function jsonEqual(a: string, b: string): boolean {
  try {
    const av = sortKeys(JSON.parse(a));
    const bv = sortKeys(JSON.parse(b));
    return JSON.stringify(av) === JSON.stringify(bv);
  } catch {
    return false;
  }
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) sorted[k] = sortKeys(obj[k]);
  return sorted;
}

/* ------------------------------------------------------------------------- *
 * back / restore                                                             *
 * ------------------------------------------------------------------------- */

/**
 * Undo last N switches (default 1). Implemented in terms of `switchTo` so
 * each step records a fresh history entry — invariants stay consistent.
 *
 * For N=1 we simply target `state.previousActive`. For N>1 we walk history
 * backward to find the n-th previous toStack (best-effort: history can
 * truncate, in which case we stop at whatever we have).
 */
export async function back(
  paths: OmoPaths,
  n = 1,
  options: SwitchOptions = {},
): Promise<SwitchResult> {
  if (n < 1) throw new UserError("`back -n` must be at least 1.");
  const state = await readState(paths.statePath);
  if (!state || !state.previousActive) {
    throw new UserError("No previous stack to revert to.");
  }
  // For N == 1 we already know the target.
  if (n === 1) return switchTo(paths, state.previousActive, options);
  // For N > 1 use our own history. Each history entry has fromStack/toStack;
  // walking back N steps means landing on the fromStack of the N-th-newest
  // entry whose toStack matches the chain. Simpler heuristic: the N-th
  // previous active is the (N-1)-th oldest entry's fromStack relative to now.
  const { listHistory } = await import("./history.js");
  const entries = await listHistory(paths.historyDir);
  if (entries.length < n) {
    throw new UserError(
      `Cannot go back ${n} steps; only ${entries.length} switch${entries.length === 1 ? "" : "es"} in history.`,
    );
  }
  // entries[0] is the newest = the snapshot taken right before the LAST switch.
  // entries[n-1].fromStack is the stack that was active before the n-th-most-recent switch.
  const target = entries[n - 1]?.fromStack;
  if (!target || target === "(none)" || target.startsWith(RESTORED_SENTINEL_PREFIX)) {
    throw new UserError(`Cannot go back ${n} steps to a non-stack target ("${target}").`);
  }
  return switchTo(paths, target, options);
}

export interface RestoreResult {
  readonly id: string;
  readonly historyId: string;
  readonly restartRequired: true;
}

/**
 * Copy a history entry's raw content into `oh-my-openagent.json`. Sets
 * `state.active` to the `(restored:<id>)` sentinel — `omo-router list`
 * surfaces that as "no named stack active" and prompts the user to bind
 * with `use <name>` once they're sure of the contents.
 */
export async function restoreFromHistory(
  paths: OmoPaths,
  id: string,
): Promise<RestoreResult> {
  const content = await readHistoryEntry(paths.historyDir, id);

  // Snapshot what's about to be displaced first (otherwise we lose it).
  const liveRaw = existsSync(paths.liveConfigPath)
    ? await readFile(paths.liveConfigPath, "utf8")
    : "";
  const prevState = await readState(paths.statePath);
  const prevActive = prevState?.active ?? "(none)";
  const sentinel = `${RESTORED_SENTINEL_PREFIX}${id})`;
  const historyId = await appendHistory(
    paths.historyDir,
    prevActive,
    sentinel,
    liveRaw,
  );

  await atomicWriteFile(paths.liveConfigPath, content);

  await writeState(paths.statePath, {
    version: 1,
    active: sentinel,
    previousActive: prevActive,
    lastSwitchedAt: new Date().toISOString(),
    lastSnapshottedFrom: null,
  });
  await trimHistory(paths.historyDir).catch(() => {});

  return { id, historyId, restartRequired: true };
}

/* ------------------------------------------------------------------------- *
 * add / remove / import / export                                             *
 * ------------------------------------------------------------------------- */

export interface AddStackOptions {
  /** When true, copy current `oh-my-openagent.json` content as the new stack. */
  readonly fromActive?: boolean;
  /** Or: read content from this absolute path. */
  readonly fromFile?: string;
  /** When true, overwrite existing stack of the same name. */
  readonly force?: boolean;
}

/** Empty template used when neither `fromActive` nor `fromFile` is given. */
const EMPTY_STACK_TEMPLATE = `{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/oh-my-opencode.schema.json",
  "agents": {},
  "categories": {}
}
`;

export async function addStack(
  paths: OmoPaths,
  name: string,
  options: AddStackOptions = {},
): Promise<void> {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new UserError(
      `Stack name "${name}" contains invalid characters. Allowed: A-Z a-z 0-9 . _ -`,
    );
  }
  const dest = stackPath(paths, name);
  if (existsSync(dest) && !options.force) {
    throw new UserError(`Stack "${name}" already exists. Use --force to overwrite.`);
  }
  await mkdir(paths.stacksDir, { recursive: true });

  if (options.fromActive && options.fromFile) {
    throw new UserError("Cannot combine --from-active and --from <file>.");
  }
  if (options.fromActive) {
    if (!existsSync(paths.liveConfigPath)) {
      throw new UserError(
        `Cannot --from-active: no oh-my-openagent.json at ${paths.liveConfigPath}.`,
      );
    }
    await copyFile(paths.liveConfigPath, dest);
    return;
  }
  if (options.fromFile) {
    if (!existsSync(options.fromFile)) {
      throw new UserError(`--from file does not exist: ${options.fromFile}`);
    }
    await copyFile(options.fromFile, dest);
    return;
  }
  await atomicWriteFile(dest, EMPTY_STACK_TEMPLATE);
}

export async function removeStack(
  paths: OmoPaths,
  name: string,
  options: { readonly force?: boolean } = {},
): Promise<void> {
  const filePath = stackPath(paths, name);
  if (!existsSync(filePath)) {
    throw new StackNotFoundError(name, await listStacks(paths));
  }
  const active = await getActiveStackName(paths);
  if (active === name && !options.force) {
    throw new UserError(`"${name}" is the active stack. Use --force to remove anyway.`);
  }
  await unlink(filePath);
}

export async function importStack(
  paths: OmoPaths,
  name: string,
  fromFile: string,
  options: { readonly force?: boolean } = {},
): Promise<void> {
  await addStack(paths, name, { fromFile, ...(options.force !== undefined ? { force: options.force } : {}) });
}

export async function exportStack(
  paths: OmoPaths,
  name: string,
  toFile: string,
): Promise<void> {
  const filePath = stackPath(paths, name);
  if (!existsSync(filePath)) {
    throw new StackNotFoundError(name, await listStacks(paths));
  }
  await mkdir(path.dirname(toFile), { recursive: true });
  await copyFile(filePath, toFile);
}

/** Helper used by callers to test for any of our typed errors uniformly. */
export function isOmoError(e: unknown): e is OmoError {
  return (
    e instanceof Error &&
    typeof (e as { name?: string }).name === "string" &&
    /Error$/.test((e as Error).name)
  );
}
