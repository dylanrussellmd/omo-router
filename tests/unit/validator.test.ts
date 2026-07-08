import { describe, expect, it } from "vitest";
import { ModelValidationError } from "../../src/core/errors.js";
import {
  collectModelRefs,
  parseModelList,
  validateStack,
  validateStackOrThrow,
} from "../../src/core/validator.js";

const MODELS = ["a/one", "b/two", "openrouter/c/three"].join("\n");
const fakeRunner = async () => MODELS;

describe("parseModelList", () => {
  it("parses one id per line, skipping blanks and comments", () => {
    const set = parseModelList("a/one\n\n# comment\nb/two\r\n  c/three  \n");
    expect([...set].sort()).toEqual(["a/one", "b/two", "c/three"]);
  });
});

describe("collectModelRefs", () => {
  it("collects agents with structural paths", () => {
    const refs = collectModelRefs({
      agents: { Omni: { model: "a/one" }, oracle: { model: "b/two" } },
    });
    expect(refs.map((r) => r.path).sort()).toEqual(["agents.Omni.model", "agents.oracle.model"]);
    expect(refs.map((r) => r.modelId).sort()).toEqual(["a/one", "b/two"]);
  });
});

describe("validateStack", () => {
  it("passes when every id is reachable", async () => {
    const r = await validateStack(
      { agents: { a: { model: "a/one" }, b: { model: "openrouter/c/three" } } },
      { runOpencodeModels: fakeRunner },
    );
    expect(r.ok).toBe(true);
    expect(r.checked).toBe(2);
    expect(r.missing).toEqual([]);
  });

  it("flags missing ids with their paths", async () => {
    const r = await validateStack(
      { agents: { a: { model: "a/one" }, ghost: { model: "no/where" } } },
      { runOpencodeModels: fakeRunner },
    );
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual([{ path: "agents.ghost.model", modelId: "no/where" }]);
  });
});

describe("validateStackOrThrow", () => {
  it("throws ModelValidationError on failure", async () => {
    await expect(
      validateStackOrThrow(
        "bad",
        { agents: { ghost: { model: "no/where" } } },
        { runOpencodeModels: fakeRunner },
      ),
    ).rejects.toBeInstanceOf(ModelValidationError);
  });

  it("returns the result on success", async () => {
    const r = await validateStackOrThrow(
      "good",
      { agents: { a: { model: "a/one" } } },
      { runOpencodeModels: fakeRunner },
    );
    expect(r.ok).toBe(true);
  });
});
