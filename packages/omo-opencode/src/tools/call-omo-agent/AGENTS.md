# src/tools/call-omo-agent/ — Direct Agent Invocation Tool

**Generated:** 2026-05-15

## OVERVIEW

26 files. The `call_omo_agent` tool directly invokes named agents (explore, librarian only). Distinct from `delegate-task`: no category system or skill loading. It supports background launch and synchronous execution; session continuation is synchronous only.

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

Same two modes as delegate-task, routed by `tools.ts`:

| Mode | File | Description |
|------|------|-------------|
| **Background** | `background-executor.ts` | Async via `BackgroundManager`; a returned notification identifies completion |
| **Sync** | `sync-executor.ts` | Create session → wait for idle → return result |

## KEY FILES

| File | Purpose |
|------|---------|
| `tools.ts` | `createCallOmoAgent()` factory — validates agent, routes to executor |
| `background-executor.ts` | Launch background work via `BackgroundManager.launch()` |
| `sync-executor.ts` | Synchronous session: create → send prompt → poll → fetch result |
| `session-creator.ts` | Create or reuse the sync session |
| `subagent-session-creator.ts` | Resolve/create an agent-specific session ID |
| `completion-poller.ts` | Poll until messages stabilize or timeout |
| `message-processor.ts` | Process raw message content and extract output |
| `message-dir.ts` | Resolve temporary message-exchange storage |
| `types.ts` | `CallOmoAgentArgs`, `AllowedAgentType`, `ToolContextWithMetadata` |

## SESSION CONTINUATION

Pass `session_id` to resume an existing session rather than create a new one in synchronous mode. Background mode rejects `session_id`.
