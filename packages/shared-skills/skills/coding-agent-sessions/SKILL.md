---
name: coding-agent-sessions
description: "MUST USE when asked to find, read, list, search, inspect, fetch, export, or reconstruct coding-agent sessions across Codex, Claude Code/Desktop, OpenCode, Senpi/pi, OpenClaw, Factory Droid, Amp, Gemini/Kimi/Qwen CLIs, Codebuff, Roo/Kilo/Cline, Kodu, Cursor CLI, Aider, or unknown local agent logs. Covers transcripts, session IDs, rollout JSONL, state SQLite, Claude projects/pre-compact histories, OpenCode messages/parts, child/subagent linkage, cwd/model/time/token filters, archives, and cost clues. Expands fuzzy recall into parallel query lanes and first probes known stores so absent platforms are skipped cheaply. Triggers: coding agent sessions, Codex/Claude/OpenCode/Senpi/pi/OpenClaw/Droid/Amp/Kodu/Cursor/Aider sessions, transcript search, session history, session ID, read transcript, token usage, subagent sessions, what did I do yesterday, did we already do this."
---

# Coding Agent Sessions

Find local coding-agent sessions across agent products before answering from memory. Prefer the bundled finder for broad cross-platform search, then read the selected session or raw file when you need exact evidence.

## PHASE 0 - PLATFORM ROUTER

1. **IF the user names a platform, load its reference first.**

   | Platform | Read |
   |---|---|
   | Codex / OpenAI Codex CLI | `references/codex.md` |
   | Claude Code / Claude Desktop histories | `references/claude.md` |
   | Senpi / pi coding-agent logs | `references/senpi.md` |
   | OpenCode / oh-my-openagent (formerly oh-my-opencode) storage | `references/opencode.md` |
   | OpenClaw, Droid, Amp, Gemini, Kimi, Qwen, Codebuff, Roo/Kilo/Cline, Kodu, Cursor CLI, Aider, Kiro, Goose, Hermes, Crush, Zed | `references/all-platforms.md` |
   | Unknown / "any session" / cross-agent search | `references/all-platforms.md` |

2. **Run the broad finder first unless the user gave an exact file path. For fuzzy recall, expand the query first.**

When the user remembers a task vaguely ("that OpenCode bug", "the dashboard PR", "when did we fix X"), derive 3-6 short query lanes before searching: product/tool aliases, repo/package names, exact error text, issue/PR/session IDs, English/Korean phrasing, and likely verbs such as `fix`, `review`, `plan`, `deploy`, or `merge`. Run the lanes together with repeated `--query` so `match_reasons` shows which wording found the hit.

```bash
python3 scripts/find-agent-sessions.py list --limit 20
python3 scripts/find-agent-sessions.py find "commit" --from 7d --platform senpi --platform opencode
python3 scripts/find-agent-sessions.py find "proxy" --platform openclaw --platform droid --platform amp
python3 scripts/find-agent-sessions.py find --query "deploy" --query "token usage" --workers 64
python3 scripts/find-agent-sessions.py find --query "opencode bug" --query "fix opencode" --query "OpenCode parent session" --include-subagents --workers 64
python3 scripts/find-agent-sessions.py read <session-id>
```

Use `python` instead of `python3` on systems where that is the available executable.

3. **Use explorer-style parallel lanes when one query batch is not enough.**

If scope is broad (multi-month, many repos/platforms, or a vague "what happened with X"), split independent searches by names/errors, repos/cwds, platforms/models, and time windows. Use available subagent/delegation tools for these lanes when they exist; otherwise run the finder calls in parallel. Merge candidates by `id`/`path`, then read the most likely sessions.

4. **Read details from search results before ad hoc digging.** Search results include `detail_hint`; run that `read <session-id> --platform <platform>` command to see the first user prompt, last user prompt, events, and child sessions together.

5. **Verify by opening raw transcripts for claims.** The finder normalizes formats; the raw `path` remains the source of truth.

## Output Contract

The finder prints JSON for stdout and `jq`. Every result includes:

| Field | Meaning |
|---|---|
| `platform` | Registered platform key such as `codex`, `claude`, `opencode`, `openclaw`, `droid`, `amp`, `kodu`, `cursor-cli`, `aider`, `roo-code`, `kilo-code`, `kilo-cli`, or `kiro` |
| `id` | Session ID or stable file-derived ID |
| `path` | Raw transcript/index file |
| `cwd` | Working directory when recoverable |
| `created_at`, `updated_at` | ISO-like timestamps when recoverable |
| `provider`, `model` | Model metadata when recoverable |
| `first_user_message` | First user prompt preview (for subagents: task description + delegated prompt) |
| `last_user_message` | Last user prompt preview when recoverable |
| `usage` | Token/cost clues when present in the platform log |
| `parent_id` | Parent session/thread ID when this is a subagent or child session, else `null` |
| `agent` | Subagent label (Claude `agentType`, Codex `nickname (role)`, OpenCode agent name) |
| `subagent_count` | Number of child sessions spawned by this session |
| `detail_hint` | Ready-to-run `read` command for detailed inspection |
| `match_reasons` | Search-only array explaining which field/content matched each query |

