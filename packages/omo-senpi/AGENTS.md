# omo-senpi

Native Senpi TypeScript extension adapter for oh-my-openagent.

This package is adapter-only. It may depend on harness-neutral core packages, but core packages must not import Senpi, Pi packages, or this adapter. The Senpi runtime boundary stays here.

## Anatomy

| Path | Purpose |
|------|---------|
| `package.json` | Private workspace package `@oh-my-opencode/omo-senpi`; exports the adapter, extension, and local installer entrypoints. |
| `src/extension/` | Senpi ExtensionAPI composition layer. It validates the required API surface, registers global and per-component disable flags, and wires components defensively. |
| `src/components/` | Five live components: `ultrawork`, `ulw-loop`, `comment-checker`, `telemetry`, and `lsp`. |
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

Rules are intentionally not a Senpi component. Senpi has builtin rules, so this adapter must not add a `rules` component just to mirror Codex or OpenCode.

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

## Evidence Rules

Live Senpi QA evidence goes under `.omo/evidence/omo-senpi-adapter/`, one subdirectory per change or task. Record:

- what command or manual action was run;
- what behavior it was meant to prove;
- the observed result, including final JSON from the QA driver when present;
- isolation proof, especially the sandbox `SENPI_CODING_AGENT_DIR` and whether the real Senpi agent dir stayed untouched;
- omitted or redacted material, especially raw logs that could contain secrets.

Do not claim live Senpi QA from unit tests alone. `bun run test:senpi` is the package gate; the scripts in `scripts/qa/` are the real harness proof.
