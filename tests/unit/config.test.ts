import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { homedir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expandHome, readConfigFile, resolvePathsWithConfig } from "../../src/core/config.js";
import { ValidationError } from "../../src/core/errors.js";

let routerHome: string;

beforeEach(() => {
  routerHome = mkdtempSync(path.join(tmpdir(), "ar-config-"));
  process.env.AGENT_ROUTER_HOME = routerHome;
});

afterEach(() => {
  Reflect.deleteProperty(process.env, "AGENT_ROUTER_HOME");
  rmSync(routerHome, { recursive: true, force: true });
});

describe("expandHome", () => {
  it("expands ~ and ~/", () => {
    expect(expandHome("~")).toBe(homedir());
    expect(expandHome("~/x/y")).toBe(path.join(homedir(), "x/y"));
    expect(expandHome("/abs")).toBe("/abs");
    expect(expandHome("rel")).toBe("rel");
  });
});

describe("readConfigFile", () => {
  it("returns null when absent", async () => {
    expect(await readConfigFile(routerHome)).toBeNull();
  });

  it("parses agentsDir and stacksDir", async () => {
    writeFileSync(
      path.join(routerHome, "config.json"),
      JSON.stringify({ agentsDir: "/a", stacksDir: "/s" }),
    );
    expect(await readConfigFile(routerHome)).toEqual({ agentsDir: "/a", stacksDir: "/s" });
  });

  it("fails closed on unknown keys", async () => {
    writeFileSync(path.join(routerHome, "config.json"), JSON.stringify({ liveConfigPath: "/x" }));
    await expect(readConfigFile(routerHome)).rejects.toBeInstanceOf(ValidationError);
  });

  it("fails closed on invalid JSON", async () => {
    writeFileSync(path.join(routerHome, "config.json"), "{nope");
    await expect(readConfigFile(routerHome)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("resolvePathsWithConfig", () => {
  it("uses defaults when config.json is absent", async () => {
    const p = await resolvePathsWithConfig();
    expect(p.routerHome).toBe(routerHome);
    expect(p.stacksDir).toBe(path.join(routerHome, "stacks"));
  });

  it("applies agentsDir/stacksDir from config.json", async () => {
    writeFileSync(
      path.join(routerHome, "config.json"),
      JSON.stringify({ agentsDir: "/cfg/agents", stacksDir: "/cfg/stacks" }),
    );
    const p = await resolvePathsWithConfig();
    expect(p.agentsDir).toBe("/cfg/agents");
    expect(p.stacksDir).toBe("/cfg/stacks");
  });

  it("expands ~ in config values", async () => {
    writeFileSync(path.join(routerHome, "config.json"), JSON.stringify({ agentsDir: "~/agents" }));
    const p = await resolvePathsWithConfig();
    expect(p.agentsDir).toBe(path.join(homedir(), "agents"));
  });

  it("anchors relative config values at routerHome", async () => {
    writeFileSync(path.join(routerHome, "config.json"), JSON.stringify({ stacksDir: "my-stacks" }));
    const p = await resolvePathsWithConfig();
    expect(p.stacksDir).toBe(path.resolve(routerHome, "my-stacks"));
  });

  it("explicit options beat the config file", async () => {
    writeFileSync(path.join(routerHome, "config.json"), JSON.stringify({ agentsDir: "/cfg" }));
    const p = await resolvePathsWithConfig({ agentsDir: "/explicit" });
    expect(p.agentsDir).toBe("/explicit");
  });
});
