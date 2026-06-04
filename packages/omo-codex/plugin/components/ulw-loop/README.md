# codex-ulw-loop

[![ci](https://img.shields.io/badge/ci-pending-lightgrey.svg)](#) [![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Codex plugin scaffold for durable repo-native multi-goal orchestration with embedded success criteria and observable evidence audit.

## Behavior

| Subcommand | Purpose |
|------------|---------|
| `omo ulw-loop create-goals` | Create repo-native goals from a brief and seed criteria. |
| `omo ulw-loop record-evidence` | Record observable evidence for the active criterion. |
| `omo ulw-loop criteria` | Inspect or revise goal success criteria. |
| `omo ulw-loop complete-goals` | Complete eligible goals after criteria pass. |
| `omo ulw-loop checkpoint` | Refuse completion until criteria and evidence gates pass. |
| `omo ulw-loop steer` | Apply steering updates to the plan. |
| `omo ulw-loop status` | Report active goal, criteria, and evidence state. |

Wave 1 is scaffold only. Command behavior lands in later waves.

## Codex Plugin

The plugin ships:

- `.codex-plugin/plugin.json` for Codex plugin discovery.
- `hooks/hooks.json` for the `UserPromptSubmit` hook.
- `skills/ulw-loop/` as the future skill directory.

The hook command is:

```bash
node "${PLUGIN_ROOT}/dist/cli.js" hook user-prompt-submit
```

No MCP server or Codex tool is exposed in this scaffold.

## Local Development

```bash
npm install
npm test
npm run typecheck
npm run check
npm pack --dry-run
```

## Local Codex Installation

```bash
npx lazycodex-ai install
```

The installer builds and copies the plugin into `~/.codex/plugins/cache/sisyphuslabs/omo/0.1.0`, registers the `sisyphuslabs` marketplace from the `lazycodex` Git repository, installs runtime dependencies there, and enables:

```toml
[features]
plugins = true
plugin_hooks = true

[plugins."omo@sisyphuslabs"]
enabled = true
```

## Privacy

This plugin runs locally. The scaffold does not call a network service by itself.

## License

[MIT](LICENSE).

## Related

- [lazycodex](https://github.com/code-yeongyu/lazycodex) - Sisyphus Labs Codex marketplace repository.
