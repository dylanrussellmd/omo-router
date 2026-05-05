import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OmoRouterPlugin } from "../../src/plugin.js";

const FAKE_OPENCODE_MODELS = [
  "anthropic/claude-opus-4-7",
  "anthropic/claude-sonnet-4-6",
  "openrouter/openai/gpt-5.4",
  "openrouter/google/gemini-2.5-flash",
  "google/gemini-3-flash-preview",
  "google/gemini-3.1-pro-preview",
  "google/gemini-2.5-flash",
];

const PREMIUM = {
  agents: { sisyphus: { model: "anthropic/claude-opus-4-7" } },
  categories: { quick: { model: "google/gemini-3-flash-preview" } },
};
const CHEAP = {
  agents: { sisyphus: { model: "openrouter/openai/gpt-5.4" } },
  categories: { quick: { model: "openrouter/google/gemini-2.5-flash" } },
};

interface ToolDef {
  description: string;
  args: Record<string, unknown>;
  execute: (
    args: Record<string, unknown>,
    context?: unknown,
  ) => Promise<string | { output: string; metadata?: Record<string, unknown> }>;
}

interface PluginReturn {
  tool: Record<string, ToolDef>;
}

function setup(): {
  paths: { liveConfigPath: string; statePath: string; stacksDir: string };
  cleanup: () => void;
} {
  const omoHome = mkdtempSync(path.join(tmpdir(), "omo-plugin-"));
  const fakeXdg = mkdtempSync(path.join(tmpdir(), "omo-plugin-xdg-"));
  const binDir = mkdtempSync(path.join(tmpdir(), "omo-plugin-bin-"));
  const prevPath = process.env.PATH ?? "";
  process.env.OMO_ROUTER_HOME = omoHome;
  process.env.XDG_CONFIG_HOME = fakeXdg;
  // Stub `opencode` so the validator's default `execFile("opencode", ["models"])`
  // resolves deterministically in any environment, including CI.
  const stubScript = path.join(binDir, "opencode");
  writeFileSync(
    stubScript,
    `#!/usr/bin/env bash
if [ "$1" = "models" ]; then
  cat <<'EOF'
${FAKE_OPENCODE_MODELS.join("\n")}
EOF
  exit 0
fi
exit 0
`,
    { mode: 0o755 },
  );
  chmodSync(stubScript, 0o755);
  process.env.PATH = `${binDir}:${prevPath}`;

  mkdirSync(path.join(fakeXdg, "opencode"), { recursive: true });
  const liveConfigPath = path.join(fakeXdg, "opencode", "oh-my-openagent.json");
  const statePath = path.join(omoHome, "state.json");
  const stacksDir = path.join(omoHome, "stacks");
  mkdirSync(stacksDir, { recursive: true });
  writeFileSync(path.join(stacksDir, "premium.json"), JSON.stringify(PREMIUM));
  writeFileSync(path.join(stacksDir, "cheap.json"), JSON.stringify(CHEAP));
  writeFileSync(liveConfigPath, JSON.stringify(PREMIUM));
  writeFileSync(
    statePath,
    `${JSON.stringify({
      version: 1,
      active: "premium",
      previousActive: null,
      lastSwitchedAt: new Date().toISOString(),
      lastSnapshottedFrom: null,
    })}\n`,
  );
  return {
    paths: { liveConfigPath, statePath, stacksDir },
    cleanup: () => {
      process.env.OMO_ROUTER_HOME = undefined;
      process.env.XDG_CONFIG_HOME = undefined;
      process.env.PATH = prevPath;
      rmSync(omoHome, { recursive: true, force: true });
      rmSync(fakeXdg, { recursive: true, force: true });
      rmSync(binDir, { recursive: true, force: true });
    },
  };
}

interface FakeClient {
  logs: Array<{ service: string; level: string; message: string }>;
  toasts: Array<{ message: string; variant: string }>;
  app: {
    log: (input: {
      body: {
        service: string;
        level: "debug" | "info" | "warn" | "error";
        message: string;
        extra?: Record<string, unknown>;
      };
    }) => Promise<void>;
  };
  tui: {
    toast: {
      show: (i: {
        body: { message: string; variant: "info" | "success" | "warning" };
      }) => Promise<void>;
    };
  };
}

function makeFakeClient(): FakeClient {
  const logs: FakeClient["logs"] = [];
  const toasts: FakeClient["toasts"] = [];
  return {
    logs,
    toasts,
    app: {
      async log(input) {
        logs.push({
          service: input.body.service,
          level: input.body.level,
          message: input.body.message,
        });
      },
    },
    tui: {
      toast: {
        async show(i) {
          toasts.push(i.body);
        },
      },
    },
  };
}

