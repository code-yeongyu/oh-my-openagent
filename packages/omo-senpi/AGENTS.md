# omo-senpi

Native Senpi TypeScript extension adapter for oh-my-openagent.

This package is adapter-only. It may depend on harness-neutral core packages plus the Senpi-coupled `@oh-my-opencode/senpi-task` engine, but those packages must not import Senpi, Pi packages, or this adapter through their harness-neutral entrypoints. The Senpi runtime boundary stays here.

## Anatomy

| Path | Purpose |
|------|---------|
| `package.json` | Private workspace package `@oh-my-opencode/omo-senpi`; exports the adapter, extension, and local installer entrypoints. |
| `src/extension/` | Senpi ExtensionAPI composition layer. It validates the required API surface, registers global and per-component disable flags, and wires components defensively. |
| `src/components/` | Six live components: `ultrawork`, `ulw-loop`, `comment-checker`, `telemetry`, `lsp`, and `task`. |
| `src/install/` | Local Senpi installer and uninstaller helpers. They add or remove the absolute plugin path in `SENPI_CODING_AGENT_DIR` or `~/.senpi/agent` settings. |
| `scripts/qa/` | Live Senpi QA drivers, continuation probe, and mock provider used by task 13 validation. |
| `plugin/` | The single Pi package `@code-yeongyu/omo-senpi`. It contains generated `extensions/omo.js`, generated skills, package metadata, and plugin-local build scripts. |

The v1 install surface is local-path only. Install the built Pi package from `packages/omo-senpi/plugin`; do not document npm, git, or marketplace distribution for this adapter until that exists in code.

## Components

- `ultrawork`: injects the Senpi ultrawork directive on matching input, backed by `src/components/ultrawork/generated-directive.ts`.
- `ulw-loop`: detects active `omo ulw-loop` state and injects continuation guidance when the cwd has an incomplete run.
- `comment-checker`: runs the shared comment-checker flow after write-like tool results when a resolver finds the binary.
- `telemetry`: sends the anonymous once-per-UTC-day `omo_senpi_daily_active` event, with product-specific opt-outs.
- `lsp`: registers direct LSP tools and optional post-edit diagnostics using the vendored Senpi LSP client adaptation.
- `task`: loads `omo.json` at register (`loadOmoConfig`, `src/components/task/index.ts:57`), composes the task engine over `@oh-my-opencode/senpi-task`, and registers the 7 task tools (`task`, `task_send`, `task_wait`, `task_interrupt`, `task_cancel`, `task_list`, `task_output`, `index.ts:106`) plus the 12 lead-only team tools (`buildLeadTeamTools`, `index.ts:122`). It wires the session lifecycle (`session_start` reconcile + buffer flush, `session_before_switch`/`before_compact` transition marking, `session_shutdown` teardown, `model_select` registry refresh, `index.ts:151`), a completion-message renderer, the `/tasks` and `/task-kill` slash commands (`src/components/task/commands.ts:30`), and the status-UI footer. Gated by the `--no-omo-task` flag and skipped when required ExtensionAPI capabilities are missing (`index.ts:45`).

Rules are intentionally not a Senpi component. Senpi has builtin rules, so this adapter must not add a `rules` component just to mirror Codex or OpenCode.

### Dependencies

The adapter depends on `@oh-my-opencode/senpi-task` (task engine + tool factories), `@oh-my-opencode/omo-config-core` (`loadOmoConfig` + `OmoConfigSource`), `@oh-my-opencode/delegate-core`, `@oh-my-opencode/team-core`, `@oh-my-opencode/comment-checker-core`, `@oh-my-opencode/telemetry-core`, `@oh-my-opencode/prompts-core`, `@oh-my-opencode/utils`, and `vscode-jsonrpc`, with `@code-yeongyu/senpi` as an optional peer (`package.json`).

### omo.json coexistence

