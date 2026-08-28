# Sisyphus Labs Codex Marketplace

Native Codex marketplace for the `omo` plugin.

## Plugin

`omo` is one Codex plugin namespace with isolated internal components:

- `components/comment-checker`: runs comment-checker automatically after successful `apply_patch` edits.
- `components/git-bash`: exposes the Windows Git Bash MCP and reminds Codex before shell-like calls.
- `components/rules`: injects local project rule files into Codex context through lifecycle hooks.
- `components/lsp`: exposes Language Server Protocol diagnostics, navigation, symbols, and rename tools through MCP and post-edit hooks.
- `components/ultrawork`: injects the ultrawork orchestration directive when a user prompt contains `ultrawork` or `ulw`.
- `components/ulw-loop`: durable repo-native multi-goal orchestration with embedded success criteria and observable evidence audit (`.omo/ulw-loop/`).
- `components/ulw-execute-continuation`: resumes `.omo/boulder.json` ulw-execute plans from stop boundaries.
- `components/telemetry`: emits anonymous daily active telemetry when enabled.

## Install

```bash
npx lazycodex-ai install
```

The installer builds `omo`, copies a clean versioned cache entry into `~/.codex/plugins/cache/sisyphuslabs/omo`, installs runtime dependencies in the cache, writes a local marketplace snapshot under `~/.codex/.tmp/marketplaces/sisyphuslabs/plugins/omo`, copies bundled-agent TOMLs into `~/.codex/agents/`, registers the `sisyphuslabs` marketplace from the local built cache, enables `[plugins."omo@sisyphuslabs"]`, and registers `[model_providers.atlascloud]` in `~/.codex/config.toml`.
It also enables both `plugins = true` and `plugin_hooks = true` under `[features]` so bundled hook files run.

### Atlas Cloud

The managed provider uses `https://api.atlascloud.ai/v1`, reads its key from `ATLASCLOUD_API_KEY`, and uses the Codex Responses wire API. The installer does not persist a key or change the default model/provider. To select it explicitly:

```bash
export ATLASCLOUD_API_KEY="your-api-key"
npx lazycodex-ai install
codex -m moonshotai/kimi-k3 -c 'model_provider="atlascloud"'
```

An existing user-owned `atlascloud` section is preserved. Uninstall removes only an unchanged canonical installer-managed section.

If your local Codex build exposes plugin install commands, you can use those instead. For older local builds, the installer replaces the manual copy fallback:

```text
~/.codex/plugins/cache/sisyphuslabs/omo/0.1.0
```
