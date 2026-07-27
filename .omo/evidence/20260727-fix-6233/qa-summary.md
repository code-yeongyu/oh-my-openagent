# QA summary - issue #6233 - boulder plan parser ignores the mandated `- [~]` blocked marker

Captured 2026-07-27 (UTC) on Windows 11, bun 1.3.14, node v22.14.0, opencode 1.18.5.
Base: `upstream/dev` @ `3f917a94c`.

## The defect

`packages/omo-opencode/src/hooks/atlas/system-reminder-templates.ts:34-35`
(`BOULDER_CONTINUATION_PROMPT`) instructs the agent, as a hard requirement:

> - If a task is blocked by missing external input, unavailable credentials, access
>   limits, or a decision only the user can make, you MUST edit the plan file in this
>   turn and change that task's checkbox from `- [ ]` to `- [~]` before moving on
> - A text-only explanation of a blocker is NOT progress. The `- [~]` checkbox edit is
>   mandatory and must happen via a real file-editing tool call

`packages/boulder-state/src/plan-checklist.ts` rejected `~` in all three checkbox
patterns (`SIMPLE_CHECKBOX_PATTERN`, `TODO_CHECKBOX_PATTERN`,
`FINAL_WAVE_CHECKBOX_PATTERN`), so every `- [~]` row was dropped from the checklist
entirely - not counted as done, not counted as remaining, simply invisible.

Consequences, both observed on the real CLI surface below:

1. **Progress under-reports.** A `- [~]` task does not appear in `total`, so
   `omo boulder` shows the wrong denominator and percentage.
2. **Boulder continuation can loop forever.** When every parseable row is `- [~]`,
   the checklist parses to `total = 0`. `getPlanProgress`
   (`storage/plan-progress.ts:44`) computes `isComplete: total > 0 && remaining === 0`,
   which is `false` at `total = 0`, and `handleAtlasSessionIdle`
   (`hooks/atlas/idle-event.ts:49`) only short-circuits on `progress.isComplete`. The
   `BOULDER CONTINUATION` directive is therefore re-injected on every idle, forever -
   the directive punishes the agent for obeying the directive.

