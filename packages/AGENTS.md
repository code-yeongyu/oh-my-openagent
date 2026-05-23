# packages/ — Monorepo Packages

**Generated:** 2026-05-20

## OVERVIEW

15 sibling packages across 4 roles. None of these are published as part of the main `oh-my-opencode` / `oh-my-openagent` npm dist (root `package.json` `files` only ships `dist/`, `bin/`, `postinstall.mjs`). They are sibling packages with their own publication / deployment targets.

## ROLE MAP

| Role | Count | Packages |
|------|-------|----------|
| **Platform binaries** | 11 | One per (OS × arch × variant). Uniform layout: `bin/` + `package.json` only. Selected at install time by `bin/` shim + `postinstall.mjs`. |
| **MCP packages** | 2 | `lsp-tools-mcp` (git submodule), `ast-grep-mcp` |
| **Core packages** | 7 | `utils`, `model-core`, `rules-engine` (was `rules-core`), `agents-md-core`, `ast-grep-core`, `comment-checker-core`, `boulder-state` |
| **Web** | 1 | `web` |

## PLATFORM BINARIES (11)

`oh-my-opencode-darwin-arm64`, `oh-my-opencode-darwin-x64`, `oh-my-opencode-darwin-x64-baseline`, `oh-my-opencode-linux-arm64`, `oh-my-opencode-linux-arm64-musl`, `oh-my-opencode-linux-x64`, `oh-my-opencode-linux-x64-baseline`, `oh-my-opencode-linux-x64-musl`, `oh-my-opencode-linux-x64-musl-baseline`, `oh-my-opencode-windows-x64`, `oh-my-opencode-windows-x64-baseline`.

Each contains only a `bin/<binary>` and a `package.json`. Built by [`script/build-binaries.ts`](file:///Users/yeongyu/local-workspaces/omo/script/build-binaries.ts) via `bun compile`. Published by the `publish-platform.yml` workflow.

`-baseline` variants are pure x86_64 (no AVX2) for older CPUs. `-musl` variants link against musl libc for Alpine. Runtime selection happens in `bin/` and `postinstall.mjs`.

## MCP PACKAGES

| Package | Layout | Purpose |
|---------|--------|---------|
| `lsp-tools-mcp/` | Full standalone project (own `.git` submodule, `.github/`, `CHANGELOG.md`, `LICENSE`, `src/`, `test/`, `biome.json`, `vitest.config.ts`) | Serves `lsp_diagnostics`, `lsp_goto_definition`, `lsp_find_references`, `lsp_symbols`, `lsp_prepare_rename`, `lsp_rename`, `lsp_status` tools via stdio MCP. Registered as tier-1 MCP `lsp` in [`src/mcp/`](file:///Users/yeongyu/local-workspaces/omo/src/mcp/). |
| `ast-grep-mcp/` | Internal package (`src/`, `dist/`, `tsconfig.json`) | Serves `ast_grep_search` + `ast_grep_replace` tools via stdio MCP. Registered as tier-1 MCP `ast_grep`. |

## CORE PACKAGES

| Package | Layout | Purpose |
|---------|--------|---------|
| `utils/` | `src/`, `tsconfig.json` | Shared utilities: deep-merge, snake-case, frontmatter, file-utils, etc. |
| `model-core/` | `src/`, `tsconfig.json` | Model resolution pipeline with ProviderCache dependency injection. |
| `rules-engine/` | `src/`, `tsconfig.json` | Rule discovery + matching engine (renamed from `rules-core`). |
| `agents-md-core/` | `src/`, `tsconfig.json` | AGENTS.md walk-up discovery and injection logic. |
| `ast-grep-core/` | `src/`, `tsconfig.json` | ast-grep types, pattern-hints, and runner core with injectable spawn. |
| `comment-checker-core/` | `src/`, `tsconfig.json` | apply-patch parser and binary runner with injectable spawn. |
| `boulder-state/` | `src/`, `tsconfig.json` | Work tracking state machine with split storage. |

## WEB

| Package | Sub-AGENTS.md | Purpose |
|---------|---------------|---------|
| `web/` | yes ([packages/web/AGENTS.md](file:///Users/yeongyu/local-workspaces/omo/packages/web/AGENTS.md)) | Marketing site. Next.js 15 + Cloudflare Workers via `@opennextjs/cloudflare`. Independent `bun.lock` + `tsconfig.json`. Only place in the repo where `@/*` path aliases are allowed. |

## CONVENTIONS

- **No new package without explicit need.** Adding a sibling package complicates publish + CI. Justify the boundary first.
- **Platform binaries** are generated. Do NOT edit by hand. Modify [`script/build-binaries.ts`](file:///Users/yeongyu/local-workspaces/omo/script/build-binaries.ts).
- **`lsp-tools-mcp` is a git submodule.** Initialize with `git submodule update --init --recursive` after fresh clone.
- **`packages/web/` is excluded from root `bun test`** via `bunfig.toml`. It has its own [`web-ci.yml`](file:///Users/yeongyu/local-workspaces/omo/.github/workflows/web-ci.yml) workflow.
- **CI builds** for non-platform packages run as part of the root `ci.yml`. Platform binaries build only via `publish-platform.yml` when triggered by `publish.yml`.

## ANTI-PATTERNS

- Never publish a sibling package manually. Use the GitHub Actions workflows.
- Never copy code between packages by hand. Either share via a core package or accept the duplication and document it.
- Never modify `bin/<binary>` inside a platform package — those are compiled artifacts.
