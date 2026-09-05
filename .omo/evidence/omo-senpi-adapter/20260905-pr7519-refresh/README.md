# PR 7519 maintenance verification

This refresh merges current `dev` into the existing Qwen fallback fix and
regenerates the conflicting task bundle from the combined source. It does not
introduce a new behavior change.

## Planned checks

- Characterize the existing fallback table before merging:
  `bun test packages/senpi-task/src/agents/builtin/fallback-chains.test.ts`.
- Merge `origin/dev` without committing, regenerate the Senpi extension, and
  verify that no conflict marker or unresolved index entry remains.
- Repeat the fallback tests, driver self-test, generated bundle freshness
  check, Senpi typecheck/unit gate, and repository typecheck.
- Drive the real Senpi CLI with
  `OMO_FALLBACK_SCENARIOS=explore-qwen-fallback,librarian-qwen-fallback`,
  the task-runtime-fallback driver, and an isolated evidence output directory.
  Both scenarios must pass the selected model and agent provenance assertions.
- Verify isolated homes, remove task-owned driver sandboxes, and record the
  cleanup receipt.

The existing PR's original RED evidence remains in its earlier evidence
directory. A maintenance merge has no new production RED scenario.

## Environment

Bun 1.4.0 is installed from the official Darwin ARM64 platform package, whose
SHA-1 is `627fb1a1dc49ad800d0791ee9abf7e6c43761acf`. The system Bun is 1.3.14
and is not used for the verification commands.

The language-server tool rejects this sibling worktree because it is outside
its configured request directory. Package and repository typechecks will
provide the compiler diagnostics for the actual merged worktree instead.

## Results

- Before merge: fallback tests passed, 6 tests, 130 assertions.
- After merge: the same tests passed, 6 tests, 126 assertions. The assertion
  count changed with the upstream Momus chain update, which was preserved.
- Driver `--self-test`: `SELF-TEST OK`.
- `bun run typecheck`: exit 0.
- `bun run test:senpi`: exit 0; 2718 tests across 354 adapter files, then
  10 evidence-resolver tests. The command includes build/staging and the
  Senpi package typecheck.
- `node packages/omo-senpi/plugin/scripts/build-extension.mjs --check`: exit 0.
- Both real CLI scenarios passed every check. Their terminal task records
  selected `opencode-go/qwen3.7-plus` with the intended agent provenance.
  Captured verdicts are in `live/explore-qwen-fallback/verdict.json` and
  `live/librarian-qwen-fallback/verdict.json`.
- Both tasks completed in-process. The driver reported unchanged credential
  digests and cleanup PASS. A separate filesystem check confirmed both
  sandbox roots absent, and a process scan found no remaining mock-provider
  or QA-sandbox process.

## Initial environment failures

The first full-gate attempt stopped before unit tests because Git disallowed
the main checkout's local submodule-cache transport. Initializing the four
known submodules with a command-scoped `protocol.file.allow=always` fixed the
worktree setup without relaxing persistent configuration.

The first standalone freshness check found an unstaged LSP runtime manifest
missing. Running the complete build/staging pipeline supplied that runtime;
the subsequent full gate and freshness check passed. No tests were weakened
or skipped to address either failure.

## Scope and omissions

The merge preserves both the current upstream model table and this PR's
Qwen changes. There is no new hand-authored production change.

Raw CLI streams and terminal task records remain local because they include
machine-specific paths. The published verdicts retain the exact binary checks
and before/after credential digests; credentials, private configuration,
unrelated session content, and personal instructions are not included.
