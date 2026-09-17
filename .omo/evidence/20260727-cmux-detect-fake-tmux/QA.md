# QA — cmux detection for injected (fake) `TMUX`

- Date: 2026-07-27
- Branch: `fix/cmux-detect-fake-tmux`
- Base: `upstream/dev` @ `465e14b80`
- Related: follow-up to #5811 (residual scope), regression introduced by `efb862ce9`

## Environment snapshot (live cmux host)

| Variable | Value |
| --- | --- |
| `TMUX` | `/tmp/cmux-omo/EA1B0811-BF91-41C9-B103-835E19BBFD5D,EEC79E0A-...,3547666270389273888` |
| `CMUX_SOCKET_PATH` | `/Users/<user>/.local/state/cmux/cmux-501.sock` |
| `CMUX_OMO_CMUX_BIN` | `/Applications/cmux.app/Contents/Resources/bin/cmux` |
| `cmux` on `PATH` | no (only the `tmux` shim that forwards to `cmux __tmux-compat`) |
| cmux app | 0.64.20 |

`isCmuxCompatEnvironment()` returned `false` on this host before the change: `TMUX` does not
contain `cmuxterm` (cmux never writes that string into a socket path — it only appears in the
bundle id `com.cmuxterm.app`), and the `CMUX_SOCKET_PATH && !TMUX` branch cannot fire because
cmux always injects `TMUX`.

## RED rounds

Round 1 — detector reverted to the pre-change expression, everything else kept:

```
(fail) isCmuxCompatEnvironment > #given cmux injected TMUX under a cmux socket directory ...
(fail) runTmuxCommand > #given cmux fake TMUX and cmux CLI reachable only through CMUX_OMO_CMUX_BIN ...
 15 pass / 2 fail
```

`red-1-detector.log`. Only the two new cmux-environment guards fail; every pre-existing test,
including the nested-real-tmux guard added by `efb862ce9`, still passes.

Round 2 — detector fixed, `resolveCmuxCliExecutable` reverted to the hard-coded `"cmux"`:

```
error: Executable not found in $PATH: "cmux"
(fail) runTmuxCommand > #given cmux fake TMUX and cmux CLI reachable only through CMUX_OMO_CMUX_BIN ...
 10 pass / 4 fail
```

`red-2-cli-resolution.log`. This is why the CLI resolution change ships together with the
detector change: flipping detection alone routes every tmux command to a binary that is not on
the agent's `PATH`, which is strictly worse than the placeholder behaviour it replaces.

## GREEN

```
packages/tmux-core                                 107 pass  0 fail
packages/omo-opencode/src/shared/tmux               89 pass  0 fail
packages/omo-opencode/src/tools/interactive-bash     3 pass  0 fail
packages/omo-opencode/src/features/tmux-subagent   166 pass  0 fail
packages/openclaw-core                              67 pass  0 fail
```

`affected-packages-test.log` — 432 pass, 0 fail.

`bunx tsgo --noEmit -p packages/tmux-core/tsconfig.json` and the same for
`packages/omo-opencode` both exit clean. `bun run build` completes.

## Real-harness QA (CONTRIBUTING § QA Discipline)

`live-cmux-driver.ts` imports `spawnTmuxPane` / `closeTmuxPaneWithDependencies` from this
branch's source and runs them against the live cmux host and a live OpenCode server:

```
isCmuxCompatEnvironment()   = true
resolveCmuxCliExecutable()  = /Applications/cmux.app/Contents/Resources/bin/cmux
spawnTmuxPane -> { success: true, paneId: "%5955808489771334554" }
pane content contains placeholder text = false
attach process observed                = true
attach process = opencode attach http://127.0.0.1:53592 --session ses_... --dir ...
closeTmuxPane -> true
```

`live-cmux-driver.log`. The pane runs `opencode attach` from the moment it is created, never
shows the placeholder, and closes cleanly. `list-panes` afterwards shows no leftover pane.

