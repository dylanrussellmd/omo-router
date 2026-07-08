/**
 * Read `${routerHome}/config.json` — agent-router's own settings file.
 *
 * Why a file when env vars already exist? `agentsDir`/`stacksDir` must agree
 * across two execution contexts: the CLI (your shell) and the plugin (inside
 * opencode). An env var has to be exported in BOTH or the contexts disagree
 * and drift returns. A file in a fixed location is read identically by both,
 * so a single declaration wins everywhere.
 *
 * Precedence (highest first): explicit `resolvePaths` option → this file →
 * env var → built-in default. The file beats env because it is the more
 * deliberate, version-controllable declaration.
 *
 * The schema is strict (fail closed) — this file is ours, like state.json.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { IOError, ValidationError } from "./errors.js";
import { type ResolvePathsOptions, type RouterPaths, resolvePaths } from "./paths.js";
import { type ConfigFile, ConfigFileSchema } from "./schema.js";

export const CONFIG_FILE_NAME = "config.json";

/** Expand a leading `~` or `~/` to the user's home directory. */
export function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return path.join(homedir(), p.slice(2));
  return p;
}

/** Read `${routerHome}/config.json`. Returns null if absent. Throws on parse/schema error. */
export async function readConfigFile(routerHome: string): Promise<ConfigFile | null> {
  const configPath = path.join(routerHome, CONFIG_FILE_NAME);
  if (!existsSync(configPath)) return null;

  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (cause) {
    throw new IOError(`Failed to read ${configPath}: ${(cause as Error).message}`, cause);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new ValidationError(
      `agent-router config.json is not valid JSON: ${(cause as Error).message}`,
      configPath,
    );
  }

  const result = ConfigFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new ValidationError(
      `agent-router config.json failed validation: ${result.error.issues.map((i) => i.message).join("; ")}`,
      configPath,
      result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }
  return result.data;
}

/** Expand `~` and anchor relative paths at `routerHome`. */
function normalizeConfigPath(routerHome: string, p: string): string {
  const expanded = expandHome(p);
  return path.isAbsolute(expanded) ? expanded : path.resolve(routerHome, expanded);
}

/**
 * Like `resolvePaths`, but first reads `config.json` so its `agentsDir` /
 * `stacksDir` take effect. This is what the CLI and plugin call —
 * `resolvePaths` stays a pure, I/O-free function for tests and callers that
 * supply their own paths.
 *
 * Explicit `options.agentsDir` / `options.stacksDir` still win over the file.
 */
export async function resolvePathsWithConfig(
  options: ResolvePathsOptions = {},
): Promise<RouterPaths> {
  const base = resolvePaths(options);

  const config = await readConfigFile(base.routerHome);
  if (!config) return base;

  const next: ResolvePathsOptions = { ...options };
  if (options.agentsDir === undefined && config.agentsDir) {
    (next as { agentsDir?: string }).agentsDir = normalizeConfigPath(
      base.routerHome,
      config.agentsDir,
    );
  }
  if (options.stacksDir === undefined && config.stacksDir) {
    (next as { stacksDir?: string }).stacksDir = normalizeConfigPath(
      base.routerHome,
      config.stacksDir,
    );
  }
  return resolvePaths(next);
}
