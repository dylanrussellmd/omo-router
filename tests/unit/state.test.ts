import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ValidationError } from "../../src/core/errors.js";
import type { StateFile } from "../../src/core/schema.js";
import { readState, writeState } from "../../src/core/state.js";

function tmp(): string {
  return mkdtempSync(path.join(tmpdir(), "omo-state-"));
}

describe("state.json", () => {
  it("returns null when state.json is missing", async () => {
    const dir = tmp();
    try {
      expect(await readState(path.join(dir, "state.json"))).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("round-trips a valid state file", async () => {
    const dir = tmp();
    try {
      const p = path.join(dir, "state.json");
      const state: StateFile = {
        version: 1,
        active: "premium",
        previousActive: null,
        lastSwitchedAt: "2026-05-04T00:00:00.000Z",
        lastSnapshottedFrom: null,
      };
      await writeState(p, state);
      const got = await readState(p);
      expect(got).toEqual(state);
      expect(readFileSync(p, "utf8")).toMatch(/\n$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects malformed JSON with ValidationError", async () => {
    const dir = tmp();
    try {
      const p = path.join(dir, "state.json");
      writeFileSync(p, "{ not json");
      await expect(readState(p)).rejects.toBeInstanceOf(ValidationError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects state with wrong shape", async () => {
    const dir = tmp();
    try {
      const p = path.join(dir, "state.json");
      writeFileSync(p, JSON.stringify({ version: 999, active: 42 }));
      await expect(readState(p)).rejects.toBeInstanceOf(ValidationError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses to write invalid state", async () => {
    const dir = tmp();
    try {
      const p = path.join(dir, "state.json");
      // @ts-expect-error - deliberately wrong
      await expect(writeState(p, { active: "x" })).rejects.toBeInstanceOf(ValidationError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
