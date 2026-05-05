import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PLUGIN_REGISTRY_ENTRY,
  ensureOpenrouterModels,
  ensurePluginEntry,
  readOpencodeJson,
  writeOpencodeJson,
} from "../../src/core/opencode-config.js";

function tmp(): string {
  return mkdtempSync(path.join(tmpdir(), "omo-oc-"));
}

describe("ensurePluginEntry", () => {
  it("appends when not present", () => {
    const { config, result } = ensurePluginEntry({ plugin: ["oh-my-openagent@latest"] });
    expect(result.added).toBe(true);
    expect(config.plugin).toEqual(["oh-my-openagent@latest", PLUGIN_REGISTRY_ENTRY]);
  });

  it("is idempotent on identical entry", () => {
    const { result } = ensurePluginEntry({ plugin: [PLUGIN_REGISTRY_ENTRY] });
    expect(result.added).toBe(false);
  });

  it("treats different version tags of same package as already-present", () => {
    const { result } = ensurePluginEntry({
      plugin: ["@dylanrussell/omo-router@0.0.1"],
    });
    expect(result.added).toBe(false);
  });

  it("creates plugin array if config has none", () => {
    const { config, result } = ensurePluginEntry({});
    expect(result.added).toBe(true);
    expect(config.plugin).toEqual([PLUGIN_REGISTRY_ENTRY]);
  });
});

describe("ensureOpenrouterModels", () => {
  it("adds missing model entries with empty-object value", () => {
    const { config, result } = ensureOpenrouterModels(
      { provider: { openrouter: { models: { "openai/gpt-5.4": {} } } } },
      ["openai/gpt-5.4", "anthropic/claude-haiku-4.5"],
    );
    expect(result.added).toEqual(["anthropic/claude-haiku-4.5"]);
    const models = (config.provider as { openrouter: { models: Record<string, unknown> } })
      .openrouter.models;
    expect(models).toEqual({
      "openai/gpt-5.4": {},
      "anthropic/claude-haiku-4.5": {},
    });
  });

  it("creates provider/openrouter/models scaffold if absent", () => {
    const { config, result } = ensureOpenrouterModels({}, ["openai/gpt-oss-120b:free"]);
    expect(result.added).toEqual(["openai/gpt-oss-120b:free"]);
    const models = (config.provider as { openrouter: { models: Record<string, unknown> } })
      .openrouter.models;
    expect(models["openai/gpt-oss-120b:free"]).toEqual({});
  });

  it("is idempotent — second run adds nothing", () => {
    const first = ensureOpenrouterModels({}, ["a", "b"]);
    const second = ensureOpenrouterModels(first.config, ["a", "b"]);
    expect(second.result.added).toEqual([]);
  });
});

describe("readOpencodeJson + writeOpencodeJson", () => {
  it("returns null when file is missing", async () => {
    const dir = tmp();
    try {
      expect(await readOpencodeJson(path.join(dir, "missing.json"))).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("round-trips a real-world-shaped config", async () => {
    const dir = tmp();
    try {
      const p = path.join(dir, "opencode.json");
      const cfg = {
        $schema: "https://opencode.ai/config.json",
        plugin: ["oh-my-openagent@latest"],
        provider: { openrouter: { models: { "openai/gpt-5.4": {} } } },
      };
      writeFileSync(p, JSON.stringify(cfg));
      const read = await readOpencodeJson(p);
      expect(read).toMatchObject(cfg);
      await writeOpencodeJson(p, { ...read, foo: "bar" });
      const text = readFileSync(p, "utf8");
      expect(JSON.parse(text)).toMatchObject({ foo: "bar", plugin: ["oh-my-openagent@latest"] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
