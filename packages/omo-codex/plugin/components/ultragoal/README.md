# codex-ultragoal

[![ci](https://img.shields.io/badge/ci-pending-lightgrey.svg)](#) [![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Codex plugin scaffold for durable repo-native multi-goal orchestration with embedded success criteria and observable evidence audit.

## Behavior

| Subcommand | Purpose |
|------------|---------|
| `omo ultragoal create-goals` | Create repo-native goals from a brief and seed criteria. |
| `omo ultragoal record-evidence` | Record observable evidence for the active criterion. |
| `omo ultragoal criteria` | Inspect or revise goal success criteria. |
| `omo ultragoal complete-goals` | Complete eligible goals after criteria pass. |
| `omo ultragoal checkpoint` | Refuse completion until criteria and evidence gates pass. |
| `omo ultragoal steer` | Apply steering updates to the plan. |
| `omo ultragoal status` | Report active goal, criteria, and evidence state. |

Wave 1 is scaffold only. Command behavior lands in later waves.

## Codex Plugin

The plugin ships:

- `.codex-plugin/plugin.json` for Codex plugin discovery.
- `hooks/hooks.json` for the `UserPromptSubmit` hook.
- `skills/ultragoal/` as the future skill directory.

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
bunx lazycodex install
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

- [oh-my-codex](https://github.com/code-yeongyu/oh-my-codex) - source project for the ultragoal port.
- [lazycodex](https://github.com/code-yeongyu/lazycodex) - Sisyphus Labs Codex marketplace repository.
