# packages/omo-codex/ - Codex CLI Light Edition (lazycodex)

**Generated:** 2026-05-31

## OVERVIEW

`@oh-my-opencode/omo-codex` (private, v0.1.0): the Codex harness adapter = the **Light Edition** (omo for the OpenAI Codex CLI). Vendors a Codex plugin namespace `omo` + a TypeScript installer + telemetry. Public distribution = the `lazycodex` bin/npm alias and the [`code-yeongyu/lazycodex`](https://github.com/code-yeongyu/lazycodex) marketplace repo. Codex marketplace identity = `sisyphuslabs` / plugin `omo` (`omo@sisyphuslabs`); `lazycodex` is the alias only. Full identity + the publish/deploy pipeline live in the root [`AGENTS.md`](file:///Users/yeongyu/local-workspaces/omo/AGENTS.md) "CODEX LIGHT EDITION" section.

## LAYOUT

| Path | Purpose |
|------|---------|
| `package.json` | `@oh-my-opencode/omo-codex` (private). Deps: `@oh-my-opencode/utils`, `posthog-node`. Scripts: `typecheck`, `test`, `build:plugin`, `sync:skills`. |
| `marketplace.json` | Codex marketplace manifest. Declares marketplace `sisyphuslabs`, single installable plugin `omo`. |
| `MARKETPLACE.md` | Native Codex marketplace notes for `sisyphuslabs` / `omo`. |
| `index.d.ts` | Type barrel re-exporting `src/`. |
| `plugin/` | Vendored Codex plugin namespace `omo`; pkg `@sisyphuslabs/omo-codex-plugin` (dep `@oh-my-opencode/shared-skills`). Holds `.codex-plugin/plugin.json` (brandColor `#7C3AED`), `hooks/hooks.json` (aggregate event wiring), `components/` (8), `skills/`, `.mcp.json`. |
| `scripts/` | Node ESM install scripts (Codex cache install + `~/.codex/config.toml` mutation + legacy-cache prune). |
| `src/` | TypeScript runtime consumed by the CLI: `install/` + `telemetry/`. |
| `tsconfig.json` | Bun-targeted strict config; included in root `typecheck:packages`. |

## COMPONENTS (8)

`comment-checker`, `git-bash`, `lsp`, `rules`, `start-work-continuation`, `telemetry`, `ultrawork`, `ulw-loop`. Each is an isolated workspace under `plugin/components/<name>/` with its own `AGENTS.md` + `hooks/hooks.json`. Wired to Codex lifecycle events `SessionStart` / `UserPromptSubmit` / `PreToolUse` / `PostToolUse` / `PostCompact` / `Stop` / `SubagentStop`. Implementations originate from `code-yeongyu/codex-{rules,comment-checker,lsp,ultrawork,ulw-loop,start-work-continuation}`.

## INSTALL (mechanics)

Entry: `src/cli/install-codex/` (`install-codex.ts`, `codex-config-toml.ts`, lazycodex-routing) + `packages/omo-codex/scripts/install*.mjs`. Targets: plugin cache `~/.codex/plugins/cache/sisyphuslabs/omo/<version>/`; agent TOMLs via `~/.codex/.tmp/marketplaces/sisyphuslabs/plugins/omo/`; enables `omo@sisyphuslabs` in `~/.codex/config.toml`; component CLIs into `~/.local/bin`. Windows: Git Bash preflight (`winget install --id Git.Git`); override `OMO_CODEX_GIT_BASH_PATH`, skip auto-install with `OMO_CODEX_SKIP_GIT_BASH_AUTO_INSTALL=1`. Non-Windows keeps the `git_bash` MCP manifest bundled but writes `enabled = false`.

## TELEMETRY

Event `omo_codex_daily_active`, at most once per UTC day per machine. Two sources: install (`install_completed`) + plugin `SessionStart` (`session_start`). Id `sha256("omo-codex:" + hostname)`; dedup state `~/.local/share/omo-codex/posthog-activity.json`; PostHog person profiles disabled. Opt-out: `OMO_CODEX_DISABLE_POSTHOG=1` / `OMO_CODEX_SEND_ANONYMOUS_TELEMETRY=0` (global `OMO_*` flags also disable). Parity with the main plugin pinned by `src/telemetry/cross-package-equivalence.test.ts`.

## DEPLOY (sync script)

`script/sync-lazycodex-marketplace.ts <source-root> <lazycodex-root>` copies `marketplace.json` to `.agents/plugins/marketplace.json` and `plugin/` to `plugins/omo/`, bundles `ast-grep-mcp` + `lsp-tools-mcp` `dist/cli.js` into `plugins/omo/components/*/dist/`, rewrites `.mcp.json` paths, then validates via `script/lazycodex-marketplace-validation.ts`. Mechanism = file copy + commit push, NOT a git subtree. The triggering `publish.yml` jobs (`publish_lazycodex`, `sync_lazycodex_marketplace`) are documented in the root `AGENTS.md`.

## NOTES

- `@sisyphuslabs/omo-codex-plugin` (the shipped Codex plugin bundle) is distinct from `@oh-my-opencode/omo-codex` (this adapter package).
- Codex marketplace name is `sisyphuslabs`, never `lazycodex`.
- `@oh-my-opencode/omo-codex` is private (not published to npm on its own); its assets ship via the root `package.json` `files` array.
- `bunfig.toml` excludes `packages/omo-codex/plugin/**` from the root `bun test`; the plugin carries its own `node --test` suite. Full Codex suite: `bun run test:codex`.
- Per-component detail lives in `plugin/components/*/AGENTS.md`; do not duplicate it here.
