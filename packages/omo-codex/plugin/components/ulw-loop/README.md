# codex-ulw-loop

[![ci](https://img.shields.io/badge/ci-pending-lightgrey.svg)](#) [![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Codex plugin component for durable repo-native multi-goal orchestration with embedded success criteria and observable evidence audit. State lives under `.omo/ulw-loop/` and is mutated through the `omo ulw-loop` CLI.

## CLI

Every subcommand below is implemented. Pass `--json` where supported for machine-readable output, and pass `--session-id <id>` or set `OMO_ULW_LOOP_SESSION_ID` to scope state to a parallel session.

| Subcommand | Purpose |
|------------|---------|
| `omo ulw-loop help` | Print CLI usage. |
| `omo ulw-loop create-goals` | Create repo-native goals and seed success criteria from a brief. |
| `omo ulw-loop status` | Report active goal, criteria, and evidence state. |
| `omo ulw-loop complete-goals` | Start or resume the next eligible goal, or report aggregate completion / blocked handoff. |
| `omo ulw-loop checkpoint` | Gate a goal transition with evidence; final completion requires a complete Codex goal snapshot and a passing quality gate. |
| `omo ulw-loop steer` | Apply a steering mutation proposal to the plan. |
| `omo ulw-loop add-goal` | Append a goal to the active plan. |
| `omo ulw-loop criteria` | Inspect one goal's success criteria. |
| `omo ulw-loop record-evidence` | Record observable evidence for one criterion. |
| `omo ulw-loop record-review-blockers` | Mark a goal as review-blocked and add follow-up work from final-review findings. |

The final quality gate parsed by `checkpoint` validates `codeReview`, `manualQa`, `gateReview`, `iteration`, and `criteriaCoverage`. `criteriaCoverage` records the original intent, desired outcome, user-facing outcome review, pass counts, and covered adversarial classes.

## Codex Plugin

This directory is a component of the aggregate `@sisyphuslabs/omo-codex-plugin` root. Plugin discovery (`.codex-plugin/plugin.json`) is owned by that aggregate root, not by this component. The component ships:

- `hooks/hooks.json` registering two hooks:
  - `UserPromptSubmit` -> `node "${PLUGIN_ROOT}/dist/cli.js" hook user-prompt-submit --with-ultrawork`
  - `PreToolUse` matching `^create_goal$` -> `node "${PLUGIN_ROOT}/dist/cli.js" hook pre-tool-use`
- `skills/ulw-loop/` for the bundled `ulw-loop` skill.
- `bin.omo-ulw-loop` -> `dist/cli.js` for standalone CLI invocation.

This component ships a CLI, a skill, and hooks. It does not expose an MCP server.

## Local Development

```bash
npm install
npm test
npm run typecheck
npm run check
npm pack --dry-run
```

`npm test` runs Vitest, `npm run typecheck` runs `tsc --noEmit`, and `npm run check` runs typecheck, Biome, and the build.

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

This component runs locally and does not call a network service by itself.

## License

[MIT](LICENSE).

## Related

- [lazycodex](https://github.com/code-yeongyu/lazycodex) - Sisyphus Labs Codex marketplace repository.
- [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) - the monorepo this component is developed in.