The built artifact was checked against the same live environment (`built-artifact-live-env.log`):
`dist/index.js` reports `isCmuxCompatEnvironment() = true` and resolves the cmux CLI to the real
binary, while still reporting native tmux for a real tmux nested inside a cmux pane.

## Host-dependent test fixed along the way

`packages/omo-opencode/src/shared/tmux/tmux-utils/pane-spawn-runner.test.ts` asserted placeholder
behaviour while letting the real detector run, so it passed only on non-cmux hosts. Once
detection became correct, those four tests failed on a cmux host. They now inject
`isCmuxCompatEnvironment` the same way the `packages/tmux-core` mirror test has since #5811, which
makes them host-independent rather than accidentally green.

`runner.test.ts` additionally clears `CMUX_OMO_CMUX_BIN` / `CMUX_BUNDLED_CLI_PATH` in `beforeEach`
so the suite does not read the host's cmux configuration.

## Whole-repo run on the CI-pinned Bun

The machine's default Bun is 1.3.13 while CONTRIBUTING pins 1.3.12, and `bun test` segfaults on
1.3.13 even on clean `upstream/dev` (`preexisting-full-test-segfault.log`). Bun 1.3.12 was
fetched into a scratch directory and used to reproduce CI conditions.

That run caught a real defect in this branch that the per-package sweep could not see:
`script/package-registration-audit.test.ts` requires every exact re-export shim to be listed in
`docs/reference/re-export-shim-inventory.md`, and the new
`packages/omo-opencode/src/shared/tmux/cmux-cli.ts` shim was missing (`Expected: 318, Received:
317`). Registering it makes that suite 6 pass / 0 fail.

After that fix, the whole-repo run on Bun 1.3.12 reports exactly two failures:

```
(fail) #given the generated Codex installer #when release versions are synchronized ...
(fail) omo-senpi local-path runtime dependencies > #given a symlinked plugin without host hoisting ...
```

Both reproduce identically on a detached checkout of clean `upstream/dev`
(`full-test-bun-1.3.12.log`), so they are pre-existing and unrelated. The summary line is not
reachable locally because Bun crashes during teardown on this host on both versions.

## Other pre-existing failures (reproduced on clean `upstream/dev`)

| Command | Result | Clean-dev result | Log |
| --- | --- | --- | --- |
| `bun run typecheck` | `senpi-task ... Cannot find module 'typebox/value'` | identical | `preexisting-senpi-task-typecheck.log` |
| per-package sweep | 3176 pass / 92 fail in `omo-senpi`, `pi-goal`, `pi-webfetch`, `senpi-task`, `team-core` | identical counts | `preexisting-package-failures.log` |
| `bun run test:codex` | 47 pass / 31 fail | identical | `preexisting-codex-test.log` |

The per-package sweep and `test:codex` were run with the machine default Bun 1.3.13; the counts
above are a like-for-like comparison against clean `upstream/dev` on the same version.

## CI flake observed on macOS type check

`typecheck (macos-latest)` failed once with a compiler crash rather than a type error:

```
panic: Unhandled case in Node.StatementList: Kind(28783) [recovered, repanicked]
##[error]Process completed with exit code 2.
```

On the same commit, `typecheck (ubuntu-latest)`, `typecheck (windows-latest)` and
`format-lint-typecheck-build` (which also runs the type check) all pass. Locally on macOS arm64,
`tsgo --noEmit -p <tsconfig>` was run for every package and none panics; the only reported errors
are the pre-existing dependency-resolution ones (`senpi-task` → `typebox/value`, `web` → `next`),
both of which reproduce on clean `dev`.

A type error introduced by this branch would surface as `error TSxxxx` on all three platforms, so
this is treated as runner-side instability in the pinned `tsgo` dev build.

## Review round 1 — cubic P3 / P2 and the `CHANGES_REQUESTED` follow-up

### P3 — `hasCmuxSocketPath` treated `\` as a path separator

