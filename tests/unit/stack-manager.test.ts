import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ModelValidationError, StackNotFoundError, UserError } from "../../src/core/errors.js";
import { listHistory } from "../../src/core/history.js";
import { type OmoPaths, resolvePaths } from "../../src/core/paths.js";
import {
  addStack,
  back,
  exportStack,
  getActiveStackName,
  importStack,
  listStacks,
  readStack,
  removeStack,
  restoreFromHistory,
  switchTo,
} from "../../src/core/stack-manager.js";
import { readState } from "../../src/core/state.js";

const ALWAYS_VALID = async () =>
  // canned model list big enough to satisfy any seed-style stack used in tests
  [
    "anthropic/claude-opus-4-7",
    "anthropic/claude-sonnet-4-6",
    "openrouter/openai/gpt-5.4",
    "google/gemini-3-flash-preview",
    "google/gemini-3.1-pro-preview",
    "openrouter/google/gemini-2.5-flash",
  ].join("\n");

const PREMIUM = {
  agents: {
    sisyphus: { model: "anthropic/claude-opus-4-7", variant: "max" },
    explore: { model: "google/gemini-3-flash-preview" },
  },
  categories: {
    quick: { model: "google/gemini-3-flash-preview" },
  },
};
const CHEAP = {
  agents: {
    sisyphus: { model: "openrouter/openai/gpt-5.4" },
    explore: { model: "openrouter/google/gemini-2.5-flash" },
  },
  categories: {
    quick: { model: "openrouter/google/gemini-2.5-flash" },
  },
};

function setup(): { paths: OmoPaths; cleanup: () => void } {
  const omoHome = mkdtempSync(path.join(tmpdir(), "omo-mgr-"));
  const opencodeDir = mkdtempSync(path.join(tmpdir(), "omo-mgr-oc-"));
  const paths = resolvePaths({ omoHome, opencodeConfigDir: opencodeDir });
  mkdirSync(paths.stacksDir, { recursive: true });
  mkdirSync(paths.historyDir, { recursive: true });
  mkdirSync(paths.opencodeConfigDir, { recursive: true });
  writeFileSync(path.join(paths.stacksDir, "premium.json"), JSON.stringify(PREMIUM));
  writeFileSync(path.join(paths.stacksDir, "cheap.json"), JSON.stringify(CHEAP));
  return {
    paths,
    cleanup: () => {
      rmSync(omoHome, { recursive: true, force: true });
      rmSync(opencodeDir, { recursive: true, force: true });
    },
  };
}

describe("listStacks", () => {
  it("returns sorted names", async () => {
    const { paths: p, cleanup } = setup();
    try {
      const list = await listStacks(p);
      expect(list).toEqual(["cheap", "premium"]);
    } finally {
      cleanup();
    }
  });

  it("returns [] when stacks dir missing", async () => {
    const { paths: p, cleanup } = setup();
    try {
      rmSync(p.stacksDir, { recursive: true, force: true });
      expect(await listStacks(p)).toEqual([]);
    } finally {
      cleanup();
    }
  });
});

describe("readStack", () => {
  it("parses + validates", async () => {
    const { paths: p, cleanup } = setup();
    try {
      const s = await readStack(p, "premium");
      expect(s.agents?.sisyphus?.model).toBe("anthropic/claude-opus-4-7");
    } finally {
      cleanup();
    }
  });

  it("throws StackNotFoundError on unknown name", async () => {
    const { paths: p, cleanup } = setup();
    try {
      await expect(readStack(p, "nope")).rejects.toBeInstanceOf(StackNotFoundError);
    } finally {
      cleanup();
    }
  });
});

