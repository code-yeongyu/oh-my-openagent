# Full root test gate (local, CI-pinned Bun 1.3.12)

## What was tested

```bash
cd <worktree>
npx --yes bun@1.3.12 test
```

## What was observed

```text
 14125 pass
 11 skip
 3 fail
 1 snapshots, 78836 expect() calls
Ran 14139 tests across 1834 files. [271.32s]
ROOT_TEST_DONE exit=1
```

The three failures are:

```text
(fail) Senpi compatibility test script > #given published root package #when payload contract is inspected #then senpi payload is contained while local build stays available
(fail) #given the generated Codex installer #when release versions are synchronized #then its embedded package version matches the root release version
(fail) omo-senpi ulw-loop runtime > #given OMO_BIN is set #when resolving the default omo binary #then Bun is not needed and PATH is ignored
```

## Attribution: none of the three is caused by this branch

1. `omo-senpi ulw-loop runtime` - this workstation exports `OMO_AGENT_TOOLKIT_BIN` (the agent harness
   itself sets it), and the resolver prefers the toolkit binary over `OMO_BIN`. The test does not clear
   that variable, so it reads the host value:

   ```text
   Expected: "/custom/omo"
   Received: "/Users/yeongyu/.bun/install/global/node_modules/omo-ai/bin/omo-agent-toolkit.js"
   ```

   Files touched by this branch cannot influence that resolver; the failure is ambient-environment leak.
2. + 3. Both inspect generated artifacts (the bundled Codex installer's embedded version and the
   published payload contract). CI regenerates them during `bun install` (`prepare` -> `bun run build`),
   while this worktree holds the committed artifacts, which trail the `v5.0.0-beta.5` version bump.

Decisive cross-check on the same tree, `dev` run 31375080844:

```text
test (ubuntu-latest)    success
test (macos-latest)     success
test (windows-latest)   failure
```

All three tests pass on clean CI checkouts, so they are not part of the Windows baseline this PR
repairs, and this branch does not regress them.

## Why this is enough

Every test this branch touches is green (admission lease 4/4, memory MCP 4/4, memfs 15/15, build graph
1/1, senpi-task lifecycle 103/103), and the whole-suite delta against the base branch is zero: the only
non-green cases are reproducible on the unmodified base branch in this same local environment.

## Cleanup receipt

The suite regenerated three Senpi extension bundles; all three were restored with
`git restore --source=HEAD --` and `git status` shows only authored changes.
