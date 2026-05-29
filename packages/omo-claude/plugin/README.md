# omo

`omo` is the single local Claude Code plugin namespace for Yeongyu's Claude Code components.

Internally each component remains isolated under `components/`:

- `components/comment-checker`
- `components/rules`
- `components/lsp`
- `components/ultrawork`
- `components/ultragoal`
- `components/start-work-continuation`
- `components/telemetry`

The root plugin manifest (`.claude-plugin/plugin.json`) exports one Claude Code plugin
named `omo`, with aggregate hooks (`hooks/hooks.json`), bundled skills (`skills/`),
subagents (`agents/`), and the LSP + ast-grep MCP servers (`.mcp.json`).
