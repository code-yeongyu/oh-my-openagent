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
- `lsp`: registers direct LSP tools and optional post-edit diagnostics through the packaged shared LSP daemon runtime. The Senpi adapter owns only descriptors, schemas, renderers, path extraction, and project-config migration warnings.
- `task`: loads `omo.json` at register (`loadOmoConfig`, `src/components/task/index.ts`), composes the task engine over `@oh-my-opencode/senpi-task`, and registers the 4 task tools (`task`, `task_send`, `task_cancel`, `task_output`) plus the 7 lead-only team tools (`team_create`, `team_delete`, `task_create`, `task_get`, `task_list`, `task_update`, `team_wait`). Team sends are durable file-only writes. The adapter owns one 1-second lead poller per team led by the current session; process members load the scoped member extension and poll themselves with only `task_send` and `team_wait`. It wires the ordered session-start recovery chain (process reattach, member/lead reservation reclaim, failed-notification retry, owned-lead poll), transition suspension, shutdown teardown, a completion-message renderer, the `/tasks` and `/task-kill` slash commands, and the status-UI footer. Gated by the `--no-omo-task` flag and skipped when required ExtensionAPI capabilities are missing.

`packages/omo-opencode` is a separate build that still uses its prior task/team names; cross-edition parity is a deliberate follow-up outside this adapter.

Rules are intentionally not a Senpi component. Senpi has builtin rules, so this adapter must not add a `rules` component just to mirror Codex or OpenCode.

### Dependencies

The adapter depends on `@oh-my-opencode/senpi-task` (task engine + tool factories), `@oh-my-opencode/omo-config-core` (`loadOmoConfig` + `OmoConfigSource`), `@oh-my-opencode/delegate-core`, `@oh-my-opencode/team-core`, `@oh-my-opencode/comment-checker-core`, `@oh-my-opencode/telemetry-core`, `@oh-my-opencode/prompts-core`, `@oh-my-opencode/lsp-core`, `@code-yeongyu/lsp-daemon`, and `@oh-my-opencode/utils`, with `@code-yeongyu/senpi` as an optional peer (`package.json`).

### omo.json coexistence

When a project carries BOTH an opencode-family config and a `.omo/omo.json` (or `.jsonc`) that contributed to the loaded config, the task component emits a one-time `DUAL_CONFIG_WARNING` on first `session_start` (`src/components/task/coexistence.ts:6`): senpi reads `.omo/omo.json` only for categories and agents; the opencode config is ignored for tasks. There is no automatic migration between the two files today. Full schema and precedence reference: [`docs/reference/omo-json.md`](../../docs/reference/omo-json.md).

## Build And Packaging

Build outputs under `plugin/extensions/` and `plugin/skills/` are generated. Do not hand-edit them.

- `node packages/omo-senpi/plugin/scripts/build-extension.mjs` builds `plugin/extensions/omo.js`.
- `node packages/omo-senpi/plugin/scripts/build-extension.mjs --check` verifies the generated extension is current.
- `node packages/omo-senpi/plugin/scripts/sync-skills.mjs` syncs Senpi-ready skills into `plugin/skills/`.
- `node packages/omo-senpi/plugin/scripts/embed-directive.mjs --check` verifies the generated ultrawork directive is current.
- `bun run test:senpi` runs the package gate: build the shared daemon, stage the plugin artifacts, typecheck, then `bun test packages/omo-senpi`.

Peer-external build rule: the extension build must externalize the Senpi peer/import family so shared core packages stay harness-neutral and Senpi resolves those peers from the installed Senpi runtime. Keep `SENPI_LOADER_ALIASES` in `plugin/scripts/build-extension.mjs` aligned with `src/bundle-purity.test.ts`, including `@code-yeongyu/senpi`, `@earendil-works/pi-*`, and `@mariozechner/pi-*` imports. The current build also externalizes the TypeBox aliases required by Senpi's loader and Node builtins.

## QA

For adapter code changes, run the narrowest relevant unit tests plus the Senpi package gate:

```sh
tsgo --noEmit -p packages/omo-senpi/tsconfig.json
bun run test:senpi
```

Task live QA scripts:

```sh
node packages/omo-senpi/scripts/qa/drive.mjs --self-test
node packages/omo-senpi/scripts/qa/drive.mjs
node packages/omo-senpi/scripts/qa/probe-continuation.mjs
SENPI_BIN="$(command -v senpi)" node packages/omo-senpi/scripts/qa/task-e2e.mjs
SENPI_BIN="$(command -v senpi)" node packages/omo-senpi/scripts/qa/team-e2e.mjs
node packages/omo-senpi/scripts/qa/task-rpc-e2e.mjs --self-test
```

`drive.mjs` and the task/team live drivers create isolated Senpi agent directories and ignore caller `SENPI_CODING_AGENT_DIR`. If the Senpi binary is unavailable, the live drivers report `SKIP` or `FAIL` in final JSON instead of touching the real `~/.senpi/agent`.

Task-component QA in this package: `packages/omo-senpi/scripts/qa/task-13.test.ts` exercises the task engine wiring, `task-e2e.mjs` covers single and batch task lifecycles, `team-e2e.mjs` covers pull delivery, `team_wait`, shutdown-via-`task_send`, stale-reservation reclaim, and kill/restart exactly-once recovery, and `task-rpc-e2e.mjs --self-test` pins the RPC driver scripts. The `@oh-my-opencode/senpi-task` unit + chaos suites (`bun test packages/senpi-task`) cover the state machine, runners, and completion invariants. The task engine's own standalone manual drivers live under `packages/senpi-task/scripts/` (see [`packages/senpi-task/AGENTS.md`](../senpi-task/AGENTS.md)).

## Evidence Rules

Live Senpi QA evidence goes under `.omo/evidence/omo-senpi-adapter/`, one subdirectory per change or task. Record:

- what command or manual action was run;
- what behavior it was meant to prove;
- the observed result, including final JSON from the QA driver when present;
- isolation proof, especially the sandbox `SENPI_CODING_AGENT_DIR` and whether the real Senpi agent dir stayed untouched;
- omitted or redacted material, especially raw logs that could contain secrets.

Do not claim live Senpi QA from unit tests alone. `bun run test:senpi` is the package gate; the scripts in `scripts/qa/` are the real harness proof.
