# agent-router migration plan

Goal: purge oh-my-openagent entirely; own every agent, prompt, rule, and
command as native opencode config inside `~/.agents` (chezmoi-versioned);
rebuild omo-router as **agent-router** — a tool that does exactly one thing:
switch the models assigned to YOUR agents.

Status: PLAN ONLY — nothing below has been executed.

---

## 0. Context primer (hard-won facts a fresh session must not rediscover)

Machine/setup facts:
- opencode 1.17.8 at /usr/bin/opencode. Runs plugins under Bun.
- chezmoi manages `~/.agents` (real files; source `~/.local/share/chezmoi/dot_agents/`)
  and `~/.config/opencode/*` as SYMLINKS into `~/.agents`
  (source `private_dot_config/opencode/symlink_*`). `~/.config/opencode/omo-router/`
  (state/stacks/config.json) is also chezmoi-managed.
- `~/.config/opencode/opencode.json -> ~/.agents/opencode.json` (symlink, intact).
- `~/.config/opencode/tui.json -> ~/.agents/tui.json` (symlink, restored 2026-07-08
  after opencode's plugin patcher clobbered it — rename(2) replaces links).
- Server plugins load from opencode.json `plugin[]`; **TUI plugins load from
  tui.json `plugin[]`** (separate file, opencode ≥1.17).
- TUI plugin entry = package.json `exports["./tui"]`; module default-exports
  `{ id, tui: async (api) => {} }`. `@opentui/solid` must be imported with a
  LITERAL specifier (host interception ignores computed specifiers). No JSX
  needed — imperative `createElement/insert/setProp` (see src/tui/render.ts).
- Bun's fs.watch drops rename-to-target events of atomic writes → poll, never watch.
- omo-router repo: ~/Documents/computer/omo-router, npm @dylanrussell/omo-router@0.2.1,
  GitHub dylanrussellmd/omo-router. Release = push `vX.Y.Z` tag → OIDC workflow
  (npm pinned to 11.x — npm@12.0.0 provenance is broken; keep the pin).
  Version lives in BOTH package.json and src/version.ts.
- atomicWriteFile realpath-resolves destinations since 0.2.1 (symlink-safe).
- TUI debugging: `OMO_TUI_DEBUG=/tmp/omo-tui.log opencode` (plugins have no stderr).
- 3 dependabot vulns open on the repo (1 high) — unrelated, triage separately.

Current oh-my-openagent footprint (the purge list, verify each at execution):
- opencode.json: `plugin[]` entry `oh-my-openagent@latest`; `default_agent: "Omni"`.
- tui.json: `plugin[]` entry `oh-my-openagent@latest`.
- `~/.agents/oh-my-openagent.json` (live model config, symlinked from
  ~/.config/opencode/) + `oh-my-openagent.json.migrations.json` + `.backup-*`/`.bak*` files.
- `~/.cache/opencode/packages/oh-my-openagent@latest/` (npm cache).
- `~/.local/state/opencode/plugin-meta.json` entry `oh-my-openagent:tui`.
- `~/.local/share/opencode/storage/oh-my-openagent/`.
- `~/.agents/plugin/omo-bypass.mjs` (omo-specific hook — read before deleting).
- `~/.agents/agents/Omni.md`, `OmniFree.md` — reference omo-provided tools
  (task categories, call_omo_agent, background_*); need rewrites, not deletion.
- `~/.agents/rules/*.md` — grep for omo/oh-my-openagent references.
- `~/.config/opencode/package.json` + `node_modules/` in config dir — check what
  installed them; likely omo postinstall.
- omo-router itself reads/writes `oh-my-openagent.json` (its whole reason for
  being, replaced in Phase C).

What is LOST when oh-my-openagent goes (accept or replace natively):
| omo capability | native replacement |
|---|---|
| task tool w/ categories (quick/deep/ultrabrain…) | native `task` subagent invocation + `@agent` mentions; categories become dedicated subagents if wanted |
| call_omo_agent (explore/librarian) | native subagents defined in ~/.agents/agents/ |
| background task tools | opencode native background subagent support (verify current native surface) |
| todo-continuation / ralph-loop hooks | drop, or port later as tiny personal plugin in ~/.agents/plugin/ |
| omo TUI sidebar (job board) | not needed; agent-router keeps its own sidebar |
| bundled skills/commands (/ulw-plan, /handoff…) | copy the ones actually used into ~/.agents/skills + ~/.agents/commands |
| oh-my-openagent.json model routing | **agent-router** (Phase C) |

oh-my-opencode-slim (github.com/alvinunreal/oh-my-opencode-slim) is INSPIRATION
ONLY — it is itself a plugin; do not install it. Steal its architecture:
- Pantheon: Orchestrator (planner/delegator), Explorer (codebase grep),
  Oracle (high-reasoning review/debug), Librarian (docs/web research),
  Designer (frontend), Fixer (fast builder), Observer (optional multimodal reader).
- Its preset config (`presets.{name}.{agent}.model/variant/skills/mcps`) is the
  conceptual model for agent-router stacks.
- Prompts live in its repo at `src/agents/*.ts` — port the ideas into markdown,
  check LICENSE for attribution requirements when copying text.

---

## Phase A — Safety net (5 min)

1. `chezmoi` source repo: commit any pending drift (there is known WIP:
   `dot_agents/agents/Omni.md.tmpl`, `dot_agents/omo-router/stacks/omo-recommended.json`
   — ask user or commit as-is first).
2. Tag the pre-migration state: `git tag pre-agent-router` in the chezmoi repo.
3. `cp -r ~/.agents ~/.agents.pre-migration` (belt and braces; delete after).

## Phase B — Build the native agent suite in ~/.agents (the real work)

Target layout (all chezmoi-managed; ~/.config/opencode/* symlinks already exist
for agents/rules/skills/plugin — verify each):

```
~/.agents/
├── agents/                  # native opencode agent .md files
│   ├── orchestrator.md      # primary; rework of Omni (planner/delegator persona)
│   ├── explorer.md          # subagent: fast codebase search, read-only tools
│   ├── oracle.md            # subagent: high-reasoning review/debug, read-only
│   ├── librarian.md         # subagent: web/docs research (webfetch/websearch/context7)
│   ├── designer.md          # subagent: frontend/UI work
│   ├── fixer.md             # subagent: quick implementation tasks
│   └── observer.md          # optional, disabled unless a vision model is set
├── commands/                # /slash commands (port the ones actually used)
├── rules/                   # instructions (existing, grep for omo references)
├── skills/                  # existing user skills (medsci etc. stay as-is)
├── plugin/                  # personal micro-plugins (chezmoi-guard stays)
├── agent-router/            # stacks + state (renamed from omo-router/)
│   └── stacks/*.json
├── opencode.json
└── tui.json
```

Agent .md frontmatter contract (this is what agent-router will edit):
```markdown
---
description: High-reasoning review, debugging, and architecture counsel
mode: subagent
model: anthropic/claude-opus-4-8        # <- the ONLY line agent-router touches
temperature: 0.1
tools: { write: false, edit: false }
---
<prompt body — owned by user, never touched by agent-router>
```

Steps:
1. Fetch slim's `src/agents/*.ts` prompts + docs/configuration.md; write the 6-7
   agent .md files. Keep prompts SHORT and personal — this is the user's setup,
   not a product. Reuse the current Omni persona for orchestrator.md where it
   still applies, stripped of omo tool references (task categories,
   call_omo_agent, background_output → replace with native `task`/`@agent` wording).
2. opencode.json: set `default_agent` to the new orchestrator; remove omo-specific
   config later in Phase D. Verify how the user's existing `agents` symlink dir is
   discovered (`~/.config/opencode/agents/` is the native location — already
   symlinked to ~/.agents/agents).
3. Restart opencode; verify with `opencode agent` listing + a "ping all agents"
   style prompt (each subagent responds with its model via `task`).
4. chezmoi re-add + commit ("native agent suite").

Decisions locked in advance:
- Agent names: lowercase (orchestrator, explorer, oracle, librarian, designer,
  fixer, observer). Omni.md is REPLACED by orchestrator.md (keep persona text
  the user likes; OmniFree.md deleted or converted to a stack instead — a
  cheap-models stack makes "free mode" a model concern, which is the whole point).
- Skills/MCP wiring stays exactly as-is (user-owned already).

## Phase C — Rebuild omo-router as agent-router (repo work)

Core conceptual change: a stack no longer snapshots `oh-my-openagent.json`;
it maps agent names → models and is APPLIED to frontmatter `model:` lines.

```json
// ~/.agents/agent-router/stacks/premium.json
{
  "agents": {
    "orchestrator": { "model": "anthropic/claude-fable-5" },
    "oracle":       { "model": "openai/gpt-5.5" },
    "explorer":     { "model": "openai/gpt-5.4-mini" },
    "librarian":    { "model": "openai/gpt-5.4-mini" },
    "designer":     { "model": "openai/gpt-5.4-mini" },
    "fixer":        { "model": "openai/gpt-5.5" }
  }
}
```

Mechanics:
- `apply`: for each stack entry, rewrite the `model:` frontmatter line of
  `~/.agents/agents/<name>.md` (strict: fail if file or model line missing;
  atomic + symlink-safe writes already exist). Restart still required.
- `capture <name>`: read current frontmatter models into a new stack (replaces
  the old snapshot-back concept AND the seed stacks — no more seeds).
- `status/list/back/history/validate/show/rm/import/export`: carry over,
  retargeted. Validation still shells `opencode models`.
- state home: `~/.agents/agent-router/` for stacks (user-versioned) and
  `~/.config/opencode/agent-router/` for state.json/history (machine-local,
  NOT chezmoi). This split is new and deliberate: stacks are config, history is state.
- TUI half carries over nearly intact (sidebar, switch/view/edit/back/validate
  dialogs) — only the read/write layer changes (frontmatter targets instead of
  oh-my-openagent.json). Keep plugin id `agent-router:tui`.
- `init`: patches opencode.json + tui.json plugin arrays with
  `@dylanrussell/agent-router@latest`; drops ALL oh-my-openagent.json and
  openrouter-model-whitelist logic.

Renames:
- GitHub repo omo-router → agent-router (github renames redirect old URLs).
- npm: publish `@dylanrussell/agent-router@1.0.0`; `npm deprecate
  @dylanrussell/omo-router "renamed to @dylanrussell/agent-router"`.
- npm trusted-publisher registration is per-package: register the NEW package
  name for OIDC on npmjs.com before the first tag push (first publish may need
  a manual `npm publish` from a logged-in terminal since OIDC registration
  requires the package to exist — check current npm rules).
- bins: `agent-router` + `ar` (check `ar` collides with binutils! use `agr` or
  keep only `agent-router`; DECISION: `agent-router` only, alias is the user's shell).
- Code: rename OmoPaths etc. opportunistically, keep churn low; env vars
  OMO_ROUTER_HOME → AGENT_ROUTER_HOME (keep old as fallback for one release);
  OMO_TUI_DEBUG → AGENT_ROUTER_TUI_DEBUG (same fallback).
- Old live file machinery (liveConfigPath, OMO_ROUTER_LIVE_CONFIG, snapshotBack)
  is DELETED, not renamed — frontmatter is the live target now.

Test strategy: the existing 156-test suite carries over; stack-manager tests
rewrite around frontmatter apply/capture (tmp dirs with fake agent .md files);
keep the symlink regression tests.

## Phase D — The purge (do AFTER B works, same sitting as C's init)

1. Remove `oh-my-openagent@latest` from opencode.json AND tui.json plugin arrays
   (write through symlinks — edit ~/.agents/*.json).
2. Delete: `~/.agents/oh-my-openagent.json`, its `.migrations.json` and backup
   siblings in ~/.config/opencode/, `~/.cache/opencode/packages/oh-my-openagent@latest/`,
   `~/.local/share/opencode/storage/oh-my-openagent/`, the `oh-my-openagent:tui`
   entry in `~/.local/state/opencode/plugin-meta.json`.
3. Read `~/.agents/plugin/omo-bypass.mjs` — delete if omo-specific (likely);
   also remove its opencode.json plugin[] entry `plugin/omo-bypass.mjs`.
4. Inspect `~/.config/opencode/package.json` + node_modules — remove omo deps if
   that's all they are.
5. Remove chezmoi source files: `dot_agents/oh-my-openagent.json`, the
   `symlink_oh-my-openagent.json`, omo-router source dirs once renamed.
6. grep -ri "oh-my-openagent\|omo" ~/.agents/rules ~/.agents/commands — scrub.
7. Restart opencode. Verify: `opencode debug config`, agents list, no plugin
   errors in log, sidebar comes from agent-router only.
8. chezmoi re-add + commit ("purge oh-my-openagent").

## Phase E — Ship + finalize

1. agent-router: full gate, README rewrite (drop all omo references; document
   frontmatter contract + stack format + capture workflow), version 1.0.0,
   commit, tag v1.0.0 → CI publish. Verify `npm view @dylanrussell/agent-router`.
2. `omo-router` npm deprecation message pointing at the new package.
3. chezmoi: final re-add of opencode.json/tui.json (now referencing
   @dylanrussell/agent-router@latest), commit + push.
4. Delete `~/.agents.pre-migration` after a week of stability.

## Verification checklist (end state)

- [ ] `opencode` starts clean; `default_agent` is orchestrator; all subagents
      respond via task/@mention with the models the active stack assigned
- [ ] `agent-router list/status/use/back/capture/validate` all work against
      frontmatter; switching + restart changes which model answers
- [ ] TUI sidebar shows active stack; /agent-switch etc. dialogs work
- [ ] `grep -ri oh-my-openagent ~/.agents ~/.config/opencode` → zero hits
      (excluding .backups/)
- [ ] `chezmoi diff` empty; dotfiles repo pushed; all symlinks intact
      (`ls -la ~/.config/opencode/*.json` shows links)
- [ ] npm: agent-router@1.0.0 latest; omo-router deprecated

## Answers for decisions asked by previous model

1. Orchestrator persona: keep "Omni" name but
   fully adopt slim-style neutral persona
2. Observer agent: include from day one? DEFAULT: include disabled
   (`disable: true` frontmatter) with a note.
3. Old stacks (premium/openrouter-cheap/free-only/omo-recommended): DEFAULT:
   do not migrate; `capture` fresh ones after Phase B, delete old dirs.
4. Keep todo-continuation-style hooks as a personal micro-plugin? DEFAULT: no —
   add later only if missed in practice.
