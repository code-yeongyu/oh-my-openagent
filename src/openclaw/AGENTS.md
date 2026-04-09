# src/openclaw/ — Bidirectional External Integration

**Generated:** 2026-04-09

## OVERVIEW

18 files. Bidirectional integration system: **outbound** session event notifications (Discord/Telegram/HTTP webhook/shell command) AND **inbound** reply handling (daemon polls chat apps, injects replies back into tmux session). Named "claw" because it reaches out from OpenCode and pulls replies back in.

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

## KEY FILES

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

## DAEMON LIFECYCLE

```
initializeOpenClaw(config)
  → wakeOpenClaw() if reply_listener.enabled
  → spawn daemon.ts as detached process
  → daemon writes PID to .opencode/openclaw.state.json
  → daemon polls Discord/Telegram every 3s
  → on reply: lookup in session-registry → inject into tmux via send-keys
```

## SECURITY

- **URL validation**: HTTPS required except localhost (config.ts)
- **Authorized users**: Inbound replies filtered by allowed user ID list
- **Token redaction**: Secrets masked in logs and error messages
- **Rate limiting**: Reply injection throttled per pane

## TESTING NOTE

`reply-listener-discord.test.ts` is **always isolated** in CI (listed in `ALWAYS_ISOLATED_TEST_FILES` of `script/run-ci-tests.ts`). Reason: mocks `globalThis.fetch` for Discord API simulation — needs process isolation to avoid interference with shared test batch.
