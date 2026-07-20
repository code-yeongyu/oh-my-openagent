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

## Resume Snapshots

`ulw-loop` writes a bounded resume snapshot at `.omo/ulw-loop/<session-id>/snapshots/latest.md` for session-scoped runs and `.omo/ulw-loop/snapshots/latest.md` for unscoped runs. The snapshot exists so a fresh Codex turn can resume the next `ulw-loop` action without rereading the prior transcript.

The snapshot is a summary, not a transcript store. It includes the active goal, criteria status, short evidence excerpts, changed-file summaries, and a single next action. Raw ledger JSON, captured evidence fields, file contents, patches, diffs, and raw transcripts are intentionally omitted. Snapshot text is redacted and size-bounded before writing, so secret-like strings and prompt-injection text should not be used as resume context.

Snapshot lookup is local and narrow: readers only trust `latest.md` inside the active workspace and, for session-scoped runs, under the matching session id. If a snapshot is missing, malformed, too large, outside the workspace, or contains unsafe text, resume code must fall back to the normal plan and Boulder state rather than treating it as authoritative.

The snapshot complements `codex resume`; it does not replace Codex's transcript restoration. `codex resume` can restore conversation history, while `latest.md` provides a minimal repo-native handoff for deciding the next `ulw-loop` action when transcript context is unavailable or intentionally discarded.

## Codex Plugin

This directory is a component of the aggregate `@sisyphuslabs/omo-codex-plugin` root. Plugin discovery (`.codex-plugin/plugin.json`) is owned by that aggregate root, not by this component. The component ships:

- `hooks/hooks.json` registering four hooks:
  - `UserPromptSubmit` -> `node "${PLUGIN_ROOT}/dist/cli.js" hook user-prompt-submit --with-ultrawork`
  - `PreToolUse` matching `^create_goal$` -> `node "${PLUGIN_ROOT}/dist/cli.js" hook pre-tool-use`
  - `PreToolUse` matching the spawn tool tokens -> `node "${PLUGIN_ROOT}/dist/cli.js" hook pre-tool-use-spawn` (fan-out cap + gate-artifact preflight)
  - `Stop` -> `node "${PLUGIN_ROOT}/dist/cli.js" hook stop` (auto-resume with a two-strike no-progress cap)
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