When a project carries BOTH an opencode-family config and a `.omo/omo.json` (or `.jsonc`) that contributed to the loaded config, the task component emits a one-time `DUAL_CONFIG_WARNING` on first `session_start` (`src/components/task/coexistence.ts:6`): senpi reads `.omo/omo.json` only for categories and agents; the opencode config is ignored for tasks. There is no automatic migration between the two files today. Full schema and precedence reference: [`docs/reference/omo-json.md`](../../docs/reference/omo-json.md).

## Build And Packaging

Build outputs under `plugin/extensions/` and `plugin/skills/` are generated. Do not hand-edit them.

- `node packages/omo-senpi/plugin/scripts/build-extension.mjs` builds `plugin/extensions/omo.js`.
- `node packages/omo-senpi/plugin/scripts/build-extension.mjs --check` verifies the generated extension is current.
- `node packages/omo-senpi/plugin/scripts/sync-skills.mjs` syncs Senpi-ready skills into `plugin/skills/`.
- `node packages/omo-senpi/plugin/scripts/embed-directive.mjs --check` verifies the generated ultrawork directive is current.
- `bun run test:senpi` runs the package gate: build extension, sync skills, directive check, then `bun test packages/omo-senpi`.

Peer-external build rule: the extension build must externalize the Senpi peer/import family so shared core packages stay harness-neutral and Senpi resolves those peers from the installed Senpi runtime. Keep `SENPI_LOADER_ALIASES` in `plugin/scripts/build-extension.mjs` aligned with `src/bundle-purity.test.ts`, including `@code-yeongyu/senpi`, `@earendil-works/pi-*`, and `@mariozechner/pi-*` imports. The current build also externalizes the TypeBox aliases required by Senpi's loader and Node builtins.

## QA

For adapter code changes, run the narrowest relevant unit tests plus the Senpi package gate:

```sh
tsgo --noEmit -p packages/omo-senpi/tsconfig.json
bun run test:senpi
```

Task 13 live QA scripts:

```sh
node packages/omo-senpi/scripts/qa/drive.mjs --self-test
node packages/omo-senpi/scripts/qa/drive.mjs
node packages/omo-senpi/scripts/qa/probe-continuation.mjs
```

`drive.mjs` creates an isolated Senpi agent directory and ignores caller `SENPI_CODING_AGENT_DIR`. If the Senpi binary is unavailable, the live driver reports `SKIP` or `FAIL` in its final JSON instead of touching the real `~/.senpi/agent`.

Task-component QA in this package: `packages/omo-senpi/scripts/qa/task-13.test.ts` exercises the task engine wiring, and the `@oh-my-opencode/senpi-task` unit + chaos suites (`bun test packages/senpi-task`) cover the state machine, runners, and completion invariants. The task engine's own standalone manual drivers live under `packages/senpi-task/scripts/` (see [`packages/senpi-task/AGENTS.md`](../senpi-task/AGENTS.md)).

## Evidence Rules

Live Senpi QA evidence goes under `.omo/evidence/omo-senpi-adapter/`, one subdirectory per change or task. Record:

- what command or manual action was run;
- what behavior it was meant to prove;
- the observed result, including final JSON from the QA driver when present;
- isolation proof, especially the sandbox `SENPI_CODING_AGENT_DIR` and whether the real Senpi agent dir stayed untouched;
- omitted or redacted material, especially raw logs that could contain secrets.

Do not claim live Senpi QA from unit tests alone. `bun run test:senpi` is the package gate; the scripts in `scripts/qa/` are the real harness proof.

## Follow-ups

- Dedicated live end-to-end drivers for the task component (in-process spawn/steer/wait, RPC process kill+reconcile, and full named-team lifecycle) are delivered by the W4 QA todos of the senpi-task plan and are not present in this package tree yet. Until they land, task-component live proof runs through `scripts/qa/drive.mjs` plus the `senpi-task` suites; do not cite driver paths that do not exist.
