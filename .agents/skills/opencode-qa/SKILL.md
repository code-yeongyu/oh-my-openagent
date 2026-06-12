---
name: opencode-qa
description: "QA opencode itself, per case: verify the CLI/terminal (opencode run, db, serve, export), prove a specific plugin hook/action/event fired via the SSE event stream, smoke-test the TUI under tmux, and investigate sessions in opencode's SQLite DB by id, title/name, or message text. Ships tested helper scripts (each with a --self-test) plus per-domain references. Use whenever someone wants to QA, smoke-test, verify, or debug opencode's CLI, HTTP server, plugin hooks/events, or TUI, or to find/inspect opencode sessions in the database. Triggers: opencode qa, qa opencode, test opencode, verify opencode hook, opencode session db, find opencode session by id/name/text, opencode tui test, opencode server health, opencode event stream."
---

# opencode QA

QA the opencode coding agent itself. This skill maps each QA need to a tested
helper script and a deep reference. Every script ships a `--self-test` that
asserts its scenario against the live machine, so the scripts are both the QA
tools and their own regression checks.

Verified against opencode v1.15.13 (bun 1.3.12, macOS). Confirm the installed
version with `opencode --version`; the surface is stable but always sanity
check a flag with `opencode <cmd> --help`.

## Golden rules (read before running anything)

- READS of the live DB are safe and intended. Investigating sessions (Case D)
  only reads `~/.local/share/opencode/opencode.db`.
- Anything that SPAWNS opencode (serve, run, the TUI) must use an isolated XDG
  sandbox so QA never writes junk sessions into the real DB. The bundled
  scripts already do this; if you run opencode by hand for QA, set
  `XDG_DATA_HOME` / `XDG_CONFIG_HOME` / `XDG_STATE_HOME` / `XDG_CACHE_HOME` to
  temp dirs first.
- Global text search over the `part` table is a multi-GB scan. Always scope it
  (`--session`, `--recent`, or `--since`). The text script refuses an
  unbounded scan on purpose.
- The opencode source repo (`packages/opencode`) tests itself with `bun test`
  and CANNOT run tests from the repo root. See `references/testing-harness.md`.

## Setup

Scripts live next to this file under `scripts/`. Invoke them from this skill
directory (or with their absolute path):

```bash
cd <this-skill-dir>                        # .agents/skills/opencode-qa
bash scripts/lib/common.sh --self-check    # confirm the harness + deps
```

`common.sh` provides the shared harness (DB path, SQL escaping, isolated XDG
sandbox, free port, server start/stop, and an EXIT-trap cleanup). It requires
`opencode`, `sqlite3`, `curl`, `jq`, and `tmux` on PATH.

## Router: pick your case

| You want to... | Case | Script | Reference |
|---|---|---|---|
| Run opencode non-interactively / check a CLI command | A | `opencode run --format json` (inline) | `references/cli-commands.md` |
| Find a session by its id | D | `scripts/db-session-by-id.sh <ses_id>` | `references/db-investigation.md` |
| Find sessions by title/name | D | `scripts/db-session-by-name.sh "<text>"` | `references/db-investigation.md` |
| Find sessions by message text | D | `scripts/db-session-by-text.sh --recent N "<text>"` | `references/db-investigation.md` |
| Export a whole session as JSON | D | `scripts/export-roundtrip.sh <ses_id>` | `references/db-investigation.md` |
| Check the HTTP server / an endpoint | B | `scripts/server-smoke.sh` | `references/server-api.md` |
| Prove a hook / action / event fired | B | `scripts/sse-hook-probe.sh` | `references/events-hooks.md` |
| Prove serve-topology wake runner-split (reproduced/fixed) | B | `scripts/serve-wake-split-probe.sh --expect reproduced\|fixed --evidence-dir DIR` (self-test: `--self-test`; fake LLM: `scripts/lib/fake-openai-server.mjs`) | `references/events-hooks.md` |
| Smoke-test the TUI | C | `scripts/tui-smoke.sh` | `references/tui-tmux.md` |
| Write/run a test in the opencode source | - | (bun test) | `references/testing-harness.md` |
| Drive opencode from a Bun/TS script | - | (SDK) | `references/sdk.md` |

## Case A: CLI / terminal works

The canonical scriptable, non-interactive entry is `opencode run`. JSON mode
emits one event per line so you can assert on it.

```bash
# stream structured events (types: text, tool_use, step_start, step_finish, reasoning, error)
opencode run "list files in src" --format json
# run a slash command
opencode run --command commit
# resume the last session
opencode run -c "continue"
# target an already-running server instead of booting one
opencode run "explain auth" --attach http://127.0.0.1:4096 -p "$OPENCODE_SERVER_PASSWORD"
```

Other QA-useful commands: `opencode db path`, `opencode debug paths`,
`opencode session list --format json`, `opencode models --verbose`. Full flag
detail in `references/cli-commands.md`.

## Case B: a specific hook, action, or event

opencode publishes lifecycle events over Server-Sent Events at `GET /event`.
Plugins observe the same events via the `event` hook, so seeing an event on the
wire proves a hook would fire.

```bash
# prove the SSE plumbing works (isolated server, asserts server.connected)
bash scripts/sse-hook-probe.sh --self-test

# watch a REAL server for a specific event while you trigger an action
bash scripts/sse-hook-probe.sh --attach http://127.0.0.1:4096 \
  --password "$OPENCODE_SERVER_PASSWORD" --directory "$PWD" \
  --event message.part.updated --timeout 30
```

