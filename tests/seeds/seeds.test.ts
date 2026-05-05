import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { StackFileSchema } from "../../src/core/schema.js";
import { collectModelRefs, parseModelList, validateStack } from "../../src/core/validator.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SEEDS_DIR = path.join(here, "..", "..", "src", "seeds");
const FIXTURE = readFileSync(
  path.join(here, "..", "fixtures", "opencode-models-output.txt"),
  "utf8",
);
const fakeRunner = async () => FIXTURE;

const SEED_NAMES = ["premium", "openrouter-cheap", "free-only"] as const;

function loadSeed(name: string): unknown {
  return JSON.parse(readFileSync(path.join(SEEDS_DIR, `${name}.json`), "utf8"));
}

describe("seed stacks", () => {
  it("ships all three seeds in src/seeds/", () => {
    const present = readdirSync(SEEDS_DIR)
      .filter((f) => f.endsWith(".json"))
      .sort();
    expect(present).toEqual(["free-only.json", "openrouter-cheap.json", "premium.json"]);
  });

  for (const name of SEED_NAMES) {
    describe(name, () => {
      const seed = loadSeed(name);

      it("parses with StackFileSchema", () => {
        const r = StackFileSchema.safeParse(seed);
        expect(r.success).toBe(true);
      });

      it("contains both `agents` and `categories`", () => {
        const s = StackFileSchema.parse(seed);
        expect(s.agents).toBeDefined();
        expect(s.categories).toBeDefined();
      });

      it("has no antigravity-prefixed model IDs", () => {
        const s = StackFileSchema.parse(seed);
        for (const ref of collectModelRefs(s)) {
          expect(ref.modelId).not.toMatch(/antigravity-/);
        }
      });

      it("every model ID is reachable in the captured opencode catalogue", async () => {
        const s = StackFileSchema.parse(seed);
        const r = await validateStack(s, { runOpencodeModels: fakeRunner });
        if (!r.ok) {
          console.error(`Stack ${name} has missing models:`, r.missing);
        }
        expect(r.ok).toBe(true);
      });
    });
  }

  it("all three seeds cover the same set of agent names (parity)", () => {
    const sets = SEED_NAMES.map((n) => {
      const s = StackFileSchema.parse(loadSeed(n));
      return new Set(Object.keys(s.agents ?? {}));
    });
    const reference = sets[0];
    expect(reference).toBeDefined();
    if (!reference) return;
    for (let i = 1; i < sets.length; i++) {
      const other = sets[i];
      expect(other).toBeDefined();
      if (!other) continue;
      expect([...other].sort()).toEqual([...reference].sort());
    }
  });

  it("all three seeds cover the same set of category names (parity)", () => {
    const sets = SEED_NAMES.map((n) => {
      const s = StackFileSchema.parse(loadSeed(n));
      return new Set(Object.keys(s.categories ?? {}));
    });
    const reference = sets[0];
    expect(reference).toBeDefined();
    if (!reference) return;
    for (let i = 1; i < sets.length; i++) {
      const other = sets[i];
      expect(other).toBeDefined();
      if (!other) continue;
      expect([...other].sort()).toEqual([...reference].sort());
    }
  });

  it("captured opencode catalogue parses to non-empty set", () => {
    const set = parseModelList(FIXTURE);
    expect(set.size).toBeGreaterThan(50);
  });
});
