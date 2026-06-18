import { homedir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePaths } from "../../src/core/paths.js";

describe("resolvePaths", () => {
  it("defaults to ~/.config/opencode and ~/.config/opencode/omo-router", () => {
    const p = resolvePaths({ env: {} });
    expect(p.opencodeConfigDir).toBe(path.join(homedir(), ".config", "opencode"));
    expect(p.omoHome).toBe(path.join(homedir(), ".config", "opencode", "omo-router"));
    expect(p.statePath).toBe(path.join(p.omoHome, "state.json"));
    expect(p.stacksDir).toBe(path.join(p.omoHome, "stacks"));
    expect(p.historyDir).toBe(path.join(p.omoHome, "history"));
  });

  it("respects XDG_CONFIG_HOME", () => {
    const p = resolvePaths({ env: { XDG_CONFIG_HOME: "/xdg" } });
    expect(p.opencodeConfigDir).toBe("/xdg/opencode");
    expect(p.omoHome).toBe("/xdg/opencode/omo-router");
  });

  it("OMO_ROUTER_HOME overrides omoHome but not opencodeConfigDir", () => {
    const p = resolvePaths({ env: { OMO_ROUTER_HOME: "/tmp/omo" } });
    expect(p.omoHome).toBe("/tmp/omo");
    expect(p.statePath).toBe("/tmp/omo/state.json");
    expect(p.opencodeConfigDir).toBe(path.join(homedir(), ".config", "opencode"));
  });

  it("explicit options.omoHome wins over OMO_ROUTER_HOME", () => {
    const p = resolvePaths({
      env: { OMO_ROUTER_HOME: "/wrong" },
      omoHome: "/right",
    });
    expect(p.omoHome).toBe("/right");
  });

  it("explicit options.opencodeConfigDir wins over XDG_CONFIG_HOME", () => {
    const p = resolvePaths({
      env: { XDG_CONFIG_HOME: "/wrong" },
      opencodeConfigDir: "/right",
    });
    expect(p.opencodeConfigDir).toBe("/right");
    expect(p.opencodeJsonPath).toBe("/right/opencode.json");
    expect(p.liveConfigPath).toBe("/right/oh-my-openagent.json");
  });

  it("backups dir is opencodeConfigDir/.backups", () => {
    const p = resolvePaths({ opencodeConfigDir: "/foo" });
    expect(p.opencodeBackupsDir).toBe("/foo/.backups");
  });

  it("OMO_ROUTER_LIVE_CONFIG overrides liveConfigPath but not opencodeConfigDir", () => {
    const p = resolvePaths({ env: { OMO_ROUTER_LIVE_CONFIG: "/agents/oh-my-openagent.json" } });
    expect(p.liveConfigPath).toBe("/agents/oh-my-openagent.json");
    expect(p.opencodeConfigDir).toBe(path.join(homedir(), ".config", "opencode"));
    expect(p.opencodeJsonPath).toBe(path.join(homedir(), ".config", "opencode", "opencode.json"));
  });

  it("explicit options.liveConfigPath wins over OMO_ROUTER_LIVE_CONFIG", () => {
    const p = resolvePaths({
      env: { OMO_ROUTER_LIVE_CONFIG: "/wrong/oh-my-openagent.json" },
      liveConfigPath: "/right/oh-my-openagent.json",
    });
    expect(p.liveConfigPath).toBe("/right/oh-my-openagent.json");
  });
});