const fakeCtx = (client: FakeClient) =>
  ({
    client,
    project: { worktree: "/tmp" },
    directory: "/tmp",
    worktree: "/tmp",
    $: () => ({}),
  }) as unknown as Parameters<typeof OmoRouterPlugin>[0];

async function call(t: ToolDef, args: Record<string, unknown>): Promise<unknown> {
  const r = await t.execute(args);
  if (typeof r === "string") return JSON.parse(r);
  return JSON.parse(r.output);
}

describe("OmoRouterPlugin", () => {
  it("returns five tools and logs init message", async () => {
    const { cleanup } = setup();
    try {
      const client = makeFakeClient();
      const result = (await OmoRouterPlugin(fakeCtx(client))) as unknown as PluginReturn;
      const toolNames = Object.keys(result.tool).sort();
      expect(toolNames).toEqual(["omo_back", "omo_list", "omo_status", "omo_use", "omo_validate"]);
      expect(client.logs.find((l) => l.service === "omo-router")?.message).toBe("init");
    } finally {
      cleanup();
    }
  });

  it("omo_status returns active + available", async () => {
    const { cleanup } = setup();
    try {
      const client = makeFakeClient();
      const r = (await OmoRouterPlugin(fakeCtx(client))) as unknown as PluginReturn;
      const status = (await call(r.tool.omo_status as ToolDef, {})) as {
        active: string | null;
        available: string[];
      };
      expect(status.active).toBe("premium");
      expect(status.available.sort()).toEqual(["cheap", "premium"]);
    } finally {
      cleanup();
    }
  });

  it("omo_list reflects isActive", async () => {
    const { cleanup } = setup();
    try {
      const client = makeFakeClient();
      const r = (await OmoRouterPlugin(fakeCtx(client))) as unknown as PluginReturn;
      const list = (await call(r.tool.omo_list as ToolDef, {})) as Array<{
        name: string;
        isActive: boolean;
      }>;
      expect(list.find((x) => x.name === "premium")?.isActive).toBe(true);
      expect(list.find((x) => x.name === "cheap")?.isActive).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("omo_use switches and fires toast", async () => {
    const { cleanup } = setup();
    try {
      const client = makeFakeClient();
      const r = (await OmoRouterPlugin(fakeCtx(client))) as unknown as PluginReturn;
      const out = (await call(r.tool.omo_use as ToolDef, {
        name: "cheap",
        validate: false,
      })) as { previous: string; current: string; restartRequired: boolean };
      expect(out.current).toBe("cheap");
      expect(out.previous).toBe("premium");
      expect(out.restartRequired).toBe(true);
      expect(client.toasts).toHaveLength(1);
      expect(client.toasts[0]?.message).toMatch(/cheap/);
    } finally {
      cleanup();
    }
  });

  it("omo_use with unknown name returns structured error and no toast", async () => {
    const { cleanup } = setup();
    try {
      const client = makeFakeClient();
      const r = (await OmoRouterPlugin(fakeCtx(client))) as unknown as PluginReturn;
      const out = (await call(r.tool.omo_use as ToolDef, {
        name: "ghost",
        validate: false,
      })) as { error?: string };
      expect(out.error).toBeDefined();
      expect(client.toasts).toHaveLength(0);
    } finally {
      cleanup();
    }
  });

  it("omo_back undoes last switch and fires toast", async () => {
    const { cleanup } = setup();
    try {
      const client = makeFakeClient();
      const r = (await OmoRouterPlugin(fakeCtx(client))) as unknown as PluginReturn;
      await call(r.tool.omo_use as ToolDef, { name: "cheap", validate: false });
      client.toasts.length = 0;
      const out = (await call(r.tool.omo_back as ToolDef, {})) as {
        previous: string;
        current: string;
      };
      expect(out.current).toBe("premium");
      expect(client.toasts).toHaveLength(1);
    } finally {
      cleanup();
    }
  });

  it("omo_validate returns structured ok/missing", async () => {
    const { cleanup, paths } = setup();
    try {
      writeFileSync(
        path.join(paths.stacksDir, "broken.json"),
        JSON.stringify({
          agents: { sisyphus: { model: "vendor-not-real/foo-bar-9000" } },
          categories: { quick: { model: "google/gemini-3-flash-preview" } },
        }),
      );
      const client = makeFakeClient();
      const r = (await OmoRouterPlugin(fakeCtx(client))) as unknown as PluginReturn;
      const out = (await call(r.tool.omo_validate as ToolDef, { name: "broken" })) as {
        ok?: boolean;
        missing?: Array<{ path: string; modelId: string }>;
        error?: string;
      };
      expect(out.ok === false || typeof out.error === "string").toBe(true);
    } finally {
      cleanup();
    }
  });
});
