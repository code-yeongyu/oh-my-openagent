# Remote executed-budget evidence (issue #8182, PR #8183)

Machine: a second macOS box in the fleet via the bunshin mesh (bun 1.4.2). Local host ran no `bun test`.
Workspace: `/tmp/lcx-smoke-20260912/omo` = shallow clone of `fix/lazycodex-smoke-readiness-budget` @ 1819ea3.

## What was tested
- GREEN: the 20 suites that read `publish.yml` (incl. the new `publish-lazycodex-smoke-budget.test.ts`, which
  executes the smoke step's run block with `npm`/`npx`/`sleep` stubbed as bash functions).
- RED: the new suite + `publish-lazycodex-workflow.test.ts` against `origin/dev`'s `publish.yml` (1712 lines).
- `bun run typecheck:script`.

## What was observed
```
host=mengmotaMac bun=1.4.2
HEAD=1819ea3
INSTALL_EXIT=0
=== GREEN (branch) ===
GREEN_EXIT=0
 99 pass
 0 fail
Ran 99 tests across 20 files. [9.45s]
(pass) publish.yml post-publish-verify LazyCodex smoke readiness > #given the registry needs ~5 minutes to expose the version #when the smoke polls #then it reaches the package instead of giving up [319.19ms]
(pass) publish.yml post-publish-verify LazyCodex smoke readiness > #given the registry never exposes the version #when the budget is exhausted #then it fails and names propagation, not the package [985.44ms]
(pass) publish post-publish verification > #given registry propagation must not hold the release hostage > #when publish-main is inspected #then it no longer carries the post-publish verification steps [1.04ms]
(pass) publish post-publish verification > #given registry propagation must not hold the release hostage > #when the workflow is parsed #then post-publish-verify owns every one of those steps [0.07ms]
(pass) publish post-publish verification > #given registry propagation must not hold the release hostage > #when post-publish-verify is wired #then it runs after the release job [0.05ms]
(pass) publish post-publish verification > #given registry propagation must not hold the release hostage > #when the release job is wired #then it never waits on post-publish-verify [0.05ms]
=== RED (origin/dev publish.yml + branch tests) ===
    1712 /tmp/dev-publish.yml
RED_EXIT=1
 5 pass
 3 fail
Ran 8 tests across 2 files. [1109.00ms]
(fail) LazyCodex publish workflow > smoke tests the published LazyCodex alias after npm publish [0.60ms]
(fail) publish.yml post-publish-verify LazyCodex smoke readiness > #given the registry needs ~5 minutes to expose the version #when the smoke polls #then it reaches the package instead of giving up [232.24ms]
(fail) publish.yml post-publish-verify LazyCodex smoke readiness > #given the registry never exposes the version #when the budget is exhausted #then it fails and names propagation, not the package [184.36ms]
=== typecheck:script ===
TC_EXIT=0
$ tsgo --noEmit -p script/tsconfig.json
REMOTE_DONE

EXIT_CODE=0
```

## Why it is enough
The budget is a machine-consumed value the loop executes; the test runs the real loop and measures npm views and
slept seconds, so the old 12 x 10 s loop fails both cases and the 60 x 15 s loop passes both. The live path is the
next LazyCodex release's smoke step.

## What was omitted
Remote hostnames and the install log. No secrets were involved.
