# Senpi runOmoCommand timeout QA

## Objective audit

| Requirement | Artifact | Evidence |
|---|---|---|
| Fix the final local `bun run test:senpi` timeout | `packages/omo-senpi/src/components/ulw-loop/ulw-loop.test-support.ts` | Fake `omo` commands now execute an absolute Node binary instead of nesting Bun under the Bun test runner. |
| Preserve the exact `runOmoCommand` behavior | `packages/omo-senpi/src/components/ulw-loop/runtime.test.ts` | Existing stdout/cwd assertions remain and now assert the child runtime is not Bun. |
| Prove RED before the fix | `red-green.txt` | PR #6310 recorded the actual 20-second full-gate timeout; a stale old-style fixture contained the Bun wrapper but no `cwd.txt`; unchanged code deterministically reported Bun `1.3.14`. |
| Prove deterministic completion | `red-green.txt` | 100 repeated runtime-test executions passed; duration fell from 147.81 seconds to 74.78 seconds. |
| Prove full gate | `verification.txt` | `bun run test:senpi` passed twice consecutively, 323 tests each. |
| Prove matching command surface | `manual-qa.txt` | Real `omo ulw-loop status --json` covered missing-plan and valid-plan paths and left no process behind. |
| Pass the HEAVY reviewer gate | `review.txt` | Goal, quality, security, hands-on, and history/context reviewers all passed the final diff with no blockers. |
| New worktree, PR, merge, cleanup | PR evidence after delivery | Branch `fix/senpi-run-command-timeout`; task worktree is removed after merge. |

## Root cause

`createTempOmoBin()` used `process.execPath`. Under `bun test`, that value is the Bun executable, so every fake status command launched another Bun process through `/bin/sh`. The original full gate recorded the exact runtime test timing out after 20 seconds. A pre-existing fixture directory from that failure class contained the old Bun wrapper and runner source but no `cwd.txt`, showing the runner did not reach its first write. The unchanged helper's runtime-identity assertion then deterministically failed with Bun `1.3.14`.

The fixture now resolves the installed Node executable once with `node -p process.execPath` and invokes that absolute binary. Shell-wrapper behavior is deliberately unchanged, isolating the fix to one causal toggle: Bun child startup versus Node child startup. Production `runOmoCommand()` behavior and deadlines are unchanged.

The timeout itself is load-sensitive: a fresh unchanged gate and 100 isolated reruns completed successfully. The evidence therefore does not claim a new deterministic timeout reproduction. It combines the actual prior timeout, the incomplete old fixture artifact, deterministic wrong-runtime RED, independent hands-on process inspection, and the two-times faster stress result.

## Validation summary

- Focused runtime test: 5 pass, 0 fail.
- Complete ulw-loop component suite: 27 pass, 0 fail.
- OMO Senpi package typecheck: exit 0.
- Runtime stress: 500 pass across 100 reruns in 77.34 seconds.
- Full Senpi gate: two consecutive runs, 323 pass / 0 fail each.
- Manual missing-plan status: expected structured error, exit 1, no leftover process.
- Manual valid-plan status: create exit 0, status exit 0, temporary state removed, no leftover process.
- Five-lane reviewer gate: unconditional PASS across all lanes.

## Cleanup

- Runtime helper removes every `omo-senpi-ulw-loop-*` directory in `finally`; the final 100-run stress check reported zero leftover fixture directories.
- Manual QA removed `/tmp/omo-senpi-run-command-qa.KL6n7S`.
- No matching `omo ulw-loop status` process remained.
- No production source or generated bundle change is included.
- Setup resolves Node before creating the fixture directory, so discovery failure cannot leak a new `omo-senpi-ulw-loop-*` directory.
- The eleven stale fixture directories found during review were removed; the final verification baseline is zero.
