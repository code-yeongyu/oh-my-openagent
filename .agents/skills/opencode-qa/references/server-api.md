# opencode HTTP server API for QA (Case B)

## Table of Contents

- [Start a server](#start-a-server)
- [Authentication](#authentication)
- [Per-request workspace routing](#per-request-workspace-routing)
- [Introspect the API](#introspect-the-api)
- [Tested smoke calls](#tested-smoke-calls)
- [Route catalog](#route-catalog)
- [Triggering a prompt over HTTP](#triggering-a-prompt-over-http)

## Start a server

Run the server with a fixed port and host:

```bash
opencode serve --port 4096 --hostname 127.0.0.1
```

Output:

```
opencode server listening on http://127.0.0.1:4096
```

Port 0 means the server will pick 4096, then fall back to a free port if that one is taken.

A bundled isolated smoke test is available at `scripts/server-smoke.sh`. It spawns an isolated server, checks `/global/health`, checks that `/doc` returns at least 100 paths, and confirms that no-auth requests get 401, then tears the server down.

## Authentication

Set the environment variable `OPENCODE_SERVER_PASSWORD` to require authentication. If it is unset, the server runs UNSECURED and prints a warning.

The username defaults to `opencode`. Override it with `OPENCODE_SERVER_USERNAME`.

Two ways to authenticate:

1. HTTP Basic Auth: `-u opencode:$PASS`
2. Query parameter: `?auth_token=<base64(user:pass)>`

Unauthenticated requests to protected routes return HTTP 401. This was verified.

## Per-request workspace routing

Most instance routes need the target project directory. Pass it as either:

- Query parameter: `?directory=$PWD`
- Header: `x-opencode-directory: $PWD`

Aliases also work: `x-opencode-workspace` header or `?workspace=` query parameter.

The server resolves an instance per request, so a single `serve` process can handle many projects.

## Introspect the API

The `/doc` endpoint returns the full OpenAPI spec. To list all documented paths:

```bash
curl -s -u opencode:$PASS http://127.0.0.1:4096/doc | jq '.paths | keys'
```

On v1.15.13 this returned 113 paths. This is the source of truth for exact request and response schemas.

## Tested smoke calls

```bash
curl -s -u opencode:$PASS http://127.0.0.1:4096/global/health | jq .
# {"healthy":true,"version":"1.15.13"}

curl -s -u opencode:$PASS http://127.0.0.1:4096/doc | jq '.paths|length'
# 113

curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4096/session?directory=$PWD
# 401 (no credentials)

curl -s -u opencode:$PASS "http://127.0.0.1:4096/session?directory=$PWD" | jq 'length'
```

## Route catalog

This mirrors the structure returned by `/doc`. Each entry is grouped as `method path - purpose`.

### Global

- `GET /global/health` - health check
- `GET /global/event` - server-wide SSE event stream
- `GET /global/config` - read global configuration
- `PATCH /global/config` - update global configuration
- `POST /global/dispose` - dispose the server instance
- `GET /doc` - OpenAPI specification

### Session

- `GET /session` - list sessions
- `GET /session/status` - session status overview
- `GET /session/:id` - get session by ID
- `GET /session/:id/children` - list child sessions
- `GET /session/:id/todo` - get session todo items
- `GET /session/:id/diff` - get session diff
- `GET /session/:id/message` - list session messages
- `GET /session/:id/message/:messageID` - get a specific message
- `POST /session` - create a new session
- `DELETE /session/:id` - delete a session
- `PATCH /session/:id` - update a session
- `POST /session/:id/fork` - fork a session
- `POST /session/:id/abort` - abort a session
- `POST /session/:id/init` - initialize a session
- `POST /session/:id/share` - share a session
- `POST /session/:id/summarize` - summarize a session
- `POST /session/:id/revert` - revert a session
- `POST /session/:id/unrevert` - unrevert a session
- `DELETE /session/:id/share` - unshare a session

### Prompting

- `POST /session/:id/message` - send a prompt; streams JSON
- `POST /session/:id/prompt_async` - fire-and-forget prompt; returns 204
- `POST /session/:id/command` - execute a command in a session
- `POST /session/:id/shell` - run a shell command in a session

### Files and find

- `GET /find` - text search via ripgrep
- `GET /find/file` - file search
- `GET /find/symbol` - symbol search
- `GET /file` - file metadata
- `GET /file/content` - file contents
- `GET /file/status` - file status

### Instance and app

- `GET /path` - path resolution
- `GET /vcs` - version control info
- `GET /vcs/status` - VCS status
- `GET /vcs/diff` - VCS diff
- `GET /command` - available commands
- `GET /agent` - available agents
- `GET /skill` - available skills
- `GET /lsp` - LSP info
- `GET /formatter` - formatter info

### Permission and question

- `GET /permission` - list pending permission requests
- `POST /permission/:requestID/reply` - reply to a permission request
- `GET /question` - list pending questions
- `POST /question/:requestID/reply` - reply to a question
- `POST /question/:requestID/reject` - reject a question

### TUI control

These endpoints drive a running TUI over HTTP.

- `POST /tui/append-prompt` - append text to the TUI prompt
- `POST /tui/submit-prompt` - submit the current TUI prompt
- `POST /tui/execute-command` - execute a TUI command
- `POST /tui/show-toast` - show a toast in the TUI
- `GET /tui/control/next` - get the next TUI control event
- `POST /tui/control/response` - respond to a TUI control event

### PTY

- `GET /pty` - list PTY sessions
- `POST /pty` - create a PTY session
- `GET /pty/:id` - get PTY session info
- `DELETE /pty/:id` - delete a PTY session
- `POST /pty/:id/connect-token` - generate a PTY connect token
- `GET /pty/:id/connect` - WebSocket connection to the PTY

### Event

- `GET /event` - instance-level SSE event stream

### V2 API

- `GET /api/session` - list sessions (v2)
- `POST /api/session/:id/prompt` - prompt a session (v2)
- `POST /api/session/:id/compact` - compact a session (v2)
- `POST /api/session/:id/wait` - wait for a session (v2)
- `GET /api/session/:id/context` - get session context (v2)
- `GET /api/session/:id/message` - get session messages (v2)
- `GET /api/model` - list models (v2)
- `GET /api/provider` - list providers (v2)

## Triggering a prompt over HTTP (for hook and event QA)

Use `prompt_async` so the event stream is not blocked.

```bash
curl -X POST -u opencode:$PASS -H 'Content-Type: application/json' \
  -d '{"parts":[{"type":"text","text":"hello"}]}' \
  "http://127.0.0.1:4096/session/<ses_id>/prompt_async?directory=$PWD"
```

This returns HTTP 204. Watching events is covered in `references/events-hooks.md`.

---

Schemas are authoritative in `GET /doc`; for the event stream see `references/events-hooks.md`.
