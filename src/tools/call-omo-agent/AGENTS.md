# src/tools/call-omo-agent/ — Direct Agent Invocation Tool

**Generated:** 2026-02-24

## OVERVIEW

23 files. The `call_omo_agent` tool — direct invocation of named agents (explore, librarian only). Distinct from `delegate-task`: no category system, no skill loading, no model selection. Fixed agent set, same execution modes (background/sync).

## DISTINCTION FROM delegate-task

| Aspect | `call_omo_agent` | `delegate-task` (`task`) |
|--------|-----------------|--------------------------|
| Agent selection | Named agent (explore/librarian) | Category or subagent_type |
| Skill loading | None | `load_skills[]` supported |
| Model selection | From agent's fallback chain | From category config |
| Use case | Quick contextual grep | Full delegation with skills |

## ALLOWED AGENTS

Only `explore` and `librarian` — enforced via `ALLOWED_AGENTS` constant in `constants.ts`. Case-insensitive validation.

## EXECUTION MODES

Same two modes as delegate-task:

| Mode | File | Description |
|------|------|-------------|
| **Background** | `background-agent-executor.ts` | Async via `BackgroundManager` |
| **Sync** | `sync-executor.ts` | Create session → wait for idle → return result |

## KEY FILES

| File | Purpose |
|------|---------|
| `tools.ts` | `createCallOmoAgent()` factory — validates agent, routes to executor |
| `background-executor.ts` | Routes to background or sync based on `run_in_background` |
| `background-agent-executor.ts` | Launch via `BackgroundManager.launch()` |
| `sync-executor.ts` | Synchronous session: create → send prompt → poll → fetch result |
| `session-creator.ts` | Create OpenCode session for sync execution |
| `subagent-session-creator.ts` | Create session with agent-specific config |
| `subagent-session-prompter.ts` | Inject prompt into session |
| `completion-poller.ts` | Poll until session idle |
| `session-completion-poller.ts` | Session-specific completion check |
| `session-message-output-extractor.ts` | Extract last assistant message as result |
| `message-processor.ts` | Process raw message content |
| `message-dir.ts` + `message-storage-directory.ts` | Temp storage for message exchange |
| `types.ts` | `CallOmoAgentArgs`, `AllowedAgentType`, `ToolContextWithMetadata` |

## SESSION CONTINUATION

Pass `session_id` to resume an existing session rather than create a new one — handled in both executors.
