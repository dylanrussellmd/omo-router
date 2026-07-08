import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolvePaths } from "../../src/core/paths.js";
import {
  type StackSnapshot,
  createSidebarPoller,
  readStackSnapshot,
  snapshotKey,
} from "../../src/tui/store.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "ar-store-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("readStackSnapshot", () => {
  it("degrades to (none) + empty list when nothing exists", async () => {
    const paths = resolvePaths({ routerHome: path.join(root, "nope"), env: {} });
    const snap = await readStackSnapshot(paths);
    expect(snap.active).toBeNull();
    expect(snap.stacks).toEqual([]);
  });

  it("reads active + stack names", async () => {
    const paths = resolvePaths({ routerHome: path.join(root, "router"), env: {} });
    mkdirSync(paths.stacksDir, { recursive: true });
    writeFileSync(path.join(paths.stacksDir, "premium.json"), "{}");
    writeFileSync(
      paths.statePath,
      JSON.stringify({
        version: 1,
        active: "premium",
        previousActive: null,
        lastSwitchedAt: new Date().toISOString(),
      }),
    );
    const snap = await readStackSnapshot(paths);
    expect(snap.active).toBe("premium");
    expect(snap.stacks).toEqual(["premium"]);
    expect(snap.key).toBe(snapshotKey("premium", ["premium"]));
  });
});

describe("createSidebarPoller", () => {
  function manualScheduler() {
    const queue: Array<() => void> = [];
    return {
      schedule: (fn: () => void) => {
        queue.push(fn);
        return queue.length;
      },
      cancel: () => {},
      flush: async () => {
        const fns = queue.splice(0);
        for (const fn of fns) fn();
        await Promise.resolve();
        await Promise.resolve();
      },
    };
  }

  function snap(active: string | null, stacks: string[]): StackSnapshot {
    return { active, stacks, key: snapshotKey(active, stacks) };
  }

  it("fires onChange only when the key changes", async () => {
    const sched = manualScheduler();
    const onChange = vi.fn();
    let current = snap("a", ["a"]);
    const stop = createSidebarPoller({
      read: async () => current,
      intervalMs: 1000,
      initial: snap("a", ["a"]),
      onChange,
      schedule: sched.schedule,
      cancel: sched.cancel,
    });

    await sched.flush();
    expect(onChange).not.toHaveBeenCalled();

    current = snap("b", ["a", "b"]);
    await sched.flush();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0].active).toBe("b");
    stop();
  });

  it("survives read failures and keeps polling", async () => {
    const sched = manualScheduler();
    const onChange = vi.fn();
    let fail = true;
    const stop = createSidebarPoller({
      read: async () => {
        if (fail) throw new Error("transient");
        return snap("ok", ["ok"]);
      },
      intervalMs: 1000,
      initial: snap(null, []),
      onChange,
      schedule: sched.schedule,
      cancel: sched.cancel,
    });

    await sched.flush();
    expect(onChange).not.toHaveBeenCalled();
    fail = false;
    await sched.flush();
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
  });

  it("stops scheduling after dispose", async () => {
    const sched = manualScheduler();
    const onChange = vi.fn();
    const stop = createSidebarPoller({
      read: async () => snap("x", ["x"]),
      intervalMs: 1000,
      initial: snap(null, []),
      onChange,
      schedule: sched.schedule,
      cancel: sched.cancel,
    });
    stop();
    await sched.flush();
    expect(onChange).not.toHaveBeenCalled();
  });
});
