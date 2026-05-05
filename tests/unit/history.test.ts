import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  appendHistory,
  listHistory,
  parseHistoryFilename,
  readHistoryEntry,
  trimHistory,
} from "../../src/core/history.js";
import { HistoryEntryNotFoundError } from "../../src/core/errors.js";

function tmp(): string {
  return mkdtempSync(path.join(tmpdir(), "omo-hist-"));
}

describe("parseHistoryFilename", () => {
  it("parses well-formed filenames", () => {
    const r = parseHistoryFilename(
      "2026-05-04T13-22-01-000Z__premium-to-openrouter-cheap.json",
    );
    expect(r).not.toBeNull();
    expect(r?.timestamp).toBe("2026-05-04T13-22-01-000Z");
    expect(r?.fromStack).toBe("premium");
    expect(r?.toStack).toBe("openrouter-cheap");
    expect(r?.id).toBe("2026-05-04T13-22-01-000Z__premium-to-openrouter-cheap");
  });

  it("returns null for non-history filenames", () => {
    expect(parseHistoryFilename("random.json")).toBeNull();
    expect(parseHistoryFilename("not.json.txt")).toBeNull();
    expect(parseHistoryFilename("nodelimiter.json")).toBeNull();
  });
});

describe("appendHistory + listHistory", () => {
  it("appends one entry and lists it", async () => {
    const dir = tmp();
    try {
      const id = await appendHistory(dir, "premium", "cheap", '{"a":1}');
      expect(id).toMatch(/__premium-to-cheap$/);
      const list = await listHistory(dir);
      expect(list).toHaveLength(1);
      expect(list[0]?.fromStack).toBe("premium");
      expect(list[0]?.toStack).toBe("cheap");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns empty array when history dir is missing", async () => {
    const list = await listHistory("/no/such/dir");
    expect(list).toEqual([]);
  });

  it("orders newest-first", async () => {
    const dir = tmp();
    try {
      await appendHistory(dir, "a", "b", "{}");
      await new Promise((r) => setTimeout(r, 5));
      await appendHistory(dir, "b", "c", "{}");
      await new Promise((r) => setTimeout(r, 5));
      await appendHistory(dir, "c", "d", "{}");
      const list = await listHistory(dir);
      expect(list).toHaveLength(3);
      expect(list[0]?.toStack).toBe("d");
      expect(list[2]?.toStack).toBe("b");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("readHistoryEntry", () => {
  it("reads back a saved entry", async () => {
    const dir = tmp();
    try {
      const id = await appendHistory(dir, "x", "y", '{"hello":"world"}');
      const got = await readHistoryEntry(dir, id);
      expect(got).toBe('{"hello":"world"}');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws HistoryEntryNotFoundError for unknown ids", async () => {
    const dir = tmp();
    try {
      await expect(readHistoryEntry(dir, "nope")).rejects.toBeInstanceOf(
        HistoryEntryNotFoundError,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("trimHistory", () => {
  it("keeps only N most recent entries", async () => {
    const dir = tmp();
    try {
      for (let i = 0; i < 5; i++) {
        await appendHistory(dir, `s${i}`, `s${i + 1}`, "{}");
        await new Promise((r) => setTimeout(r, 3));
      }
      const deleted = await trimHistory(dir, 3);
      expect(deleted).toHaveLength(2);
      const remaining = await listHistory(dir);
      expect(remaining).toHaveLength(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does nothing when count is below the keep limit", async () => {
    const dir = tmp();
    try {
      await appendHistory(dir, "a", "b", "{}");
      const deleted = await trimHistory(dir, 5);
      expect(deleted).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
