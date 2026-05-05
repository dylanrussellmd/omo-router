import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { setupCliFixture } from "./helpers.js";

describe("add / rm / import / export", () => {
  it("add --from-active snapshots live config", () => {
    const fx = setupCliFixture();
    try {
      fx.run("init");
      const r = fx.run("add", "snap", "--from-active");
      expect(r.status).toBe(0);
      const snap = JSON.parse(readFileSync(path.join(fx.omoHome, "stacks", "snap.json"), "utf8"));
      const premium = JSON.parse(
        readFileSync(path.join(fx.omoHome, "stacks", "premium.json"), "utf8"),
      );
      expect(snap).toEqual(premium);
    } finally {
      fx.cleanup();
    }
  });

  it("add --from <file> imports a JSON file", () => {
    const fx = setupCliFixture();
    try {
      fx.run("init");
      const src = path.join(fx.xdgHome, "external.json");
      writeFileSync(
        src,
        JSON.stringify({
          agents: { sisyphus: { model: "anthropic/claude-opus-4-7" } },
          categories: { quick: { model: "google/gemini-3-flash-preview" } },
        }),
      );
      const r = fx.run("add", "external", "--from", src);
      expect(r.status).toBe(0);
      expect(existsSync(path.join(fx.omoHome, "stacks", "external.json"))).toBe(true);
    } finally {
      fx.cleanup();
    }
  });

  it("add refuses bad names", () => {
    const fx = setupCliFixture();
    try {
      fx.run("init");
      const r = fx.run("add", "bad name!");
      expect(r.status).toBe(1);
    } finally {
      fx.cleanup();
    }
  });

  it("rm refuses active without --force", () => {
    const fx = setupCliFixture();
    try {
      fx.run("init");
      const r = fx.run("rm", "premium");
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/active stack/);
    } finally {
      fx.cleanup();
    }
  });

  it("rm with --force removes active", () => {
    const fx = setupCliFixture();
    try {
      fx.run("init");
      const r = fx.run("rm", "premium", "--force");
      expect(r.status).toBe(0);
      expect(existsSync(path.join(fx.omoHome, "stacks", "premium.json"))).toBe(false);
    } finally {
      fx.cleanup();
    }
  });

  it("import + export round-trip", () => {
    const fx = setupCliFixture();
    try {
      fx.run("init");
      const out = path.join(fx.xdgHome, "out.json");
      const exp = fx.run("export", "premium", out);
      expect(exp.status).toBe(0);
      expect(existsSync(out)).toBe(true);
      const imp = fx.run("import", "imported", out);
      expect(imp.status).toBe(0);
      expect(existsSync(path.join(fx.omoHome, "stacks", "imported.json"))).toBe(true);
    } finally {
      fx.cleanup();
    }
  });
});
