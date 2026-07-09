import { describe, expect, it } from "vitest";
import { type SolidRuntime, materialize } from "../../src/tui/render.js";
import { type AgentAssignment, type StackSnapshot, snapshotKey } from "../../src/tui/store.js";
import { buildSidebarNodes, restartRequired } from "../../src/tui/view.js";

const AGENTS: AgentAssignment[] = [];

const snap = (
  active: string | null,
  stacks: string[] = [],
  agents: AgentAssignment[] = AGENTS,
): StackSnapshot => ({
  active,
  stacks,
  agents,
  key: snapshotKey(active, stacks, agents),
});

describe("buildSidebarNodes", () => {
  it("lists every stack — active checked green, inactive muted unchecked", () => {
    const nodes = buildSidebarNodes(snap("premium", ["cheap", "premium"]), {
      bootActive: "premium",
    });
    const texts = nodes.map((n) => n.text);
    expect(texts[0]).toBe("Agent Stacks");
    expect(texts).toContain(" ▣ premium");
    expect(texts).toContain(" □ cheap");
    // stack count summary was replaced by the per-stack list
    expect(texts.some((t) => /^ \d+ stacks?$/.test(t ?? ""))).toBe(false);
  });

  it("shows (none) when uninitialized", () => {
    const nodes = buildSidebarNodes(snap(null), { bootActive: null });
    expect(nodes.map((n) => n.text)).toContain(" ▣ (none)");
  });

  it("lists all stacks as muted unchecked when no active stack is set", () => {
    const nodes = buildSidebarNodes(snap(null, ["a", "b"]), { bootActive: null });
    const texts = nodes.map((n) => n.text);
    expect(texts).toContain(" □ a");
    expect(texts).toContain(" □ b");
    expect(texts.some((t) => t?.startsWith(" ▣ "))).toBe(false);
  });

  it("adds restart badge only when active differs from boot", () => {
    const same = buildSidebarNodes(snap("a", ["a"]), { bootActive: "a" });
    expect(same.map((n) => n.text)).not.toContain(" ⟳ restart required");

    const switched = buildSidebarNodes(snap("b", ["a", "b"]), { bootActive: "a" });
    expect(switched.map((n) => n.text)).toContain(" ⟳ restart required");
  });

  it("applies theme colors — active green, inactive muted, header text, warning", () => {
    const theme = { text: "TEXT", textMuted: "MUTED", warning: "WARN", success: "OK" };
    const nodes = buildSidebarNodes(snap("b", ["a", "b"]), { bootActive: "a", theme });
    expect(nodes[0].props.fg).toBe("TEXT");
    expect(nodes.find((n) => n.text === " ▣ b")?.props.fg).toBe("OK");
    expect(nodes.find((n) => n.text === " □ a")?.props.fg).toBe("MUTED");
    expect(nodes.find((n) => n.text === " ⟳ restart required")?.props.fg).toBe("WARN");
  });

  it("renders a Current Stack header followed by each agent → model line", () => {
    const agents = [
      { agent: "build", model: "gpt-5" },
      { agent: "explorer", model: "claude-opus" },
    ];
    const nodes = buildSidebarNodes(snap("s", ["s"], agents), { bootActive: "s" });
    const headerIdx = nodes.findIndex((n) => n.text === "Current Stack");
    expect(headerIdx).toBeGreaterThan(0);
    // Each agent line is a row box: bullet + "agent → model"
    const line1 = nodes[headerIdx + 1];
    const line2 = nodes[headerIdx + 2];
    expect(line1.kind).toBe("box");
    expect(line1.children?.map((c) => c.text)).toEqual(["•", "build → gpt-5"]);
    expect(line2.children?.map((c) => c.text)).toEqual(["•", "explorer → claude-opus"]);
  });

  it("shows (none) under Current Stack when the active stack has no agents", () => {
    const nodes = buildSidebarNodes(snap(null), { bootActive: null });
    const texts = nodes.map((n) => n.text);
    const headerIdx = texts.indexOf("Current Stack");
    expect(texts[headerIdx + 1]).toBe("• (none)");
  });

  it("colors the bullet green (via style.fg) and the agent → model text muted", () => {
    const theme = { text: "TEXT", textMuted: "MUTED", success: "OK" };
    const agents = [{ agent: "build", model: "gpt-5" }];
    const nodes = buildSidebarNodes(snap("s", ["s"], agents), { bootActive: "s", theme });
    const headerIdx = nodes.findIndex((n) => n.text === "Current Stack");
    const line = nodes[headerIdx + 1];
    expect(line.kind).toBe("box");
    // bullet: flexShrink:0, green via style.fg (mirrors opencode LSP pattern)
    expect(line.children?.[0]?.props.flexShrink).toBe(0);
    expect(line.children?.[0]?.props.style).toEqual({ fg: "OK" });
    // label: muted
    expect(line.children?.[1]?.props.fg).toBe("MUTED");
    expect(nodes.find((n) => n.text === "Current Stack")?.props.fg).toBe("TEXT");
  });
});

describe("restartRequired", () => {
  it("false at boot, true after a switch, false after switching back", () => {
    expect(restartRequired(snap("a"), { bootActive: "a" })).toBe(false);
    expect(restartRequired(snap("b"), { bootActive: "a" })).toBe(true);
    expect(restartRequired(snap("a"), { bootActive: "a" })).toBe(false);
  });
});

describe("materialize", () => {
  type FakeNode = {
    tag: string;
    props: Record<string, unknown>;
    children: Array<FakeNode | string>;
  };

  const fakeSolid = (): SolidRuntime & { roots: FakeNode[] } => {
    const roots: FakeNode[] = [];
    return {
      roots,
      createElement(tag: string) {
        const node: FakeNode = { tag, props: {}, children: [] };
        roots.push(node);
        return node;
      },
      insert(parent: unknown, child: unknown) {
        (parent as FakeNode).children.push(child as FakeNode | string);
      },
      setProp(node: unknown, name: string, value: unknown) {
        (node as FakeNode).props[name] = value;
      },
    };
  };

  it("wraps nodes in a column box and inserts text content", () => {
    const solid = fakeSolid();
    const root = materialize(
      buildSidebarNodes(snap("premium", ["premium"]), { bootActive: "premium" }),
      solid,
    ) as FakeNode;

    expect(root.tag).toBe("box");
    expect(root.props.flexDirection).toBe("column");
    // Agent Stacks header + active stack line + Current Stack header + (none)
    expect(root.children).toHaveLength(4);
    const first = root.children[0] as FakeNode;
    expect(first.tag).toBe("text");
    expect(first.children).toContain("Agent Stacks");
  });

  it("skips undefined props", () => {
    const solid = fakeSolid();
    const root = materialize(
      buildSidebarNodes(snap("a", ["a"]), { bootActive: "a" }),
      solid,
    ) as FakeNode;
    const first = root.children[0] as FakeNode;
    expect("fg" in first.props).toBe(false);
  });
});