describe("switchTo", () => {
  it("validates by default and rejects unreachable IDs", async () => {
    const { paths: p, cleanup } = setup();
    try {
      const fakeRunner = async () => "anthropic/claude-opus-4-7\n"; // no gemini, no openrouter
      await expect(
        switchTo(p, "cheap", { validateOptions: { runOpencodeModels: fakeRunner } }),
      ).rejects.toBeInstanceOf(ModelValidationError);
    } finally {
      cleanup();
    }
  });

  it("performs first switch correctly (no prevActive snapshot)", async () => {
    const { paths: p, cleanup } = setup();
    try {
      const r = await switchTo(p, "premium", {
        validateOptions: { runOpencodeModels: ALWAYS_VALID },
      });
      expect(r.previous).toBeNull();
      expect(r.current).toBe("premium");
      expect(r.snapshottedFrom).toBeNull();
      const live = readFileSync(p.liveConfigPath, "utf8");
      expect(JSON.parse(live)).toEqual(PREMIUM);
      const state = await readState(p.statePath);
      expect(state?.active).toBe("premium");
      expect(state?.previousActive).toBeNull();
      const hist = await listHistory(p.historyDir);
      expect(hist).toHaveLength(1);
      expect(hist[0]?.fromStack).toBe("(none)");
      expect(hist[0]?.toStack).toBe("premium");
    } finally {
      cleanup();
    }
  });

  it("snapshot-back captures drift on subsequent switch", async () => {
    const { paths: p, cleanup } = setup();
    try {
      await switchTo(p, "premium", { validateOptions: { runOpencodeModels: ALWAYS_VALID } });

      // simulate a hand-edit / migration of live oh-my-openagent.json
      const drifted = JSON.parse(readFileSync(p.liveConfigPath, "utf8"));
      drifted.agents.sisyphus.model = "anthropic/claude-sonnet-4-6";
      writeFileSync(p.liveConfigPath, JSON.stringify(drifted));

      const r = await switchTo(p, "cheap", {
        validateOptions: { runOpencodeModels: ALWAYS_VALID },
      });
      expect(r.snapshottedFrom).toBe("premium");

      // premium.json on disk should now reflect the drift
      const premiumRaw = JSON.parse(readFileSync(path.join(p.stacksDir, "premium.json"), "utf8"));
      expect(premiumRaw.agents.sisyphus.model).toBe("anthropic/claude-sonnet-4-6");

      // live should match cheap.json
      const live = JSON.parse(readFileSync(p.liveConfigPath, "utf8"));
      expect(live).toEqual(CHEAP);
    } finally {
      cleanup();
    }
  });

  it("--no-snapshot-back leaves source stack untouched even on drift", async () => {
    const { paths: p, cleanup } = setup();
    try {
      await switchTo(p, "premium", { validateOptions: { runOpencodeModels: ALWAYS_VALID } });
      const drifted = JSON.parse(readFileSync(p.liveConfigPath, "utf8"));
      drifted.agents.sisyphus.model = "anthropic/claude-sonnet-4-6";
      writeFileSync(p.liveConfigPath, JSON.stringify(drifted));

      const r = await switchTo(p, "cheap", {
        snapshotBack: false,
        validateOptions: { runOpencodeModels: ALWAYS_VALID },
      });
      expect(r.snapshottedFrom).toBeNull();
      const premiumRaw = JSON.parse(readFileSync(path.join(p.stacksDir, "premium.json"), "utf8"));
      expect(premiumRaw.agents.sisyphus.model).toBe("anthropic/claude-opus-4-7"); // unchanged
    } finally {
      cleanup();
    }
  });

  it("forceInvalid bypasses the validation gate", async () => {
    const { paths: p, cleanup } = setup();
    try {
      const empty = async () => "";
      await expect(
        switchTo(p, "cheap", {
          forceInvalid: true,
          validateOptions: { runOpencodeModels: empty },
        }),
      ).resolves.toMatchObject({ current: "cheap" });
    } finally {
      cleanup();
    }
  });

  it("throws StackNotFoundError on unknown target", async () => {
    const { paths: p, cleanup } = setup();
    try {
      await expect(
        switchTo(p, "ghost", { validateOptions: { runOpencodeModels: ALWAYS_VALID } }),
      ).rejects.toBeInstanceOf(StackNotFoundError);
    } finally {
      cleanup();
    }
  });
});

