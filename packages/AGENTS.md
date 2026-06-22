# packages/ — Monorepo Packages

**Generated:** 2026-06-17

## OVERVIEW

37 sibling packages across 6 roles. `omo-opencode` is the **build entry** for the main npm dist (`packages/omo-opencode/src/index.ts` → bundled into root `dist/`). The root `package.json` `files` array ships `dist/` + `bin/` + `postinstall.mjs` plus selected sibling artifacts (`lsp-tools-mcp`, `lsp-daemon`, `git-bash-mcp` `dist/`; `shared-skills`; the `omo-codex` plugin bundle; and `.opencode`/`.agents` command+skill dirs). Everything else is a sibling with its own publication / deployment target.

## ROLE MAP

| Role | Count | Packages |
|------|-------|----------|
| **Platform binaries** | 12 | One per (OS × arch × variant). Uniform layout: `bin/` + `package.json` only. Selected at install time by `bin/` shim + `postinstall.mjs`. |
| **MCP packages** | 3 | `lsp-tools-mcp`, `git-bash-mcp`, `lsp-daemon` |
| **Core packages** | 18 | `utils`, `model-core`, `prompts-core`, `rules-engine` (was `rules-core`), `agents-md-core`, `comment-checker-core`, `hashline-core`, `boulder-state`, `telemetry-core`, `lsp-core`, `mcp-stdio-core`, `tmux-core`, `claude-code-compat-core`, `skills-loader-core`, `mcp-client-core`, `openclaw-core`, `team-core`, `delegate-core` |
| **Adapters** | 2 | `omo-opencode` (OpenCode Ultimate edition; the former root `src/`, build entry for the main npm dist) + `omo-codex` (Codex CLI Light edition; npm/bin alias `lazycodex`; Codex marketplace `sisyphuslabs` / plugin `omo`). See [`packages/omo-opencode/src/AGENTS.md`](omo-opencode/src/AGENTS.md), [`packages/omo-codex/AGENTS.md`](omo-codex/AGENTS.md) |
| **Skills** | 1 | [`shared-skills`](shared-skills/AGENTS.md) (cross-harness SKILL.md bundle shared between OMO and Codex; shipped via root `files` array) |
| **Web** | 1 | `web` |

## PLATFORM BINARIES (12)

`oh-my-opencode-darwin-arm64`, `oh-my-opencode-darwin-x64`, `oh-my-opencode-darwin-x64-baseline`, `oh-my-opencode-linux-arm64`, `oh-my-opencode-linux-arm64-musl`, `oh-my-opencode-linux-x64`, `oh-my-opencode-linux-x64-baseline`, `oh-my-opencode-linux-x64-musl`, `oh-my-opencode-linux-x64-musl-baseline`, `oh-my-opencode-windows-x64`, `oh-my-opencode-windows-x64-baseline`, `oh-my-opencode-windows-arm64`.

Each contains only a `bin/<binary>` and a `package.json`. Built by [`script/build-binaries.ts`](../script/build-binaries.ts) via `bun compile`. Published by the `publish-platform.yml` workflow.

`-baseline` variants are pure x86_64 (no AVX2) for older CPUs. `-musl` variants link against musl libc for Alpine. The `windows-arm64` entry targets Windows-on-ARM via x64 emulation / node fallback (`bun compile` target `bun-windows-x64`). Runtime selection happens in `bin/` and `postinstall.mjs`.

## MCP PACKAGES

| Package | Layout | Purpose |
|---------|--------|---------|
| `lsp-tools-mcp/` | Vendored standalone project (`.github/`, `CHANGELOG.md`, `LICENSE`, `src/`, `test/`, `biome.json`, `vitest.config.ts`) | Serves `lsp_diagnostics`, `lsp_goto_definition`, `lsp_find_references`, `lsp_symbols`, `lsp_prepare_rename`, `lsp_rename`, `lsp_status` tools via stdio MCP. Registered as tier-1 MCP `lsp` in [`packages/omo-opencode/src/mcp/`](omo-opencode/src/mcp/AGENTS.md). Node-targeted, built with `npm` + vitest, and consumes `lsp-core` + `mcp-stdio-core`. |
| [`git-bash-mcp/`](git-bash-mcp/AGENTS.md) | Internal package (`src/`, `dist/`, `tsconfig.json`) | stdio MCP serving the Windows-only `git_bash` tool for the Codex edition (Bun-targeted, unlike the other two). Tier-1 MCP. |
| `lsp-daemon/` | Vendored standalone project (`src/`, `test/`, `scripts/`, `biome.json`, `package-lock.json`) | Shared per-user LSP **daemon** over a unix socket (Windows named pipe) + a stdio MCP **proxy** + a tool client, consuming `lsp-core` + `mcp-stdio-core`. Lets multiple Codex sessions share one warm LSP process. Bin `omo-lsp-daemon`. Node-targeted (`npm` + vitest). See [`packages/lsp-daemon/AGENTS.md`](lsp-daemon/AGENTS.md). |

## CORE PACKAGES

Every Core package now ships its own AGENTS.md (linked below).

