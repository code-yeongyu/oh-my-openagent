# omo-senpi local-path dependency resolution QA

## What was tested

1. The report's direct Node ESM resolution scenario from `packages/omo-senpi/plugin/extensions`.
2. A focused Bun regression that resolves the generated extension's surviving `typebox` and `@earendil-works/pi-tui` imports from the extension real path.
3. The real Senpi 2026.7.23 CLI through `packages/omo-senpi/scripts/qa/ulw-prompts-e2e.mjs` with its local mock model and isolated `SENPI_CODING_AGENT_DIR`.
4. An isolated Senpi startup with the generated extension and a before/after hash of the real `~/.senpi/agent/settings.json`.
5. OMP 17.0.7 interactive startup with an isolated `PI_CODING_AGENT_DIR` and `--plugin-dir packages/omo-senpi/plugin`.
6. The full `bun run test:senpi` gate, package typecheck, focused package tests, and generated-extension freshness check.

## What was observed

- Before the fix, Node failed from the extension real path with `ERR_MODULE_NOT_FOUND: Cannot find package 'typebox'`.
- Before the production edit, `runtime-dependency-resolution.test.ts` failed because `@earendil-works/pi-tui` could not be resolved from `plugin/extensions/omo.js`.
- After declaring both generated-runtime dependencies on the owning `@oh-my-opencode/omo-senpi` workspace, the focused test passed and direct Node imports printed `typebox_kind=object` and `pi_tui=resolved`.
- The final regression derives every surviving non-node static import from the generated bundle, verifies each is declared as a dependency or peer, constructs a temporary checkout plus host `node_modules`, symlinks the plugin into the host, exposes only non-peer runtime dependencies from the real path, imports them through the symlink, and removes the temporary tree in `afterEach`.
- Mutation proof moved both packages from `dependencies` to `devDependencies` while leaving installed modules present; the test still failed and named both imports, proving development installs and unrelated hoisting cannot satisfy runtime ownership.
- The targeted Senpi driver returned `PASS`, `ultraworkInjected: true`, no missing directive markers, and no forbidden markers.
- The isolated Senpi startup exited 0 and the real settings SHA-256 was unchanged.
- OMP reached its interactive `Welcome back!` screen on branch `fix/omo-senpi-typebox-symlink` and exited 0 without a `Failed to load extension`, `typebox`, or `@earendil-works/pi-tui` warning.
- `bun run test:senpi` passed 320 tests across 59 files.

## Why this is enough

The RED proof exercises the exact symlink-realpath resolution boundary in the report. The final GREEN regression builds an isolated symlink topology and executes a Node import through it instead of relying on the repository's root dependency tree. Its mutation proof demonstrates that `devDependencies` and unrelated installed modules cannot mask missing runtime ownership. The Senpi and OMP runs cover both user-facing hosts with the real CLIs, while the mock provider avoids external model calls. The package gate and extension freshness check cover the generated artifact and adjacent adapter behavior.

## What was omitted

- Raw `~/.senpi` logs, sessions, auth files, and environment dumps were not captured because they may contain credentials or private prompts.
- `drive.mjs` returned an unrelated `commentChecker: FAIL`; the targeted `ulw-prompts-e2e.mjs` driver passed. Its whole-directory `realSenpiUntouched` field was false because this active Senpi coding session writes its own session state concurrently, so isolation was instead proven with an exact before/after hash of `settings.json`.

## Cleanup receipts

- Removed `/tmp/omo-senpi-omp-red.UXBJvA`; PTY `bash_55` exited 0.
- `drive.mjs` removed sandbox `omo-senpi-qa-awanGT`.
- `ulw-prompts-e2e.mjs` removed sandbox `omo-senpi-qa-Nt9z2O`.
- Removed `/tmp/omo-senpi-omp-green-agent`; PTY `bash_86` exited 0.
- Removed `/tmp/omo-senpi-senpi-green.A6OnJG`.
