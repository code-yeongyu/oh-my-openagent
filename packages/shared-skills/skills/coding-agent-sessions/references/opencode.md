# OpenCode Session Stores

## Fast path

Prefer the OpenCode CLI index before touching session files:

```bash
opencode db path
sqlite3 "$(opencode db path)" 'select id, title, directory, time_updated from session order by time_updated desc limit 2000'
opencode session list --format json --max-count 100
```

Use direct SQLite via `opencode db path` for ordinary `list` and title/session-ID/cwd searches. It queries OpenCode's own indexed session database and avoids expensive scans across `messages/` and `parts/`. Use `opencode session list --format json` as the next fallback when direct DB access is unavailable.

Only fall back to file joins when `opencode` is not installed, the command fails, or the user passes an explicit `--root` for a nonstandard store.

## Subagent (child) sessions

Child sessions spawned by the task tool / subagents are ordinary rows in the `session` table:

- `session.parent_id` — parent session ID (`NULL` for main sessions). Tens of thousands of child rows are normal.
- `session.agent` — subagent name (`explore`, `plan`, `librarian`, `Sisyphus-Junior`, ...).
- Child titles often end with the convention `"... (@<agent> subagent)"`.

```bash
sqlite3 "$(opencode db path)" "select id, agent, title from session where parent_id='<parent-id>' order by time_created"
```

In the file store, the same linkage is the `parentID` field of `storage/session/<project-hash>/ses_*.json` info files. The finder surfaces children with `parent_id` + `agent` set; `get <parent-id>` lists them under `subagents`.

## File fallback

Observed OpenCode layouts vary by version:

- `~/.opencode/messages/ses_*/*.json`: message metadata.
- `~/.opencode/parts/msg_*/*.json`: message parts, including text and synthetic compaction context.
- `~/.opencode/sessions/**`: newer session indexes or compatibility storage.
- `~/.local/share/opencode/storage/session/<project-hash>/ses_*.json`: session info files (`id`, `parentID`, `title`, `directory`, `time.created/updated`) — sibling `storage/message/` and `storage/part/` (singular) dirs hold content.
- `~/.local/share/opencode/storage/**`: older or Linux/XDG storage, often with session/message JSON or SQLite-backed data.

Message metadata usually contains `sessionID`, `role`, `time.created`, `agent`, `model.providerID`, `model.modelID`, and `path.cwd`. Text content may live in `parts/<message-id>/*.json`.

When answering from OpenCode, join messages to parts by `messageID` and order by `time.created` or part time. Compaction injections are useful for continuity but should be labeled as synthetic.
