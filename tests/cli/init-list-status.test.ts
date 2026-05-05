import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { setupCliFixture } from "./helpers.js";

describe("init / list / status / show / path", () => {
  it("init creates state, drops 3 seeds, copies premium to live, edits opencode.json", () => {
    const fx = setupCliFixture();
    try {
      const r = fx.run("init");
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/dropped \d+ seed/);
      const stacksDir = path.join(fx.omoHome, "stacks");
      expect(existsSync(path.join(stacksDir, "premium.json"))).toBe(true);
      expect(existsSync(path.join(stacksDir, "openrouter-cheap.json"))).toBe(true);
      expect(existsSync(path.join(stacksDir, "free-only.json"))).toBe(true);

      const state = JSON.parse(readFileSync(path.join(fx.omoHome, "state.json"), "utf8"));
      expect(state.active).toBe("premium");

      const live = JSON.parse(
        readFileSync(path.join(fx.opencodeConfigDir, "oh-my-openagent.json"), "utf8"),
      );
      const premium = JSON.parse(readFileSync(path.join(stacksDir, "premium.json"), "utf8"));
      expect(live).toEqual(premium);

      const oc = JSON.parse(readFileSync(path.join(fx.opencodeConfigDir, "opencode.json"), "utf8"));
      expect(oc.plugin).toContain("@dylanrussell/omo-router@latest");
      expect(oc.provider.openrouter.models).toHaveProperty("anthropic/claude-haiku-4.5");
      expect(oc.provider.openrouter.models).toHaveProperty("openai/gpt-oss-120b:free");
    } finally {
      fx.cleanup();
    }
  });

  it("init is idempotent without --force", () => {
    const fx = setupCliFixture();
    try {
      fx.run("init");
      const r = fx.run("init");
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/already initialized/);
    } finally {
      fx.cleanup();
    }
  });

  it("list marks active with *", () => {
    const fx = setupCliFixture();
    try {
      fx.run("init");
      const r = fx.run("list");
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/^\* premium$/m);
      expect(r.stdout).toMatch(/^ {2}openrouter-cheap$/m);
    } finally {
      fx.cleanup();
    }
  });

  it("status prints active stack name", () => {
    const fx = setupCliFixture();
    try {
      fx.run("init");
      const r = fx.run("status");
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe("premium");
    } finally {
      fx.cleanup();
    }
  });

  it("show <name> dumps stack JSON", () => {
    const fx = setupCliFixture();
    try {
      fx.run("init");
      const r = fx.run("show", "free-only");
      expect(r.status).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.agents.sisyphus).toBeDefined();
    } finally {
      fx.cleanup();
    }
  });

  it("path prints all paths", () => {
    const fx = setupCliFixture();
    try {
      const r = fx.run("path");
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/omoHome/);
      expect(r.stdout).toMatch(/stacksDir/);
    } finally {
      fx.cleanup();
    }
  });

  it("--version prints version string", () => {
    const fx = setupCliFixture();
    try {
      const r = fx.run("--version");
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/omo-router\/\d+\.\d+\.\d+/);
    } finally {
      fx.cleanup();
    }
  });
});