`socketPath.split(/[\\/]/)` split on backslash as well as slash. tmux and cmux both run only on
Unix, where `\` is an ordinary filename character, so the extra separator could only ever widen
detection: a real tmux socket whose directory name contains a backslash, such as
`/private/tmp/tmux-501/weird\cmux-omo`, was split into `weird` + `cmux-omo` and matched the cmux
segment pattern. That is a false positive in the direction this PR exists to prevent — it would
route a genuine tmux session through `cmux __tmux-compat`.

Split is now `/` only, and the doc comment records that this is deliberate rather than an
oversight, which also answers the maintainer's question on the PR ("is the backslash case needed
for Windows cmux, or is it defensive?"): it is neither needed nor defensive, because tmux does
not run on Windows.

RED — new guard against the pre-change detector:

```
(fail) isCmuxCompatEnvironment > #given a tmux socket whose directory name contains a literal
       backslash #when isCmuxCompatEnvironment called #then returns false ...
Expected: false
Received: true
 7 pass / 1 fail
```

`red-3-backslash-separator.log`. Only the new guard fails; every pre-existing test — including
`efb862ce9`'s nested-real-tmux guard and the cmux-injected-`TMUX` case — still passes, so the
narrowing does not disturb either side of the discriminator.

### P2 — the live QA driver could not fail

`live-cmux-driver.ts` logged the three observations it was cited for (placeholder text, `opencode
attach` in the process table, `closeTmuxPane`) and then exited 0 regardless of their values, so
re-running it produced no red/green signal. The three are now collected into explicit failure
conditions that exit non-zero, and the check runs *after* `closeTmuxPaneWithDependencies` so a
failed expectation never leaks a live pane.

### Nested-real-tmux behaviour (confirmation requested in review)

Unchanged and still covered from both directions. `CMUX_SOCKET_PATH` remains a precondition, and
the discriminator is the socket path shape:

| `CMUX_SOCKET_PATH` | `TMUX` | Result |
| --- | --- | --- |
| `/tmp/cmux.sock` | `/private/tmp/tmux-501/default,123,0` | `false` — native tmux nested in cmux |
| `/tmp/cmux.sock` | `/private/tmp/tmux-501/weird\cmux-omo,123,0` | `false` — backslash is not a separator |
| `/Users/…/cmux-501.sock` | `/tmp/cmux-omo/<workspace>,<surface>,<pane>` | `true` — cmux |
| unset | `/tmp/cmux-omo/workspace,surface,pane` | `false` — no cmux socket |

GREEN — every package that imports `isCmuxCompatEnvironment` or the tmux runner:

```
packages/tmux-core                                 108 pass / 0 fail
packages/omo-opencode/src/shared/tmux               89 pass / 0 fail
packages/omo-opencode/src/tools/interactive-bash     3 pass / 0 fail
packages/omo-opencode/src/features/tmux-subagent   166 pass / 0 fail
packages/openclaw-core                              67 pass / 0 fail
```

`review-round-1-green.log`. 433 pass / 0 fail, one more than the 432 recorded above because of
the new backslash guard. `bunx tsgo --noEmit` exits 0 for both `packages/tmux-core` and
`packages/omo-opencode`.

## Review round 2 — removing the `cmuxterm` branch

Round 1 fixed one false positive (backslash as a separator) but left a larger one in the same
function untouched, which was inconsistent. `isCmuxCompatEnvironment` opened with:

```ts
if (tmuxEnvironment?.includes("cmuxterm") === true) return true
```

That branch returned true *before* the `CMUX_SOCKET_PATH` precondition, so any tmux session whose
name contained `cmuxterm` was reported as cmux. Unlike the backslash case, a user picks session
names freely, so this is reachable in ordinary use.

### Why the branch was safe to delete rather than merely guard

The branch was introduced in `8236d7d6b` (2026-05-07) as the second half of
`Boolean(CMUX_SOCKET_PATH) || TMUX?.includes("cmuxterm")` — a backup heuristic for the case where
`CMUX_SOCKET_PATH` is absent. It rests on the assumption that cmux writes its own name into
`TMUX`. Reading the shipped binary shows that it does not.

`strings /Applications/cmux.app/Contents/Resources/bin/cmux`:

| Purpose | Observed strings |
| --- | --- |
| socket paths (all channels) | `/tmp/cmux-ssh-`, `/tmp/cmux-cli-shims`, `/tmp/cmux-debug-`, `/tmp/cmux-nightly-`, `/tmp/cmux-staging-`, `/tmp/cmux-debug.sock`, `/tmp/cmux-nightly.sock` |
| where `cmuxterm` actually appears | `com.cmuxterm.app` (bundle id), `~/.cmuxterm/…` (config dir), `CMUXTERM_CLI_RESPONSE_TIMEOUT_SEC` (env name), `_TtC12CmuxTerminal…` (Swift symbols), `CMUXTERMINFO` (heredoc marker) |

Every socket path is `cmux-` prefixed and `cmuxterm` never appears in one. The live host confirms
it: `TMUX=/tmp/cmux-omo/EE5868C2-…`. So the branch never matched a real cmux session — there is no
"build that does use it" to stay compatible with — while it did mislabel real tmux sessions.

`CMUX_SOCKET_PATH` is now the single precondition and the socket path shape the only
discriminator, which is the rule this PR already stated in its own doc comment.

### RED

```
(fail) #given TMUX contains cmuxterm without CMUX_SOCKET_PATH … #then returns false
(fail) #given a real tmux socket whose session name contains cmuxterm … #then returns false
 8 pass / 2 fail