Trigger an action over HTTP (fire-and-forget so the stream is not blocked):

```bash
curl -X POST -u opencode:$OPENCODE_SERVER_PASSWORD -H 'Content-Type: application/json' \
  -d '{"parts":[{"type":"text","text":"say hi"}]}' \
  "http://127.0.0.1:4096/session/<ses_id>/prompt_async?directory=$PWD"
```

A real prompt needs a configured provider, so run the watch-and-trigger pattern
against your real server, not the isolated sandbox. Event-type catalog, the 21
plugin hook points, and how to load a local plugin: `references/events-hooks.md`.
Server start, auth, and routes: `references/server-api.md`.

## Case C: the TUI

```bash
bash scripts/tui-smoke.sh --self-test
```

This launches the TUI under tmux in an isolated sandbox, confirms it renders
(`capture-pane`), confirms `send-keys` reaches the composer, tears the tmux
session down, and verifies the real DB session count is unchanged.

Honest verdict: tmux is fine for SMOKE (did it boot, render, accept a key) but
fragile for asserting conversation output (the TUI is a 60fps full-screen app).
For real behavior assertions use Case A (`opencode run`), Case B (server API +
SSE), or the TUI control HTTP API (`POST /tui/append-prompt`,
`POST /tui/submit-prompt`, `POST /tui/execute-command`). Details and the manual
tmux recipe: `references/tui-tmux.md`.

## Case D: investigate sessions in the DB

Read-only against the live SQLite DB. The `session` table is small (title and
id lookups are instant); message text lives in the multi-GB `part` table, so
text search must be scoped.

```bash
# by id
bash scripts/db-session-by-id.sh ses_3a4ee6335ffedFB8f76BPU1Eb3
# by title / name (newest first; second arg = limit)
bash scripts/db-session-by-name.sh "auth refactor" 20
# by message text - scope with --session, --recent N, or --since "<window>"
bash scripts/db-session-by-text.sh --session ses_3a4e... "ULTRAWORK"
bash scripts/db-session-by-text.sh --recent 50 "permission denied"
bash scripts/db-session-by-text.sh --since "7 days" --limit 50 "TODO"
# export an entire session as clean JSON
bash scripts/export-roundtrip.sh ses_3a4e... > session.json
```

Ad hoc queries: `opencode db "<SQL>" --format json`. Schema, tested query
shapes with timings, the legacy `message`/`part` vs V2 `session_message`
distinction, and the 25 GB caveat: `references/db-investigation.md`.

## Scripts index

Run any script with `--self-test` to verify it against the live machine, or
`-h` for usage. DB-read scripts are read-only; serve/sse/tui scripts use an
isolated sandbox and clean up on exit.

| Script | Case | Self-test asserts |
|---|---|---|
| `scripts/lib/common.sh --self-check` | - | deps present, DB path resolves, SQL escaping, free port, sandbox auto-removed |
| `scripts/db-session-by-id.sh` | D | id round-trips for a real session |
| `scripts/db-session-by-name.sh` | D | a derived title needle returns >=1 row |
| `scripts/db-session-by-text.sh` | D | scoped search hits; unbounded scan refused; bounded search <30s |
| `scripts/export-roundtrip.sh` | D | export stdout is valid JSON and `.info.id` round-trips |
| `scripts/server-smoke.sh` | B | `/global/health` healthy, `/doc` >=100 paths, no-auth -> 401 |
| `scripts/sse-hook-probe.sh` | B | `/event` opens and delivers `server.connected` |
| `scripts/tui-smoke.sh` | C | TUI renders under tmux, tears down, real DB untouched |

## Risks and caveats

- 25 GB part table: never run an unbounded text scan. Use `--session`,
  `--recent`, or `--since`. A naive `JOIN ... WHERE session.time_created >= X`
  scans oldest-first and can take ~50s; the scripts use an `IN`-subquery on the
  newest sessions (~20ms).
- `opencode export` writes its banner to STDERR; pipe with `2>/dev/null` before
  `jq` or you will get a parse error.
- The server enforces auth only when `OPENCODE_SERVER_PASSWORD` is set;
  otherwise it runs unsecured. Authenticated calls use `-u opencode:$PASS`.
  Unauthenticated calls to a secured server return HTTP 401.
- Installed binary vs dev source: cite dev source paths for internals but
  verify flags against the installed `opencode <cmd> --help`.
- Isolation: any QA that spawns opencode must use an isolated XDG sandbox so it
  never pollutes the real DB. Prove it by comparing
  `sqlite3 "$(opencode db path)" "SELECT count(*) FROM session"` before and
  after.
- TUI output assertions are fragile; use the API for real assertions.

## References

- `references/cli-commands.md` - every QA-relevant opencode subcommand and flag
- `references/db-investigation.md` - DB schema, tested queries, the 25 GB caveat
- `references/server-api.md` - server start, auth, route catalog, /doc
- `references/events-hooks.md` - SSE endpoints, event types, plugin hooks
- `references/tui-tmux.md` - tmux recipe, isolation, TUI control API
- `references/testing-harness.md` - how opencode tests itself (bun test)
- `references/sdk.md` - the @opencode-ai/sdk client (reference only)
