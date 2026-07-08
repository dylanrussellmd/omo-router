import { describe, expect, it } from "vitest";
import {
  ConfigFileSchema,
  OpencodeJsonSchema,
  StackFileSchema,
  StateFileSchema,
} from "../../src/core/schema.js";

describe("StateFileSchema", () => {
  const valid = {
    version: 1,
    active: "premium",
    previousActive: null,
    lastSwitchedAt: new Date().toISOString(),
  };

  it("accepts a valid state", () => {
    expect(StateFileSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects unknown keys (strict)", () => {
    expect(StateFileSchema.safeParse({ ...valid, lastSnapshottedFrom: null }).success).toBe(false);
  });

  it("rejects wrong version", () => {
    expect(StateFileSchema.safeParse({ ...valid, version: 2 }).success).toBe(false);
  });

  it("rejects empty active", () => {
    expect(StateFileSchema.safeParse({ ...valid, active: "" }).success).toBe(false);
  });
});

describe("StackFileSchema", () => {
  it("accepts an agents record with models", () => {
    const r = StackFileSchema.safeParse({
      agents: { Omni: { model: "a/b" }, oracle: { model: "c/d" } },
    });
    expect(r.success).toBe(true);
  });

  it("passes unknown entry keys through", () => {
    const r = StackFileSchema.safeParse({
      agents: { Omni: { model: "a/b", note: "keep me" } },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect((r.data.agents.Omni as Record<string, unknown>).note).toBe("keep me");
    }
  });

  it("passes unknown top-level keys through", () => {
    const r = StackFileSchema.safeParse({ $schema: "x", agents: { a: { model: "m/1" } } });
    expect(r.success).toBe(true);
    if (r.success) expect((r.data as Record<string, unknown>).$schema).toBe("x");
  });

  it("rejects an empty agents record", () => {
    expect(StackFileSchema.safeParse({ agents: {} }).success).toBe(false);
  });

  it("rejects a missing agents key", () => {
    expect(StackFileSchema.safeParse({ categories: { q: { model: "m/1" } } }).success).toBe(false);
  });

  it("rejects entries without a model", () => {
    expect(StackFileSchema.safeParse({ agents: { a: {} } }).success).toBe(false);
    expect(StackFileSchema.safeParse({ agents: { a: { model: "" } } }).success).toBe(false);
  });
});

describe("ConfigFileSchema", () => {
  it("accepts agentsDir/stacksDir", () => {
    expect(ConfigFileSchema.safeParse({ agentsDir: "/a", stacksDir: "/s" }).success).toBe(true);
    expect(ConfigFileSchema.safeParse({}).success).toBe(true);
  });

  it("rejects unknown keys (strict)", () => {
    expect(ConfigFileSchema.safeParse({ liveConfigPath: "/x" }).success).toBe(false);
  });
});

describe("OpencodeJsonSchema", () => {
  it("reads the plugin array and preserves the rest", () => {
    const r = OpencodeJsonSchema.safeParse({
      plugin: ["a", "b"],
      provider: { openrouter: { models: {} } },
      instructions: ["rules/x.md"],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.plugin).toEqual(["a", "b"]);
      expect((r.data as Record<string, unknown>).instructions).toEqual(["rules/x.md"]);
    }
  });
});