```

`red-4-cmuxterm-branch.log`. Only the two new guards fail. The release-channel test
(`cmux-omo`, `cmux-nightly`, `cmux-staging`, `cmux-debug`, `cmux-cli-shims`) already passed before
the removal, which is what proves the socket pattern `/^cmux([-.]|$)/` covers every channel on its
own and the branch was redundant.

### Tests that used `cmuxterm` to simulate cmux

Four call sites set `TMUX=/tmp/cmuxterm-test.sock` purely to enter the cmux path, not to assert
anything about the string. They now use the shape a real cmux session has
(`/tmp/cmux-omo/workspace,surface,pane` with `CMUX_SOCKET_PATH` set), so they exercise the real
contract: `pane-auth-cmux.test.ts` (2), `manager-cmux-eligibility.test.ts` (1),
`manager.test.ts` (1, which additionally had to stop deleting `CMUX_SOCKET_PATH`).

### GREEN and live verification

```
packages/tmux-core                                 110 pass / 0 fail
packages/omo-opencode/src/shared/tmux               89 pass / 0 fail
packages/omo-opencode/src/tools/interactive-bash     3 pass / 0 fail
packages/omo-opencode/src/features/tmux-subagent   166 pass / 0 fail
packages/openclaw-core                              67 pass / 0 fail
```

`review-round-2-green.log` — 435 pass / 0 fail. `bunx tsgo --noEmit` exits 0 for both packages.
On the live cmux host the patched detector still returns `true`, and the nested-real-tmux,
backslash, `cmuxterm`-named-session, and `TMUX`-not-injected cases all resolve correctly.

## Review round 3 — Windows CI regression caused by the round 1 fix

`test (windows-latest)` failed on three consecutive pushes after the Unix-only split landed, on a
single test:

```
(fail) runTmuxCommand > #given cmux fake TMUX and cmux CLI reachable only through
       CMUX_OMO_CMUX_BIN #when run #then delegates through that binary
 13368 pass / 1 fail
