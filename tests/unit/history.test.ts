import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendHistory,
  listHistory,
  parseHistoryFilename,
  trimHistory,
} from "../../src/core/history.js";

let historyDir: string;

beforeEach(() => {
  historyDir = path.join(mkdtempSync(path.join(tmpdir(), "ar-history-")), "history");
});

afterEach(() => {
  rmSync(path.dirname(historyDir), { recursive: true, force: true });
});

describe("parseHistoryFilename", () => {
  it("round-trips through appendHistory", async () => {
    const id = await appendHistory(historyDir, "premium", "cheap", "{}");
    const parsed = parseHistoryFilename(`${id}.json`);
    expect(parsed?.fromStack).toBe("premium");
    expect(parsed?.toStack).toBe("cheap");
  });

  it("handles stack names containing dashes", async () => {
    const id = await appendHistory(historyDir, "my-fast-stack", "my-cheap-stack", "{}");
    const parsed = parseHistoryFilename(`${id}.json`);
    expect(parsed?.fromStack).toBe("my-fast-stack");
    expect(parsed?.toStack).toBe("my-cheap-stack");
  });

  it("returns null for non-history filenames", () => {
    expect(parseHistoryFilename("random.txt")).toBeNull();
    expect(parseHistoryFilename("no-separator.json")).toBeNull();
  });
});

describe("listHistory", () => {
  it("returns empty for a missing dir", async () => {
    expect(await listHistory(path.join(historyDir, "missing"))).toEqual([]);
  });

  it("lists newest first", async () => {
    await appendHistory(historyDir, "a", "b", "{}");
    await new Promise((r) => setTimeout(r, 5));
    await appendHistory(historyDir, "b", "c", "{}");
    const entries = await listHistory(historyDir);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.toStack).toBe("c");
    expect(entries[1]?.toStack).toBe("b");
  });
});

describe("trimHistory", () => {
  it("does nothing below the keep limit", async () => {
    await appendHistory(historyDir, "a", "b", "{}");
    expect(await trimHistory(historyDir, 20)).toEqual([]);
  });

  it("deletes oldest entries beyond the limit", async () => {
    for (let i = 0; i < 5; i += 1) {
      await appendHistory(historyDir, `s${i}`, `s${i + 1}`, "{}");
      await new Promise((r) => setTimeout(r, 5));
    }
    const deleted = await trimHistory(historyDir, 3);
    expect(deleted).toHaveLength(2);
    expect(readdirSync(historyDir)).toHaveLength(3);
    const remaining = await listHistory(historyDir);
    expect(remaining[0]?.toStack).toBe("s5");
  });
});
