# Remote shape-test evidence (issue #8175, PR #8177)

Machine: a second macOS box in the fleet via the bunshin mesh (bun 1.4.0). Local host ran no `bun test`.
Workspace: `/tmp/lcx-shape-20260912b/omo` = shallow clone of `fix/lazycodex-beta-release-channel` @ f132166.

## What was tested
- GREEN: every `*.test.ts` that reads `publish.yml` (19 files) against the branch workflow.
- RED: the new `publish-lazycodex-channel-workflow.test.ts` plus the four updated suites against `origin/dev`'s
  `publish.yml` (1598 lines, swapped in via `git show origin/dev:...`, restored afterwards).
- `bun run typecheck:script` (tsgo) on the branch.
- actionlint locally (`-shellcheck=''`, the CI setting): clean.

## What was observed
```
HEAD=f132166
--- green ---
 97 pass
 0 fail
Ran 97 tests across 19 files. [4.02s]
--- red ---
 28 pass
 12 fail
Ran 40 tests across 5 files. [355.00ms]
(fail) LazyCodex publish channels > every channel that publishes lazycodex-ai also syncs the marketplace and cuts the LazyCodex release [0.15ms]
(fail) LazyCodex publish channels > lazycodex_only is a dispatch input that reaches the provenance-safe child under its own tag namespace [0.09ms]
(fail) LazyCodex publish channels > lazycodex_only publishes the base head without stamping and refuses a version either release path already used [0.09ms]
(fail) LazyCodex publish channels > lazycodex_only skips every omo publish, release, and verification surface [0.14ms]
(fail) LazyCodex publish channels > publish-time plugin builds stamp the manifests an unstamped tree would otherwise leave behind [0.09ms]
(fail) LazyCodex publish workflow > publishes a LazyCodex GitHub release only when the marketplace payload changed [0.32ms]
(fail) publish resume idempotency > keeps every resumability guard in the real publish workflow [0.28ms]
(fail) publish resume idempotency > reports the exact guard removed by an in-memory mutation [0.19ms]
(fail) publish resume idempotency > reports the stale-stamp refusal when the head-equality guard is neutralised [0.20ms]
(fail) release and platform publish workflows > publishes platform packages before installable wrappers [0.16ms]
(fail) release and platform publish workflows > validates an existing release tag before redispatching its prepared source [0.12ms]
(fail) test workflows > dispatches a source-pinned publish run before provenance-bearing release operations [0.29ms]
--- tc ---
$ tsgo --noEmit -p script/tsconfig.json
--- dev publish.yml used for RED ---
    1598 /tmp/dev-publish.yml
publish.yml restored clean

EXIT=0
```

## First attempt (commit dedc679, superseded)
5 GREEN failures drove two fixes: the LazyCodex mirror release keeps the #7743 badge rule (no `--prerelease`,
`release-latest-flag.ts`), and every `set -u` script reads `${LAZYCODEX_ONLY:-}` because the stale-stamp harness
executes the prepare step with an explicit env. The first RED attempt was invalid (a `--single-branch` clone has no
`origin/dev`; the swapped file was empty) and was rerun with `git fetch origin dev:refs/remotes/origin/dev`.
```
host=mengmotaMac bun=1.4.0 load={ 5.60 5.83 5.42 }
HEAD=dedc679
INSTALL_EXIT=0

595 packages installed [2.29s]
=== GREEN (branch publish.yml) ===
GREEN_EXIT=1
 92 pass
 5 fail
Ran 97 tests across 19 files. [5.89s]
(fail) omo-ai publish workflow shape > decides the Latest badge from the highest published semver, never from a pre-release flag [0.80ms]
(fail) omo-ai publish workflow shape > publishes omo-ai through beta-only OIDC after every wrapper publish [5.77ms]
(fail) omo-ai publish workflow shape > always runs readiness, dist-tag guard, and live verification [0.36ms]
(fail) test workflows > attaches and verifies release-binary assets on every GitHub release [0.27ms]
(fail) publish.yml prepare-release-state reuse decision > #given the 'release: vX' commit IS the base head #when prepare runs for vX #then it reuses that SHA without pushing [325.01ms]
(fail) omo-ai publish workflow shape > decides the Latest badge from the highest published semver, never from a pre-release flag [0.80ms]
(fail) omo-ai publish workflow shape > publishes omo-ai through beta-only OIDC after every wrapper publish [5.77ms]
(fail) omo-ai publish workflow shape > always runs readiness, dist-tag guard, and live verification [0.36ms]
(fail) test workflows > attaches and verifies release-binary assets on every GitHub release [0.27ms]
(fail) publish.yml prepare-release-state reuse decision > #given the 'release: vX' commit IS the base head #when prepare runs for vX #then it reuses that SHA without pushing [325.01ms]
```

## Why it is enough
The workflow is declarative; its contract is the set of `if:` gates, input plumbing, and shell branches the tests
parse from the real file. RED proves the new assertions distinguish the old contract; GREEN proves the whole shape
suite (including the stale-stamp harness that executes the prepare script) accepts the new one. The live contract is
exercised by the first `lazycodex_only` dispatch after merge; its evidence is posted on #8175.

## What was omitted
Remote hostnames and the raw install log. No secrets were involved.
