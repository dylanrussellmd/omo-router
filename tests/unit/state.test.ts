import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ValidationError } from "../../src/core/errors.js";
import { readState, writeState } from "../../src/core/state.js";

let dir: string;
let statePath: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ar-state-"));
  statePath = path.join(dir, "state.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const VALID = {
  version: 1 as const,
  active: "premium",
  previousActive: null,
  lastSwitchedAt: new Date().toISOString(),
};

describe("readState", () => {
  it("returns null when the file is absent", async () => {
    expect(await readState(statePath)).toBeNull();
  });

  it("round-trips through writeState", async () => {
    await writeState(statePath, VALID);
    expect(await readState(statePath)).toEqual(VALID);
  });

  it("throws ValidationError on malformed JSON", async () => {
    writeFileSync(statePath, "{broken");
    await expect(readState(statePath)).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError on schema mismatch", async () => {
    writeFileSync(statePath, JSON.stringify({ version: 99 }));
    await expect(readState(statePath)).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects legacy state with lastSnapshottedFrom", async () => {
    writeFileSync(statePath, JSON.stringify({ ...VALID, lastSnapshottedFrom: null }));
    await expect(readState(statePath)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("writeState", () => {
  it("refuses to write invalid state", async () => {
    await expect(
      writeState(statePath, { ...VALID, active: "" } as typeof VALID),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("writes pretty JSON with trailing newline", async () => {
    await writeState(statePath, VALID);
    const raw = readFileSync(statePath, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw).toContain('  "active"');
  });
});
