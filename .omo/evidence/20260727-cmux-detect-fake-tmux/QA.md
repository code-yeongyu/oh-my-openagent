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

## Residual

`findTmuxPath()` still probes a bare `cmux` on `PATH` before falling back to a verified `tmux`
path. On this host that fallback finds cmux's `tmux` shim, so command routing works, and
`resolveCmuxCliExecutable()` corrects the executable afterwards. A headless cmux with neither
`cmux` nor a `tmux` shim on `PATH` would still stop at "tmux not found"; that path is unchanged
by this PR.
