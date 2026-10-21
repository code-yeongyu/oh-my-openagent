# OpenCode V2 decisions

Status: active

Branch: `plan-b-v2-full`

Date opened: 2026-10-21

## Purpose

This file records the decisions for the additive OpenCode V2 host. It is the source of truth for scope, architecture, known gaps, and verification. If a later change contradicts a decision here, update this file in the same PR and explain why.

## Context

OpenCode 1 and OpenCode 2 use different plugin APIs. The current `dev` branch loads on OpenCode 2 through a `setup` entry that only logs a notice. The V1 runtime remains behind the `server` entry. The project has declined a full upstream V2 port and points users to OmO Native for the complete experience. This branch is a downstream implementation of the full plugin experience for OpenCode 2.

A public reference port exists at `fazulfi/omo-v2` on branch `port/v2`. It is used as behavioral and API reference material, not as a dependency. Its published parity matrix covers an owner-used subset. This branch targets full V1 parity, not that subset.

## Scope

In scope:

- The OpenCode plugin entry, tools, tool hooks, prompt and context hooks, agents, commands, MCP servers, skills, configuration, background orchestration, team mode, monitor, OpenClaw, and the TUI.
- V1 coexistence. The V1 entry stays unchanged and continues to load on OpenCode 1.
- A real-host parity matrix and an isolated QA harness.

Out of scope:

- The `omo` CLI and the OmO Native binary.
- The Codex and Senpi adapters.
- Desktop application code.
- Publishing a new npm package or changing the release workflow.

## Architecture

The V2 host lives in `packages/omo-opencode/src/v2/`. It is a sibling of the V1 source, not a wrapper around it.

```text
packages/omo-opencode/src/v2/
  index.ts              V2 Plugin.define entry and cleanup composition
  managers/             V2-native background, skill MCP, monitor, tmux managers
  tools/                tool registration and execution
  hooks/                tool, prompt, context, compaction, event, fallback
  agents/               agent definitions and dynamic prompts
  config/               .omo/omo.jsonc loading and domain transforms
  commands/             command registration
  mcp/                  built-in and configured MCP servers
  skills/               shared, user, project, and runtime skills
  orchestration/        background agents, todos, goal, boulder, team, monitor
  tui/                  OpenCode 2 TUI entry
  compat/               event, message, and schema adapters
  rpc/                  diagnostic RPCs
```

The V1 source continues to live in `packages/omo-opencode/src/` and is bundled to `dist/index.js` and `dist/tui.js`. The V2 host is bundled to `dist/v2/index.js` and `dist/v2/tui.js`. The two hosts share only harness-neutral workspace packages.

## Decision log

### D-001: additive dual host

Decision: keep V1 untouched and add a separate V2 host.

Rationale: the project requires zero V1 regressions and the maintainer rejected a V1 import of V2 SDK code. A separate package export keeps the V1 module graph unchanged.

Status: accepted.

### D-002: V2-native host, not a V1 bridge

Decision: implement against the V2 domains directly. Do not translate the V2 context into the V1 plugin context and replay the V1 pipeline.

Rationale: the bridge approach has known semantic holes in command interception, compaction, message identity, and TUI slots. A native host gives each feature an explicit V2 mapping.

Status: accepted.

### D-003: target the repository V2 pin

Decision: author against `@opencode/plugin` 2.0.32, the version pinned by the repository, and validate on the installed OpenCode 2.0.25 host.

Rationale: the repository already pins 2.0.32. The host loads plugins built against that surface. The real-host smoke is authoritative for compatibility.

Status: accepted. Revisit when the repository pin changes.

### D-004: no V1 imports in the V2 host

Decision: `packages/omo-opencode/src/v2/` must not import `@opencode-ai/*` or the V1 plugin pipeline. It may import harness-neutral workspace packages.

Rationale: the V1 SDK types and client semantics differ from V2. Allowing them in the V2 host would reintroduce the bridge problems and make the host boundary unclear.

Status: accepted.

### D-005: configuration is loaded once and projected through transforms

Decision: `.omo/omo.jsonc` remains the source of truth. Load and validate it in memory. Apply it through `agent.transform`, `command.transform`, `mcp.transform`, `provider.transform`, `model.transform`, `tool.transform`, and `skill.transform`. Do not rewrite the user's config file.

Rationale: V2 has no single `config` mutation hook. Per-domain transforms are the supported surface. In-memory normalization preserves rollback and avoids destructive config edits.

Status: accepted.

### D-006: agents use transform upsert, with markdown fallback

Decision: register agents through `agent.transform`. If the host does not allow adding a new agent through the editor, write agent markdown under the OpenCode agents directory and use the editor only for updates.

Rationale: the V2 `AgentEditor` surface has changed across 2.0.x. The implementation must detect the capability and use the supported path.

Status: accepted. Verify at runtime on 2.0.25 and 2.0.32.

### D-007: one ordered context composer

Decision: all context mutation runs through one ordered `session.hook("context")` composer. The order is:

