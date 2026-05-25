# @oh-my-opencode/omo-codex

Codex harness adapter for **oh-my-openagent**. Brings the OMO experience (rules injection, comment checker, LSP MCP, ultrawork, ultragoal) into [OpenAI Codex CLI](https://github.com/openai/codex) through Codex's native plugin system.

## Layout

| Path | Purpose |
|------|---------|
| `plugin/` | Vendored Codex plugin namespace `omo` with 5 components. Shipped to the user via `~/.codex/plugins/cache/`. |
| `marketplace.json` | Codex marketplace manifest. Identifies `omo` as the single installable plugin. |
| `scripts/` | Node ESM build scripts (port of the original `codex-plugins/scripts/install-local.mjs`). |
| `src/` | TypeScript runtime: installer + telemetry consumed by the omodex CLI. |
| `MARKETPLACE.md` | Vendored upstream marketplace README. |

## Components Vendored

- `rules` (TypeScript) - injects `AGENTS.md` / `CLAUDE.md` / `.omo/rules/**` into context via `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `PostCompact`.
- `comment-checker` (TypeScript) - runs `@code-yeongyu/comment-checker` after `apply_patch` / `edit` / `write` tool use.
- `lsp` (TypeScript + LSP MCP) - exposes LSP diagnostics, navigation, symbols, rename via MCP + post-edit hooks.
- `ultrawork` (Python) - keyword detector (`ulw` / `ultrawork`) that injects the full ultrawork directive, plus a `SessionStart` hook that syncs bundled agent TOML files into `CODEX_HOME/agents`.
- `ultragoal` (TypeScript) - durable multi-goal orchestration backed by `.omo/ultragoal/` evidence audit.

## Install

End users invoke through the omodex CLI:

```bash
bunx omo install --codex=yes
# or, equivalently:
bunx oh-my-opencode install --codex=yes
bunx oh-my-openagent install --codex=yes
```

The installer copies the built plugin into `~/.codex/plugins/cache/code-yeongyu-codex-plugins/omo/<version>/`, enables it in `~/.codex/config.toml`, and links the per-component binaries into `~/.local/bin/` (or `CODEX_LOCAL_BIN_DIR`).

## Telemetry

Anonymous telemetry uses the same PostHog project as oh-my-openagent but emits the distinct event `omo_codex_daily_active`. Opt out with:

```bash
export OMO_CODEX_DISABLE_POSTHOG=1
# or globally for every OMO product:
export OMO_DISABLE_POSTHOG=1
```

See `/Users/yeongyu/local-workspaces/omodex/docs/legal/privacy-policy.md` for the full disclosure.

## Provenance

Vendored from [`code-yeongyu/codex-plugins`](https://github.com/code-yeongyu/codex-plugins) at the snapshot present in `/Users/yeongyu/local-workspaces/codex-plugins/` on 2026-05-25. Per-component upstream:

- [code-yeongyu/codex-rules](https://github.com/code-yeongyu/codex-rules)
- [code-yeongyu/codex-comment-checker](https://github.com/code-yeongyu/codex-comment-checker)
- [code-yeongyu/codex-lsp](https://github.com/code-yeongyu/codex-lsp)
- [code-yeongyu/codex-ultrawork](https://github.com/code-yeongyu/codex-ultrawork)
- [code-yeongyu/codex-ultragoal](https://github.com/code-yeongyu/codex-ultragoal)
