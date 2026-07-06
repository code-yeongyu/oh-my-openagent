# CodeGraph tmpdir defaults evidence

## What Was Tested

- RED: `bun test packages/utils/src/codegraph-exclusion.test.ts` before implementation, captured in `red-codegraph-exclusion-test.txt` (`exit=1`, darwin injected tmpdir returned `excluded: false`).
- GREEN focused: `bun test packages/utils/src/codegraph-exclusion.test.ts`, captured in `green-codegraph-exclusion-test.txt`.
- CodeGraph component call sites: `cd packages/omo-codex/plugin/components/codegraph && bun test test`, captured in `green-codegraph-component-tests.txt`.
- Live SessionStart proof: `live-sessionstart-qa.ts` drove `executeCodegraphSessionStartHook` with isolated `HOME`/`CODEX_HOME`; real OS temp cwd skipped, repo-local normal cwd spawned. Results in `live-sessionstart-proof.json` and real config hash proof in `live-sessionstart-isolation.txt`.
- Codex QA conventions: common self-check, app-server plugin drive, and install-verify self-test, captured in `codex-qa-common-self-check.txt`, `codex-qa-app-server-drive-plugin.txt`, and `codex-qa-install-verify-self-test-rerun.txt`.
- Hermetic gates: `bun run test:codex`, `bun run typecheck`, and isolated rerun of `bun test packages/utils packages/omo-codex`, captured in `gate-test-codex.txt`, `gate-typecheck.txt`, and `gate-bun-test-utils-omo-codex-rerun.txt`.

## What Was Observed

- New exclusion tests went RED before product code, then GREEN after adding `tmpdir` injection and OS temp defaults.
- On this macOS host, the real OS temp root was skipped before status probing or worker spawning; a normal project root still probed and spawned the CodeGraph bootstrap worker.
- `~/.codex/config.toml` hash stayed unchanged during live QA.
- `bun run test:codex`, `bun run typecheck`, codex-qa app-server drive, codex-qa install verify, and the broad package test rerun exited 0.

## Why It Is Enough

The unit test pins platform-specific default behavior (darwin, linux, win32), custom `excluded_roots`, `.omo` state exclusion, and normal-project inclusion. The component tests cover the hook/serve call sites after the new default. The live SessionStart proof covers the requested real temp-root skip and normal-project include behavior through the CodeGraph hook path with isolated Codex state.

## What Was Omitted

No raw secrets, auth headers, launchd environments, or private credentials were copied. The first broad package run (`gate-bun-test-utils-omo-codex.txt`) and first install-verify run (`codex-qa-install-verify-self-test.txt`) are retained as diagnostic artifacts; both were superseded by clean reruns after avoiding concurrent generated-payload/submodule work.

## Cleanup

Temporary live-QA project roots and isolated homes were removed by `live-sessionstart-qa.ts`; see `live-sessionstart-proof.json`. Temporary clean-base verification worktrees were removed and pruned; see `cleanup-worktrees.txt`.
