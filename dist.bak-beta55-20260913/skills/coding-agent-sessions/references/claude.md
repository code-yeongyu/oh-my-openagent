# Claude Session Stores

Observed Claude formats:

- `~/.claude/projects/<encoded-cwd>/*.jsonl`: Claude Code project sessions (main sessions; filename = session ID).
- `~/.claude/transcripts/ses_*.jsonl`: compact transcript exports with simple `type`, `timestamp`, `content`, and tool fields.
- `~/.claude/pre-compact-session-histories/*.jsonl`: pre-compaction histories with `sessionId`, `cwd`, `message`, `uuid`, `parentUuid`, and tool result metadata.

For project files, `sessionId`, `cwd`, `version`, `gitBranch`, and `message.model` are usually embedded in each line. For transcript exports, the filename may be the only stable session ID.

When reconstructing a Claude session, preserve the event order from the JSONL file and distinguish assistant text, thinking, tool use, tool result, and progress events.

## Subagent transcripts (per-session directory)

Each main session may own a sibling directory named after the session ID:

```
projects/<encoded-cwd>/<session-id>/
├── subagents/
│   ├── agent-<agentId>.jsonl        # Task-tool subagent transcript
│   ├── agent-<agentId>.meta.json    # {"agentType", "description", "toolUseId"}
│   └── workflows/wf_<id>/
│       ├── agent-<agentId>.jsonl    # Workflow-spawned agent transcripts
│       ├── agent-<agentId>.meta.json
│       └── journal.jsonl            # workflow orchestration journal — NOT a session
├── workflows/wf_<id>.json           # workflow run metadata
└── tool-results/*.txt               # persisted oversized tool outputs
```

Subagent JSONL lines look like main-session lines but carry `isSidechain: true`, `agentId`, `promptId`, and `sessionId` pointing at the PARENT session — never treat a subagent file's `sessionId` as its own identity; use the `agentId` (also in the filename) and take the parent from the directory path. The first line's user message is the delegated task prompt; `agent-*.meta.json` gives the human-readable `description` and `agentType`.

The finder models these as `platform: claude` sessions with `id = <agentId>`, `parent_id = <session-id>`, `agent = agentType`. `get <main-session-id>` lists them under `subagents`; `get <agentId>` returns the child transcript events. Older Claude Code versions inlined sidechains in the main JSONL (`isSidechain: true` lines) instead of separate files.
