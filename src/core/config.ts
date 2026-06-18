/**
 * Read `~/.config/opencode/omo-router/config.json` — omo-router's own
 * settings file.
 *
 * Why a file when env vars already exist? `liveConfigPath` must agree across
 * two execution contexts: the CLI (your shell) and the plugin (inside
 * opencode). An env var has to be exported in BOTH or the contexts disagree
 * and drift returns. A file in a fixed location is read identically by both,
 * so a single declaration wins everywhere.
 *
 * Precedence (highest first): explicit `resolvePaths` option -> this file ->
 * `OMO_ROUTER_LIVE_CONFIG` env -> built-in default. The file beats env because
 * it is the more deliberate, version-controllable declaration.
 *
 * The schema is strict (fail closed) — this file is ours, like state.json.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { IOError, ValidationError } from "./errors.js";
import { type OmoPaths, type ResolvePathsOptions, resolvePaths } from "./paths.js";
import { type ConfigFile, ConfigFileSchema } from "./schema.js";

export const CONFIG_FILE_NAME = "config.json";

/** Expand a leading `~` or `~/` to the user's home directory. */
export function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return path.join(homedir(), p.slice(2));
  return p;
}

/** Read `${omoHome}/config.json`. Returns null if absent. Throws on parse/schema error. */
export async function readConfigFile(omoHome: string): Promise<ConfigFile | null> {
  const configPath = path.join(omoHome, CONFIG_FILE_NAME);
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
      `omo-router config.json is not valid JSON: ${(cause as Error).message}`,
      configPath,
    );
  }

  const result = ConfigFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new ValidationError(
      `omo-router config.json failed validation: ${result.error.issues.map((i) => i.message).join("; ")}`,
      configPath,
      result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }
  return result.data;
}

/**
 * Resolve the `liveConfigPath` a config file declares, with `~` expanded and
 * relative paths anchored at the config dir (`omoHome`). Returns null when the
 * file is absent or does not set `liveConfigPath`, so callers fall through to
 * the env/default chain in `resolvePaths`.
 */
export async function readLiveConfigOverride(omoHome: string): Promise<string | null> {
  const config = await readConfigFile(omoHome);
  if (!config?.liveConfigPath) return null;
  const expanded = expandHome(config.liveConfigPath);
  return path.isAbsolute(expanded) ? expanded : path.resolve(omoHome, expanded);
}

/**
 * Like `resolvePaths`, but first reads `config.json` so its `liveConfigPath`
 * takes effect. This is what the CLI and plugin call — `resolvePaths` stays a
 * pure, I/O-free function for tests and callers that supply their own paths.
 *
 * An explicit `options.liveConfigPath` still wins over the config file.
 */
export async function resolvePathsWithConfig(options: ResolvePathsOptions = {}): Promise<OmoPaths> {
  const base = resolvePaths(options);
  if (options.liveConfigPath !== undefined) return base;

  const override = await readLiveConfigOverride(base.omoHome);
  if (override === null) return base;

  return resolvePaths({ ...options, liveConfigPath: override });
}
