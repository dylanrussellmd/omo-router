/**
 * CLI smoke-test harness.
 *
 * Spawns the CLI as a child process with a tmp `OMO_ROUTER_HOME` and a tmp
 * `XDG_CONFIG_HOME/opencode/` so each test starts from clean state.
 *
 * We invoke the CLI via the source TypeScript entry through `tsx` — that way
 * we exercise the same code paths as the eventual built binary without
 * needing to run `tsup` in test setup. Tests stay fast (single process) and
 * don't depend on dist/ being built.
 *
 * `opencode models` is faked by injecting a stub binary on PATH that prints
 * a deterministic model list. This makes the validation gate fully
 * reproducible regardless of the developer's local opencode auth state.
 */

import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..", "..");
const CLI_ENTRY = path.join(REPO_ROOT, "src", "cli.ts");

/** Models the CLI tests expect to be reachable (covers all 3 seeds). */
const FAKE_OPENCODE_MODELS = [
  "anthropic/claude-opus-4-7",
  "anthropic/claude-sonnet-4-6",
  "openrouter/openai/gpt-5.4",
  "openrouter/openai/gpt-5.4-mini",
  "openrouter/anthropic/claude-sonnet-4-6",
  "openrouter/anthropic/claude-haiku-4.5",
  "openrouter/google/gemini-2.5-flash",
  "openrouter/openai/gpt-oss-120b:free",
  "google/gemini-3-flash-preview",
  "google/gemini-3.1-pro-preview",
  "google/gemini-2.5-flash",
];

export interface CliFixture {
  /** OMO_ROUTER_HOME for this run. */
  omoHome: string;
  /** Synthetic `~/.config` so opencode.json + oh-my-openagent.json land in tmp. */
  xdgHome: string;
  /** Resolved opencode config dir = `${xdgHome}/opencode`. */
  opencodeConfigDir: string;
  /** PATH-prepended dir holding the stub `opencode` binary. */
  binDir: string;
  /** Convenience: full env to pass to spawnSync. */
  env: NodeJS.ProcessEnv;
  /** Run the CLI with the given args. */
  run: (...args: string[]) => SpawnSyncReturns<string>;
  /** Cleanup all tmp dirs. */
  cleanup: () => void;
}

export function setupCliFixture(): CliFixture {
  const omoHome = mkdtempSync(path.join(tmpdir(), "omo-cli-omo-"));
  const xdgHome = mkdtempSync(path.join(tmpdir(), "omo-cli-xdg-"));
  const binDir = mkdtempSync(path.join(tmpdir(), "omo-cli-bin-"));
  const opencodeConfigDir = path.join(xdgHome, "opencode");
  mkdirSync(opencodeConfigDir, { recursive: true });

  // Stub `opencode` binary: prints fake model list when called as
  // `opencode models`. Anything else is a noop with success exit. This is
  // what the validator shells out to when --no-validate isn't passed.
  const stubScript = path.join(binDir, "opencode");
  writeFileSync(
    stubScript,
    `#!/usr/bin/env bash
if [ "$1" = "models" ]; then
  cat <<'EOF'
${FAKE_OPENCODE_MODELS.join("\n")}
EOF
  exit 0
fi
exit 0
`,
    { mode: 0o755 },
  );
  chmodSync(stubScript, 0o755);

  // Seed a baseline opencode.json so init's auto-edit has something to work
  // with. Mirrors the user's actual layout.
  writeFileSync(
    path.join(opencodeConfigDir, "opencode.json"),
    `${JSON.stringify(
      {
        $schema: "https://opencode.ai/config.json",
        plugin: ["oh-my-openagent@latest"],
        provider: { openrouter: { models: { "openai/gpt-5.4": {} } } },
      },
      null,
      2,
    )}\n`,
  );

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OMO_ROUTER_HOME: omoHome,
    XDG_CONFIG_HOME: xdgHome,
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
    NO_COLOR: "1",
    EDITOR: "/bin/true",
  };

  function run(...args: string[]): SpawnSyncReturns<string> {
    return spawnSync("npx", ["tsx", CLI_ENTRY, ...args], {
      env,
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 60_000,
    });
  }

  return {
    omoHome,
    xdgHome,
    opencodeConfigDir,
    binDir,
    env,
    run,
    cleanup: () => {
      const { rmSync } = require("node:fs");
      rmSync(omoHome, { recursive: true, force: true });
      rmSync(xdgHome, { recursive: true, force: true });
      rmSync(binDir, { recursive: true, force: true });
    },
  };
}
