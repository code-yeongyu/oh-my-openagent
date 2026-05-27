# @oh-my-opencode/omo-codex

Codex harness adapter for **oh-my-openagent**. Brings the OMO experience (rules injection, comment checker, LSP MCP, ultrawork, ultragoal) into [OpenAI Codex CLI](https://github.com/openai/codex) through Codex's native plugin system.

## Layout

| Path | Purpose |
|------|---------|
| `plugin/` | Vendored Codex plugin namespace `omo` with 5 components. Shipped to the user via `~/.codex/plugins/cache/`. |
| `marketplace.json` | Codex marketplace manifest. Identifies `omo` as the single installable plugin. |
| `scripts/` | Node ESM build scripts for Codex cache installation and marketplace config updates. |
| `src/` | TypeScript runtime: installer + telemetry consumed by the omodex CLI. |
| `MARKETPLACE.md` | Vendored upstream marketplace README. |

## Components Vendored

- `rules` (TypeScript) - injects `AGENTS.md` / `CLAUDE.md` / `.omo/rules/**` into context via `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `PostCompact`.
- `comment-checker` (TypeScript) - runs `@code-yeongyu/comment-checker` after `apply_patch` / `edit` / `write` tool use.
- `lsp` (TypeScript + LSP MCP) - exposes LSP diagnostics, navigation, symbols, rename via MCP + post-edit hooks.
- `ultrawork` (Python) - keyword detector (`ulw` / `ultrawork`) that injects the full ultrawork directive, plus a `SessionStart` hook that syncs bundled agent TOML files into `CODEX_HOME/agents`.
- `ultragoal` (TypeScript) - durable multi-goal orchestration backed by `.omo/ultragoal/` evidence audit.

## Install

End users invoke through the omodex CLI. This package is the **Light edition** of omo — install it directly with:

```bash
bunx omo install --platform=codex
# or via the shortcut alias (same compiled CLI, defaults --platform=codex):
bunx lazycodex install
# or the longer package names:
bunx oh-my-opencode install --platform=codex
bunx oh-my-openagent install --platform=codex
```

To install **both** the Ultimate edition (OpenCode plugin) and the Light edition (this package) at once, use `--platform=both`.

The installer copies the built plugin into `~/.codex/plugins/cache/sisyphuslabs/omo/<version>/`, enables `omo@sisyphuslabs` in `~/.codex/config.toml`, and registers the `sisyphuslabs` marketplace from the `lazycodex` Git repository for native Codex marketplace upgrades.

To install both editions in one command, use `--platform=both`.

## Telemetry

Anonymous telemetry uses the same PostHog project as oh-my-openagent but emits the distinct event `omo_codex_daily_active`. The event is sent at most once per UTC day per machine from two sources:

| Source | Reason | Trigger |
|--------|--------|---------|
| `install` | `install_completed` | `bunx omo install --platform=codex` or `--platform=both` finishes (handled by `src/cli/install-codex/install-codex.ts`) |
| `plugin` | `session_start` | Codex plugin `SessionStart` hook fires (handled by `plugin/components/telemetry/`) |

Both sources share the same SHA256-hashed installation identifier (`sha256("omo-codex:" + hostname)`), suppress PostHog person profiles, and write the daily dedup state to `~/.local/share/omo-codex/posthog-activity.json`.

Opt out with:

```bash
# Codex-only
export OMO_CODEX_DISABLE_POSTHOG=1
export OMO_CODEX_SEND_ANONYMOUS_TELEMETRY=0

# Globally (also disables oh-my-openagent telemetry)
export OMO_DISABLE_POSTHOG=1
export OMO_SEND_ANONYMOUS_TELEMETRY=0
```

The identity constants and opt-out behavior are pinned across both sources by `src/telemetry/cross-package-equivalence.test.ts`.

See `/Users/yeongyu/local-workspaces/omodex/docs/legal/privacy-policy.md` for the full disclosure.

## Component Sources

The bundled component implementations come from the Sisyphus Labs Codex plugin family:

- [code-yeongyu/codex-rules](https://github.com/code-yeongyu/codex-rules)
- [code-yeongyu/codex-comment-checker](https://github.com/code-yeongyu/codex-comment-checker)
- [code-yeongyu/codex-lsp](https://github.com/code-yeongyu/codex-lsp)
- [code-yeongyu/codex-ultrawork](https://github.com/code-yeongyu/codex-ultrawork)
- [code-yeongyu/codex-ultragoal](https://github.com/code-yeongyu/codex-ultragoal)
