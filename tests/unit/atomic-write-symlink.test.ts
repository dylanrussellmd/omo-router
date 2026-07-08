import { mkdtempSync, rmSync } from "node:fs";
import { lstat, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { atomicWriteFile, atomicWriteJson } from "../../src/core/atomic-write.js";
import { ensureTuiJsonPluginEntry } from "../../src/core/opencode-config.js";

describe("atomic-write symlink preservation", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "omo-atomic-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes through a file symlink instead of replacing it", async () => {
    const real = path.join(dir, "real.json");
    const link = path.join(dir, "link.json");
    await writeFile(real, "{}");
    await symlink(real, link);

    await atomicWriteFile(link, '{"a":1}');

    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await readFile(real, "utf8")).toBe('{"a":1}');
  });

  it("writes through a symlinked parent directory", async () => {
    const realDir = path.join(dir, "real-dir");
    const linkDir = path.join(dir, "link-dir");
    await mkdir(realDir);
    await symlink(realDir, linkDir);

    await atomicWriteJson(path.join(linkDir, "new.json"), { b: 2 });

    expect((await lstat(linkDir)).isSymbolicLink()).toBe(true);
    expect(JSON.parse(await readFile(path.join(realDir, "new.json"), "utf8"))).toEqual({ b: 2 });
  });

  it("still creates brand-new files at plain paths", async () => {
    const dest = path.join(dir, "nested", "fresh.json");
    await atomicWriteJson(dest, { c: 3 });
    expect(JSON.parse(await readFile(dest, "utf8"))).toEqual({ c: 3 });
  });

  it("ensureTuiJsonPluginEntry preserves a chezmoi-style symlinked tui.json", async () => {
    const real = path.join(dir, "agents-tui.json");
    const link = path.join(dir, "tui.json");
    await writeFile(real, JSON.stringify({ plugin: ["oh-my-openagent@latest"] }));
    await symlink(real, link);

    const result = await ensureTuiJsonPluginEntry(link);

    expect(result.added).toBe(true);
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    const written = JSON.parse(await readFile(real, "utf8"));
    expect(written.plugin).toContain("@dylanrussell/omo-router@latest");
  });
});
