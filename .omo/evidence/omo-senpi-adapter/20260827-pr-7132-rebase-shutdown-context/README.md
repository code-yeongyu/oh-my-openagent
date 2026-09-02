# PR 7132 rebase: shutdown-context QA

## What was tested

- Rebased PR #7132 onto `origin/dev` at `9c62b6278bbe322f1629ad50564d54c7adca4c40`.
- Built the shipped Senpi plugin with Bun 1.4.0 through `bun run build:senpi-plugin`.
- Ran `tsgo --noEmit -p packages/omo-senpi/tsconfig.json` as part of `bun run test:senpi`.
- Ran the three focused shutdown suites: `wiring.test.ts`, `shutdown-drain.test.ts`, and
  `dream-trigger-shutdown.test.ts`.
- Drove the real repository-local Senpi 2026.8.26 binary with the dedicated
  `shutdown-context-e2e.mjs` driver already carried by this PR.

## Observed result

PASS for the PR behavior. All 29 focused tests passed. The live run seeded isolated memory, replaced
the print-mode session context, exited normally, observed the exact assistant response `OK`, found
no `stale extension ctx` failure, and durably recorded `reflection-run-1` with `trigger: dream` and
`origin: shutdown`. Every assertion in `result.json` is true.

The shutdown reflection terminalized as `failed / spawn_failed / model_not_visible`, which is the
expected isolated-provider result: the discovery-disabled child cannot see the mock provider loaded
only in the parent. The lifecycle under test crossed shutdown launch and terminalized durably.

## Isolation and cleanup

- Isolated sandbox: `C:\Users\dajiaohuang\AppData\Local\Temp\omo-senpi-qa-dem2Ph`
- Isolated agent dir: `C:\Users\dajiaohuang\AppData\Local\Temp\omo-senpi-qa-dem2Ph\agent`
- Isolated memory home: `C:\Users\dajiaohuang\AppData\Local\Temp\omo-senpi-qa-dem2Ph\memory`
- `realSenpiUntouched`: true
- No surviving process command line referenced the sandbox after the driver exited.
- The sandbox was removed and a final existence check returned false.

On Windows the current `drive.mjs` helper implements its directory creation through the POSIX
`mkdir -p` executable, so Git's `usr/bin` was added to `PATH` for the live run. No source file was
changed to work around that harness portability issue.

## Broader gate observation

The package gate completed the official build and package typecheck, then ran 2,295 tests: 2,264
passed, 14 skipped, and 17 failed on this Windows host. The failures are outside the PR's touched
memory wiring and are platform/harness limitations such as unprivileged symlink creation, the same
`mkdir -p` QA helper, and unrelated init-deep-advisor and skill-pointer tests. The focused shutdown
tests and live lifecycle driver both passed, so the rebased change is covered without expanding the
PR to fix those baseline failures.

## Why this is enough

The focused suites pin the event-context handoff and drain ordering deterministically. The live
driver then proves the same boundary through a real Senpi process, isolated credentials, normal
session replacement, and shutdown. The official build regenerated the tracked extension bundle
from the rebased source.

## Omitted

No real provider credentials or network model calls were used. No upstream issue, PR, or branch was
modified while collecting this evidence.
