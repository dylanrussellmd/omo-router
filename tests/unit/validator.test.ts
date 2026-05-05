import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { StackFile } from "../../src/core/schema.js";
import { collectModelRefs, parseModelList, validateStack } from "../../src/core/validator.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(
  path.join(here, "..", "fixtures", "opencode-models-output.txt"),
  "utf8",
);

const fakeRunner = async () => FIXTURE;

describe("parseModelList", () => {
  it("parses one id per non-empty line", () => {
    const set = parseModelList("a/b\nc/d\n\n  e/f  \n# comment\n");
    expect(set.has("a/b")).toBe(true);
    expect(set.has("c/d")).toBe(true);
    expect(set.has("e/f")).toBe(true);
    expect(set.size).toBe(3);
  });
});

describe("collectModelRefs", () => {
  it("walks agents + categories + fallback_models", () => {
    const stack: StackFile = {
      agents: {
        sisyphus: { model: "a", fallback_models: [{ model: "b" }, { model: "c" }] },
        oracle: { model: "d" },
      },
      categories: {
        deep: { model: "e", fallback_models: [{ model: "f" }] },
      },
    };
    const refs = collectModelRefs(stack);
    expect(refs.length).toBe(6);
    expect(refs.find((r) => r.path === "agents.sisyphus.model")?.modelId).toBe("a");
    expect(refs.find((r) => r.path === "agents.sisyphus.fallback_models[1].model")?.modelId).toBe(
      "c",
    );
    expect(refs.find((r) => r.path === "categories.deep.fallback_models[0].model")?.modelId).toBe(
      "f",
    );
  });
});

describe("validateStack", () => {
  it("approves a stack whose IDs all appear in the fixture", async () => {
    const stack: StackFile = {
      agents: {
        sisyphus: { model: "anthropic/claude-opus-4-7" },
        oracle: { model: "openrouter/openai/gpt-5.4" },
        explore: { model: "google/gemini-3-flash-preview" },
      },
      categories: { quick: { model: "google/gemini-3-flash-preview" } },
    };
    const r = await validateStack(stack, { runOpencodeModels: fakeRunner });
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.checked).toBe(4);
  });

  it("flags missing IDs with structural paths", async () => {
    const stack: StackFile = {
      agents: {
        oracle: {
          model: "openrouter/openai/gpt-5.4",
          fallback_models: [{ model: "anthropic/claude-fakemodel-9000" }],
        },
      },
      categories: { deep: { model: "vendor-that-doesnt-exist/foo" } },
    };
    const r = await validateStack(stack, { runOpencodeModels: fakeRunner });
    expect(r.ok).toBe(false);
    expect(r.missing).toHaveLength(2);
    const paths = r.missing.map((m) => m.path).sort();
    expect(paths).toEqual(["agents.oracle.fallback_models[0].model", "categories.deep.model"]);
  });
});
