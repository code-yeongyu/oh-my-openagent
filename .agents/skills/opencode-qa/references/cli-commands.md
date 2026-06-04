# opencode CLI for QA (Case A: terminal works)

The installed binary is `opencode` (v1.15.13). From the source repo you can also run `bun run --conditions=browser ./src/index.ts <cmd>` inside `packages/opencode`. The canonical non-interactive QA entry is `opencode run --format json`.

## Global flags

```
--print-logs
--log-level DEBUG|INFO|WARN|ERROR
--pure                    (run without external plugins)
-h, --help
-v, --version
```

## `opencode run` (non-interactive QA core)

Positional message. Key flags:

```
-m, --model <provider/model>
--agent <name>
-s, --session <ses_...>
-c, --continue
--fork
--format default|json
-f, --file <path>
--title
--attach <url>
-p, --password
-u, --username
--dir
--variant
--thinking
-i, --interactive
--dangerously-skip-permissions
--command <slash-cmd>
```

`--format json` emits NDJSON, one JSON object per line, each shaped like:

```json
{"type":"...", "timestamp":<ms>, "sessionID":"ses_...", ...}
```

`type` is one of: `text`, `tool_use`, `step_start`, `step_finish`, `reasoning`, `error`. The process exits when the session goes idle.

Validation rules:

- `-i` cannot combine with `--command` or `--format json`
- `--fork` needs `-c` or `-s`

Examples:

```bash
opencode run "list the files in src" --format json
```

```bash
opencode run --command commit
```

```bash
opencode run -c "continue the previous task"
```

```bash
opencode run "explain auth" --attach http://127.0.0.1:4096 -p "$OPENCODE_SERVER_PASSWORD"
```

## `opencode db` (database tools)

```bash
opencode db path
```

Prints the active DB file path.

```bash
opencode db "<SQL>" --format json
```

Runs a query and prints JSON rows. Use `--format tsv` (default) for TSV output.

```bash
opencode db
```

Opens an interactive sqlite3 shell.

```bash
opencode db migrate
```

Migrates legacy JSON storage into SQLite.

Bundled scripts for session investigation:

- `scripts/db-session-by-id.sh`
- `scripts/db-session-by-name.sh`
- `scripts/db-session-by-text.sh`
- `scripts/export-roundtrip.sh`

Full detail in `references/db-investigation.md`.

## `opencode session`

```bash
opencode session list --format json
```

Lists sessions as JSON.

```bash
opencode session delete <ses_id>
```

Deletes one session.

## `opencode export [sessionID]`

Prints "Exporting session: ..." to STDERR and a clean JSON document `{info:{...}, messages:[...]}` to STDOUT. Always redirect STDERR before piping to jq.

Example:

```bash
opencode export ses_3a4e... 2>/dev/null | jq '.info.id'
```

Bundled wrapper:

```bash
scripts/export-roundtrip.sh <ses_id>
```

## `opencode serve`

Starts a headless HTTP server.

Flags:

```
--port            (0 = pick 4096 then a free port)
--hostname        (default 127.0.0.1)
--mdns
--mdns-domain
--cors
```

On start it prints:

```
opencode server listening on http://<host>:<port>
```

Set `OPENCODE_SERVER_PASSWORD` to require auth. See `references/server-api.md`.

Bundled smoke test:

```bash
scripts/server-smoke.sh
```

## `opencode debug`

Useful subcommands:

```bash
opencode debug paths    # data/config/cache/state dirs
opencode debug info     # version, OS, terminal, plugins
```

Others: `config`, `lsp`, `ripgrep`, `file`, `skill`, `snapshot`, `agent`, `v2`, `wait`.

## Other commands

```bash
opencode models [provider] --verbose
opencode stats
opencode providers list          # alias: auth
opencode mcp list
opencode generate                # prints the OpenAPI JSON spec
```

## Installed binary vs dev source (IMPORTANT note box)

The installed `opencode` (v1.15.13) matches the dev source in `packages/opencode`. When citing internals, cite dev source paths but always verify a flag against `opencode <cmd> --help` on the installed binary, since the dev branch can drift ahead.

For DB internals see `references/db-investigation.md`; for the HTTP server see `references/server-api.md`.
