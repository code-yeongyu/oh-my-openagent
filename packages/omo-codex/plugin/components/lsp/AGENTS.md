# Repository Conventions

Conventions for humans and agents working on this repository.

## Style

- TypeScript strict mode. No `any`, `@ts-ignore`, `@ts-expect-error`, or enums.
- ESM modules with `.js` suffix in import paths.
- Tabs for indentation. Double quotes for strings.
- Runtime is Node only.
- Tests use vitest and should exercise Codex hook/MCP behavior before implementation changes.

## Commands

- `npm install` installs dependencies.
- `npm test` runs the test suite once.
- `npm run typecheck` runs strict TypeScript checking.
- `npm run check` runs typecheck, Biome, and build.

## LSP Constraints

- LSP server processes are owned by `LspManager`.
- Tool execution acquires clients through `withLspClient(...)` unless it only reports static status.
- `lsp.rename` mutates files by applying workspace edits; keep it sequential at the MCP caller level.
- `.mcp.json` sets `lsp` MCP server `startup_timeout_sec: 10` to bound startup; preserve the bound on edits.
- Do not add pi-coding-agent or omo source dependencies. This package is standalone.
