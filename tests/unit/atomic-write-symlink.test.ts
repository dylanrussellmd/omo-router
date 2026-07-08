import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { atomicWriteFile, atomicWriteJson } from "../../src/core/atomic-write.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "ar-symlink-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("atomicWriteFile symlink preservation", () => {
  it("writes through a symlink instead of replacing it", async () => {
    const realDir = path.join(root, "dotfiles");
    mkdirSync(realDir, { recursive: true });
    const realFile = path.join(realDir, "agent.md");
    await atomicWriteFile(realFile, "original\n");

    const linkDir = path.join(root, "config");
    mkdirSync(linkDir, { recursive: true });
    const link = path.join(linkDir, "agent.md");
    symlinkSync(realFile, link);

    await atomicWriteFile(link, "updated\n");

    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(realFile, "utf8")).toBe("updated\n");
    expect(readFileSync(link, "utf8")).toBe("updated\n");
  });

  it("writes through a symlinked parent directory", async () => {
    const realDir = path.join(root, "real-agents");
    mkdirSync(realDir, { recursive: true });
    const linkDir = path.join(root, "agents");
    symlinkSync(realDir, linkDir);

    await atomicWriteFile(path.join(linkDir, "new.md"), "hello\n");
    expect(readFileSync(path.join(realDir, "new.md"), "utf8")).toBe("hello\n");
    expect(lstatSync(linkDir).isSymbolicLink()).toBe(true);
  });

  it("creates parent directories when missing", async () => {
    const dest = path.join(root, "a", "b", "c.json");
    await atomicWriteJson(dest, { ok: true });
    expect(JSON.parse(readFileSync(dest, "utf8"))).toEqual({ ok: true });
  });
});
