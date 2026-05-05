/**
 * Zod schemas for omo-router's own files.
 *
 * Two philosophies:
 *
 *   1. `state.json` is OURS — strict schema, fail closed. We control every
 *      byte; if it's malformed something corrupted it and we should refuse
 *      to proceed rather than silently rebuild and lose pointers.
 *
 *   2. `stacks/*.json` are FORWARDED to oh-my-openagent. They follow that
 *      project's schema, which evolves out from under us. We validate only
 *      the shape we care about (presence of agents/categories with `model`
 *      strings) and pass everything else through verbatim. This way new
 *      top-level keys oh-my-openagent adds keep working without an
 *      omo-router update.
 *
 * `record(z.string(), …)` is used rather than `z.object({})` everywhere for
 * forward compatibility — unknown keys survive round-trips.
 */

import { z } from "zod";

/* ------------------------------------------------------------------------- *
 * state.json                                                                 *
 * ------------------------------------------------------------------------- */

/** Sentinel marker written into `state.active` after `omo-router restore <id>`. */
export const RESTORED_SENTINEL_PREFIX = "(restored:";

export const StateFileSchema = z
  .object({
    version: z.literal(1),
    active: z.string().min(1),
    previousActive: z.string().min(1).nullable(),
    lastSwitchedAt: z.string().min(1),
    lastSnapshottedFrom: z.string().min(1).nullable(),
  })
  .strict();

export type StateFile = z.infer<typeof StateFileSchema>;

/* ------------------------------------------------------------------------- *
 * stack files (forwarded to oh-my-openagent verbatim)                        *
 * ------------------------------------------------------------------------- */

/**
 * The smallest commitment we make about a model entry: it must have a `model`
 * string. Variants, fallbacks, temperatures, and unknown keys ride along
 * unchanged.
 */
export const ModelEntrySchema = z
  .object({
    model: z.string().min(1),
    fallback_models: z.array(z.object({ model: z.string().min(1) }).passthrough()).optional(),
  })
  .passthrough();

export type ModelEntry = z.infer<typeof ModelEntrySchema>;

/**
 * The minimum a stack file must satisfy: at least one of `agents` or
 * `categories` is present and is a record of model entries. All other
 * top-level keys (and unknown sub-keys) are preserved.
 */
export const StackFileSchema = z
  .object({
    agents: z.record(z.string(), ModelEntrySchema).optional(),
    categories: z.record(z.string(), ModelEntrySchema).optional(),
  })
  .passthrough()
  .refine((s) => s.agents != null || s.categories != null, {
    message: "Stack file must contain at least one of `agents` or `categories`.",
  });

export type StackFile = z.infer<typeof StackFileSchema>;

/**
 * Loose schema for `opencode.json`. We only read/edit `plugin` (array) and
 * `provider.openrouter.models` (record). Everything else is preserved.
 */
export const OpencodeJsonSchema = z
  .object({
    plugin: z.array(z.string()).optional(),
    provider: z
      .object({
        openrouter: z
          .object({
            models: z.record(z.string(), z.unknown()).optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type OpencodeJson = z.infer<typeof OpencodeJsonSchema>;
