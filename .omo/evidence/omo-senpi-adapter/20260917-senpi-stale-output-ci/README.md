# 20260917-senpi-stale-output-ci

Fix CI `senpi-compatibility (ubuntu-latest)` on
`fix/validation-diagnostic-names-unknown-keys` at parent PR
https://github.com/code-yeongyu/oh-my-openagent/pull/8206.

## WHAT WAS TESTED

- Reproduced the CI gate locally with the same toolchain CI uses:
  Node 24.21.0 + Bun 1.4.2 after `bun install --frozen-lockfile --ignore-scripts`.
- Confirmed the failing command before regenerate:
  `node packages/omo-senpi/plugin/scripts/build-extension.mjs --check`
  exited 1 with `stale-output` on
  `packages/omo-senpi/plugin/runtime/agent-toolkit-sdk/sdk.js`.
- Regenerated committed Senpi artifacts without local runtime dists:
  - `node packages/omo-senpi/plugin/scripts/build-extension.mjs`
  - `node packages/omo-senpi/plugin/scripts/build-install.mjs`
- Re-ran both freshness gates with `packages/lsp-daemon/dist` and
  `packages/ast-grep-mcp/dist` absent (hidden if a later unit test built them):
  - `node packages/omo-senpi/plugin/scripts/build-extension.mjs --check`
  - `node packages/omo-senpi/plugin/scripts/build-install.mjs --check`
- Preserved unknown-keys diagnostic behavior:
  `bun test packages/omo-config-core/src/loader/unknown-keys.test.ts`
  and the full `packages/omo-config-core/src/` suite.
- Typecheck: `bunx tsgo --noEmit -p packages/omo-senpi/tsconfig.json` and
  `packages/omo-config-core/tsconfig.json`.
- Senpi QA driver self-test: `node packages/omo-senpi/scripts/qa/drive.mjs --self-test`.

## WHAT WAS OBSERVED

- Before rebuild, `--check` on Node 24 with no runtime dists failed exactly as
  CI: `omo-senpi extension build is not current: stale-output` /
  `output=.../plugin/runtime/agent-toolkit-sdk/sdk.js`.
- After rebuild, both `--check` commands exit 0:
  `omo-senpi extension build is current` and `omo-senpi installer is current`.
- Bundle diffs are marker/digest lines only (6 files, 6 insertions / 6 deletions).
  `install.mjs` was already current and did not change.
- `unknown-keys.test.ts`: 6 pass, including `#then the diagnostic names both`.
- `packages/omo-config-core/src/`: 226 pass / 0 fail / 34 files.
- `tsgo` for `omo-senpi` and `omo-config-core`: exit 0.
- `drive.mjs --self-test`: `SELF-TEST OK`.
- `senpi` binary is absent, so live harness QA is SKIP, not a pass.
- Real `~/.senpi/agent` does not exist. Real `~/.omo/agent` does not exist.

Artifacts:

- `ci-equivalent-check.log`
- `unknown-keys-tests.log`
- `drive-self-test.log`
- `isolation.txt`
- `changed-files.txt`
- `pre-commit-tip.txt`

## WHY IT IS ENOUGH

ubuntu-latest `senpi-compatibility` runs `--check` on Node 24 after
`--ignore-scripts`, before lsp-daemon/ast-grep dists exist. Regenerating the
committed artifacts in that same shape is the gate that failed. macos/windows
do not run `--check`. Unknown-keys tests prove the diagnostic still names
unrecognized keys.

## WHAT WAS OMITTED

- Live `senpi` session: binary absent, recorded as SKIP.
- Full `bun run test:senpi` (builds lsp-daemon + ast-grep + full adapter suite).
  Hermetic coverage here is config-core + typecheck + `--check`.
- Raw env dumps, tokens, and auth headers: none captured.

## Residual risk

- `--check` hashes include `node:module.builtinModules` from the Node that
  runs the script. This rebuild used Node 24 on linux/amd64, matching the
  ubuntu-latest gate. A later local `--check` on Node 22 can fail even when
  CI is green.
- A later local `--check` can fail if `packages/lsp-daemon/dist` exists but
  the plugin runtime is not staged. CI installs with `--ignore-scripts` and
  runs `--check` before those dists exist.