1. runtime agent prompt reconciliation
2. skill and category catalog
3. rules and AGENTS.md injection
4. keyword and mode detection
5. BTW, team, and monitor context
6. tool-pair and message repair
7. model parameter and header projection

Rationale: multiple independent context hooks would produce order-dependent message corruption. One composer makes ordering explicit and testable.

Status: accepted.

### D-008: identity-safe message writes

Decision: when adapting V2 context messages to a transform view, keep a `WeakMap` from the view to the source message. Never write transformed messages back by array index.

Rationale: inserting or removing a message by index moves content between neighboring messages and breaks tool-call/tool-result pairing. A prior bridge implementation hit this bug.

Status: accepted.

### D-009: tools use the V2 tool domain

Decision: register tools with `ctx.tool.transform` and intercept calls with `ctx.tool.hook("execute.before")` and `ctx.tool.hook("execute.after")`. Convert tool input schemas to the V2 JSON schema shape at registration.

Rationale: this is the direct V2 surface for tools and per-call guards.

Status: accepted.

### D-010: own commands only

Decision: register all OmO commands through `ctx.command.transform`. Do not promise interception of third-party slash commands. Own commands implement their behavior directly.

Rationale: the V2 command editor adds commands but does not expose a general pre-execution hook. A documented limitation is better than a silent behavior change.

Status: accepted.

### D-011: compaction uses the session hook

Decision: use `ctx.session.hook("compaction")` for compaction context and todo preservation. Implement auto-continue with an event-driven resume path. If the host cannot support a safe resume, document the limitation at startup.

Rationale: V2 does not expose the V1 `experimental.compaction.autocontinue` flag. The behavior must be rebuilt, not assumed.

Status: accepted. Auto-continue design is pending.

### D-012: todos use session metadata

Decision: store OmO todos in session metadata under a reserved key. Do not assume a native V2 todo API.

Rationale: the V2 client surface does not expose the V1 todo store.

Status: accepted.

### D-013: TUI uses the V2 slot and keymap API

Decision: use `ctx.ui.slot`, `ctx.keymap.layer`, `ctx.data`, `ctx.storage`, and Solid rendering. Do not use raw stdin or renderer internals.

Rationale: the V2 TUI context is the supported surface and is richer than the V1 TUI API object.

Status: accepted.

### D-014: no toast dependency

Decision: do not require a toast API. Route user-facing notifications through the TUI notification surface when available, otherwise log them.

Rationale: V2 has no stable toast API. Missing toasts must not break a tool or hook.

Status: accepted.

### D-015: typed event subscriptions with an explicit name map

Decision: subscribe through the V2 event domain and keep a checked V1-to-V2 event name map. Test renamed and split events.

Rationale: V2 event names and payloads differ from V1. A wildcard assumption would silently drop events.

Status: accepted.

### D-016: model catalog is lazy

Decision: do not snapshot the model catalog during setup. Resolve models and fallbacks lazily after catalog updates.

Rationale: the catalog is empty at setup and populates asynchronously. A setup-time snapshot sends agents to the wrong fallback.

Status: accepted.

### D-017: QA is real-host and isolated

Decision: every slice needs an isolated OpenCode 2 run with its own `HOME` and XDG roots, a behavior assertion, and evidence under `.omo/evidence/`. Unit tests are necessary but not sufficient.

Rationale: the repository QA contract requires proof on the real harness. V2 plugin load alone does not prove feature behavior.

Status: accepted.

### D-018: upstream divergence

Decision: this is a downstream branch. Do not open a full-port upstream PR. If a slice is upstreamable, keep it additive and V1-neutral.

Rationale: upstream has declined the full port and paused the dual-host track. Pretending otherwise wastes review time.

Status: accepted.

### D-019: license and provenance

Decision: preserve the repository license and third-party notices. If code is adapted from `fazulfi/omo-v2`, record the source and attribution in the file header and this document.

Rationale: the reference fork is public under the same license family. Attribution is required and provenance must stay auditable.

Status: accepted.

### D-020: atomic PR slices

Decision: deliver the work as small PRs. The first PR is the scaffold. Each later PR owns one subsystem and flips its parity rows.

Rationale: a full port in one PR cannot be reviewed or tested. The project's review workflow requires small, independently verifiable slices.

Status: accepted.

### D-021: build outputs are additive

Decision: add a `v2-index` build node that emits `dist/v2/index.js`. Add `v2-tui` when the TUI slice lands. Keep the existing `index`, `tui`, and `cli` nodes unchanged.

Rationale: V1 and V2 must remain independently buildable and rollback-safe.

Status: accepted.

### D-022: rollback stays one config change

Decision: the V2 config points at `dist/v2`. Switching back to `dist` returns to the current V1/load-only behavior. No user config is rewritten.

Rationale: a failed V2 deploy must not require a rebuild or a config migration.

Status: accepted.

## V1 to V2 mapping

