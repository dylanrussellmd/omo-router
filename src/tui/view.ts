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
  const nodes: ViewNode[] = [
    text("Agent Stack", { fg: theme.text, attributes: TEXT_ATTR_BOLD }),
    text(` ▣ ${snapshot.active ?? "(none)"}`, { fg: theme.success }),
  ];
  if (restartRequired(snapshot, ctx)) {
    nodes.push(text(" ⟳ restart required", { fg: theme.warning }));
  }
  nodes.push(
    text(` ${snapshot.stacks.length} stack${snapshot.stacks.length === 1 ? "" : "s"}`, {
      fg: theme.textMuted,
    }),
  );
  return nodes;
}
