import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  expandHome,
  readConfigFile,
  readLiveConfigOverride,
  resolvePathsWithConfig,
} from "../../src/core/config.js";

function tmp(): string {
  return mkdtempSync(path.join(tmpdir(), "omo-cfg-"));
}

function writeConfig(dir: string, value: unknown): void {
  writeFileSync(path.join(dir, "config.json"), JSON.stringify(value), "utf8");
}

describe("expandHome", () => {
  it("expands a bare tilde", () => {
    expect(expandHome("~")).toBe(homedir());
  });

  it("expands a leading ~/ segment", () => {
    expect(expandHome("~/.agents/x.json")).toBe(path.join(homedir(), ".agents/x.json"));
  });

  it("leaves absolute and relative paths untouched", () => {
    expect(expandHome("/abs/x.json")).toBe("/abs/x.json");
    expect(expandHome("rel/x.json")).toBe("rel/x.json");
  });
});

describe("readConfigFile", () => {
  it("returns null when the file is absent", async () => {
    const dir = tmp();
    try {
      expect(await readConfigFile(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("parses a valid config", async () => {
    const dir = tmp();
    try {
      writeConfig(dir, { liveConfigPath: "/x/oh-my-openagent.json" });
      expect(await readConfigFile(dir)).toEqual({ liveConfigPath: "/x/oh-my-openagent.json" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws on invalid JSON", async () => {
    const dir = tmp();
    try {
      writeFileSync(path.join(dir, "config.json"), "{ not json", "utf8");
      await expect(readConfigFile(dir)).rejects.toThrow(/not valid JSON/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects unknown keys (strict, fail closed)", async () => {
    const dir = tmp();
    try {
      writeConfig(dir, { liveConfigPath: "/x.json", bogus: true });
      await expect(readConfigFile(dir)).rejects.toThrow(/validation/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("readLiveConfigOverride", () => {
  it("returns null when config is absent", async () => {
    const dir = tmp();
    try {
      expect(await readLiveConfigOverride(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns null when liveConfigPath is unset", async () => {
    const dir = tmp();
    try {
      writeConfig(dir, {});
      expect(await readLiveConfigOverride(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("expands ~ in liveConfigPath", async () => {
    const dir = tmp();
    try {
      writeConfig(dir, { liveConfigPath: "~/.agents/oh-my-openagent.json" });
      expect(await readLiveConfigOverride(dir)).toBe(
        path.join(homedir(), ".agents/oh-my-openagent.json"),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("anchors a relative liveConfigPath at omoHome", async () => {
    const dir = tmp();
    try {
      writeConfig(dir, { liveConfigPath: "sub/x.json" });
      expect(await readLiveConfigOverride(dir)).toBe(path.join(dir, "sub/x.json"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("resolvePathsWithConfig", () => {
  it("applies the config file's liveConfigPath", async () => {
    const home = tmp();
    try {
      writeConfig(home, { liveConfigPath: "/agents/oh-my-openagent.json" });
      const p = await resolvePathsWithConfig({ omoHome: home, opencodeConfigDir: "/cfg" });
      expect(p.liveConfigPath).toBe("/agents/oh-my-openagent.json");
      expect(p.opencodeConfigDir).toBe("/cfg");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("explicit liveConfigPath option wins over the config file", async () => {
    const home = tmp();
    try {
      writeConfig(home, { liveConfigPath: "/from-file.json" });
      const p = await resolvePathsWithConfig({
        omoHome: home,
        liveConfigPath: "/from-option.json",
      });
      expect(p.liveConfigPath).toBe("/from-option.json");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("falls through to the env/default chain when no config file exists", async () => {
    const home = tmp();
    try {
      const p = await resolvePathsWithConfig({
        omoHome: home,
        opencodeConfigDir: "/cfg",
        env: {},
      });
      expect(p.liveConfigPath).toBe("/cfg/oh-my-openagent.json");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
