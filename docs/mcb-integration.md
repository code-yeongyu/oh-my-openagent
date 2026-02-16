# MCB Integration Guide

Memory Context Bank (MCB) integration for oh-my-opencode. Provides semantic code search, persistent memory, code validation, and version control awareness across sessions.

**MCB is completely optional.** Oh-my-opencode works perfectly without it. When disabled (the default), MCB has zero impact on the plugin.

## Prerequisites

- MCB binary installed (`mcb` v0.2.1+) — [github.com/marlonsc/mcb](https://github.com/marlonsc/mcb)
- oh-my-opencode v3.4.0+

## Quick Start

Add to your `.opencode/oh-my-opencode.json` (project-level) or `~/.config/opencode/oh-my-opencode.json` (user-level):

```jsonc
{
  "mcb": {
    "enabled": true
  }
}
```

That's it. MCB connects via stdio (`mcb serve`) by default. All MCB tools are enabled when `enabled` is `true`.

MCB is also registered as a builtin skill (`oc-mcb`), which means agents can load it via `load_skills=["oc-mcb"]` to get access to MCB tools.

## Configuration Reference

All fields are optional. MCB is disabled unless `enabled` is explicitly set to `true`.

```jsonc
{
  "mcb": {
    // Master switch. Must be true to activate MCB integration.
    // Default: undefined (treated as disabled)
    "enabled": true,

    // MCB binary command. Default: "mcb"
    "command": "mcb",

    // Arguments passed to the command. Default: ["serve"]
    "args": ["serve"],

    // Environment variables for the MCB process.
    "env": {},

    // MCB data directory override.
    "data_dir": "/path/to/mcb-data",

    // MCB server URL (legacy/alternative — for HTTP transport).
    "url": "http://localhost:3100",

    // Default collection for search and indexing operations.
    "default_collection": "my-project",

    // Automatically index the project on plugin startup.
    "auto_index": false,

    // Per-tool toggles. Each defaults to true when MCB is enabled.
    "tools": {
      "search": true,    // Semantic code search across indexed repositories
      "memory": true,    // Persistent observations, error patterns, quality gates
      "index": true,     // Codebase indexing for semantic search
      "validate": true,  // Code quality validation (12 built-in rules)
      "vcs": true,       // Git-aware context (branch comparison, impact analysis)
      "session": true    // Session lifecycle tracking
    }
  }
}
```

### Field Details

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `boolean` | `undefined` | Master switch. MCB is inactive unless explicitly `true`. |
| `command` | `string` | `"mcb"` | MCB binary command for stdio transport. |
| `args` | `string[]` | `["serve"]` | Arguments passed to the MCB command. |
| `env` | `Record<string, string>` | - | Environment variables for the MCB process. |
| `data_dir` | `string` | - | Override MCB data directory. |
| `url` | `string` (URL) | - | MCB server endpoint (legacy — for HTTP transport). |
| `default_collection` | `string` | - | Default collection name for search/index operations. |
| `auto_index` | `boolean` | - | Auto-index project codebase on plugin startup. |
| `tools.search` | `boolean` | `true` | Enable semantic code search (`mcb_search`). |
| `tools.memory` | `boolean` | `true` | Enable persistent memory (`mcb_memory`). |
| `tools.index` | `boolean` | `true` | Enable codebase indexing (`mcb_index`). |
| `tools.validate` | `boolean` | `true` | Enable code validation (`mcb_validate`). |
| `tools.vcs` | `boolean` | `true` | Enable git-aware context (`mcb_vcs`). |
| `tools.session` | `boolean` | `true` | Enable session tracking (`mcb_session`). |

## Recommended Configurations

### Minimal (Search + Memory)

Best for: individual developers who want semantic search and cross-session memory without the overhead of full integration.

```jsonc
{
  "mcb": {
    "enabled": true,
    "tools": {
      "search": true,
      "memory": true,
      "index": false,
      "validate": false,
      "vcs": false,
      "session": false
    }
  }
}
```

### Development (Search + Memory + Index + Validate)

Best for: active development workflows where you want code quality checks and automatic indexing alongside search.

```jsonc
{
  "mcb": {
    "enabled": true,
    "auto_index": true,
    "tools": {
      "search": true,
      "memory": true,
      "index": true,
      "validate": true,
      "vcs": false,
      "session": false
    }
  }
}
```

### Full (All Tools)

Best for: teams or power users who want the complete MCB experience including git-aware context and session tracking.

```jsonc
{
  "mcb": {
    "enabled": true,
    "default_collection": "my-project",
    "auto_index": true,
    "tools": {
      "search": true,
      "memory": true,
      "index": true,
      "validate": true,
      "vcs": true,
      "session": true
    }
  }
}
```

## Architecture

### Transport

MCB connects via **stdio** by default. When an agent loads the `oc-mcb` skill or a tool call targets MCB, the `SkillMcpManager` spawns `mcb serve` as a child process and communicates over stdin/stdout using the MCP protocol.

The connection is **lazy** — the MCB process is only spawned on the first tool call, not at plugin startup. This means zero overhead when MCB is enabled but not used.

### Config Gate

When oh-my-opencode starts, it reads the `mcb` config and makes a one-time decision:

1. **`enabled` is falsy or missing**: MCB is permanently disabled for the session. All MCB tool calls return gracefully with no-op results. Zero overhead.
2. **`enabled` is `true`**: Per-tool toggles are evaluated. Disabled tools are marked unavailable. The availability state is then **locked** for the rest of the session.

This lock-on-startup design means:
- No runtime configuration drift
- No unexpected MCB calls mid-session
- Deterministic behavior from the moment the plugin loads

### Graceful Degradation

Every MCB operation is wrapped in a fallback layer. If an MCB call fails at runtime (binary not found, process crash, unexpected error):

- The operation returns a degraded result instead of throwing
- The specific tool that failed is automatically marked unavailable for subsequent calls
- A one-time warning is emitted describing which capabilities are affected
- Failed operations are queued to disk for later replay
- The rest of oh-my-opencode continues working normally

This means MCB issues will never crash your session. At worst, you lose MCB features while everything else keeps working.

### Recovery

On `session.created`, oh-my-opencode automatically:
1. Resets degradation warnings (so they can re-emit in the new session)
2. Attempts to replay any queued operations from previous failed MCB calls (fire-and-forget, non-blocking)

## MCB Tools Reference

### `mcb_search` (search)

Semantic search across indexed code, memory observations, and context.

| Resource | Description |
|----------|-------------|
| `code` | Search indexed source code semantically |
| `memory` | Search stored observations and patterns |
| `context` | Search project context and metadata |

### `mcb_memory` (memory)

Store and retrieve persistent observations across sessions.

| Resource Type | Description |
|---------------|-------------|
| `observation` | General observations about codebase |
| `execution` | Execution logs and outcomes |
| `quality_gate` | Quality check results |
| `error_pattern` | Recurring error patterns |
| `session` | Session-level context |

### `mcb_index` (index)

Index project source code for semantic search.

| Action | Description |
|--------|-------------|
| `start` | Begin indexing a directory |
| `status` | Check indexing progress |
| `clear` | Remove indexed data |

### `mcb_validate` (validate)

Run code quality validation with 12 built-in rules.

| Action | Description |
|--------|-------------|
| `run` | Validate a file or project |
| `list_rules` | Show available validation rules |
| `analyze` | Deep analysis with complexity metrics |

### `mcb_vcs` (vcs)

Git-aware context and impact analysis.

Provides repository listing, branch comparison, and change impact analysis.

### `mcb_session` (session)

Session lifecycle management for tracking work across conversations.

## Tuning Tips

1. **Start minimal.** Enable only `search` and `memory` first. Add tools as you find value in them.

2. **Use `auto_index` for active projects.** If you're working on the same codebase daily, auto-indexing on startup ensures search results stay fresh.

3. **Disable `session` if you don't need cross-session tracking.** Session tracking adds overhead and is most useful for teams tracking work across multiple developers.

4. **Use `default_collection` to namespace projects.** If you work on multiple projects against the same MCB server, set a unique collection name per project config.

5. **Disable `validate` if you have existing linters.** MCB validation is useful when you don't have ESLint/Biome configured, but redundant if you already have a lint pipeline.

6. **Keep `vcs` disabled unless you need cross-branch analysis.** The built-in git tools in oh-my-opencode handle most git operations. MCB VCS adds value when comparing branches or analyzing change impact across large codebases.

## Troubleshooting

### MCB tools not appearing

- Verify `"enabled": true` is set in your config
- Check that `mcb` is in your PATH: `which mcb`
- Check that your config file is in the correct location (`.opencode/oh-my-opencode.json` or `~/.config/opencode/oh-my-opencode.json`)
- Restart your opencode session (MCB config is evaluated once at startup)

### MCB calls returning degraded results

- Check that the MCB binary is installed and runnable: `mcb --version`
- If using a custom binary path, set `"command": "/path/to/mcb"` in config
- If a tool was auto-disabled due to errors, restart the session to re-enable it

### Config changes not taking effect

MCB availability is locked at startup. Any config changes require restarting the opencode session to take effect. This is by design to ensure consistent behavior within a session.

### Specific tools not working

- Check the `tools` section in your config — individual tools can be disabled
- Some tools have known limitations (see AGENTS.md for current MCB tool status)
- Ensure the MCB binary version supports the tool you're trying to use (v0.2.1+ recommended)
