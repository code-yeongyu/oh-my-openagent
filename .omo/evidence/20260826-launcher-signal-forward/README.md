# Evidence: omo launcher signal forwarding + stale-orphan doctor

Branch `fix/launcher-signal-forward`, base `origin/dev` (a17b91cdc). Host: macOS 25.6.0 (arm64),
bun 1.4.0, node v26.7.0. Every artifact here was produced in this worktree; the main checkout and
every other worktree were never touched.

## WHAT WAS TESTED

1. **The launcher chain's reaction to a signal, on a real pty.** `packages/omo-native/test/pty-signal-qa.py`
   boots the real chain (`node bin/omo.js` -> optional bun re-exec -> the real pinned senpi engine,
   TUI and all) inside a session whose leader OUTLIVES the launcher, then sends `SIGTERM` to the
   **launcher only** and watches what happens to every descendant.

   The session layout is the load-bearing part: if the launcher were the session leader, killing it
   would make the kernel `SIGHUP` the foreground process group and the engine would die from that
   instead of from anything the launcher did - the bug would be invisible. A "shell" process owns
   the pty and stays alive, exactly like a user's terminal.

2. **The two spawn layers as units.** `packages/omo-native/test/child-process-signal.test.ts` drives
   the real helper in real child processes: SIGTERM/SIGHUP forwarding, SIGINT NOT being forwarded,
   exit-code passthrough, death-by-signal fidelity, and the bounded grace window when a child
   ignores the signal. It covers both layers (`spawnNode` and `maybeReexecUnderBun`).

3. **Stale-orphan detection and reap safety.** `packages/omo-native/test/doctor-stale-engines.test.ts`
   plus live runs of the worktree `omo doctor` against this machine's real process table.

## WHAT WAS OBSERVED

| file | scenario | result |
| --- | --- | --- |
| `00-baseline-package-tests-clean-env.txt` | `bun test packages/omo-native/test` on the unmodified base | 175 pass / 0 fail |
| `00-baseline-package-tests-polluted-env-summary.txt` | same run with this shell's inherited `OMO_CODING_AGENT_DIR` | 165 pass / 10 fail - all in doctor/setup tests that assert the unconfigured default agent dir; an inherited override wins over the fixture's `SENPI_CODING_AGENT_DIR`. Environment-induced, present on the untouched base, unrelated to this change. Every later run scrubs those variables. Summarized instead of copied because the raw output embeds this machine's harness/provider inventory. |
| `01-red-unit-tests.txt` | **RED**, captured BEFORE any production edit | `SyntaxError: Export named 'classifyEngineProcesses' not found` (doctor file did not exist yet) and 4 forwarding failures: `timed out waiting for SIGTERM/SIGHUP` (spawnSync forwards nothing) plus the SIGINT case dying instantly |
| `02-red-pty-qa.txt` / `02-red-pty-transcript.txt` | **RED** pty QA, pre-change `bin/` checked out from `origin/dev` into `/tmp/omo-prechange` | engine reparented to PPID 1 and still running; `ORPHANED: True`, `ENGINE_TERMINAL_RESTORED: False`, launcher died `signal=15` |
| `03-red-pty-bun-reexec-qa.txt` / transcript | **RED** pty QA, same pre-change chain with `OMO_RUNTIME=bun` | BOTH the bun launcher and the engine survive: `FAIL 2 process(es) survive launcher SIGTERM` |
| `04-green-pty-qa.txt` / transcript | GREEN, node chain | `SURVIVING_PIDS_AFTER: []`, engine gone 0.74s after the signal, `ENGINE_TERMINAL_RESTORED: True`, launcher `exit=0` |
| `05-green-pty-bun-reexec-qa.txt` / transcript | GREEN, three-deep bun chain (node launcher -> bun launcher -> engine) | `SURVIVING_PIDS_AFTER: []`, engine gone 0.41s after the signal, terminal restored, launcher `exit=0` |
| `06-green-doctor-live-report.txt` | `omo doctor` against this machine's live process table | reports the real stale engines (75183, 90387, 90878 and two more) with pid/age/tty and the explicit reap command. **Report only - nothing was signaled.** |
| `07-green-doctor-reap-refusals.txt` | `--reap` with no pid, with a live attached engine (12811), with a non-engine pid, with a non-numeric pid | all four refused, `exit=1` each, and every named process still alive afterwards |
| `08-green-doctor-reap-owned-fixture.txt` | a HARNESS-OWNED orphan shaped exactly like a stale engine (double-forked, PPID 1, engine-marker cmdline) | reported as stale, reaped by explicit pid, gone; the user's 75183 / 90387 / 90878 untouched before and after |
| `09-green-package-tests.txt` | `bun test packages/omo-native/test` after the change | 200 pass / 0 fail |

`ENGINE_TERMINAL_RESTORED` is what proves the engine ran ITS OWN shutdown rather than merely
disappearing: the engine's graceful signal path restores the terminal on the way out (`ESC[?25h`,
`ESC[?2004l`), and those bytes are only counted when they arrive AFTER the SIGTERM. The RED
transcripts end mid-TUI with no restore; the GREEN ones end with it.

## WHY IT IS ENOUGH

The RED/GREEN pair runs the same harness against the same real surface (real pty, real engine,
real TUI), differing only in the launcher code under test, and covers both spawn layers - the
`OMO_RUNTIME=bun` run exercises the three-deep chain a published `bun add -g omo-ai` install
actually has. The unit suite pins the contract at the seam (forwarding, non-forwarding of SIGINT,
exit fidelity, grace ceiling) so a future refactor cannot silently reintroduce `spawnSync`. Doctor
safety is proven on the real process table: every unsafe spelling refused against live user
processes, and the success path proven on a process this evidence run created itself.

## WHAT WAS OMITTED

- Windows behavior is not exercised here (no host). The implementation installs no signal handlers
  on win32, where `process.on("SIGTERM")` never fires and `subprocess.kill` would terminate a child
  abruptly; the wait itself is the whole behavior there, and the existing suite covers the
  win32-path unit contracts.
- The pty transcripts are raw terminal output (ANSI + TUI frames) from an isolated agent directory
  (`/tmp/omo-pty-signal-qa-agent`, `PI_OFFLINE=1`); no credentials, tokens, or model traffic appear
  in them. The real `~/.omo/agent` was never used by any harness run.
- `01-red-unit-tests.txt` is the pre-implementation transcript. Two cases were refined afterwards
  (the SIGINT case now also asserts that the launcher keeps waiting instead of dying under the
  child, and the doctor reap-success case gained explicit parameter types); their names in the RED
  transcript therefore differ slightly from the final suite. The failing behavior it records - no
  forwarding at all, no doctor exports - is the behavior the change fixes.
- Live stale PIDs 75183, 90387, 90878 belong to the user and were treated as read-only fixtures
  throughout. They are still running.
