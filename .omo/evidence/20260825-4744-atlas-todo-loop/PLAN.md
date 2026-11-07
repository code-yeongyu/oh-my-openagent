# Plan: fix #4744 - Atlas endless loop after all todos complete

## Root cause (file:line)

1. `packages/omo-opencode/src/hooks/atlas/resolve-active-boulder-session.ts:12-14` -
   `isInactiveBoulderStatus()` treats only `"paused" | "abandoned"` as inactive.
   A work whose status is `"completed"` keeps resolving as an ACTIVE boulder
   session on every `session.idle`, forever. There is no terminal transition.
2. `packages/boulder-state/src/storage/plan-progress.ts:35,44` - after completion,
   if the plan file is deleted/unparseable or its checklist drops to zero items
   (exactly what redundant post-nudge todo/plan edits produce, per the owner's
   diagnosis on the issue), `getPlanProgress()` returns
   `{ total: 0, completed: 0, isComplete: false }`.
3. `packages/omo-opencode/src/hooks/atlas/idle-event.ts:54` - with
   `isComplete === false`, the idle falls into the CONTINUATION branch instead of
   the completion branch, injecting `BOULDER_CONTINUATION_PROMPT`
   ("Continue working", "[Status: 0/0 completed, 0 remaining]") on every idle.
4. The existing anti-loop guard `shouldAbortForNoToolProgress`
   (`tool-progress.ts`) never trips because the model's redundant todo-write /
   plan-edit cycles ARE tool calls, so "tool progress" is detected each round.

Net effect: Atlas re-prompts the model forever; each model turn burns tokens and
ends in another idle -> another injection. Matches the issue report (endless
loop, token exhaustion) and the owner's comment (model re-enters the
todo-update cycle after the once-only completion nudge).

## Fix

`resolve-active-boulder-session.ts`: add `"completed"` to
`isInactiveBoulderStatus()`. The terminal transition then fires exactly once:
the first idle with a fully-checked plan runs `handleCompletedBoulderIdle`
(`completeBoulder()` flips status to `"completed"` + fires the once-only nudge
via `boulderCompletionNudgedAt`); every later idle short-circuits at eligibility
and Atlas never injects again for that work. Starting a NEW work still works:
the new active work has status `"active"`.

Accepted tradeoff (documented in evidence): if the completion nudge was skipped
pre-dispatch (session became active during settle), a completed work no longer
retries the nudge on later idles. The nudge is cosmetic (final summary print);
killing an unbounded token-burning loop outweighs a lost cosmetic nudge.

## Tests (failing first, co-located in idle-event-complete-boulder.test.ts)

- Test A (expected RED on current code): GIVEN work status `"completed"` and the
  plan file deleted, WHEN `session.idle` fires, THEN zero prompt dispatches
  (Atlas terminates; no continuation resurrection).
- Test B (pins once-only terminal transition): GIVEN fully-checked plan, WHEN
  two consecutive idles fire, THEN exactly one prompt dispatch total (the
  completion nudge) and work status `"completed"`.

## Verification

- `bun test packages/omo-opencode/src/hooks/atlas/idle-event-complete-boulder.test.ts`
  + neighbor suites (`idle-event.test.ts`, `resolve-active-boulder-session.test.ts`,
  `idle-completion-nudge` consumers via full atlas dir run).
- Typecheck: tsgo scoped to omo-opencode (LSP daemon unreliable in worktrees).
- Evidence: red/green outputs under this dir.

## Commit / PR

ONE conventional commit: fix(atlas): terminate boulder session loop when todos exhausted.
Stage ONLY: resolve-active-boulder-session.ts, idle-event-complete-boulder.test.ts,
evidence dir (git add -f). NEVER: packages/shared-skills/upstreams/*, plugin build
artifacts, pre-existing .omo drift. Push `fork issue/4744-atlas-loop-after-todos`,
PR to code-yeongyu/oh-my-openagent base dev, body ends `Fixes #4744`.
