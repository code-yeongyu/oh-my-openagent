# 20260917-validation-diagnostic-rebase-dev

Rebase of `fix/validation-diagnostic-names-unknown-keys` onto parent default `dev` so parent PR https://github.com/code-yeongyu/oh-my-openagent/pull/8206 is mergeable again.

## WHAT WAS TESTED

- Added remote `parent` (`https://github.com/code-yeongyu/oh-my-openagent.git`) and fetched `parent/dev`.
- Rebased the unique diagnostic commit onto `parent/dev` at `5ec06d5d3` (Merge pull request #8392).
- Skipped the two stale pre-rebase Senpi bundle-regen commits (`32c5e10dd`, `776f2cd06`) because they conflicted with newer parent bundles.
- Regenerated Senpi plugin artifacts with the same scripts CI uses, without local runtime dists:
  - `node packages/omo-senpi/plugin/scripts/build-extension.mjs`
  - `node packages/omo-senpi/plugin/scripts/build-install.mjs`
- Re-ran the CI freshness gate:
  - `node packages/omo-senpi/plugin/scripts/build-extension.mjs --check`
  - `node packages/omo-senpi/plugin/scripts/build-install.mjs --check`
- Kept the PR intent: `bun test packages/omo-config-core/src/loader/unknown-keys.test.ts` and the full `packages/omo-config-core/src/` suite.
- Typecheck: `bunx tsgo --noEmit -p packages/omo-config-core/tsconfig.json` and `packages/omo-senpi/tsconfig.json`.
- Senpi QA driver self-test: `node packages/omo-senpi/scripts/qa/drive.mjs --self-test`.
- Isolation: real `~/.senpi/agent` and `~/.omo/agent` paths recorded.

## WHAT WAS OBSERVED

- `parent/dev` moved from `ceb3cce0b` to `5ec06d5d3` (memory startup diet, senpi 2026.9.17, lazy senpi state, plus a bun-pinned bundle rebuild).
- Diagnostic commit replayed cleanly as `9a1c05cf6`. Evidence commit replayed as `8ae828e68`.
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
- `unknown-keys-tests.log`
- `drive-self-test.log`
- `isolation.txt`
- `changed-files.txt`
- `unique-commits.txt`
- `tip-sha.txt`

## WHY IT IS ENOUGH

The parent PR was DIRTY because `dev` advanced past the previous merge-base. Replaying the diagnostic onto current `parent/dev` and regenerating committed Senpi artifacts on linux/amd64 with the CI `--check` commands (no local runtime dists) is the mergeability + freshness gate. Config-core tests prove the diagnostic still names unrecognized keys.

## WHAT WAS OMITTED

- Live `senpi` session: binary absent, recorded as SKIP.
- Full `bun run test:senpi` (builds lsp-daemon + ast-grep + full adapter suite). Hermetic unit coverage here is config-core + typecheck + `--check`.
- Raw env dumps, tokens, and auth headers: none captured.

## Residual risk

- `--check` hashes are platform-sensitive; this rebuild is linux/amd64, matching `senpi-compatibility (ubuntu-latest)`.
- A later local `--check` can fail if `packages/lsp-daemon/dist` exists but the plugin runtime is not staged. CI installs with `--ignore-scripts` and runs `--check` before those dists exist.
