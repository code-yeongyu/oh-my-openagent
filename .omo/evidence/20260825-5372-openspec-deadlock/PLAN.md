# Plan — issue #5372: child-agent deadlock in task pipeline

## Problem statement
Issue #5372 ("Unchanged OpenSpec task identifier + child agent deadlocks post OMO-Spenspec integration"):
Atlas-spawned child tasks hang with no output/progress; framing narrowed to
"task identifier resolution blocks the child pipeline".

## Root cause
PENDING — two explore agents hunting (engine hang path; identifier seams). Fill in file:line + interleaving.

## Change plan
1. Failing-first regression test co-located next to the fix target (given/when/then), proving
   identifier resolution completes without deadlock under the issue scenario (fakes/timers as needed).
2. Minimal scoped fix at the root-cause seam. No type suppression, no test weakening, no refactors.
3. Verify: scoped `bun test <scoped paths>` green + `tsgo --noEmit` on touched package(s).

## Verification matrix
- [ ] Red: new regression test fails on BASE c7094b8ac behavior (pre-fix)
- [ ] Green: same test passes post-fix
- [ ] Scoped suite: bun test packages/senpi-task (or narrower dir) green
- [ ] Typecheck: tsgo --noEmit for touched package tsconfig
- [ ] No tracked dirty state outside own files (upstreams/, plugin bundles untouched)

## Commit / PR
- ONE conventional commit staging ONLY: fix file(s) + test file(s) + this evidence dir (git add -f).
- NEVER stage packages/shared-skills/upstreams/*, plugin/extensions/*.js, pre-existing .omo drift.
- push fork issue/5372-openspec-child-deadlock; gh pr create --repo code-yeongyu/oh-my-openagent --base dev
  --head AceRothstein71:issue/5372-openspec-child-deadlock; English body What/Why/Verified/Risk ending "Fixes #5372".
