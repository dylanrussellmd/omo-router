/**
 * state.json read/write.
 *
 * `state.json` is the single pointer that says which stack is currently
 * "active" (i.e. its models were most recently applied to the agent files'
 * frontmatter). Every CLI command that switches stacks updates this file
 * atomically so concurrent CLIs and the plugin agree on what's active.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { atomicWriteJson } from "./atomic-write.js";
import { IOError, ValidationError } from "./errors.js";
import { type StateFile, StateFileSchema } from "./schema.js";

/**
 * Read state.json. Returns `null` if the file doesn't exist (uninitialized).
 * Throws `ValidationError` if the file exists but is malformed.
 */
export async function readState(statePath: string): Promise<StateFile | null> {
  if (!existsSync(statePath)) return null;
  let raw: string;
  try {
    raw = await readFile(statePath, "utf8");
  } catch (cause) {
    throw new IOError(`Failed to read ${statePath}: ${(cause as Error).message}`, cause);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new ValidationError(
      `state.json is not valid JSON: ${(cause as Error).message}`,
      statePath,
    );
  }
  const result = StateFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new ValidationError(
      `state.json failed validation: ${result.error.issues.map((i) => i.message).join("; ")}`,
      statePath,
      result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }
  return result.data;
}

/** Atomic write of `state.json`. Validates before writing — defensive. */
export async function writeState(statePath: string, state: StateFile): Promise<void> {
  const result = StateFileSchema.safeParse(state);
  if (!result.success) {
    throw new ValidationError(
      `Refusing to write invalid state.json: ${result.error.issues.map((i) => i.message).join("; ")}`,
      statePath,
    );
  }
  await atomicWriteJson(statePath, result.data);
}
