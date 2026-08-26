# coding-agent-sessions — Cross-Platform Session Finder (Python)

**Generated:** 2026-08-24 (f3642fcda)

## OVERVIEW

The only shared skill besides `ultimate-browsing` carrying a real sub-project: a Python package + CLI that finds, lists, searches, and reads local coding-agent session transcripts across ~25 platforms (Codex, Claude, OpenCode, OMO/Senpi/pi, and a long tail), normalizing them into one `Session` model. Earned this file: 33 files, 23 Python modules, own test suite, own `pyrightconfig.json`, own `.npmignore` (ships in the npm package minus tests/caches).

## STRUCTURE

```
coding-agent-sessions/
├── SKILL.md                      # router: platform table → references/<platform>.md
├── references/                   # codex, claude, opencode, senpi, all-platforms (store layouts per platform)
├── agents/openai.yaml            # Codex agent role declaration
├── scripts/
│   ├── find-agent-sessions.py    # thin shebang entry (PEP 723, >=3.11); runpy → agent_sessions.cli
│   ├── agent_sessions/           # the package (12 modules)
│   └── tests/                    # 6 pytest modules
└── pyrightconfig.json            # extraPaths scripts/, excludes scripts/tests
```

## PUBLIC API (`scripts/agent_sessions/`)

| Module | Key exports |
|--------|-------------|
| `scanners.py` | `scan`, `DEFAULT_PLATFORMS`, `PLATFORM_SCANNERS`, per-platform `scan_*` (codex, claude, opencode, senpi, oh_my_pi, gajae_code, …) |
| `types.py` | `Session`, `Options`, `Json`, `JsonMap` — imported by nearly every module and test |
| `transcript.py` | parallel file reads, normalization, timestamps, session ids; `recent`, `MAX_PLATFORM_FILES` |
| `cli.py` | command parsing, filtering, payload construction, JSON emission (283 LOC — behavioral hotspot) |
| platform adapters | `file_scanners.py` (file-backed providers), `opencode.py` (CLI/SQLite/storage fallbacks), `sqlite_scanners.py`, `sqlite_optional_scanners.py`, `pi_family.py`, `aside_scanner.py`, `kiro_scanner.py` |

## CLI CONTRACT

`python3 scripts/find-agent-sessions.py <command>`; aliases `find`=`search`, `read`=`get`. Commands: `list`, `find`/`search` (repeated `--query` lanes, `--from 7d`, repeated `--platform`, `--workers`, `--cwd/--model`, `--include-subagents`, `--limit`), `get`/`read <session-id>`. Output is JSON with `match_reasons` and reconstructed first/last user prompts — that JSON shape is the stable contract.

## CONVENTIONS

- Stdlib-only Python (`>=3.11`), `from __future__ import annotations`, pathlib everywhere; no third-party deps at runtime.
- Probe-first, bounded discovery: platform-specific roots checked before broad globbing; optional platforms excluded from default search when they cannot reconstruct user prompts.
- Main sessions hide subagent children by default but report child counts; `--include-subagents` flips it. Parent/child linkage preserved and records deduplicated.
- Tests are pytest with `tmp_path` + `MonkeyPatch` isolation; in-file `# pyright: ignore[reportMissingImports]`-style relaxations for import diagnostics only.
- `.npmignore` strips `scripts/tests/`, `pyrightconfig.json`, and caches from the shipped skill.

## ANTI-PATTERNS

- NEVER answer from normalized previews alone — pull the raw transcript (`read`/`get`) for exact evidence.
- Usage-only stores are NOT transcript sources.
- A Claude subagent's embedded `sessionId` is NOT its identity — use its `agentId` + parent-directory linkage.
- Don't add a platform by globbing blindly; register it in `PLATFORM_SCANNERS`/`DEFAULT_PLATFORMS` with a bounded root probe.

## COMMANDS

```bash
# from packages/shared-skills/skills/coding-agent-sessions/
python3 scripts/find-agent-sessions.py list --limit 20
python3 scripts/find-agent-sessions.py find "commit" --from 7d --platform senpi --platform opencode
python3 scripts/find-agent-sessions.py read <session-id>
pytest scripts/tests
```

- Parent: [`packages/shared-skills/AGENTS.md`](../../AGENTS.md).