Each `match_reasons` entry includes `query`, `platform`, `field`, and `snippet`, so you can tell which platform matched and what content caused the hit without opening every transcript.

## Filters

`list` and `search` share these filters:

| Filter | Meaning |
|---|---|
| `--platform` | Repeatable platform filter; pass one platform per flag |
| `--root` | Extra root to scan, repeatable |
| `--from`, `--to` | Date bounds: `YYYY-MM-DD`, `YYYY-MM`, `YYYY`, `today`, `yesterday`, `7d` |
| `--cwd` | Working-directory substring |
| `--model` | Model substring |
| `--limit` | Maximum results |
| `--query` | Repeatable search query; multiple queries return per-query groups plus a de-duplicated merged result list |
| `--workers` | Parallel worker count for platform scans, transcript parsing, OpenCode message joins, and multi-query matching |
| `--include-subagents` | Include subagent/child sessions as standalone `list`/`search` results (hidden by default) |

When `--platform` is omitted, the finder searches every registered platform in parallel. Each optional platform first probes fixed, known transcript roots and returns immediately when the product has no local store, so broad default searches stay cheap. Use repeatable flags such as `--platform openclaw --platform droid` only when narrowing. Comma-separated platform values are intentionally unsupported.

For OpenCode, the finder uses `opencode db path` plus direct SQLite queries first, then `opencode session list --format json` as a fallback. It avoids heavy `messages/` or `parts/` scans during normal list/search, and only falls back to file joins when the OpenCode DB/CLI is unavailable or explicit `--root` values request a nonstandard store.

Usage-only sources such as Copilot OTEL, Mux, Antigravity tokscale cache rows, Synthetic provider retagging, and Cursor IDE usage CSV are excluded from default transcript search because they do not reconstruct user prompts.

## Subagent / Child Sessions

`list` and `find`/`search` return main sessions only by default, each annotated with `subagent_count`. `read <main-session-id>` (alias: `get`) always returns a `prompts` object and a `subagents` array containing every child session (id, agent label, parent_id, prompt preview, raw path), so opening a main session reveals its whole delegation tree. `read <child-id>` works too and returns that child's own events.

| Platform | Where children live | Linkage |
|---|---|---|
| Claude Code | `projects/<proj>/<session-id>/subagents/agent-*.jsonl` (Task tool) and `.../subagents/workflows/wf_*/agent-*.jsonl` (Workflow) | Directory name = parent session ID; `agent-*.meta.json` holds `agentType` + task description |
| Codex | Regular threads in `state_*.sqlite` + own rollout JSONL | `thread_spawn_edges` table and `threads.source` / rollout `session_meta.payload.source.subagent.thread_spawn` |
| OpenCode | Regular sessions in `opencode.db` / `storage/session/` | `session.parent_id` column / `parentID` field; `agent` column names the subagent |

When the user asks whether some specific work was ever done, search with `--include-subagents` — delegated work often lives only in child transcripts, not in the main session. Workflow `journal.jsonl` files are orchestration logs, not sessions.

## Codex Notes

For Codex sessions, use the same broad finder. It reads `state_*.sqlite`, rollout JSONL, and archived rollout files:

```bash
python3 scripts/find-agent-sessions.py list --platform codex --from 7d
python3 scripts/find-agent-sessions.py find "deploy" --platform codex
python3 scripts/find-agent-sessions.py read <session-id> --platform codex
```

Use `references/codex.md` for Codex storage details.

## Troubleshooting

| Problem | Fix |
|---|---|
| Missing Codex sessions | Set `CODEX_HOME` or pass `--root /path/to/.codex`. |
| Missing OpenCode sessions | Pass the data dir that contains `messages/` and `parts/`, often `~/.opencode` or `~/.local/share/opencode`. |
| Missing Claude sessions | Search `~/.claude/projects`, `~/.claude/transcripts`, and `~/.claude/pre-compact-session-histories`; use `--root` for nonstandard config dirs. |
| Missing optional platform sessions | Check `references/all-platforms.md` for the exact local store. For project-local tools such as Aider, pass `--root /path/to/workspace` if the repo is outside the bounded default roots. |
| Date filter misses local sessions | Timestamps are compared as UTC instants when parseable; otherwise file mtime is used. |
| Search is slow | Narrow with repeated `--platform` flags or date/cwd filters. Optional stores are probed before parsing; avoid passing your whole home as `--root` unless you really want every bounded project-local scan. |

## Activation

Use this skill for any request to find, read, or inspect a local coding-agent session, regardless of product name — including memory-recall questions ("what did I work on a few days ago", "did we already migrate X", "when did I fix Y"). If the user only says "that session where we did X", do not rely on one literal query: expand to multiple discriminative terms first, add `--include-subagents` when the work may have been delegated, then narrow by `--platform`, `cwd`, `model`, and time (`--from 7d` for "a few days ago"). Prefer the `detail_hint` from the chosen search result for the next read step. If the first query batch is still ambiguous, use explorer-style lanes by keyword, repo/cwd, platform/model, and time window before summarizing.
