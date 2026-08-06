# openclaw-core — OpenClaw Gateway + Reply Daemon (Core)

**Generated:** 2026-06-16

## OVERVIEW

Package: `@oh-my-opencode/openclaw-core`. Harness-neutral Core for OpenClaw bidirectional integration. Outbound dispatch fires HTTP webhooks or shell commands on session events; inbound reply-listener daemon polls Discord/Telegram and injects replies into tracked tmux panes. Consumed by the OpenCode adapter at [`packages/omo-opencode/src/openclaw/`](../omo-opencode/src/openclaw/AGENTS.md) via re-export shims.

## KEY FILES

| File | Role |
|------|------|
| `src/index.ts` | Barrel: `wakeOpenClaw()`, `initializeOpenClaw()`, `startReplyListener`, `stopReplyListener` |
| `src/types.ts` | `OpenClawConfig`, `OpenClawPayload`, `WakeResult` |
| `src/config.ts` | Gateway resolution + reply listener config normalization |
| `src/dispatcher.ts` | HTTP POST + shell command execution with variable interpolation |
| `src/runtime-dispatch.ts` | Maps harness events to OpenClaw events; orchestrates dispatch |
| `src/session-registry.ts` | JSONL registry correlating message IDs to sessions and panes (file-locked) |
| `src/reply-listener.ts` | Daemon lifecycle barrel (start/stop/poll loop/status/log) |
| `src/reply-listener-start.ts` | Spawns the daemon as a detached Bun process |
| `src/reply-listener-poll-loop.ts` | Polls Discord/Telegram every 3s, prunes stale registry entries hourly |
| `src/reply-listener-injection.ts` | Injects received replies into tmux panes with rate limiting |
| `src/tmux.ts` | `captureTmuxPane()`, `sendToPane()`, `analyzePaneContent()` |
| `src/daemon.ts` | Entry point for the detached daemon process |

## FLOW

```
Discord/Telegram API → reply-listener-poll-loop.ts
  → session-registry.ts: lookup tmux pane by message ID
  → reply-listener-injection.ts: rate limit check → sanitize → send-keys into pane
```

## NOTES

- URL validation requires HTTPS except localhost (`gateway-url-validation.ts`).
- Session registry is a file-locked JSONL written via `session-registry-storage.ts`.
- Daemon state persists to disk via `reply-listener-state.ts` (PID, config signature, poll tracking).
- Rate limiter defaults to 10 injections per minute per pane.
- `tmux.ts` pane confidence check skips injection if `analyzePaneContent()` returns below 0.3.

Parent: [`packages/AGENTS.md`](../AGENTS.md)