| V1 surface | V2 surface | Notes |
|---|---|---|
| `PluginModule { id, server }` | `Plugin.define({ id, setup })` | Separate entry, not a V1 wrapper |
| `config` hook | domain `transform` calls | No single config hook |
| `tool` record | `ctx.tool.transform` | Schema conversion at registration |
| `tool.execute.before/after` | `ctx.tool.hook` | Direct mapping |
| `tool.definition` | `ctx.tool.transform` update | Per-tool definition changes |
| `chat.message` | `ctx.session.hook("prompt")` | Prompt and command detection |
| `chat.params` | `ctx.session.hook("context")` options | Provider-specific knobs |
| `chat.headers` | `ctx.session.hook("http.request")` | Request headers |
| `experimental.chat.messages.transform` | `ctx.session.hook("context")` | Identity-safe writes |
| `experimental.chat.system.transform` | `ctx.session.hook("context")` | System parts |
| `experimental.session.compacting` | `ctx.session.hook("compaction")` | Context and todo preservation |
| `experimental.compaction.autocontinue` | event-driven resume | No direct flag |
| `command.execute.before` | `ctx.command.transform` for own commands | Foreign interception is a gap |
| `event` | `ctx.event.subscribe` | Typed events and name map |
| `config` agents | `ctx.agent.transform` | Upsert or markdown fallback |
| `config` commands | `ctx.command.transform` | Add commands |
| `config` MCPs | `ctx.mcp.transform` | Add and override servers |
| `config` providers/models | `ctx.provider.transform` / `ctx.model.transform` | Lazy catalog |
| `config` tools | `ctx.tool.transform` | Enable, disable, trim |
| `config` skills | `ctx.skill.transform` | Shared and runtime skills |
| TUI slots and keymaps | `ctx.ui.slot` / `ctx.keymap.layer` | No raw stdin |

## Parity matrix

The matrix is implemented as behavior tests, not as a prose claim. Each row has a status and an owning slice.

| Row | Behavior | Owner | Status |
|---|---|---|---|
| 1 | V1 entry loads unchanged | scaffold | pending |
| 2 | V2 entry loads and exposes `id` + `setup` | scaffold | pending |
| 3 | `omo.status` RPC returns the bootstrap response | scaffold | pending |
| 4 | `glob` tool call | tools | pending |
| 5 | `grep` tool call | tools | pending |
| 6 | tool execute before/after hooks fire | tools | pending |
| 7 | prompt hook sees and mutates a prompt | prompt | pending |
| 8 | context hook mutates system and messages | prompt | pending |
| 9 | tool-call/tool-result pairing survives a message insert | prompt | pending |
| 10 | compaction hook preserves context and todos | prompt | pending |
| 11 | agents list contains the OmO agents | agents | pending |
| 12 | agent dispatch reaches an OmO agent | agents | pending |
| 13 | unknown agent returns a clear error | agents | pending |
| 14 | commands list contains the OmO commands | commands | pending |
| 15 | built-in MCP servers connect | mcp | pending |
| 16 | shared skills load | skills | pending |
| 17 | config projects agents, commands, MCPs, and skills | config | pending |
| 18 | background task spawn/collect/cancel | orchestration | pending |
| 19 | todo write/read roundtrip | orchestration | pending |
| 20 | goal and boulder continuation | orchestration | pending |
| 21 | model fallback moves to the next model | orchestration | pending |
| 22 | team mode mailbox and tools | orchestration | pending |
| 23 | monitor lifecycle | orchestration | pending |
| 24 | TUI sidebar slot renders | tui | pending |
| 25 | TUI keymap layer dispatches | tui | pending |

## Known gaps and mitigations

| Gap | Mitigation | Status |
|---|---|---|
| No general slash-command interception | Own commands register their behavior; foreign interception is documented as unsupported | accepted |
| No compaction auto-continue flag | Event-driven resume; if unsafe, log a startup warning and leave auto-continue off | open |
| No single config hook | Per-domain transforms with in-memory config | accepted |
| Agent add may be unavailable | Markdown agent files plus transform updates | open |
| No toast API | TUI notification or log | accepted |
| No native todo API | Session metadata | accepted |
| No `session_prompt` TUI slot | `prompt.footer` plus reactive data | accepted |
| Model catalog empty at setup | Lazy resolution and catalog updates | accepted |
| Event renames and splits | Explicit checked event map | accepted |

## QA plan

Every slice runs:

1. Unit tests for the new modules and the parity rows it owns.
2. `bun run typecheck:packages`.
3. A real OpenCode 2 run in an isolated home and XDG sandbox.
4. A behavior assertion for each flipped parity row.
5. Evidence written under `.omo/evidence/<date>-<slug>/` and summarized in the PR body.
6. A V1 regression check that the V1 entry still loads and still exposes `server`.

The real-host harness uses the installed OpenCode binary, a temporary config root, and a temporary data root. It never reads or writes the user's real OpenCode database.

## Open decisions

- The exact auto-continue mechanism after compaction.
- The agent registration path when `AgentEditor` cannot add a new agent.
- The minimum TUI surface for the first TUI slice.
- Whether the V2 host ships as a package `./v2` export, a separate `dist/v2` directory, or both. The current plan is both: the export for package consumers and the directory for local plugin configs.
