import { describe, expect, it } from "vitest";
import { getFrontmatterModel, setFrontmatterModel } from "../../src/core/frontmatter.js";

const AGENT_MD = `---
description: Strategic advisor
mode: subagent
model: openai/gpt-5.5
temperature: 0.1
tools:
  write: false
---
You are Oracle.
`;

describe("getFrontmatterModel", () => {
  it("extracts the model value", () => {
    expect(getFrontmatterModel(AGENT_MD)).toBe("openai/gpt-5.5");
  });

  it("strips trailing YAML comments", () => {
    const md = AGENT_MD.replace(
      "model: openai/gpt-5.5",
      "model: openai/gpt-5.5   # the ONLY line agent-router touches",
    );
    expect(getFrontmatterModel(md)).toBe("openai/gpt-5.5");
  });

  it("strips quotes", () => {
    const md = AGENT_MD.replace("model: openai/gpt-5.5", 'model: "openai/gpt-5.5"');
    expect(getFrontmatterModel(md)).toBe("openai/gpt-5.5");
  });

  it("returns null without frontmatter", () => {
    expect(getFrontmatterModel("# just a doc\nmodel: nope\n")).toBeNull();
  });

  it("returns null without a model line", () => {
    expect(getFrontmatterModel("---\ndescription: x\n---\nbody\n")).toBeNull();
  });

  it("ignores indented (nested) model keys", () => {
    const md = "---\noptions:\n  model: nested/thing\ndescription: x\n---\nbody\n";
    expect(getFrontmatterModel(md)).toBeNull();
  });

  it("ignores model-like lines in the body", () => {
    const md = "---\ndescription: x\nmodel: real/model\n---\nmodel: body/decoy\n";
    expect(getFrontmatterModel(md)).toBe("real/model");
  });
});

describe("setFrontmatterModel", () => {
  it("replaces only the model line, preserving everything else", () => {
    const next = setFrontmatterModel(AGENT_MD, "anthropic/claude-opus-4-8");
    expect(getFrontmatterModel(next)).toBe("anthropic/claude-opus-4-8");
    expect(next).toContain("description: Strategic advisor");
    expect(next).toContain("You are Oracle.");
    expect(next).toContain("temperature: 0.1");
    expect(next).not.toContain("openai/gpt-5.5");
  });

  it("round-trips: set then get", () => {
    const next = setFrontmatterModel(AGENT_MD, "x/y");
    expect(getFrontmatterModel(next)).toBe("x/y");
  });

  it("is byte-identical outside the model line", () => {
    const next = setFrontmatterModel(AGENT_MD, "a/b");
    const before = AGENT_MD.split("\n").filter((l) => !l.startsWith("model:"));
    const after = next.split("\n").filter((l) => !l.startsWith("model:"));
    expect(after).toEqual(before);
  });

  it("does not interpret $-patterns in the model id", () => {
    const next = setFrontmatterModel(AGENT_MD, "weird/$&$'model");
    expect(next).toContain("model: weird/$&$'model");
  });

  it("throws without frontmatter", () => {
    expect(() => setFrontmatterModel("no frontmatter", "a/b")).toThrow(/frontmatter/);
  });

  it("throws without a model line", () => {
    expect(() => setFrontmatterModel("---\ndescription: x\n---\nbody\n", "a/b")).toThrow(/model/);
  });

  it("keeps a model line in the body untouched", () => {
    const md = "---\nmodel: real/model\n---\nmodel: body/decoy\n";
    const next = setFrontmatterModel(md, "new/model");
    expect(next).toContain("model: body/decoy");
    expect(getFrontmatterModel(next)).toBe("new/model");
  });
});
