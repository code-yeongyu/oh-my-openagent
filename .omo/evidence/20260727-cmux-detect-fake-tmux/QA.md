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

## Residual

`findTmuxPath()` still probes a bare `cmux` on `PATH` before falling back to a verified `tmux`
path. On this host that fallback finds cmux's `tmux` shim, so command routing works, and
`resolveCmuxCliExecutable()` corrects the executable afterwards. A headless cmux with neither
`cmux` nor a `tmux` shim on `PATH` would still stop at "tmux not found"; that path is unchanged
by this PR.
