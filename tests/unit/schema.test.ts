import { describe, expect, it } from "vitest";
import { StackFileSchema, OpencodeJsonSchema } from "../../src/core/schema.js";

describe("StackFileSchema", () => {
  it("rejects empty objects (no agents AND no categories)", () => {
    const r = StackFileSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it("accepts agents-only stacks", () => {
    const r = StackFileSchema.safeParse({
      agents: { sisyphus: { model: "anthropic/claude-opus-4-7" } },
    });
    expect(r.success).toBe(true);
  });

  it("accepts categories-only stacks", () => {
    const r = StackFileSchema.safeParse({
      categories: { quick: { model: "google/gemini-3-flash-preview" } },
    });
    expect(r.success).toBe(true);
  });

  it("preserves unknown top-level keys (forward compatibility)", () => {
    const r = StackFileSchema.safeParse({
      $schema: "https://example.com/schema.json",
      agents: { sisyphus: { model: "anthropic/claude-opus-4-7", variant: "max" } },
      experimental: { future_field: true },
      disabled_skills: ["playwright"],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.$schema).toBe("https://example.com/schema.json");
      expect(r.data.experimental).toEqual({ future_field: true });
      expect(r.data.disabled_skills).toEqual(["playwright"]);
    }
  });

  it("preserves unknown keys inside model entries (e.g., variant, temperature)", () => {
    const r = StackFileSchema.safeParse({
      agents: {
        oracle: {
          model: "openrouter/openai/gpt-5.4",
          variant: "high",
          temperature: 0.2,
          fallback_models: [{ model: "anthropic/claude-opus-4-7", variant: "max" }],
        },
      },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      const oracle = r.data.agents?.oracle as { variant: string; temperature: number };
      expect(oracle.variant).toBe("high");
      expect(oracle.temperature).toBe(0.2);
    }
  });

  it("rejects model entries missing the `model` string", () => {
    const r = StackFileSchema.safeParse({
      agents: { sisyphus: { variant: "max" } },
    });
    expect(r.success).toBe(false);
  });
});

describe("OpencodeJsonSchema", () => {
  it("accepts a minimal config", () => {
    const r = OpencodeJsonSchema.safeParse({});
    expect(r.success).toBe(true);
  });

  it("accepts plugin array + provider.openrouter.models", () => {
    const r = OpencodeJsonSchema.safeParse({
      plugin: ["@dylanrussell/omo-router@latest", "oh-my-openagent@latest"],
      provider: { openrouter: { models: { "openai/gpt-5.4": {} } } },
    });
    expect(r.success).toBe(true);
  });

  it("preserves unknown top-level keys", () => {
    const r = OpencodeJsonSchema.safeParse({
      $schema: "https://opencode.ai/config.json",
      provider: { openrouter: { models: {} } },
      mcp: { foo: { type: "stdio" } },
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.mcp).toEqual({ foo: { type: "stdio" } });
  });
});
