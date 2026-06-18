/**
 * opencode plugin entry for omo-router.
 *
 * What this exposes to opencode:
 *   - 5 tools the agent can call:
 *       omo_status   — read state.json
 *       omo_list     — list stacks
 *       omo_use      — switch stacks (fires TUI toast on success)
 *       omo_validate — check model IDs against opencode's reachable list
 *       omo_back     — undo last switch (fires TUI toast)
 *
 *   - One log line on init noting the active stack (via client.app.log).
 *
 * What this DOES NOT do:
 *   - We never fire `tui.toast.show` from plugin init. The toast hook is only
 *     reliably callable inside event/tool handler context per opencode docs.
 *   - We never modify oh-my-openagent.json from a hook (only from tool calls).
 *
 * The `tool()` helper from `@opencode-ai/plugin` wraps our `args` zod shape +
 * `execute()` into the shape opencode wants. `execute()` must return either a
 * string or `{output: string, metadata?: object}`. We always return JSON in
 * `output` so the agent can parse our tool responses programmatically.
 */

import { type Plugin, tool } from "@opencode-ai/plugin";
import { resolvePathsWithConfig } from "./core/config.js";
import { OmoError } from "./core/errors.js";
import type { OmoPaths } from "./core/paths.js";
import {
  back as backCore,
  getActiveStackName,
  listStacks,
  readStack,
  switchTo,
} from "./core/stack-manager.js";
import { validateStack } from "./core/validator.js";
import { VERSION } from "./version.js";

interface PluginClientLike {
  app?: {
    log?: (input: {
      body: {
        service: string;
        level: "debug" | "info" | "warn" | "error";
        message: string;
        extra?: Record<string, unknown>;
      };
    }) => Promise<unknown>;
  };
  tui?: {
    toast?: {
      show?: (input: {
        body: { message: string; variant: "info" | "success" | "warning" };
      }) => Promise<unknown>;
    };
  };
}

/**
 * Try to fire a TUI toast. The hook isn't always available (different
 * opencode versions, headless test runs, etc.) — silently fall back to
 * structured logging so a missing toast never blocks the actual switch.
 */
async function safeToast(
  client: PluginClientLike,
  message: string,
  variant: "info" | "success" | "warning" = "success",
): Promise<void> {
  try {
    if (client.tui?.toast?.show) {
      await client.tui.toast.show({ body: { message, variant } });
      return;
    }
  } catch {
    // fall through to log
  }
  await client.app
    ?.log?.({
      body: { service: "omo-router", level: "info", message: `[toast-fallback] ${message}` },
    })
    .catch(() => {
      /* really truly silent now */
    });
}

/**
 * Stringify a tool result so opencode renders it as the agent's tool output.
 * `output` is the displayed string; `metadata` is structured data the agent
 * can reason over without re-parsing.
 */
function ok(value: unknown): { output: string; metadata: Record<string, unknown> } {
  return { output: JSON.stringify(value, null, 2), metadata: value as Record<string, unknown> };
}

/** Convert one of our typed errors into a tool-friendly response. */
function errOut(e: unknown): { output: string; metadata: { error: string } } {
  const msg =
    e instanceof OmoError
      ? `${e.name}: ${e.message}`
      : `${(e as Error).name ?? "Error"}: ${(e as Error).message}`;
  return { output: JSON.stringify({ error: msg }, null, 2), metadata: { error: msg } };
}

/* ------------------------------------------------------------------------- *
 * plugin definition                                                          *
 * ------------------------------------------------------------------------- */

export const OmoRouterPlugin: Plugin = async (ctx) => {
  const paths: OmoPaths = await resolvePathsWithConfig();
  const client = ctx.client as unknown as PluginClientLike;

  // Init log. Best-effort — never throw from plugin init.
  await client.app
    ?.log?.({
      body: {
        service: "omo-router",
        level: "info",
        message: "init",
        extra: {
          version: VERSION,
          active: (await getActiveStackName(paths).catch(() => null)) ?? "(none)",
          omoHome: paths.omoHome,
        },
      },
    })
    .catch(() => {
      /* logging must not block plugin startup */
    });

  return {
    tool: {
      omo_status: tool({
        description: "Report the active omo-router stack and the names of all available stacks.",
        args: {},
        async execute() {
          try {
            const [active, available] = await Promise.all([
              getActiveStackName(paths),
              listStacks(paths),
            ]);
            return ok({ active, available });
          } catch (e) {
            return errOut(e);
          }
        },
      }),

      omo_list: tool({
        description: "List all omo-router stacks with isActive flags.",
        args: {},
        async execute() {
          try {
            const [active, available] = await Promise.all([
              getActiveStackName(paths),
              listStacks(paths),
            ]);
            return ok(available.map((name) => ({ name, isActive: name === active })));
          } catch (e) {
            return errOut(e);
          }
        },
      }),

      omo_use: tool({
        description:
          "Switch the active omo-router stack. Validates model IDs first. Restart opencode for changes to take effect.",
        args: {
          name: tool.schema.string().describe("Stack name to switch to (see omo_list)."),
          snapshotBack: tool.schema
            .boolean()
            .optional()
            .describe(
              "Default true. Save current oh-my-openagent.json back to its source stack first.",
            ),
          validate: tool.schema
            .boolean()
            .optional()
            .describe("Default true. Reject the switch if any model ID is unreachable."),
        },
        async execute(args) {
          try {
            const r = await switchTo(paths, args.name, {
              snapshotBack: args.snapshotBack ?? true,
              validate: args.validate ?? true,
            });
            await safeToast(
              client,
              `omo-router: switched to "${r.current}". Restart opencode for change to take effect.`,
            );
            return ok({
              previous: r.previous,
              current: r.current,
              snapshottedFrom: r.snapshottedFrom,
              restartRequired: true,
            });
          } catch (e) {
            return errOut(e);
          }
        },
      }),

      omo_validate: tool({
        description:
          "Validate that every model ID in a stack (or the live config) is reachable through current opencode auth.",
        args: {
          name: tool.schema.string().optional().describe("Stack name; omit when using `active`."),
          active: tool.schema
            .boolean()
            .optional()
            .describe("Validate the live oh-my-openagent.json instead."),
        },
        async execute(args) {
          try {
            let stack: unknown;
            if (args.active) {
              const { readFile } = await import("node:fs/promises");
              stack = JSON.parse(await readFile(paths.liveConfigPath, "utf8"));
            } else if (args.name) {
              stack = await readStack(paths, args.name);
            } else {
              return errOut(new Error("Pass `name` or `active: true`."));
            }
            const r = await validateStack(stack as Parameters<typeof validateStack>[0]);
            return ok({
              ok: r.ok,
              checked: r.checked,
              missing: r.missing.map((m) => ({ path: m.path, modelId: m.modelId })),
            });
          } catch (e) {
            return errOut(e);
          }
        },
      }),

      omo_back: tool({
        description:
          "Undo the last N omo-router switches (default 1). Restart opencode for changes to take effect.",
        args: {
          n: tool.schema.number().optional().describe("How many switches to undo."),
        },
        async execute(args) {
          try {
            const r = await backCore(paths, args.n ?? 1);
            await safeToast(
              client,
              `omo-router: reverted to "${r.current}". Restart opencode for change to take effect.`,
            );
            return ok({
              previous: r.previous,
              current: r.current,
              restartRequired: true,
            });
          } catch (e) {
            return errOut(e);
          }
        },
      }),
    },
  };
};

export default OmoRouterPlugin;
