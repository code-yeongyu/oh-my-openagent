# 20260917-validation-diagnostic-bundle

CI fix for parent PR https://github.com/code-yeongyu/oh-my-openagent/pull/8206.

## WHAT WAS TESTED

- Rebased unique commit `e6d020f12` onto parent default `dev` (`parent/dev` at `ceb3cce0b`). Parent has no `main`.
- Regenerated Senpi plugin artifacts with the same scripts CI uses:
  - `node packages/omo-senpi/plugin/scripts/build-extension.mjs`
  - `node packages/omo-senpi/plugin/scripts/build-install.mjs`
- Re-ran the CI freshness gate:
  - `node packages/omo-senpi/plugin/scripts/build-extension.mjs --check`
  - `node packages/omo-senpi/plugin/scripts/build-install.mjs --check`
- Kept the PR intent: `bun test packages/omo-config-core/src/loader/unknown-keys.test.ts` and the full `packages/omo-config-core/src/` suite.
- Senpi package typecheck: `bunx tsgo --noEmit -p packages/omo-senpi/tsconfig.json`
- Senpi QA driver self-test: `node packages/omo-senpi/scripts/qa/drive.mjs --self-test`
- Isolation: real `~/.senpi/agent` and `~/.omo/agent` paths recorded.

## WHAT WAS OBSERVED

- Before rebuild, `--check` reported `stale-output` (first mismatch `plugin/runtime/agent-toolkit-sdk/sdk.js`; `omo.js` is also rebuilt because `omo-config-core` is inlined).
- After rebuild, CI-equivalent `--check` reports `omo-senpi extension build is current` and `omo-senpi installer is current`.
- `unknown-keys.test.ts`: 6 pass, including `#then the diagnostic names both` (names `codegraph` and `agents.x.models`).
- `packages/omo-config-core/src/`: 226 pass / 0 fail / 34 files.
- `tsgo` for `omo-config-core` and `omo-senpi`: exit 0.
- `drive.mjs --self-test`: `SELF-TEST OK`.
- `senpi` binary is absent, so live harness QA is SKIP, not a pass.
- Real `~/.senpi/agent` does not exist. Real `~/.omo/agent` does not exist. Nothing attributed to a real Senpi home.

Artifacts:

- `ci-equivalent-check.log`
- `ci-check.log` (later local run failed only after test-setup built `packages/lsp-daemon/dist`; that is not the CI path)
- `omo-config-core-tests.log`
- `drive-self-test.json`
- `isolation.txt`
- `changed-files.txt`
- `unique-commits.txt`
- `tip-sha.txt`

## WHY IT IS ENOUGH

The failing CI job is a byte-freshness gate over committed Senpi plugin artifacts. Regenerating those artifacts on linux/amd64 and passing the same `--check` commands is the gate that failed. Config-core tests prove the diagnostic still names unrecognized keys. Bundle rebuild does not change schema or loader control flow beyond inlining that message.

## WHAT WAS OMITTED

- Live `senpi` session: binary absent, recorded as SKIP.
- Full `bun run test:senpi` (builds lsp-daemon + ast-grep + full adapter suite). Hermetic unit coverage here is config-core + typecheck + `--check`.
- Raw env dumps, tokens, and auth headers: none captured.

## Residual risk

- `--check` hashes are platform-sensitive; this rebuild is linux/amd64, matching `senpi-compatibility (ubuntu-latest)`.
- A later local `--check` can fail if `packages/lsp-daemon/dist` exists but the plugin runtime is not staged. CI installs with `--ignore-scripts` and runs `--check` before those dists exist.
