import { describe, expect, it } from "vitest";
import {
  applyModelEdit,
  collectHostModels,
  listModelTargets,
  targetLabel,
} from "../../src/tui/actions.js";

const STACK = {
  agents: {
    Omni: { model: "a/one" },
    oracle: { model: "b/two", note: "keep" },
  },
};

describe("listModelTargets", () => {
  it("lists one target per agent", () => {
    const rows = listModelTargets(STACK);
    expect(rows).toEqual([
      { agent: "Omni", model: "a/one" },
      { agent: "oracle", model: "b/two" },
    ]);
  });

  it("labels targets by agent name", () => {
    expect(targetLabel({ agent: "oracle" })).toBe("oracle");
  });
});

describe("applyModelEdit", () => {
  it("replaces only the model, preserving unknown keys", () => {
    const next = applyModelEdit(STACK, "oracle", "c/three");
    expect(next.agents.oracle?.model).toBe("c/three");
    expect((next.agents.oracle as Record<string, unknown>).note).toBe("keep");
    expect(next.agents.Omni?.model).toBe("a/one");
    expect(STACK.agents.oracle.model).toBe("b/two");
  });

  it("throws for unknown agents", () => {
    expect(() => applyModelEdit(STACK, "ghost", "c/three")).toThrow(/ghost/);
  });
});

describe("collectHostModels", () => {
  it("returns [] for unusable input", () => {
    expect(collectHostModels(undefined)).toEqual([]);
    expect(collectHostModels("nope")).toEqual([]);
    expect(collectHostModels([])).toEqual([]);
  });

  it("collects provider/model ids from array-of-models shape", () => {
    const out = collectHostModels([
      { id: "openai", models: [{ id: "gpt-5.5" }, "gpt-5.4-mini"] },
      { id: "anthropic", models: { "claude-fable-5": {} } },
      { notAnId: true },
    ]);
    expect(out).toEqual(["anthropic/claude-fable-5", "openai/gpt-5.4-mini", "openai/gpt-5.5"]);
  });
});
