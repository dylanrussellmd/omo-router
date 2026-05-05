import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { setupCliFixture } from "./helpers.js";

describe("use / back / history / restore / validate", () => {
  it("use openrouter-cheap switches active and live", () => {
    const fx = setupCliFixture();
    try {
      fx.run("init");
      const r = fx.run("use", "openrouter-cheap");
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/Switched: premium → openrouter-cheap/);
      expect(r.stdout).toMatch(/Restart opencode/);

      const state = JSON.parse(readFileSync(path.join(fx.omoHome, "state.json"), "utf8"));
      expect(state.active).toBe("openrouter-cheap");
      expect(state.previousActive).toBe("premium");

      const live = JSON.parse(
        readFileSync(path.join(fx.opencodeConfigDir, "oh-my-openagent.json"), "utf8"),
      );
      const cheap = JSON.parse(
        readFileSync(path.join(fx.omoHome, "stacks", "openrouter-cheap.json"), "utf8"),
      );
      expect(live).toEqual(cheap);

      const histFiles = readdirSync(path.join(fx.omoHome, "history"));
      expect(histFiles.length).toBeGreaterThanOrEqual(1);
    } finally {
      fx.cleanup();
    }
  });

  it("use <unknown> exits 2", () => {
    const fx = setupCliFixture();
    try {
      fx.run("init");
      const r = fx.run("use", "ghost");
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/Stack "ghost" not found/);
      expect(r.stderr).toMatch(/Available:/);
    } finally {
      fx.cleanup();
    }
  });

  it("use with model-validation failure exits 4", () => {
    const fx = setupCliFixture();
    try {
      fx.run("init");
      // craft a stack referencing an unreachable id
      writeFileSync(
        path.join(fx.omoHome, "stacks", "broken.json"),
        JSON.stringify({
          agents: { sisyphus: { model: "vendor-not-real/foo-bar" } },
          categories: { quick: { model: "google/gemini-3-flash-preview" } },
        }),
      );
      const r = fx.run("use", "broken");
      expect(r.status).toBe(4);
      expect(r.stderr).toMatch(/unreachable model ID/);
      expect(r.stderr).toMatch(/vendor-not-real\/foo-bar/);
    } finally {
      fx.cleanup();
    }
  });

  it("use --no-validate skips the gate", () => {
    const fx = setupCliFixture();
    try {
      fx.run("init");
      writeFileSync(
        path.join(fx.omoHome, "stacks", "broken.json"),
        JSON.stringify({
          agents: { sisyphus: { model: "vendor-not-real/foo-bar" } },
          categories: { quick: { model: "google/gemini-3-flash-preview" } },
        }),
      );
      const r = fx.run("use", "broken", "--no-validate");
      expect(r.status).toBe(0);
    } finally {
      fx.cleanup();
    }
  });

  it("back undoes the last switch", () => {
    const fx = setupCliFixture();
    try {
      fx.run("init");
      fx.run("use", "openrouter-cheap");
      const r = fx.run("back");
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/openrouter-cheap → premium/);
    } finally {
      fx.cleanup();
    }
  });

  it("history lists newest-first", () => {
    const fx = setupCliFixture();
    try {
      fx.run("init");
      fx.run("use", "openrouter-cheap");
      fx.run("use", "free-only");
      const r = fx.run("history");
      expect(r.status).toBe(0);
      // First line should be the most recent transition (premium-to-... or ...-to-free-only)
      const firstLine = r.stdout.split("\n")[0] ?? "";
      expect(firstLine).toMatch(/free-only/);
    } finally {
      fx.cleanup();
    }
  });

  it("validate --all reports OK on seeds", () => {
    const fx = setupCliFixture();
    try {
      fx.run("init");
      const r = fx.run("validate", "--all");
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/premium: OK/);
      expect(r.stdout).toMatch(/openrouter-cheap: OK/);
      expect(r.stdout).toMatch(/free-only: OK/);
    } finally {
      fx.cleanup();
    }
  });

  it("validate <broken> exits 4 with grouped output", () => {
    const fx = setupCliFixture();
    try {
      fx.run("init");
      writeFileSync(
        path.join(fx.omoHome, "stacks", "broken.json"),
        JSON.stringify({
          agents: { sisyphus: { model: "vendor-not-real/foo-bar" } },
          categories: { quick: { model: "google/gemini-3-flash-preview" } },
        }),
      );
      const r = fx.run("validate", "broken");
      expect(r.status).toBe(4);
      expect(r.stderr).toMatch(/MISSING/);
      expect(r.stderr).toMatch(/vendor-not-real\/foo-bar/);
    } finally {
      fx.cleanup();
    }
  });
});
