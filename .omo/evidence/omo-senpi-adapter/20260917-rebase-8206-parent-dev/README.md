# 20260917-rebase-8206-parent-dev

Rebase of `fix/validation-diagnostic-names-unknown-keys` onto current parent
default `dev` so parent PR
https://github.com/code-yeongyu/oh-my-openagent/pull/8206 is mergeable again.

## WHAT WAS TESTED

- Added remote `parent` (`https://github.com/code-yeongyu/oh-my-openagent.git`)
  and fetched `parent/dev`.
- Rebased the unique diagnostic commit onto `parent/dev` at `fc7b12ac7`
  (Merge pull request #8421). Parent has no `main`.
- Skipped the two stale Senpi bundle-regen commits (`3eecc2180`, `c11085327`)
  because they conflicted with newer parent bundles (`omo.js`, `omo-task.js`).
- Regenerated Senpi plugin artifacts with the same scripts CI uses, without
  local runtime dists, on Node 24 + Bun 1.4.2:
  - `node packages/omo-senpi/plugin/scripts/build-extension.mjs`
  - `node packages/omo-senpi/plugin/scripts/build-install.mjs`
- Re-ran the CI freshness gate with `packages/lsp-daemon/dist` and
  `packages/ast-grep-mcp/dist` absent:
  - `node packages/omo-senpi/plugin/scripts/build-extension.mjs --check`
  - `node packages/omo-senpi/plugin/scripts/build-install.mjs --check`
- Kept the PR intent: `bun test packages/omo-config-core/src/loader/unknown-keys.test.ts`
  (6/6) and the full `packages/omo-config-core/src/` suite.
- Typecheck: `bunx tsgo --noEmit -p packages/omo-config-core/tsconfig.json`
  and `packages/omo-senpi/tsconfig.json`.
- Senpi QA driver self-test: `node packages/omo-senpi/scripts/qa/drive.mjs --self-test`.
- Isolation: real `~/.senpi/agent` and `~/.omo/agent` paths recorded.

## WHAT WAS OBSERVED

- `parent/dev` moved from `5ec06d5d3` to `fc7b12ac7` (deferred plugin startup,
  first-paint seams, lsp formatter on first use).
- Diagnostic commit replayed cleanly. Prior evidence commits replayed.
  Stale bundle-regen commits were skipped, not merged.
- Before rebuild, `--check` reported `stale-output` on
  `plugin/extensions/omo.js` (omo-config-core diagnostic is inlined).
- After rebuild, CI-equivalent `--check` reports
  `omo-senpi extension build is current` and
  `omo-senpi installer is current`. Hidden-dist recheck also exits 0.
- Bundle diffs are marker/digest lines only (`omo.js`, `omo-task.js`;
  2 files, 4 insertions / 4 deletions). `install.mjs` was already current.
- `unknown-keys.test.ts`: 6 pass, including `#then the diagnostic names both`.
- `packages/omo-config-core/src/`: pass / 0 fail.
- `tsgo` for `omo-config-core` and `omo-senpi`: exit 0.
- `drive.mjs --self-test`: `SELF-TEST OK`.
- `senpi` binary is absent, so live harness QA is SKIP, not a pass.
- Real `~/.senpi/agent` does not exist. Real `~/.omo/agent` does not exist.
- `packages/lsp-daemon/dist` is gitignored and was not committed. It appeared
  only after `bun test` test-setup; `--check` was run with it absent.

Artifacts:

- `pre-regen-check.log`
- `ci-equivalent-check.log`
- `hidden-dist-recheck.log`
- `unknown-keys-tests.log`
- `omo-config-core-tests.log`
- `typecheck.log`
- `drive-self-test.log`
- `isolation.txt`
- `changed-files.txt`
- `unique-commits.txt`
- `tip-sha.txt`

## WHY IT IS ENOUGH

The parent PR was DIRTY because `dev` advanced past the previous merge-base
(`5ec06d5d3`, behind 6). Replaying the diagnostic onto current `parent/dev`
and regenerating committed Senpi artifacts on linux/amd64 with the CI
`--check` commands (no local runtime dists) is the mergeability + freshness
gate. Config-core tests prove the diagnostic still names unrecognized keys.

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
