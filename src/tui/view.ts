/**
 * Pure view model for the sidebar — no opentui imports, fully unit-testable.
 * `materialize` in render.ts turns these nodes into real opentui elements.
 */

import type { StackSnapshot } from "./store.js";

export interface ViewNode {
  readonly kind: "box" | "text";
  readonly props: Readonly<Record<string, unknown>>;
  readonly text?: string;
  readonly children?: readonly ViewNode[];
}

export interface SidebarTheme {
  readonly text?: unknown;
  readonly textMuted?: unknown;
  readonly warning?: unknown;
  readonly success?: unknown;
}

export interface SidebarContext {
  /** Active stack when the TUI booted — differing means a restart is due. */
  readonly bootActive: string | null;
  readonly theme?: SidebarTheme | undefined;
}

/** Mirrors @opentui/core's TextAttributes.BOLD bitflag — opentui is host-provided and never imported here (see render.ts). */
const TEXT_ATTR_BOLD = 1;

function text(content: string, props: Record<string, unknown> = {}): ViewNode {
  return { kind: "text", props, text: content };
}

export function restartRequired(snapshot: StackSnapshot, ctx: SidebarContext): boolean {
  return snapshot.active !== ctx.bootActive;
}

export function buildSidebarNodes(snapshot: StackSnapshot, ctx: SidebarContext): ViewNode[] {
  const theme = ctx.theme ?? {};
  const nodes: ViewNode[] = [text("Agent Stacks", { fg: theme.text, attributes: TEXT_ATTR_BOLD })];

  if (snapshot.stacks.length === 0) {
    // Uninitialized: nothing on disk, surface the empty state.
    nodes.push(text(" ▣ (none)", { fg: theme.success }));
  } else {
    for (const name of snapshot.stacks) {
      const isActive = name === snapshot.active;
      nodes.push(
        text(`${isActive ? " ▣ " : " □ "}${name}`, {
          fg: isActive ? theme.success : theme.textMuted,
        }),
      );
    }
  }

  // Current Stack — the active stack's agent → model assignments.
  nodes.push(text("Current Stack", { fg: theme.text, attributes: TEXT_ATTR_BOLD }));
  if (snapshot.agents.length === 0) {
    nodes.push(text("• (none)", { fg: theme.textMuted }));
  } else {
    for (const { agent, model } of snapshot.agents) {
      // Row box mirroring opencode's LSP sidebar: green bullet (flexShrink:0)
      // + muted label, separated by gap:1.
      nodes.push({
        kind: "box",
        props: { flexDirection: "row", gap: 1 },
        children: [
          text("•", { flexShrink: 0, style: { fg: theme.success } }),
          text(`${agent} → ${model}`, { fg: theme.textMuted }),
        ],
      });
    }
  }

  if (restartRequired(snapshot, ctx)) {
    nodes.push(text(" ⟳ restart required", { fg: theme.warning }));
  }
  return nodes;
}
