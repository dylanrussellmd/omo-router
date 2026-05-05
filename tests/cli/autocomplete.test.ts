import { exec } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execAsync = promisify(exec);

describe("CLI Autocomplete", () => {
  it("dynamically returns stacks for the 'completion-resolve' command", async () => {
    const { stdout } = await execAsync("npx tsx src/cli.ts completion-resolve");

    expect(stdout).toContain("premium");
    expect(stdout).toContain("openrouter-cheap");
    expect(stdout).toContain("free-only");
  });
});
