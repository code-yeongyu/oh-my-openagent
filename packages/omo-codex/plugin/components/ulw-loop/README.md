---

# codex-ulw-loop

[![ci](https://img.shields.io/badge/ci-pending-lightgrey.svg)](#) [![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Codex plugin component for durable repo-native multi-goal orchestration with embedded success criteria and observable evidence audit. State lives under `.omo/ulw-loop/` and is mutated only through the `omo ulw-loop` CLI; never hand-edit the goal store.

## CLI

Every subcommand below is implemented. Pass `--json` to any subcommand for machine-readable output, and `--session-id <id>` (or the `OMO_ULW_LOOP_SESSION_ID` env var) to scope state to a parallel session.

| Subcommand | Purpose |
|------------|---------|
| `omo ulw-loop create-goals` | Create repo-native goals and seed success criteria from a brief (`--brief`, `--brief-file`, `--from-stdin`, or positional text). |
| `omo ulw-loop status` | Report the active goal, success criteria, and evidence state. |
| `omo ulw-loop complete-goals` | Start or resume the next eligible goal, or report aggregate completion / a blocked-decision handoff. |
| `omo ulw-loop add-goal` | Append a goal (`--title`, `--objective`) to the active plan. |
| `omo ulw-loop criteria` | Inspect a goal's success criteria (`--goal-id`). |
| `omo ulw-loop record-evidence` | Record observable evidence for one criterion (`--goal-id`, `--criterion-id`, `--status` of `pass`/`fail`/`blocked`, `--evidence`). |
| `omo ulw-loop checkpoint` | Gate a goal transition (`--goal-id`, `--status`, `--evidence`); final completion requires `--codex-goal-json` and a passing `--quality-gate-json`. |
| `omo ulw-loop steer` | Apply a steering mutation proposal to the plan. |
| `omo ulw-loop record-review-blockers` | Mark a goal `review_blocked` from final-review findings and add a follow-up goal. |
| `omo ulw-loop help` | Print CLI usage. |

The quality gate parsed by `checkpoint` validates `aiSlopCleaner`, `verification`, `codeReview`, and `criteriaCoverage` (see `UlwLoopQualityGate` in `src/domain-types.ts`).

## Codex Plugin

This directory is a component of the aggregate `@sisyphuslabs/omo-codex-plugin` root. Plugin discovery (`.codex-plugin/plugin.json`) is owned by that aggregate root, not by this component. The component ships:

- `hooks/hooks.json` registering two hooks:
  - `UserPromptSubmit` → `node "${PLUGIN_ROOT}/dist/cli.js" hook user-prompt-submit` (checks ulw-loop steering).
  - `PreToolUse` matching `^create_goal$` → `node "${PLUGIN_ROOT}/dist/cli.js" hook pre-tool-use` (enforces the unlimited ulw-loop goal budget).
- `skills/ulw-loop/` — the `ulw-loop` skill (`SKILL.md`, `agents/openai.yaml`, `references/full-workflow.md`).
- `bin.omo-ulw-loop` → `dist/cli.js` for standalone CLI invocation.

This component ships a CLI, a skill, and hooks. It does not expose an MCP server.

## Local Development

```bash
npm install
npm test
npm run typecheck
npm run check
npm pack --dry-run
```

`npm test` runs Vitest, `npm run typecheck` runs `tsc --noEmit`, and `npm run check` runs typecheck + Biome + build.

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
