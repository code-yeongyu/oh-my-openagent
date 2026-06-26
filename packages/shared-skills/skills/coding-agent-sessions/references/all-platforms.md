# Cross-Platform Session Search

## Default locations

Search these first, then add user-supplied roots with `--root`:

Registered platform keys: `codex`, `claude`, `senpi`, `opencode`, `openclaw`, `droid`, `amp`, `gemini`, `kimi`, `qwen`, `codebuff`, `roo-code`, `kilo-code`, `cline`, `kodu`, `cursor-cli`, `aider`, `kilo-cli`, `hermes`, `goose`, `crush`, `zed`, `kiro`.

| Platform | Unix/macOS | Windows |
|---|---|---|
| Codex | `$CODEX_HOME`, `~/.codex` | `%CODEX_HOME%`, `%USERPROFILE%\.codex` |
| Claude | `~/.claude` | `%USERPROFILE%\.claude`, `%APPDATA%\Claude` |
| Senpi / pi | `~/.senpi/agent`, `~/.pi/agent` | `%USERPROFILE%\.senpi\agent`, `%USERPROFILE%\.pi\agent` |
| OpenCode | `$OPENCODE_HOME`, `~/.opencode`, `~/.local/share/opencode` | `%OPENCODE_HOME%`, `%APPDATA%\opencode`, `%USERPROFILE%\.opencode` |
| OpenClaw | `~/.openclaw/agents/*/sessions`, `~/.openclaw/session-backups` | pass `--root` |
| Factory Droid | `~/.factory/sessions/*/*.jsonl` | pass `--root` |
| Amp | `~/.local/share/amp/threads/T-*.json` | pass `--root` |
| Gemini / Kimi / Qwen | `~/.gemini/tmp/*/chats`, `~/.kimi/sessions/*/*/wire.jsonl`, `~/.qwen/projects/*/chats` | pass `--root` |
| Codebuff | `~/.config/manicode*/projects/*/chats/*/chat-messages.json` | pass `--root` |
| Roo Code (`roo-code`) / Kilo Code (`kilo-code`) / Cline | VS Code `globalStorage/<extension>/tasks/*` | VS Code `globalStorage\<extension>\tasks\*` |
| Kodu | VS Code `globalStorage/kodu-ai.claude-dev-experimental/db/Azad.db` | VS Code `globalStorage\kodu-ai.claude-dev-experimental\db\Azad.db` |
| Cursor CLI | `~/.cursor/chats/*/*/store.db`, `~/.cursor/prompt_history.json` | `%USERPROFILE%\.cursor\chats` |
| Aider | bounded project roots containing `.aider.chat.history.md`; use `--root` for other repos | pass `--root` |
| Kilo CLI (`kilo-cli`) / Hermes / Goose / Crush / Zed | Known SQLite roots are probed cheaply; unsupported schemas return empty | pass `--root` |
| Kiro | `~/.kiro/sessions/cli/*.json` plus paired `*.jsonl` prompt events | pass `--root` |

## Excluded usage-only sources

Do not add these as default transcript platforms without a separate prompt-reconstruction source:

| Source | Why excluded |
|---|---|
| Copilot OTEL | Token/telemetry rows, not prompts |
| Mux | `session-usage.json` usage buckets only |
| Antigravity | tokscale cache/RPC data, not raw chat transcripts |
| Synthetic | Provider retagging over another platform, not an independent session store |
| Cursor IDE usage CSV | Usage accounting; use `cursor-cli` for local CLI chat stores |

## Workflow

1. Run `scripts/find-agent-sessions.py search <query>` across all platforms, or repeat `--query` for several searches in one scan. Add `--include-subagents` when the work may have run inside a delegated agent — child transcripts are excluded from `list`/`search` by default.
2. If results are noisy, add `--cwd`, `--model`, `--from`, or repeated `--platform` filters.
3. Run `get <session-id>` on likely hits. The result includes a `subagents` array: every child session (Claude Task/workflow agents, Codex thread spawns, OpenCode child sessions) with its own id, `agent` label, and raw path — follow up with `get <child-id>` for a child's events.
4. Open raw `path` files for exact quotes, tool calls, and evidence.

## Subagent linkage cheat sheet

| Platform | Child identity | Parent linkage | Agent label |
|---|---|---|---|
| Claude | `projects/<proj>/<sid>/subagents/**/agent-<agentId>.jsonl` | directory `<sid>` | `agent-*.meta.json` `agentType` |
| Codex | thread row + own rollout JSONL | `thread_spawn_edges` / `source.subagent.thread_spawn.parent_thread_id` | `agent_nickname (agent_role)` |
| OpenCode | `session` table row / `storage/session/**.json` | `parent_id` column / `parentID` field | `agent` column |

## Parallelism

The finder scans selected platforms concurrently, parses transcript files concurrently, joins OpenCode message/part files concurrently, and evaluates repeated `--query` values concurrently. Increase `--workers` for large local stores:

```bash
python3 scripts/find-agent-sessions.py search --query "commit" --query "deploy" --workers 64
python3 scripts/find-agent-sessions.py search --query "commit" --platform senpi --platform opencode --workers 64
```

Omit `--platform` for the full multi-platform search. Add repeated platform flags such as `--platform openclaw --platform droid` only when the user already knows the likely stores. Comma-separated platform values are intentionally unsupported.

The default scan is intentionally probe-first: optional platforms check for exact store roots before globbing or opening files. This avoids expensive home-wide searches while still making newly installed local agents visible without changing the command.

OpenCode is optimized differently from raw JSONL stores: it calls `opencode db path`, reads the SQLite session table directly, falls back to `opencode session list --format json`, and only scans `messages/` / `parts/` when the DB/CLI is unavailable or explicit `--root` values force a file-store lookup.

## Evidence rule

Never answer "what happened in a session" from the normalized preview alone. Use the preview to locate candidates, then inspect the raw transcript or `get` output.
