/**
 * Frontmatter `model:` line handling — the read/write layer between stacks
 * and the agent `.md` files opencode loads.
 *
 * Contract (see README): an agent file starts with a YAML frontmatter block
 * delimited by `---` lines, containing exactly one top-level `model:` key.
 * agent-router rewrites ONLY that line; the prompt body and every other
 * frontmatter key are owned by the user and never touched.
 *
 * Parsing is deliberately line-based rather than a full YAML round-trip:
 * a YAML parser would re-serialize the whole block and clobber the user's
 * comments, key order, and formatting. A targeted line replacement cannot.
 * Only top-level (column-0) `model:` keys match, so nested keys like
 * `options.model` are never confused for the agent model.
 */

import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { AgentFileError, IOError } from "./errors.js";

/** Matches the frontmatter block at the very start of the file. */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** Matches a top-level `model:` line inside frontmatter (multiline mode). */
const MODEL_LINE_RE = /^model:[ \t]*(.*)$/m;

/** Strip a trailing YAML comment (` # ...`) and surrounding quotes/space. */
function cleanModelValue(raw: string): string {
  let v = raw;
  const hash = v.search(/[ \t]#/);
  if (hash >= 0) v = v.slice(0, hash);
  v = v.trim();
  if (
    (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
    (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
  ) {
    v = v.slice(1, -1);
  }
  return v;
}

/**
 * Extract the frontmatter `model:` value from agent file content.
 * Returns null when the file has no frontmatter or no model line.
 */
export function getFrontmatterModel(content: string): string | null {
  const fm = FRONTMATTER_RE.exec(content);
  if (!fm?.[1]) return null;
  const line = MODEL_LINE_RE.exec(fm[1]);
  if (!line) return null;
  const value = cleanModelValue(line[1] ?? "");
  return value.length > 0 ? value : null;
}

/**
 * Return new content with the frontmatter `model:` line replaced by
 * `model: <model>`. Throws (plain Error — callers wrap with context) when
 * there is no frontmatter or no model line to replace.
 */
export function setFrontmatterModel(content: string, model: string): string {
  const fm = FRONTMATTER_RE.exec(content);
  if (!fm?.[1]) throw new Error("no frontmatter block");
  const block = fm[1];
  if (!MODEL_LINE_RE.test(block)) throw new Error("no `model:` line in frontmatter");
  // Replacement callback sidesteps `$`-pattern interpretation in the model id.
  const nextBlock = block.replace(MODEL_LINE_RE, () => `model: ${model}`);
  // Splice the edited block back into the matched frontmatter by index so no
  // string in the file is ever treated as a pattern.
  const blockStart = fm[0].indexOf(block);
  const nextFm = fm[0].slice(0, blockStart) + nextBlock + fm[0].slice(blockStart + block.length);
  return nextFm + content.slice(fm[0].length);
}

/** Absolute path of `<agentsDir>/<name>.md`. */
export function agentFilePath(agentsDir: string, name: string): string {
  return path.join(agentsDir, `${name}.md`);
}

/** List agent names (`.md` basenames) in the agents dir, sorted. */
export async function listAgentFiles(agentsDir: string): Promise<string[]> {
  if (!existsSync(agentsDir)) return [];
  let names: string[];
  try {
    names = await readdir(agentsDir);
  } catch (cause) {
    throw new IOError(`Failed to read agents dir: ${(cause as Error).message}`, cause);
  }
  return names
    .filter((n) => n.endsWith(".md"))
    .map((n) => n.slice(0, -".md".length))
    .sort();
}

/**
 * Read the current agent → model mapping from every `.md` file in the agents
 * dir. Files without a frontmatter `model:` line are skipped (they aren't
 * routable agents — e.g. docs accidentally living there).
 */
export async function readAgentModels(agentsDir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of await listAgentFiles(agentsDir)) {
    const filePath = agentFilePath(agentsDir, name);
    let content: string;
    try {
      content = await readFile(filePath, "utf8");
    } catch (cause) {
      throw new IOError(`Failed to read ${filePath}: ${(cause as Error).message}`, cause);
    }
    const model = getFrontmatterModel(content);
    if (model !== null) out[name] = model;
  }
  return out;
}

/**
 * Read one agent file strictly: throws `AgentFileError` when the file is
 * missing or has no rewritable `model:` line. Returns the raw content plus
 * the current model, ready for `setFrontmatterModel`.
 */
export async function readAgentFileStrict(
  agentsDir: string,
  name: string,
): Promise<{ filePath: string; content: string; model: string }> {
  const filePath = agentFilePath(agentsDir, name);
  if (!existsSync(filePath)) {
    throw new AgentFileError(name, filePath, "file does not exist");
  }
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch (cause) {
    throw new IOError(`Failed to read ${filePath}: ${(cause as Error).message}`, cause);
  }
  const model = getFrontmatterModel(content);
  if (model === null) {
    throw new AgentFileError(name, filePath, "no frontmatter `model:` line to rewrite");
  }
  return { filePath, content, model };
}
