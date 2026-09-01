# QA evidence: facts extractor quick-category fallback leak

Branch: `fix/facts-quick-pin`
Work began on `origin/dev` @ 24c909c4e; upstream advanced to fab28ed5e (PR #7588 dream-o1-volume-gate)
while the fix was in flight, so the branch was rebased onto fab28ed5e. The RED/GREEN captures below
were taken pre-rebase; the same suites were re-run green on the final head (see Rebase re-verify).
Scope: `packages/omo-senpi/src/components/memory/facts-runner.ts` + its test file + committed plugin bundle.

## WHAT TESTED

1. **TDD RED first.** Added a case to the facts runner's existing test file
   (`facts-runner.test.ts`, describe `quick-pinned facts launch`):
   a registry that does NOT contain the quick chain's model but DOES contain another usable model
   (`other-provider/expensive-1`), with `categories: {}`. Under that setup `resolveReflectionModel`
   answers `kind: "resolved"` through its beyond-category ladder and tags it
   `source: "registry_fallback"`. Expected behavior: warn + skip (quick is PINNED).
2. Full facts suite: `bun test packages/omo-senpi/src/components/memory/facts-*.test.ts`.
3. Typecheck: `bun x tsgo --noEmit -p packages/omo-senpi/tsconfig.json`.
4. Mirrored-surface regression check: `memorian-runner.test.ts` + `worker/resolve-model.test.ts`
   (both untouched by this change, confirmed still green).
5. Committed bundle refresh via `bun packages/omo-senpi/plugin/scripts/build-extension.mjs`,
   then grepped the minified bundle to prove the widened guard actually shipped.

## OBSERVED

### RED (before the fix)

```
$ bun test packages/omo-senpi/src/components/memory/facts-runner.test.ts -t "beyond-category"
bun test v1.4.0 (34cbb9a40)

packages/omo-senpi/src/components/memory/facts-runner.test.ts:
80 |     expect(result.status).toBe("skipped")
                               ^
error: expect(received).toBe(expected)

Expected: "skipped"
Received: "failed"

      at <anonymous> (.../facts-runner.test.ts:80:27)
(fail) quick-pinned facts launch > #given a registry without quick but with another usable model
       #when pending facts are launched #then the beyond-category resolution is refused instead of launched [2067.91ms]

 0 pass
 9 filtered out
 1 fail
```

`"failed"` rather than `"skipped"` is the leak in full: the runner accepted the
`registry_fallback` resolution as launchable, reserved a run dir and spawned an extraction child
against an arbitrary out-of-category model (the child then failed against the fixture provider).

### GREEN (after the fix)

```
$ bun test packages/omo-senpi/src/components/memory/facts-runner.test.ts
(pass) quick-pinned facts launch > #given quick cannot resolve #when pending facts are launched #then no child spawns and the queue stays intact with one warning [347.13ms]
(pass) quick-pinned facts launch > #given a registry without quick but with another usable model #when pending facts are launched #then the beyond-category resolution is refused instead of launched [129.09ms]
(pass) quick-pinned facts launch > #given one injected launch-preflight seam #when reflection and facts launch #then both surfaces route through it [1365.86ms]
(pass) quick-pinned facts launch > #given two pending queue entries #when one launch runs #then the supervised child consumes all entries in one trailer-bearing commit [2095.33ms]
(pass) quick-pinned facts launch > #given an extension-only quick primary and a child-visible fallback #when facts extraction launches #then it retries and commits with the fallback [2540.97ms]
(pass) quick-pinned facts launch > #given facts attempt two has a stale attempt-one outcome #when reconciled before the shared deadline #then the retry remains active [27.42ms]
(pass) quick-pinned facts launch > #given a commit lands before queue cleanup crashes #when a fresh runner reconciles #then the batch receipt prevents a duplicate commit [2087.44ms]
(pass) quick-pinned facts launch > #given a legacy dirty run without an envelope #when retried after cleanup #then it fails closed, retains queue watermarks, and later commits [4285.89ms]
(pass) quick-pinned facts launch > #given a valid empty extraction #when finalized #then no commit lands and the queue is consumed as no_facts [1530.41ms]
(pass) quick-pinned facts launch > #given a schema-invalid project record carrying person #when finalized #then the queue is retained [1375.16ms]

 10 pass
 0 fail
 61 expect() calls
Ran 10 tests across 1 file. [18.98s]
```

Full facts suite:

```
$ bun test packages/omo-senpi/src/components/memory/facts-*.test.ts
 81 pass
 0 fail
 329 expect() calls
Ran 81 tests across 12 files. [81.59s]
```

Typecheck:

```
$ bun x tsgo --noEmit -p packages/omo-senpi/tsconfig.json
TSGO_EXIT=0
```

Mirrored surface untouched and still green:

```
$ bun test .../memorian-runner.test.ts .../worker/resolve-model.test.ts
 31 pass
 0 fail
 70 expect() calls
Ran 31 tests across 2 files. [9.11s]
```

Shipped bundle carries the widened guard:

```
$ grep -o '.\{200\}facts extractor quick category unavailable' packages/omo-senpi/plugin/extensions/omo.js
F("quick",a.config,this.options.resolveModelRegistry());if("category_unavailable"===s.kind||void 0!==s.source){
let e="category_unavailable"===s.kind?s.cause:s.source;return this.options.logger?.warn("facts extractor quick category unavailable
```

## WHY ENOUGH

- The RED run proves the bug was reachable through the runner's real public entry point
  (`launchPending()`), not through a mocked-out internal seam: an actual run dir was reserved and a
  real child was spawned. The GREEN run proves the same entry point now refuses it.
- **Skip semantics are preserved exactly, not re-invented.** The fix only widens the guard
  condition; every statement inside the branch is unchanged. The new test asserts the complete
  pre-existing contract of the `category_unavailable` path, so a future regression in any part of it
  fails the test:
  - `status: "skipped"`,
  - exactly one warning (`facts extractor quick category unavailable`),
  - no child spawned,
  - no `facts/runs` directory created,
  - queue entry still pending (fail-open, no queue writes),
  - failure-store record still written with `streak: 1`, `lastReason: "quick_category_unavailable"`
    and a `preflight-<uuid>` failure id (the backoff interaction).
- The two neighbouring pre-existing tests that cover the `category_unavailable` cause (in
  `facts-runner.test.ts` and `facts-failure-streaks.test.ts`) both still pass, so widening the
  condition did not change the narrow case's behavior.
- The `model-fallback` test still passes, which is the important negative control: an
  *in-category* multi-rung chain (`categories.quick.models`) carries NO `source`, so legitimate
  within-category fallback still launches and retries. The fix rejects only beyond-category
  resolutions.
- tsgo covers the type-level half: the guard keeps the `kind === "resolved"` narrowing that the
  downstream `launchFactsModelChain({ resolution })` argument depends on.

## OMITTED

- `session_inherit` has no dedicated test case. It enters through the identical
  `resolution.source !== undefined` predicate as `registry_fallback` and the facts runner never
  passes `options.sessionModel` to `resolveReflectionModel`, so that branch is unreachable from this
  surface today; a case would assert the test double, not the runner.
- No change to `resolve-model.ts` or the memorian files, per scope. The beyond-category ladder stays
  as-is for the surfaces that legitimately want it (reflection); this fix is only about the
  quick-pinned facts surface.
- No end-to-end run against a live provider: the launch path is already covered by the fixture-backed
  supervisor tests in the suite above, and the changed code returns before any spawn.
- The repo-wide `bun test` was not run; the change is confined to one guard in one runner, and the
  scoped facts suite plus the mirrored-surface suite cover every caller of the touched branch.
- `packages/omo-codex/**` shows unrelated modified artifacts in this worktree (version-bump/hash
  drift regenerated by `bun install`'s postinstall). Left uncommitted and out of scope.

## Rebase re-verify (final head, base fab28ed5e)

Upstream's `fd29f1b88` had rebuilt the committed plugin bundles, so the bundle was regenerated on
the new base rather than cherry-picked (minified blob, conflict-prone). Source commits applied clean;
`facts-runner.ts` was untouched upstream.

```
$ bun test packages/omo-senpi/src/components/memory/facts-*.test.ts
 81 pass
 0 fail
 329 expect() calls
Ran 81 tests across 12 files. [54.37s]

$ bun x tsgo --noEmit -p packages/omo-senpi/tsconfig.json
TSGO_EXIT=0
```

Bundle guard grep on the final head:

```
$ grep -o 'category_unavailable"===s.kind||void 0!==s.source' packages/omo-senpi/plugin/extensions/omo.js
category_unavailable"===s.kind||void 0!==s.source
```

Range check — the branch carries exactly the four intended paths:

```
$ git diff --stat origin/dev..HEAD
 .omo/evidence/20260901-facts-quick-pin/QA.md       | 146 +
 packages/omo-senpi/plugin/extensions/omo.js        |   4 +-
 .../src/components/memory/facts-runner.test.ts     |  50 +-
 .../src/components/memory/facts-runner.ts          |  13 +-
```
