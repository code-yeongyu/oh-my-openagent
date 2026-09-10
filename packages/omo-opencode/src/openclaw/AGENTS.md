# src/openclaw/ — Bidirectional External Integration

**Generated:** 2026-05-15

## OVERVIEW

This directory is a thin compatibility surface over `@oh-my-opencode/openclaw-core`: every local module is a one-line re-export that keeps OpenCode import paths stable. Outbound gateway dispatch, inbound reply listeners, daemon state, session registry, and tmux injection are implemented in the core package - change behavior there, and keep the layout below only as the map of which core module owns what.

## BIDIRECTIONAL FLOW

### Outbound (OpenCode → External)
```
OpenCode session event → dispatchOpenClawEvent()
  → runtime-dispatch.ts: map event to OpenClaw event
  → dispatcher.ts: execute gateway (HTTP POST or shell command)
  → session-registry.ts: record message ID ↔ sessionID ↔ tmux pane
```

### Inbound (External → OpenCode)
```
Discord/Telegram API → reply-listener daemon (separate Bun process)
  → reply-listener-{discord,telegram}.ts: poll every 3s
  → session-registry.ts: look up target tmux session from message ID
  → reply-listener-injection.ts: send-keys into tmux pane (rate limited)
```

## KEY FILES (each re-exports the same-named core module)

| File | Purpose |
|------|---------|
| `index.ts` | `wakeOpenClaw()`, `initializeOpenClaw()` — main entry |
| `types.ts` | `OpenClawConfig`, `OpenClawPayload`, `WakeResult` types |
| `config.ts` | Gateway resolution + URL validation (HTTPS required, localhost exception) |
| `dispatcher.ts` | HTTP POST + shell command execution with variable interpolation |
| `runtime-dispatch.ts` | Maps OpenCode events → OpenClaw events, orchestrates dispatch |
| `session-registry.ts` | JSONL registry correlating message IDs ↔ sessions ↔ panes (file-locked) |
| `reply-listener.ts` | Daemon lifecycle: start/stop, poll loop, state persistence |
| `reply-listener-discord.ts` | Discord API polling |
| `reply-listener-telegram.ts` | Telegram API polling |
| `reply-listener-injection.ts` | Inject received reply into tmux pane (rate limiting + user filtering) |
| `reply-listener-state.ts` | Daemon state: PID, config signature, poll tracking |
| `daemon.ts` | Daemon entry point (runs as detached Bun process) |
| `tmux.ts` | `capturePane()`, `sendToPane()` utilities |

## GATEWAY TYPES

| Type | Config | Execution |
|------|--------|-----------|
| **HTTP webhook** | `url` field | POST with JSON payload |
| **Shell command** | `command` field | Execute with env vars (OPENCLAW_*) |

## PAYLOAD VARIABLES (interpolation)

`{sessionId}`, `{projectPath}`, `{tmuxSession}`, `{timestamp}`, `{eventType}` (session.created/deleted/idle), `{messageContent}`, `{promptSummary}`

## INTEGRATION POINTS

- `src/index.ts` — calls `initializeOpenClaw(pluginConfig.openclaw)` at plugin startup (if `enabled`)
- `src/plugin/event.ts` — calls `dispatchOpenClawEvent()` for session.created/deleted/idle
- `src/config/schema/openclaw.ts` — Zod config schema

## DAEMON LIFECYCLE (IMPLEMENTED IN CORE)

```
initializeOpenClaw(config)
  → wakeOpenClaw() if reply_listener.enabled
  → spawn daemon.ts as detached process
  → daemon writes PID to .opencode/openclaw.state.json
  → daemon polls Discord/Telegram every 3s
  → on reply: lookup in session-registry → inject into tmux via send-keys
```

## SECURITY (ENFORCED IN CORE)

- **URL validation**: HTTPS required except localhost (config.ts)
- **Authorized users**: Inbound replies filtered by allowed user ID list
- **Token redaction**: Secrets masked in logs and error messages
- **Rate limiting**: Reply injection throttled per pane
