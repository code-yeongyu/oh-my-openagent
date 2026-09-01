# lsp — Codex LSP integration (PostToolUse diagnostics + MCP routing)

**Generated:** 2026-08-24 (refresh pass)

## OVERVIEW

`@code-yeongyu/codex-lsp` (Node >=20). Codex-specific integration only: a `PostToolUse` hook (matcher `^(apply_patch|Write|Edit|MultiEdit|multi_edit|write|edit|multiedit)$`, 60s timeout) that runs error diagnostics on files mutated by edit tools and injects blocking feedback plus the same diagnostics as additional context, and a `PostCompact` hook that resets the per-session diagnostics cache. The LSP/MCP runtime lives upstream: `src/cli.ts` routes the `mcp` subcommand to the vendored repo-root `packages/lsp-tools-mcp/` + `packages/lsp-daemon/` builds (wired via the component `.mcp.json` → `../../../../lsp-daemon/dist/cli.js mcp`); this component consumes `@oh-my-opencode/lsp-core` and `@code-yeongyu/lsp-daemon/client` and stays standalone.

Deletes are ignored (cannot introduce new diagnostics); unsupported extensions and clean files emit no hook output.

## KEY FILES

| File | Role |
|------|------|
| `src/cli.ts` | Entry: routes `mcp` to the upstream runtime; `hook post-tool-use` / `hook post-compact` stay local |
| `src/codex-hook.ts` | Hook logic: request context, mutated-file extraction, daemon diagnostics call, output shaping (`runLspPostToolUseHook`, `runLspPostCompactHook`, `codexLspRequestContext`) |
| `src/mutated-file-paths.ts` | Tool-input → file path extraction (`path`/`filePath`/`file_path` aliases, `apply_patch` command parsing) |
| `src/lsp-session-state.ts` | Per-session post-edit cache, compaction marking, daemon-unreachable detection |
| `src/daemon-cli-path.ts` | Resolves/vets the lsp-daemon CLI and its env (`resolveLspDaemonCliPath`, `ensureLspDaemonCliEnv`) |
| `scripts/build-lsp-tools.mjs`, `build-lsp-daemon.mjs`, `build-runtime.mjs` | Vendored upstream builds (run by `prebuild`/`pretest` hooks) |
| `scripts/test.mjs` | Test driver behind `npm test` |

## COMMANDS

- `npm install` then `npm run bootstrap` (builds vendored lsp-tools-mcp + lsp-daemon)
- `npm test` (builds first, then `node scripts/test.mjs`); `npm run test:watch`
- `npm run typecheck` / `npm run lint` / `npm run check` (typecheck + Biome + build)

## LSP Constraints

- LSP server processes are owned by `LspManager` (upstream runtime).
- Tool execution acquires clients through `withLspClient(...)` unless it only reports static status.
- `lsp.rename` mutates files by applying workspace edits; keep it sequential at the MCP caller level.
- `.mcp.json` sets `startup_timeout_sec: 10` to bound startup; preserve the bound on edits.
- Do not add pi-coding-agent or omo source dependencies. This package is standalone.

## Style

- TypeScript strict mode. No `any`, `@ts-ignore`, `@ts-expect-error`, or enums.
- ESM modules with `.js` suffix in import paths. Tabs. Double quotes.
- Runtime is Node only; tests use vitest and should exercise Codex hook/MCP behavior before implementation changes.
