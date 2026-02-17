# src/cli/run/ — Non-Interactive Session Launcher

**Generated:** 2026-02-18

## OVERVIEW

37 files. Powers the `oh-my-opencode run <message>` command. Connects to OpenCode server, creates/resumes sessions, streams events, and polls for completion.

## EXECUTION FLOW

```
runner.ts
  1. opencode-binary-resolver.ts → Find OpenCode binary
  2. server-connection.ts → Connect to OpenCode server (start if needed)
  3. agent-resolver.ts → Flag → env → config → Sisyphus
  4. session-resolver.ts → Create new or resume existing session
  5. events.ts → Stream SSE events from session
  6. event-handlers.ts → Process each event type
  7. poll-for-completion.ts → Wait for todos + background tasks done
  8. on-complete-hook.ts → Execute user-defined completion hook
```

## KEY FILES

| File | Purpose |
|------|---------|
| `runner.ts` | Main orchestration — connects, resolves, runs, completes |
| `server-connection.ts` | Start OpenCode server process, create SDK client |
| `agent-resolver.ts` | Resolve agent: `--agent` flag → `OPENCODE_AGENT` env → config → Sisyphus |
| `session-resolver.ts` | Create new session or resume via `--attach` / `--session-id` |
| `events.ts` | SSE event stream subscription |
| `event-handlers.ts` | Route events to handlers (message, tool, error, idle) |
| `event-stream-processor.ts` | Process event stream with filtering and buffering |
| `poll-for-completion.ts` | Poll session until todos complete + no background tasks |
| `completion.ts` | Determine if session is truly done |
| `continuation-state.ts` | Persist state for `run` continuation across invocations |
| `output-renderer.ts` | Format session output for terminal |
| `json-output.ts` | JSON output mode (`--json` flag) |
| `types.ts` | `RunOptions`, `RunResult`, `RunContext`, event payload types |

## AGENT RESOLUTION PRIORITY

```
1. --agent CLI flag
2. OPENCODE_AGENT environment variable
3. default_run_agent config
4. "sisyphus" (default)
```

## COMPLETION DETECTION

Poll-based with two conditions:
1. All todos marked completed (no pending/in_progress)
2. No running background tasks

`on-complete-hook.ts` executes optional user command on completion (e.g., `--on-complete "notify-send done"`).
