import { defineConfig } from "tsup";
import { chmod } from "node:fs/promises";
import path from "node:path";

/**
 * tsup config: bundle plugin, CLI, and TUI as ESM, and `chmod +x` the CLI
 * binary so `agent-router` is executable straight out of `npm install`.
 */
export default defineConfig({
  entry: {
    plugin: "src/plugin.ts",
    cli: "src/cli.ts",
    tui: "src/tui/index.ts",
  },
  format: ["esm"],
  target: "node20",
  platform: "node",
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  shims: false,
  // Bundle our deps; mark opencode plugin types as external (peer dep) and
  // @opentui/solid as external (the opencode TUI host provides it at runtime).
  external: ["@opencode-ai/plugin", "@opentui/solid"],
  async onSuccess() {
    // Add shebang + executable bit to dist/cli.js so the bin works.
    const { readFile, writeFile } = await import("node:fs/promises");
    const cliPath = path.resolve("dist/cli.js");
    const contents = await readFile(cliPath, "utf8");
    if (!contents.startsWith("#!/usr/bin/env node")) {
      await writeFile(cliPath, `#!/usr/bin/env node\n${contents}`, "utf8");
    }
    await chmod(cliPath, 0o755);
  },
});