This matches the reporter's observation (directive injected 30 times over 3 days with
`[Status: 0/0 completed, 0 remaining]`) and the independent reproduction by `ycyopen`
in the same thread (7 injections, verified against opencode's SQLite session records).

## The change

One product file, `packages/boulder-state/src/plan-checklist.ts` (+10 / -5):

- `~` added to the marker character class of the three checkbox patterns.
- New `isDischargedMarker()` helper; both `parseSimpleTopLevelCheckbox` and
  `parseStructuredTopLevelCheckbox` now route their marker through it, so `x`, `X` and
  `~` all count as discharged. Sibling predicates are hardened together rather than at
  one symptom site.

A `- [~]` row is discharged, not open: it counts toward `completed`, never becomes
`nextTaskLabel`, and cannot be selected as the next top-level task.

## What was tested, and what was observed

All raw artifacts are in this directory.

| # | Scenario | Artifact | Observed |
|---|---|---|---|
| RED | New tests on unmodified base | `red-6233.txt` | 3 fail in `plan-checklist.test.ts`, 3 fail in `plan-progress.test.ts`. All-blocked plan returns `{total: 0, completed: 0, isComplete: false}` where `{2, 2, true}` is expected - the exact `0/0` the issue reports. Behavioural failures, not compile errors. |
| GREEN | Same tests with the fix | `green-6233.txt` | `plan-checklist.test.ts` 16/16, `plan-progress.test.ts` 4/4, whole `packages/boulder-state` 38/38. |
| Negative control | Revert only the product file, keep the tests | `negative-control-6233.txt` | Both suites fail again (exit 1, same 3+3). Confirms the tests are pinned to the product change. |
| Typecheck | `tsgo --noEmit` | `typecheck-6233.txt` | `packages/boulder-state` exit 0, `packages/omo-opencode` exit 0. |
| Regression | All 5 consumer suites, base vs PR | `baseline-preexisting-failures.txt`, `related-suite-6233.txt`, `regression-comparison.txt` | No new failures. See table below. |
| Live surface | Real `boulder` CLI, JSON + text | `live-driver.sh`, `live-driver-before.txt`, `live-driver-after.txt` | See below. |
| Isolation | Real DB / user config untouched | `isolation-proof.txt` | `delta_driver = 0` sessions; user config sha256 unchanged. |

### Consumer regression sweep

Both sweeps run sequentially on a quiet host, same 5 suites, same machine.

| Suite | clean `upstream/dev` | with this PR |
|---|---|---|
| `packages/boulder-state` | 31 pass / 0 fail | 38 pass / 0 fail (+7 new tests) |
| `packages/omo-opencode/src/features/boulder-state` | 75 / 0 | 75 / 0 |
| `packages/omo-opencode/src/hooks/atlas` | 208 / 0 | 208 / 0 |
| `packages/omo-opencode/src/hooks/start-work` | 94 / 0 | 94 / 0 |
| `packages/omo-opencode/src/cli/run` | 194 / **2** | 194 / **2** |

The two `cli/run` failures are `executeOnCompleteHook > uses powershell when PowerShell
is detected on Windows` and `... falls back to cmd.exe on Windows when PowerShell is not
detected`. They fail identically on unmodified `upstream/dev` on this Windows host and
have no relationship to plan parsing.

### Live surface: real `boulder` CLI

`bash live-driver.sh <out>` builds a throwaway project (`mktemp -d`, removed on exit)
containing `.omo/boulder.json` plus two plans, then runs the real CLI entry
`bun packages/omo-opencode/src/cli/index.ts boulder --directory <tmp>` in both `--json`
and text mode. No build step, no network.

`blocked-plan.md` - every task user-blocked, exactly as the directive mandates:

```markdown
## Todos
- [~] 1. Blocked on a decision only the user can make

## Final verification wave
- [~] F1. Blocked on unavailable credentials
```

| Field | before (`upstream/dev`) | after (this PR) |
|---|---|---|
| `total_tasks` | `0` | `2` |
| `completed_tasks` | `0` | `2` |
| `remaining_tasks` | `0` | `0` |
| `percentage` | `0` | `100` |
| text surface | `progress: 0% (0/0)` | `progress: 100% (2/2)` |

`mixed-plan.md` (`- [x]` + `- [~]` + `- [ ]`): `50% (1/2)` before, `67% (2/3)` after, and
`current_task` remains `Still actionable` in both - the blocked row is counted but is
never offered as the next task.

The before-capture prints `git diff --stat upstream/dev` for the product file, so each
artifact carries proof of which tree produced it.

## Competing hypotheses that were tested and rejected

An initial consumer sweep reported 53 failures across atlas / start-work / cli-run.
Rather than assume they were pre-existing, both hypotheses were checked:

- **Rejected - "the change broke them".** The sweep ran while the host was under heavy
  load. It executed the identical test count (`Ran 208 tests across 26 files`) but took
  752s versus 9-13s on a quiet host, and contained 49 `this test timed out after 5000ms`
  / `beforeEach hook timed out` lines versus 1 at baseline. The set included tests with
  no causal path to checkbox parsing, such as
  `executeOnCompleteHook > uses powershell when PowerShell is detected`.
- **Accepted - host-load timeouts.** The quiet-host re-runs recorded here show parity
  with the clean base.

A later quiet run showed one further failure,
`resolveActiveBoulderSession > returns null for tracked work session when resolved work
is abandoned`. That function does call `getPlanProgress`, so it was investigated rather
than dismissed (`flake-proof-resolve-active-boulder-session.txt`): the test's fixtures
are `- [ ] Active task` / `- [ ] Abandoned task` and the file contains zero `[~]`
checkboxes, so it takes byte-identical code paths before and after this change; the
recorded failure was `[27086.93ms]` with no assertion diff, i.e. a hang; and 5/5 isolated
runs with the fix applied pass 8/8 in ~420ms.

## Why this is enough

The regression test drives the real exported parser and the real `getPlanProgress`
entrypoint (reading an actual plan file from disk), not hand-built internal payloads,
and it fails on `upstream/dev` for the behavioural reason before passing here. The live
capture drives the actual user-facing `boulder` CLI end to end and shows the operator
visible `0% (0/0)` to `100% (2/2)` transition on the same plan text the product itself
tells the agent to write. `packages/boulder-state` is a harness-neutral core package
with no `@opencode-ai/*` imports, so the parser is fully exercisable without a live
OpenCode session; every consumer suite of `getPlanProgress` was swept for regressions.

## Declared non-goals and residual risk

The issue proposes three changes. Two are deliberately **not** included:

1. **Broader task-ID grammar** (`T1.1`, `H1`, `F5 - ...` with an em dash). The existing
   test `#given noncanonical structured rows #when parsed #then only exact
   positive-number grammar is counted` (`plan-checklist.test.ts:90`) deliberately pins
   the strict grammar, including rejecting `- [ ] 0.`, `- [ ] 01.` and `* [ ] 2.`.
   Loosening it is a contract change, not a bug fix, and belongs to whoever owns that
   contract. That test still passes unchanged here, which is the proof this PR did not
   touch the grammar.
2. **Changing `isComplete: total > 0 && remaining === 0`** in `storage/plan-progress.ts`.
   `getPlanProgress` has 19 call sites, including the `start-work` plan-discovery and
   plan-selection filters that use `!isComplete` to decide which plans to offer the
   user. Making `total === 0` mean "complete" would hide a freshly created, not yet
   written plan from `/start-work`. That is a wider blast radius than this defect
   warrants, so the `total > 0` guard is left exactly as it is.

**Residual:** a plan that parses to `total = 0` for a reason other than `- [~]` - for
example checkboxes written under a heading the parser does not treat as a counted
section, or with a non-canonical task-ID - still yields `isComplete: false` and can
still drive the continuation loop. This PR removes the `- [~]` cause, which is the one
the product itself creates by mandating that marker; it does not claim to close the
whole `total === 0` class. Non-goal 2 above is the remaining half and is left open on
purpose.

**Blast radius:** confined to plan lines whose checkbox marker is `~`. Any plan without
a `~` character takes byte-identical paths before and after, which is why all pre-existing
tests pass unchanged.

## What was omitted

No secrets, tokens, credentials or environment dumps are included. The isolation
capture records only a session-row count, the user config path, and its sha256 digest -
never the config contents. The live driver writes solely into a `mktemp -d` directory
that is deleted when it exits.

Honest note on isolation: this QA ran from inside a live opencode session, so the real
session table could not be frozen for the measurement window. The driver's own
contribution was isolated with an A/B/C measurement against an equal idle gap
(`delta_driver = 0`), plus a source grep confirming the `boulder` CLI opens no database,
no session API and no network.
