# codex-plugins

Local marketplace for the `omo` Codex plugin components ported from `../pi-extensions`.

## Plugin

`omo` is one Codex plugin namespace with isolated internal components:

- `components/comment-checker`: runs comment-checker automatically after successful `apply_patch` edits.
- `components/rules`: injects local project rule files into Codex context through lifecycle hooks.
- `components/lsp`: exposes Language Server Protocol diagnostics, navigation, symbols, and rename tools through MCP and post-edit hooks.
- `components/ultrawork`: injects the ultrawork orchestration directive when a user prompt contains `ultrawork` or `ulw`.
- `components/ultragoal`: durable repo-native multi-goal orchestration with embedded success criteria and observable evidence audit (`.omo/ultragoal/`).

## Local Install

```bash
codex plugin marketplace add /Users/yeongyu/local-workspaces/codex-plugins
node /Users/yeongyu/local-workspaces/codex-plugins/scripts/install-local.mjs /Users/yeongyu/local-workspaces/codex-plugins
```

The installer builds `omo`, copies a clean versioned cache entry into `~/.codex/plugins/cache/code-yeongyu-codex-plugins/omo`, installs runtime dependencies in the cache, prunes stale split-plugin cache/config entries, and enables `[plugins."omo@code-yeongyu-codex-plugins"]` in `~/.codex/config.toml`.
It also enables both `plugins = true` and `plugin_hooks = true` under `[features]` so bundled hook files run.

If your local Codex build exposes plugin install commands, you can use those instead. For older local builds, the installer replaces the manual copy fallback:

```text
~/.codex/plugins/cache/code-yeongyu-codex-plugins/omo/0.1.0
```