```

`runner.test.ts` built the fake `TMUX` with `path.join`:

```ts
process.env.TMUX = `${path.join(temporaryDirectory, "cmux-omo", "workspace")},surface,pane`
```

On Windows that yields `D:\a\_temp\xyz\cmux-omo\workspace`. The old `split(/[\\/]/)` happened to
split it and find the `cmux-omo` segment, so the test passed for the wrong reason — the backslash
branch was not dead code after all, it was holding up this one test. Under the Unix-only split the
path is a single segment and the detector correctly reports "not cmux".

Reproduced both states directly:

```
before (path.join → backslash TMUX): false   <- the Windows CI failure
after  (POSIX literal TMUX)        : true    <- passes
```

The fix belongs in the test, not the detector. cmux runs only on macOS and always injects a
`/`-separated socket path, so a backslash `TMUX` is a shape no cmux build produces — the same
"asserting against a fictional environment" problem as the `cmuxterm` test sites in round 2. The
value is now a POSIX literal with a comment explaining why it must not be rebuilt with `path.join`.
`CMUX_SOCKET_PATH` keeps using `path.join`, which is fine because only its presence is checked.

A sweep of every `process.env.TMUX = …` assignment across the test suite confirms this was the
only OS-dependent one; all others were already POSIX literals.

`test (macos-latest)` failed once, on the newest push only, and in an unrelated suite
(`prompt-async-route-audit.test.ts`, "production prompt injection routes") where the first case
timed out at 5018 ms against a 5000 ms limit and the two dependent cases fell over with it. It
passed on the two earlier pushes of this branch and passes on `dev`, so it is treated as a
timing flake rather than an effect of this branch.

### Outcome of the fix

| job | previous three pushes | after `f209aa6e8` |
| --- | --- | --- |
| `test (windows-latest)` | fail, fail, fail | **pass** (12m39s) |
| `test (macos-latest)` | pass, pass, fail | **pass** (5m34s) |
| `test (ubuntu-latest)` | pass, pass, pass | fail — see below |

Windows is green, which closes the regression. macOS passed on unchanged code, confirming the
timeout diagnosis.

### The remaining `ubuntu-latest` failure is upstream, and it is not a timeout

```
(fail) acquireSessionAdmissionLease > #given one stale lease and two racing waiters #when both
       attempt the takeover CAS #then exactly one wins and the loser never deletes the winner's lease
Expected length: 1
Received length: 2
 13403 pass / 1 fail
```

Not this branch: `packages/senpi-task/src/lifecycle/admission-lease.test.ts` does not exist on this
branch at all (`git grep acquireSessionAdmissionLease HEAD` is empty). It lives on `origin/dev`,
which this branch is 336 commits behind, and CI runs the PR merged into `dev`. There is no file
overlap with anything this PR touches.

Worth flagging rather than dismissing, though: the received length is **2**, not 0. Both waiters
acquired the lease, so this is a mutual-exclusion failure rather than a slow-runner timeout — the
test caught precisely what its name describes. `tryTakeover` re-validates
`fresh.token !== observed.token` under the record mutex, so both attempts landing means that mutex
did not serialize them. The lease body keys on `pid` while both waiters are two async tasks in the
same process, which is a plausible reason, but that was not confirmed.

The race did not reproduce locally: the test was run 20 times in a row on a clean `origin/dev`
worktree (macOS arm64, Bun 1.3.13) and passed 20/20, so the window appears to need Linux runner
timing. Re-running the job is expected to go green, and a rebase would not help because the defect
travels with `dev`.

## Review round 4 — rebase onto current `dev` and the `CMUX_AGENT_LAUNCH_KIND` contract

### The issue is still live on `dev`

Checked before doing any work, because a 2,659-commit gap is long enough for a fix to land
independently. It has not. `origin/dev` still carries the regressed expression verbatim:

```ts
const tmuxEnvironment = environment.TMUX
return tmuxEnvironment?.includes("cmuxterm") === true ||
	(Boolean(environment.CMUX_SOCKET_PATH) && !tmuxEnvironment)
