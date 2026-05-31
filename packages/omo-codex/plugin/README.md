# omo

`omo` is the single local Codex plugin namespace for Yeongyu's Codex components.

Internally each component remains isolated under `components/`:

- `components/comment-checker`
- `components/rules`
- `components/lsp`
- `components/ultrawork`
- `components/ulw-loop`

The root plugin manifest exports one Codex plugin named `omo`, with aggregate hooks, skills, and the LSP MCP server.
