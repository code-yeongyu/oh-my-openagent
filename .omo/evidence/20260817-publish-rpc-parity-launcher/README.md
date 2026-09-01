# beta.8 publish RPC parity repair evidence

## What was tested

- GitHub publish run `32029562189`, job `95386274449`, as the failing-first release surface.
- The exact publish install/build sequence with Bun 1.3.12.
- Ten consecutive focused real RPC catalog-child integrations.
- One full root `bun test` suite with Bun 1.3.12.
- OMO Senpi package typecheck, TypeScript no-excuse rules, diff check, and pure LOC.

## What was observed

- RED: the explicit `omo-mock/mock-1` provider extension was missing from one child catalog during the release test gate.
- GREEN focused: 10/10 runs, 20/20 assertions, 0 failures.
- GREEN full suite: 15,739 pass, 13 skip, 0 fail; 15,752 tests across 2,044 files in 584.46s.
- Typecheck and no-excuse checks exited 0; the changed test is 66 pure LOC.

## Why it is enough

- The test continues to spawn the real Senpi CLI child and load the real provider extension.
- Per-fixture XDG roots remove the remaining shared root-suite state without changing product/runtime behavior.
- The full one-process suite is the exact class of gate that failed in publish.

## What was omitted

- Full install/build and 15k-test raw logs are retained only in the task worktree to avoid committing megabytes of generated noise. Concise exact summaries are committed.
- Raw environment dumps, auth material, and credentials were not captured.