```

The only commit to touch `cmux-detect.ts` since this branch forked is `7da0e4d3c`
(`fix(tmux): support inline cmux pane lifecycle`), which parameterises `process.env` for testability
and leaves the condition unchanged. Evaluated against this host's real environment, that expression
still returns `false` inside a cmux omo pane — see `live-signal-inheritance.log` for the environment
and `built-artifact-live-env.log` for the shipped-bundle comparison.

### Rebase

`b072d2791..origin/dev` replayed 14 of the 15 commits with one conflict, in
`docs/reference/re-export-shim-inventory.md`. `dev` had regenerated that inventory (317 → 256
shims, snapshot 2026-08-31), so the original registration commit reduced to an empty diff and was
dropped; the shim is re-registered against the current tree instead, with the counts regenerated
from the scan command the document itself documents rather than incremented by hand
(257 total, `@oh-my-opencode/tmux-core` 3 → 4). No source file this PR touches had drifted on `dev`.

### Reconciling the two signals

The review asked for the socket-shape detection and cmux's `CMUX_AGENT_LAUNCH_KIND=omo` contract to
have a defined precedence rather than being independent paths. The measurement that decides the
order is in `live-signal-inheritance.log`: starting a real tmux server inside a cmux pane passes
`CMUX_AGENT_LAUNCH_KIND=omo` and `CMUX_SOCKET_PATH` through to its children byte-identically, and
only `TMUX` changes to the real socket. The launch kind describes the launcher; the socket path
describes the server a tmux command would actually reach.

So the order is:

1. the `TMUX` socket shape — the only discriminator, and it can veto both env signals;
2. `CMUX_SOCKET_PATH` — the authenticated credential, sufficient on its own once 1 has not vetoed;
3. `CMUX_AGENT_LAUNCH_KIND === "omo"` — accepted only as a stand-in for 2 and only where 1 confirms
   a cmux-shaped socket. Never sufficient alone, so an environment carrying only the launch kind
   fails closed to native tmux.

Matched exactly against `omo`: cmux names the launched agent in this variable and ships a wrapper
shim per agent, so only `omo` carries the `CMUX_OMO_CMUX_BIN` contract `resolveCmuxCliExecutable()`
depends on. A `claude`/`codex` value means this process descends from another agent's launch.

Against the previous head this changes exactly one of the eighteen signal combinations —
`CMUX_SOCKET_PATH` absent, launch kind `omo`, `TMUX` cmux-shaped — which is reachable when a shell
profile scrubs `CMUX_*` while the cmux tmux shim still injects `TMUX`.

### RED

- **`red-5-launch-kind-fallback.log`** — launch kind left unreconciled. 13 pass / 2 fail: the one
  matrix row above, plus the assertion that isolates it. Proves the signal is load-bearing rather
  than documented-but-inert.
- **`red-6-launch-kind-precedence.log`** — launch kind promoted above the socket shape, i.e. the
  naive reading of the request. 12 pass / 3 fail: two nested-real-tmux rows and the fail-closed
  boundary. This is why the launch kind is subordinate rather than primary.

### Checks before the change

- Every non-test reader of `CMUX_SOCKET_PATH` was enumerated, because row 11 makes detection true
  without it for the first time. There are two: the detector itself, and a debug log object in
  `pane-spawn.ts` that reads it optionally. Nothing dereferences it as required.
- `cmuxterm` was re-checked against the shipped app rather than assumed: `~/.cmuxterm/` holds
  config and state and contains no sockets (`find -type s` is empty), while the live socket is
  `~/.local/state/cmux/cmux-501.sock`. Both live socket shapes match `/^cmux([-.]|$)/`, so the
  pattern needs no widening and the removed branch stays removed.
- `killTmuxSessionIfExists` reads a non-zero `has-session` exit as "no such session", and that
  helper now routes through the compat layer for the first time, so the convention was measured:
  `cmux __tmux-compat has-session` exits 1 for a missing session, same as real tmux
  (`cmux-compat-exit-codes.log`).

### GREEN and live verification

- `review-round-3-green.log` — 442 pass / 0 fail across `tmux-core`, `omo-opencode/src/shared/tmux`,
  `omo-opencode/src/tools/interactive-bash`, `omo-opencode/src/features/tmux-subagent` and
  `openclaw-core`, plus `script/package-registration-audit.test.ts` at 6 pass / 0 fail. Both
  affected packages typecheck clean.
- `live-cmux-driver.log` — re-run on the rebased head against the cmux-launched OpenCode server on
  port 64155. Detection true, cmux CLI resolved to the real binary, pane spawned without the
  placeholder, `opencode attach` observed in the process table, pane closed, exit 0.
- `built-artifact-live-env.log` — `bun run build` then the detector driven straight out of
  `dist/index.js`. All eight guards hold in the shipped bundle, including nested-real-tmux.

`cmux-detect.test.ts` now clears `CMUX_AGENT_LAUNCH_KIND` in `beforeEach` alongside the other two
variables. Without that the suite would read this host's cmux configuration and the
"cmux socket directory without `CMUX_SOCKET_PATH`" guard would invert on any cmux machine.

### CI on the rebased head

The first push after the rebase (`e6007ce28`) came back 23 pass / 1 fail, and the failure was
mine. `script/agent-command-string-audit.test.ts` scans tracked sources for uncategorized agent
command strings, and the new doc comment spelled the launch kind as an assignment, which the
scanner reads as one:

```
+   "packages/tmux-core/src/cmux-detect.ts: =omo",
- Expected  - 0
+ Received  + 1
```

It reproduced locally on the first try. Fixed by dropping the value from that one sentence rather
than widening the allowlist — the sentence is about the variable being inherited, and the value is
already carried by `CMUX_OMO_LAUNCH_KIND` and its own doc comment. This is a gate the local
per-package sweep cannot see, the same class of miss as the shim-inventory audit in the original
round.

The same run also reported `omo setup credential inheritance` in `packages/omo-native` as a
5000 ms timeout. That file contains no tmux or cmux reference and is untouched by this PR
(`git log origin/dev..HEAD -- packages/omo-native/test/setup-import.test.ts` is empty), so it is
runner timing rather than this diff.

On `66f651f30` the full protected matrix is **25 pass / 0 fail**, including the `ubuntu-latest`
shard that failed on the pre-rebase head, and `mergeable_state` is `clean`.

## Review round 5 — merged current `dev` (504 commits) and re-verified

`dev` moved 504 commits after the round-4 head, so the branch was brought up to date again. Merge
rather than rebase, matching the merge the repository owner had already made onto this branch, so
no published commit is rewritten.

The merge was conflict-free, and no file this PR touches had drifted: `git log <head>..origin/dev`
is empty for `cmux-detect.ts`, `cmux-detect.test.ts`, `cmux-cli.ts`, `runner.ts`, `index.ts`,
`tools.ts`, the omo-opencode tmux barrel and the shim inventory.

Re-verified on the merged tree rather than assumed inert:

```
packages/tmux-core                                  121 pass / 0 fail
packages/omo-opencode/src/shared/tmux                89 pass / 0 fail
packages/omo-opencode/src/tools/interactive-bash      3 pass / 0 fail
packages/omo-opencode/src/features/tmux-subagent    168 pass / 0 fail
packages/openclaw-core                               68 pass / 0 fail
script/package-registration-audit.test.ts             6 pass / 0 fail
script/agent-command-string-audit.test.ts             2 pass / 0 fail

bunx tsgo --noEmit -p packages/tmux-core/tsconfig.json      exit 0
bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json   exit 0
bun run build                                               exit 0
```

Both repo-wide gates still hold: the shim inventory keeps `cmux-cli.ts` registered at 257 exact
shims, and the agent command audit stays clean after the doc-comment fix.

`live-cmux-driver.log` was re-recorded on the merged head — detection true, cmux CLI resolved to
the real binary, pane spawned without the placeholder, `opencode attach` observed, pane closed,
exit 0 — and the built `dist/index.js` still carries the reconciled detector verbatim.

## Residual

`findTmuxPath()` still probes a bare `cmux` on `PATH` before falling back to a verified `tmux`
path. On this host that fallback finds cmux's `tmux` shim, so command routing works, and
`resolveCmuxCliExecutable()` corrects the executable afterwards. A headless cmux with neither
`cmux` nor a `tmux` shim on `PATH` would still stop at "tmux not found"; that path is unchanged
by this PR.