describe("back", () => {
  it("undoes the most recent switch", async () => {
    const { paths: p, cleanup } = setup();
    try {
      const opts = { validateOptions: { runOpencodeModels: ALWAYS_VALID } };
      await switchTo(p, "premium", opts);
      await switchTo(p, "cheap", opts);
      const r = await back(p, 1, opts);
      expect(r.current).toBe("premium");
      const live = JSON.parse(readFileSync(p.liveConfigPath, "utf8"));
      expect(live.agents.sisyphus.model).toBe("anthropic/claude-opus-4-7");
    } finally {
      cleanup();
    }
  });

  it("throws UserError when no previous active", async () => {
    const { paths: p, cleanup } = setup();
    try {
      await switchTo(p, "premium", { validateOptions: { runOpencodeModels: ALWAYS_VALID } });
      await expect(back(p, 1)).rejects.toBeInstanceOf(UserError);
    } finally {
      cleanup();
    }
  });
});

describe("restoreFromHistory", () => {
  it("copies a history entry back into live + sets sentinel active", async () => {
    const { paths: p, cleanup } = setup();
    try {
      const opts = { validateOptions: { runOpencodeModels: ALWAYS_VALID } };
      await switchTo(p, "premium", opts);
      await switchTo(p, "cheap", opts);
      const hist = await listHistory(p.historyDir);
      // Pick the one whose displaced content was premium (= toStack:cheap)
      const entry = hist.find((e) => e.toStack === "cheap");
      expect(entry).toBeDefined();
      const r = await restoreFromHistory(p, entry?.id ?? "");
      expect(r.id).toBe(entry?.id);
      const live = JSON.parse(readFileSync(p.liveConfigPath, "utf8"));
      expect(live).toEqual(PREMIUM);
      const state = await readState(p.statePath);
      expect(state?.active.startsWith("(restored:")).toBe(true);
    } finally {
      cleanup();
    }
  });
});

describe("addStack / removeStack / importStack / exportStack", () => {
  it("addStack with --from-active copies live config", async () => {
    const { paths: p, cleanup } = setup();
    try {
      const opts = { validateOptions: { runOpencodeModels: ALWAYS_VALID } };
      await switchTo(p, "premium", opts);
      await addStack(p, "snap", { fromActive: true });
      const snap = await readStack(p, "snap");
      expect(snap).toEqual(PREMIUM);
    } finally {
      cleanup();
    }
  });

  it("addStack rejects invalid names", async () => {
    const { paths: p, cleanup } = setup();
    try {
      await expect(addStack(p, "bad name!")).rejects.toBeInstanceOf(UserError);
    } finally {
      cleanup();
    }
  });

  it("addStack refuses to overwrite without --force", async () => {
    const { paths: p, cleanup } = setup();
    try {
      await expect(addStack(p, "premium")).rejects.toBeInstanceOf(UserError);
      await addStack(p, "premium", { force: true });
    } finally {
      cleanup();
    }
  });

  it("removeStack refuses active without --force", async () => {
    const { paths: p, cleanup } = setup();
    try {
      const opts = { validateOptions: { runOpencodeModels: ALWAYS_VALID } };
      await switchTo(p, "premium", opts);
      await expect(removeStack(p, "premium")).rejects.toBeInstanceOf(UserError);
      await removeStack(p, "premium", { force: true });
      expect(await listStacks(p)).toEqual(["cheap"]);
    } finally {
      cleanup();
    }
  });

  it("import + export round-trip", async () => {
    const { paths: p, cleanup } = setup();
    try {
      const out = path.join(p.opencodeConfigDir, "out.json");
      await exportStack(p, "premium", out);
      await importStack(p, "imported", out);
      expect(await listStacks(p)).toContain("imported");
    } finally {
      cleanup();
    }
  });
});

describe("getActiveStackName", () => {
  it("returns null before any switch", async () => {
    const { paths: p, cleanup } = setup();
    try {
      expect(await getActiveStackName(p)).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("returns name after switch", async () => {
    const { paths: p, cleanup } = setup();
    try {
      await switchTo(p, "cheap", { validateOptions: { runOpencodeModels: ALWAYS_VALID } });
      expect(await getActiveStackName(p)).toBe("cheap");
    } finally {
      cleanup();
    }
  });
});
