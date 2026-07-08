import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CliFixture, setupCliFixture } from "./helpers.js";

let fx: CliFixture;

beforeEach(() => {
  fx = setupCliFixture();
  fx.run("init");
  writeFileSync(
    path.join(fx.stacksDir, "cheap.json"),
    JSON.stringify({ agents: { Omni: { model: "c/three" }, oracle: { model: "c/three" } } }),
  );
});

afterEach(() => {
  fx.cleanup();
});

function omniModel(): string {
  return (
    readFileSync(path.join(fx.agentsDir, "Omni.md"), "utf8").match(/^model: (.*)$/m)?.[1] ?? ""
  );
}

describe("agent-router use", () => {
  it("rewrites agent frontmatter and reminds about restart", () => {
    const r = fx.run("use", "cheap");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("default → cheap");
    expect(r.stdout).toContain("Restart opencode");
    expect(omniModel()).toBe("c/three");
  });

  it("exits 2 for unknown stacks", () => {
    const r = fx.run("use", "ghost");
    expect(r.status).toBe(2);
    expect(omniModel()).toBe("a/one");
  });

  it("blocks on unreachable models unless forced", () => {
    writeFileSync(
      path.join(fx.stacksDir, "bad.json"),
      JSON.stringify({ agents: { Omni: { model: "not/real" } } }),
    );
    const blocked = fx.run("use", "bad");
    expect(blocked.status).toBe(4);
    expect(omniModel()).toBe("a/one");

    const forced = fx.run("use", "bad", "--force-invalid");
    expect(forced.status).toBe(0);
    expect(omniModel()).toBe("not/real");

    const skipped = fx.run("use", "cheap", "--no-validate");
    expect(skipped.status).toBe(0);
    expect(omniModel()).toBe("c/three");
  });
});

describe("agent-router back", () => {
  it("reverts the last switch", () => {
    fx.run("use", "cheap");
    const r = fx.run("back");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("cheap → default");
    expect(omniModel()).toBe("a/one");
  });

  it("errors when there is nothing to revert", () => {
    const r = fx.run("back");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("No previous stack");
  });
});

describe("agent-router capture", () => {
  it("snapshots current models into a stack", () => {
    fx.run("use", "cheap");
    const r = fx.run("capture", "my-mix");
    expect(r.status).toBe(0);
    const stack = JSON.parse(readFileSync(path.join(fx.stacksDir, "my-mix.json"), "utf8"));
    expect(stack.agents.Omni.model).toBe("c/three");
  });

  it("refuses to overwrite without --force", () => {
    expect(fx.run("capture", "default").status).toBe(1);
    expect(fx.run("capture", "default", "--force").status).toBe(0);
  });
});

describe("agent-router history", () => {
  it("lists switches newest first", () => {
    fx.run("use", "cheap");
    fx.run("back");
    const r = fx.run("history");
    expect(r.status).toBe(0);
    const lines = r.stdout.trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines[0]).toContain("cheap → default");
    expect(lines[1]).toContain("default → cheap");
  });

  it("prints a placeholder when empty", () => {
    const r = fx.run("history");
    expect(r.stdout).toContain("(no history)");
  });
});

describe("agent-router validate", () => {
  it("validates a single stack", () => {
    const r = fx.run("validate", "cheap");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("OK");
  });

  it("validates all stacks and fails on unreachable ids", () => {
    writeFileSync(
      path.join(fx.stacksDir, "bad.json"),
      JSON.stringify({ agents: { Omni: { model: "not/real" } } }),
    );
    const r = fx.run("validate", "--all");
    expect(r.status).toBe(4);
    expect(r.stderr).toContain("not/real");
  });

  it("validates the current frontmatter with --active", () => {
    const r = fx.run("validate", "--active");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("(current frontmatter): OK");
  });
});

describe("agent-router rm/import/export", () => {
  it("rm refuses the active stack without --force", () => {
    expect(fx.run("rm", "default").status).toBe(1);
    expect(fx.run("rm", "cheap").status).toBe(0);
    expect(fx.run("rm", "default", "--force").status).toBe(0);
  });

  it("import/export round-trip", () => {
    const out = path.join(fx.xdgHome, "exported.json");
    expect(fx.run("export", "cheap", out).status).toBe(0);
    expect(fx.run("import", "cheap2", out).status).toBe(0);
    const r = fx.run("show", "cheap2");
    expect(JSON.parse(r.stdout).agents.Omni.model).toBe("c/three");
  });
});
