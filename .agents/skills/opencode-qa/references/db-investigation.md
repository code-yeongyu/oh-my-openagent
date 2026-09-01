# Investigating opencode sessions in the DB (Case D)

## Table of Contents

- [Where the data lives](#where-the-data-lives)
- [Access methods](#access-methods)
- [Schema (the tables that matter)](#schema-the-tables-that-matter)
- [Time conversion](#time-conversion)
- [Tested query patterns](#tested-query-patterns)
- [The 25 GB caveat](#the-25-gb-caveat)
- [Verifying read-only](#verifying-read-only)

## Where the data lives

Active DB path: `opencode db path` (on this machine `~/.local/share/opencode/opencode.db`).

Derived from XDG data dir + "opencode" + "opencode.db" (or "opencode-<channel>.db" on non-stable channels). Override via env `OPENCODE_DB` (`:memory:`, absolute, or relative-to-data).

It is large (tens of GB) because the `part` table stores tool output. The `session` table is small (~21k rows; full scans are milliseconds).

## Access methods

Preferred: `opencode db "<SQL>" --format json` (WAL-safe; resolves the active DB). `--format tsv` default. Bare `opencode db` opens an interactive sqlite3 shell. `opencode db path` prints the file.

Raw fallback for EXPLAIN/perf: `sqlite3 "$(opencode db path)" "<SQL>"`. Reads are safe alongside a running opencode (WAL allows concurrent readers).

## Schema (the tables that matter)

Note the ACTIVE storage in v1.15.13 is the LEGACY pair `message` + `part`; the V2 `session_message` table exists but is EMPTY in this version (a recent session showed 43 message rows, 169 part rows, 0 session_message). Document both but make clear `message`/`part` is what holds current data.

### `session`

| Column | Notes |
|--------|-------|
| id | PK, 'ses_' prefix |
| project_id | FK |
| parent_id | |
| slug | |
| directory | |
| title | NOT NULL |
| version | |
| agent | |
| model | JSON {providerID, modelID} |
| cost | |
| tokens_input | |
| tokens_output | |
| tokens_reasoning | |
| tokens_cache_read | |
| tokens_cache_write | |
| metadata | JSON |
| time_created | epoch MILLISECONDS |
| time_updated | epoch MILLISECONDS |
| time_archived | |

Indexes: project_id, parent_id, workspace_id. NO index on title or time_created.

### `message` (legacy)

| Column | Notes |
|--------|-------|
| id | 'msg_' prefix |
| session_id | FK -> session, cascade |
| time_created | |
| time_updated | |
| data | JSON: {role, time:{created}, summary:{title}, agent, model:{providerID,modelID}, variant} |

### `part` (legacy)

| Column | Notes |
|--------|-------|
| id | 'prt_' prefix |
| message_id | FK -> message, cascade |
| session_id | denormalized; index part_session_idx |
| data | JSON |

Part types seen: text, reasoning, tool, step-start, step-finish. A text part is `{"type":"text","text":"..."}`.

### Other tables

`session_message` (V2, currently empty), `todo`, `project`, `permission`, `session_share`, `workspace`, `event`.

## Time conversion

`time_created`/`time_updated` are epoch milliseconds. Convert:

```sql
datetime(time_created/1000,'unixepoch')
```

## Tested query patterns

### 1. By id (instant)

Script: `scripts/db-session-by-id.sh <ses_id>`

```sql
SELECT
  id,
  slug,
  title,
  directory,
  agent,
  json_extract(model,'$.modelID') AS model,
  json_extract(model,'$.providerID') AS provider,
  cost,
  tokens_input,
  tokens_output,
  datetime(time_created/1000,'unixepoch') AS created,
  datetime(time_updated/1000,'unixepoch') AS updated
FROM session
WHERE id='<ses_id>'
```

### 2. By name/title (0.006s over 21k rows)

Script: `scripts/db-session-by-name.sh "<substr>" [limit]`

```sql
SELECT
  id,
  title,
  datetime(time_created/1000,'unixepoch') AS created
FROM session
WHERE title LIKE '%<substr>%'
ORDER BY time_created DESC
LIMIT <N>
```

### 3. By message text

Script: `scripts/db-session-by-text.sh (--session <id>|--recent <N>|--since "<window>") [--limit N] "<text>"`

CRITICAL performance note: text lives in `part.data` JSON, and `part` is the multi-GB table, so an UNBOUNDED text scan is refused by the script. Always scope it.

#### Scoped within one session (indexed, ~0.017s)

```sql
SELECT
  p.session_id,
  p.id,
  substr(json_extract(p.data,'$.text'),1,120)
FROM part p
WHERE p.session_id='<id>'
  AND json_extract(p.data,'$.type')='text'
  AND json_extract(p.data,'$.text') LIKE '%<text>%'
LIMIT 50
```

#### Bounded to the N most-recent sessions (worst-case ~0.02s)

```sql
SELECT
  p.session_id,
  p.id,
  substr(json_extract(p.data,'$.text'),1,120)
FROM part p
WHERE p.session_id IN (
  SELECT id FROM session ORDER BY time_created DESC LIMIT <N>
)
  AND json_extract(p.data,'$.type')='text'
  AND json_extract(p.data,'$.text') LIKE '%<text>%'
LIMIT 50
```

#### AVOID this naive form (took ~50s)

A JOIN `FROM session s JOIN part p ON p.session_id=s.id WHERE s.time_created >= X ...` scans oldest sessions first. The IN-subquery (newest-first, drives `part_session_idx`) is the right shape because it lets SQLite use the index on `part.session_id` with a small, ordered set of recent session IDs, rather than scanning the entire `part` table from the oldest sessions upward.

### 4. Full export

Script: `scripts/export-roundtrip.sh <ses_id>` wraps `opencode export <id> 2>/dev/null` -> clean JSON `{info:{id,slug,projectID,directory,title,tokens,time,...}, messages:[...]}` (banner goes to stderr).

### 5. Listing recent sessions

```sql
SELECT
  id,
  title,
  datetime(time_created/1000,'unixepoch') created
FROM session
ORDER BY time_created DESC
LIMIT 100
```

## The 25 GB caveat

Global text search over all parts is a full scan of the largest table and can take a long time. The bundled script refuses it; you must pass `--session`, `--recent`, or `--since`. Title search (`session` table) is always cheap.

## Verifying read-only

All Case D operations are reads. To prove a QA pass did not mutate the DB, compare before and after:

```bash
sqlite3 "$(opencode db path)" "SELECT count(*) FROM session"
```

These queries are exactly what the `scripts/db-*.sh` helpers run; each ships a `--self-test`.