| Package | Layout | Purpose |
|---------|--------|---------|
| [`utils/`](utils/AGENTS.md) | `src/`, `tsconfig.json` | Shared utilities: deep-merge, snake-case, frontmatter, file-utils, etc. |
| [`model-core/`](model-core/AGENTS.md) | `src/`, `tsconfig.json` | Model resolution pipeline with ProviderCache dependency injection. |
| [`prompts-core/`](prompts-core/AGENTS.md) | `src/`, `prompts/`, `test/`, `tsconfig.json` | Harness-neutral markdown prompt loading, model-variant routing, and bundled mode prompts for search/analyze/team/hyperplan. |
| [`rules-engine/`](rules-engine/AGENTS.md) | `src/`, `tsconfig.json` | Rule discovery + matching engine (renamed from `rules-core`). |
| [`agents-md-core/`](agents-md-core/AGENTS.md) | `src/`, `tsconfig.json` | AGENTS.md walk-up discovery and injection logic. |
| [`comment-checker-core/`](comment-checker-core/AGENTS.md) | `src/`, `tsconfig.json` | apply-patch parser and binary runner with injectable spawn. |
| [`hashline-core/`](hashline-core/AGENTS.md) | `src/`, `tsconfig.json` | Hashline edit primitives and diff helpers shared by adapter shims. |
| [`boulder-state/`](boulder-state/AGENTS.md) | `src/`, `tsconfig.json` | Work tracking state machine with split storage. |
| [`telemetry-core/`](telemetry-core/AGENTS.md) | `src/`, `tsconfig.json` | Harness-neutral telemetry primitives and PostHog wrappers. |
| [`lsp-core/`](lsp-core/AGENTS.md) | `src/`, `tsconfig.json` | Harness-neutral LSP engine, request context, tool definitions, and MCP entry helpers. |
| [`mcp-stdio-core/`](mcp-stdio-core/AGENTS.md) | `src/`, `tsconfig.json` | Shared JSON-RPC stdio framing and dispatch primitives for MCP servers. |
| [`tmux-core/`](tmux-core/AGENTS.md) | `src/`, `tsconfig.json` | Harness-neutral tmux session, pane, layout, and runner primitives. |
| [`claude-code-compat-core/`](claude-code-compat-core/AGENTS.md) | `src/`, `tsconfig.json` | Claude Code compatibility loaders for plugins, MCPs, commands, and agents. |
| [`skills-loader-core/`](skills-loader-core/AGENTS.md) | `src/`, `tsconfig.json` | Skill loading, builtin skill, runtime skill, and skill matching primitives. |
| [`mcp-client-core/`](mcp-client-core/AGENTS.md) | `src/`, `tsconfig.json` | MCP client lifecycle, skill-embedded MCP manager, and OAuth primitives. |
| [`openclaw-core/`](openclaw-core/AGENTS.md) | `src/`, `tsconfig.json` | OpenClaw gateway, reply-listener daemon, session registry, and tmux injection primitives. |
| [`team-core/`](team-core/AGENTS.md) | `src/`, `tsconfig.json` | Team-mode registry, mailbox, tasklist, state, worktree, and tmux layout domain primitives. |
| [`delegate-core/`](delegate-core/AGENTS.md) | `src/`, `tsconfig.json` | Delegate task selection and retry primitives. |

## WEB

| Package | Sub-AGENTS.md | Purpose |
|---------|---------------|---------|
| `web/` | yes ([packages/web/AGENTS.md](web/AGENTS.md)) | Marketing site. Next.js 15 + Cloudflare Workers via `@opennextjs/cloudflare`. Independent `bun.lock` + `tsconfig.json`. Only place in the repo where `@/*` path aliases are allowed. |

## ADAPTERS

- **`omo-opencode`** is the OpenCode Ultimate edition — the former root `src/`, moved here by the package layering refactor (100% git rename). It is the build entry for the main npm dist (`packages/omo-opencode/src/index.ts` → root `dist/`) and holds all 11 agents, ~55 hooks, native tools, features, and built-in MCPs. Full breakdown in [`packages/omo-opencode/src/AGENTS.md`](omo-opencode/src/AGENTS.md).
- **`omo-codex`** is the Codex CLI Light edition (vendored Codex plugin namespace `omo` + TS installer + telemetry); its public distribution is the `lazycodex` bin/npm alias and the `code-yeongyu/lazycodex` marketplace repo; full layout in [`packages/omo-codex/AGENTS.md`](omo-codex/AGENTS.md) and the publish/deploy pipeline in the root [`AGENTS.md`](../AGENTS.md).

## CONVENTIONS

- **No new package without explicit need.** Adding a sibling package complicates publish + CI. Justify the boundary first.
- **Platform binaries** are generated. Do NOT edit by hand. Modify [`script/build-binaries.ts`](../script/build-binaries.ts).
- **`lsp-tools-mcp` + `lsp-daemon` are vendored Node-targeted source.** Build them with `bun run build:lsp-tools-mcp` / `bun run build:lsp-daemon` (each runs `npm ci` + `npm run build`) before workflows or package tasks that need their `dist/`.
- **`packages/web/` is excluded from root `bun test`** via `bunfig.toml`. It has its own [`web-ci.yml`](../.github/workflows/web-ci.yml) workflow.
- **CI builds** for non-platform packages run as part of the root `ci.yml`. Platform binaries build only via `publish-platform.yml` when triggered by `publish.yml`.

## ANTI-PATTERNS

- Never publish a sibling package manually. Use the GitHub Actions workflows.
- Never copy code between packages by hand. Either share via a core package or accept the duplication and document it.
- Never modify `bin/<binary>` inside a platform package — those are compiled artifacts.
