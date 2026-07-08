/**
 * Pure logic behind the TUI dialogs — no opentui/api access, fully
 * unit-testable. Dialog flows in dialogs.ts call these.
 */

import type { StackFile } from "../core/schema.js";

export interface ModelTarget {
  readonly agent: string;
  readonly model: string;
}

export function targetLabel(target: Pick<ModelTarget, "agent">): string {
  return target.agent;
}

export function listModelTargets(stack: StackFile): ModelTarget[] {
  return Object.entries(stack.agents).map(([agent, entry]) => ({
    agent,
    model: entry.model,
  }));
}

/**
 * Replace the model of one agent entry, preserving every other key
 * (unknown passthrough fields) untouched.
 */
export function applyModelEdit(stack: StackFile, agent: string, model: string): StackFile {
  const entry = stack.agents[agent];
  if (!entry) {
    throw new Error(`No entry "${agent}" in stack`);
  }
  return {
    ...stack,
    agents: {
      ...stack.agents,
      [agent]: { ...entry, model },
    },
  };
}

/**
 * Extract `provider/model` IDs from the TUI host's provider catalog
 * (`api.state.provider`). Shape-defensive: the SDK type evolves, so treat it
 * as unknown and pull only what looks right. Returns [] when nothing usable.
 */
export function collectHostModels(providers: unknown): string[] {
  if (!Array.isArray(providers)) return [];
  const out = new Set<string>();
  for (const provider of providers) {
    if (typeof provider !== "object" || provider === null) continue;
    const record = provider as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : undefined;
    if (!id) continue;
    const models = record.models;
    if (Array.isArray(models)) {
      for (const m of models) {
        if (typeof m === "string") out.add(`${id}/${m}`);
        else if (typeof m === "object" && m !== null) {
          const mid = (m as Record<string, unknown>).id;
          if (typeof mid === "string") out.add(`${id}/${mid}`);
        }
      }
    } else if (typeof models === "object" && models !== null) {
      for (const key of Object.keys(models)) out.add(`${id}/${key}`);
    }
  }
  return [...out].sort();
}
