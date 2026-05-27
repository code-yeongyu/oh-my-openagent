# Sisyphus Labs Codex Marketplace

Native Codex marketplace for the `omo` plugin.

## Plugin

`omo` is one Codex plugin namespace with isolated internal components:

- `components/comment-checker`: runs comment-checker automatically after successful `apply_patch` edits.
- `components/rules`: injects local project rule files into Codex context through lifecycle hooks.
- `components/lsp`: exposes Language Server Protocol diagnostics, navigation, symbols, and rename tools through MCP and post-edit hooks.
- `components/ultrawork`: injects the ultrawork orchestration directive when a user prompt contains `ultrawork` or `ulw`.
- `components/ultragoal`: durable repo-native multi-goal orchestration with embedded success criteria and observable evidence audit (`.omo/ultragoal/`).

## Install

```bash
bunx lazycodex install
```

The installer builds `omo`, copies a clean versioned cache entry into `~/.codex/plugins/cache/sisyphuslabs/omo`, installs runtime dependencies in the cache, registers the `sisyphuslabs` marketplace from `https://github.com/code-yeongyu/lazycodex.git`, and enables `[plugins."omo@sisyphuslabs"]` in `~/.codex/config.toml`.
It also enables both `plugins = true` and `plugin_hooks = true` under `[features]` so bundled hook files run.

If your local Codex build exposes plugin install commands, you can use those instead. For older local builds, the installer replaces the manual copy fallback:

```text
~/.codex/plugins/cache/sisyphuslabs/omo/0.1.0
```
