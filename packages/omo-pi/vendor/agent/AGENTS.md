# packages/agent

`@earendil-works/pi-agent-core` — stateful agent loop with tool execution, message streaming, and a "harness" layer (compaction, session storage, env, skills) intended for the senpi CLI to migrate onto (planned, not started — see `docs/agent-harness.md` item 7). The CLI currently imports only `Agent` and types from this package and keeps its own copies of compaction/skills/session/prompt-template logic.

## STRUCTURE

```
src/
├── agent.ts             # Agent class — queue, prompt(), state, subscribe()
├── agent-loop.ts        # Provider stream → assistant message → tool execution loop
├── types.ts             # AgentMessage union, AgentEvent union, AgentState, ToolExecutionMode
├── proxy.ts             # Server proxy stream() — for hosting an Agent over the wire
├── index.ts             # Public exports
├── changes.md           # Fork-change log: tool scheduling, abort handling, harness compat, UUIDv7
└── harness/
    ├── agent-harness.ts # AgentHarness — drives runAgentLoop() directly with compaction/session/skills wiring
    ├── compaction/      # branch-summarization.ts, compaction.ts, utils.ts
    ├── env/             # nodejs.ts (process / fs / shell facades = ExecutionEnv impl)
    ├── messages.ts      # Harness-level message helpers
    ├── prompt-templates.ts  # User-facing prompt scaffolding
    ├── session/         # session.ts + {jsonl,memory}-repo.ts + {jsonl,memory}-storage.ts + repo-utils.ts + uuid.ts
    ├── skills.ts        # Skill discovery + invocation
    ├── system-prompt.ts # Default harness system prompt
    ├── types.ts         # Harness types incl. ExecutionEnv interface (testable shell)
    └── utils/           # shell-output.ts, truncate.ts
```

## WHERE TO LOOK

| Task | File |
|------|------|
| Change tool-execution scheduling | `src/agent-loop.ts` `executeToolCallsParallel()` |
| Add new event type | `src/types.ts` `AgentEvent` union |
| Customize message conversion | `src/types.ts` `convertToLlm` (declaration merging point for app-specific message types) |
| Persist sessions to disk | `src/harness/session/jsonl-storage.ts` |
| In-memory session (tests) | `src/harness/session/memory-storage.ts` |
| Branch-summary compaction | `src/harness/compaction/branch-summarization.ts` |
| Stream Agent over RPC | `src/proxy.ts` |

## CONVENTIONS

- **Two message types**: `AgentMessage` (flexible app-level) vs the `Message` from `@earendil-works/pi-ai` (LLM-shaped). Always cross the boundary through `convertToLlm`.
- **Events vs Messages**: subscribers receive `AgentEvent`s; messages are state. Streaming deltas come as `message_update` events with discriminated `assistantMessageEvent.type`.
- **Order vs concurrency** (fork change, 2026-04-05): `executeToolCallsParallel()` finalizes prepared tool calls concurrently but the returned `toolResults` array stays in assistant source order — preserves next-turn context determinism even though emission is unordered. Don't break this invariant.
- **Harness is optional**: `Agent` itself has no fs/process dependencies. The harness layer adds them in a single, swappable place. Tests should use `harness/env/` substitutes.

## ANTI-PATTERNS

- Awaiting tool calls sequentially in the agent loop (regresses 2026-04-05 fix).
- Adding fs/process imports into `agent.ts`, `agent-loop.ts`, or `types.ts` — the runtime is meant to be browser-runnable.
- Using `pi-ai`'s `Message` type directly in app-level state — losing the `AgentMessage` extension hooks.

## NOTES

- Author header is `Mario Zechner` (upstream). The fork's only intentional source change is in `src/changes.md`.
- `README.md` doubles as quick-start docs; keep it in sync with public API edits.
- `docs/agent-harness.md` covers the harness layer in depth (configuration knobs, lifecycle, hook contracts).
