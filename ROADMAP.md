# ROADMAP

- [What This Is](#what-this-is)
- [Current Priority: Package Layering Refactor](#current-priority-package-layering-refactor)
- [Architecture Direction](#architecture-direction)
- [Multi-Harness Support (Exploratory)](#multi-harness-support-exploratory)
- [Why Not OpenCode-Native](#why-not-opencode-native)
- [Non-Goals](#non-goals)
- [Decision Principle](#decision-principle)

## What This Is

Oh-my-opencode is a harness for agents.

The human is not the worker. The agent is the worker. The human says what they want. Then they leave. The agent does the work. The human does not come back to fix details. The human does not come back to clarify. The human does not come back at all.

OMO does not make agents better at small tasks. OMO makes it possible to hand off big tasks. The kind of tasks where a human would normally stay in the loop for hours. OMO removes that loop.

The agent thinks. The agent decides. The agent executes. The human only initiates.

## Current Priority: Package Layering Refactor

**This is the most urgent work.**

The current `packages/` directory mixes binaries, web apps, MCP servers, and pure TypeScript logic in one flat namespace. This makes reuse across harnesses impossible and creates duplication across three repositories (`omo`, `pi-extensions`, `codex-plugins`).

The refactor splits packages into strict layers by runtime boundary:

| Layer | Contents | Boundary |
|---|---|---|
| Core | Pure TypeScript logic: rule discovery, AGENTS.md parsing, config schemas, model capabilities, todo state machines | No harness dependencies. Testable in isolation. |
| MCP | External tool servers: LSP, ast-grep | stdio process boundary. Host-agnostic. |
| Skills | Static declarative files (SKILL.md) | Markdown consumed by the agent. No code. |
| Adapters | Harness-specific glue: OpenCode plugin, Pi extensions, Codex plugins | Thin wrappers. Import core, wrap in harness API, export. |
| Platform | Bun compile binaries per target | Deployment artifacts. Never imported. |
| Web | Marketing site | Independent application. |

**Dependency rule:** The DAG flows downward only. Adapters depend on Core, MCP, and Skills. Nothing depends on Adapters. Platform and Web are leaves.

**Migration principle:** Existing behavior is preserved. Nothing breaks. Each extraction is a pure move: copy logic into Core, make the original location re-export from Core, verify tests still pass, then delete the duplicate in the other repositories.

**Current extraction status:**

- 7 Core packages are now extracted under `packages/`: `utils`, `model-core`, `rules-engine`, `agents-md-core`, `ast-grep-core`, `comment-checker-core`, `boulder-state`.
- `omo` consumes all 7 via workspace dependencies plus per-file re-export shims at the original `src/` locations.
- `pi-extensions` and `codex-plugins` are not yet migrated to consume these packages. That migration is the next phase.
- The `lsp-tools-mcp` submodule is untouched. `lsp-core` extraction is `[~]` deferred pending submodule strategy.

Layering achieved: Core (7 pure-TS packages) → Adapter (`omo` plugin) → Platform binaries. Future Pi and Codex adapters will consume the same Core layer.

The Pi Engine DI abstraction was deferred. It can be revisited once the adapter migration is complete.

## Architecture Direction

The codebase is built for the agent doing the work, not for the human reading it. If a structure is harder for a human to understand but makes the agent's job easier, we keep it. If a pattern adds friction to the agent's reasoning, we remove it.

The hierarchy of expression is:

1. **Skill** (static knowledge, zero runtime cost)
2. **MCP** (external tool with process boundary)
3. **Tool** (first-party runtime capability)
4. **Hook** (injection into the agent loop itself)

This order is not dogma. If the loop performs better another way, we change it. Agent performance is the only metric.

## Multi-Harness Support (Exploratory)

We may support additional harnesses: Claude Code, Codex, Pi, Amp, Droid, and others. Not confirmed. The current codebase is strongly coupled to OpenCode. Extracting the pure logic into a harness-neutral layer is a prerequisite if we ever do this.

Most harnesses share common lifecycle hooks: pre-tool-use guards, post-tool-use transforms, system message injection, model parameter overrides. One could abstract these into a unified hook layer. Rule injection could become a harness-agnostic primitive that adapts to each plugin API.

We are skeptical of this abstraction.

The industry changes too fast. Fixed patterns and agreed conventions should be implemented directly. Uncertain parts should not be over-abstracted. If an adapter for a new harness is needed, an agent can write it in one shot. The connection points are a single question away. Premature "adapter pattern" abstraction across unstable interfaces causes more pain than duplication.

We express what each component does in markdown documentation, not in interface definitions.

## Why Not OpenCode-Native

OpenCode is the current host. But its plugin API makes it trivial to break the main agent loop.

Session prompt injection (`session.prompt`, `session.promptAsync`) returns before the prompt is durably accepted. Later failures arrive as `session.error`. Multiple hooks observe the same idle or error edge and inject the same internal message into a live parent session. Duplicate work. Infinite loops. State corruption.

The TUI burns CPU.

Breaking changes are frequent.

These are not OpenCode-specific flaws. Any plugin system that exposes the main loop to arbitrary injection has the same disease. We treat OpenCode as one adapter target among several. Not the center of the architecture.

## Non-Goals

- We will not create a grand unified plugin interface that abstracts every harness.
- We will not prioritize human-readable file organization over agent loop performance.
- We will not fill in unspecified human details as a primary objective. The harness completes what was stated, using the model's natural representation.

## Decision Principle

When in doubt, prefer the representation that requires the least reasoning from the agent doing the work.

If that makes the directory structure messy for a human, the directory structure is wrong for humans and right for agents.
