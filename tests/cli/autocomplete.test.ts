import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CliFixture, setupCliFixture } from "./helpers.js";

let fx: CliFixture;

beforeEach(() => {
  fx = setupCliFixture();
});

afterEach(() => {
  fx.cleanup();
});

describe("agent-router completion", () => {
  it("prints install instructions", () => {
    const r = fx.run("completion");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("ZSH");
    expect(r.stdout).toContain("BASH");
    expect(r.stdout).toContain("FISH");
  });

  it("emits scripts per shell", () => {
    for (const shell of ["zsh", "bash", "fish"]) {
      const r = fx.run("completion-script", shell);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("agent-router");
    }
  });

  it("completion-resolve lists stack names", () => {
    fx.run("init");
    const r = fx.run("completion-resolve");
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("default");
  });
});
