# Senpi LSP stale-version sweep version wiring and isolation

## What was tested

This QA covers the Senpi startup process sweep after wiring the effective LSP
daemon runtime version into `sweepStaleLspDaemonVersions`, including supported
paired CLI/version overrides, isolating runtime resolution to that cleanup family,
and stabilizing the diagnostics freshness integration
coverage that failed on the loaded macOS runner.

### Regression test red phase

Command:

```sh
bun test \
  /home/minpeter/.local/share/oh-my-openagent-senpi-pr/packages/omo-senpi/src/components/task/process-sweep.test.ts
```

Observed before the implementation:

```text
error: stale-version sweep was not called
5 pass
1 fail
```

This proves the session-start path did not honor the injected packaged-version
resolver and family sweep dependencies before the wiring seam was implemented.

### Cleanup isolation red phase

Command:

```sh
bun test packages/omo-senpi/src/components/task/process-sweep.test.ts
```

Observed before moving daemon resolution into the stale-version family:

```text
error: unrelated cleanup families did not complete
6 pass
1 fail
```

The injected daemon resolver threw before the three family-level best-effort
boundaries started, reproducing the review finding.

### Active daemon override red/green phase

The packaged daemon is version `0.1.0`, while the regression fixture starts a
paired override contract at version `9.8.7` with a real temporary CLI path.
Before the fix, startup passed no environment to the resolver and selected
`0.1.0` as current:

```text
Expected: "9.8.7"
Received: "0.1.0"
7 pass
1 fail
```

That incorrect current version makes the live `9.8.7` owner a stale candidate.
After startup began resolving the same effective runtime contract as the daemon,
the test ran the real stale-version sweeper and proved only PID 100 from
`v0.1.0` was terminated while active override PID 987 remained alive. Ten
repeated runs passed:

```text
10 pass
0 fail
30 expect() calls
```

The resolver parity cases also reject an unpaired override, relative CLI,
directory CLI, and invalid version exactly as the daemon client does:

```text
4 pass
0 fail
8 expect() calls
```

### Owner-bound daemon termination safety

The current-head security review reproduced two unsafe behaviors in the original
PID-only sweep authorization:

```text
TERM:4242:attested-daemon
ALIVE:4242:unrelated-replacement
KILL:4242:unrelated-replacement
```

It also proved that an unrelated `node ... cli.js daemon` command satisfied the
legacy argv matcher. The stale-version family now preserves the complete owner
record, re-reads it, authenticates `omo/ping` (`params._omo.{protocolVersion,
token}`) with the version `daemon.auth` token, and compares PID, nonce, start
time, endpoint path, and socket identity. The same owner-bound proof runs during
planning, immediately before `SIGTERM`, and again before `SIGKILL`; uncertainty
spares the PID.

Deterministic regressions prove generic argv is insufficient and an identity
change after TERM never receives KILL. One case drives the real
`packages/lsp-daemon/src/request-routing.ts` router so the wire envelope cannot
drift, and one pins the `daemon.auth` token path:

```text
19 process-sweep family tests pass
5 owner-attestation tests pass
0 fail
```

### Targeted regression test

Command:

```sh
bun test \
  /home/minpeter/.local/share/oh-my-openagent-senpi-pr/packages/omo-senpi/src/components/task/process-sweep.test.ts
```

Observed after the implementation:

```text
8 pass
0 fail
12 expect() calls
```

The added assertion dispatched the real `session_start` handler, resolved the
distinct `"9.8.7"` sentinel through the version-resolution seam, and observed
that value at the stale-version sweep dependency. The override assertion also
uses `9.8.7`, deliberately different from packaged `0.1.0`, so the test fails
if startup ignores the effective runtime environment.

The isolation assertion also injects an unreadable daemon metadata error and
proves that CodeGraph and orphaned-proxy cleanup still complete while only the
stale-version family logs a skip.

### macOS diagnostics freshness stabilization

The failed macOS CI run expected the first pull result `stale-pull` but received
`[]` before any cache invalidation occurred. The child-process integration case
used a 60ms freshness budget, which is also the pull request timeout; under the
loaded runner the first response missed that budget.

The two pull-fallback cases now use the existing 500ms integration-test budget.
Both cases were repeated 20 times:

```text
40 pass
0 fail
120 expect() calls
```

The complete `lsp-core` package also passed:

```text
92 pass
0 fail
277 expect() calls
```

### macOS full-suite flake stabilization

The refreshed macOS run proved the diagnostics fallback fix, then exposed two
independent timing assumptions elsewhere in the root suite:

- overlapping Senpi reconciles assumed the second-started RPC child must lose
  ownership, even though either asynchronous respawn can complete first;
- the CodeGraph tree-reaping fixture gave a loaded nested Node process only
  100ms to spawn its descendant and write `survivor.pid`.

The reconcile failure reproduced locally 20 times in 1,000 runs. The corrected
assertion verifies the actual invariant: exactly one child is terminated and
disposed, and the surviving child remains the manager owner regardless of
start order.

```text
1000 pass
0 fail
5000 expect() calls
```

The CodeGraph fixture now starts a readiness listener before spawning the
command. After the descendant writes its PID and signals that listener, the
test resolves an injected timeout trigger that runs the same process-tree
termination path as the production timer. The standard `AbortSignal` listener
is removed when the command settles. This removes wall-clock startup from
the asserted behavior.

```text
100 pass
0 fail
200 expect() calls
```

Affected package gates:

```text
senpi-task: 1035 pass, 0 fail
codegraph-bootstrap: 21 pass, 0 fail
workspace typecheck: exit code 0
```

After materializing the repository's ignored build prerequisites with
`bun run build`, the full root suite passed:

```text
12518 pass
3 skip
0 fail
42864 expect() calls
```

After fetching `origin/dev`, the branch was already current:

```text
behind 0, ahead 5
```

### Senpi package typecheck

Command:

```sh
bun run --cwd /home/minpeter/.local/share/oh-my-openagent-senpi-pr/packages/omo-senpi typecheck
```

Observed result: exit code 0 with no diagnostics.

### Complete Senpi package gate

Command:

```sh
bun run --cwd /home/minpeter/.local/share/oh-my-openagent-senpi-pr test:senpi
```

Observed result:

```text
492 pass
0 fail
1379 expect() calls
```

The gate rebuilt the packaged daemon and regenerated Senpi extension artifacts,
ran the adapter typecheck, and ran all 78 Senpi test files.

### Real Senpi TUI startup

The built PR plugin was installed into the isolated agent directory:

```text
/home/minpeter/.cache/omo-pr-lsp-sweep-qa-20260729
```

`OMO_LSP_DAEMON_VERSION` and `OMO_LSP_DAEMON_CLI` were explicitly unset before
launching the real `senpi --no-session` TUI.

Observed result:

```json
{"badge":true,"staleVersionWarning":false,"unknownVersion":false,"undefinedSuffix":false}
```

The rerun again rendered:

```text
(🏴‍☠️ OmO Native)
```

### Real Senpi RPC startup

The real `senpi --mode rpc --no-session` process was launched with the same
isolated agent directory and without either LSP daemon override variable. A
`get_commands` request confirmed the built plugin loaded its task surface.

Observed result:

```json
{"tasks":true,"staleVersionWarning":false,"unknownVersion":false,"undefinedSuffix":false}
```

The successful `get_commands` response reported both `tasks` and `task-kill`
from the PR worktree's generated `omo.js`. The TUI and RPC were rerun with
`OMO_LSP_DAEMON_CLI` pointing at the built worktree CLI and
`OMO_LSP_DAEMON_VERSION=9.8.7`; the badge, command surface, and clean startup
remained intact with a version distinct from packaged `0.1.0`.

## Why this is enough

- The red/green regression test proves the stale-version sweep receives the
  daemon's effective version and spares a live paired override.
- The resolver-failure regression proves LSP packaging failures cannot suppress
  the independent CodeGraph and orphaned-proxy cleanup families.
- Owner-bound authenticated re-attestation proves stale cleanup cannot signal an
  unrelated recycled PID or escalate after identity changes.
- The repeated diagnostics fallback cases and complete `lsp-core` package gate
  cover the macOS CI failure without changing production timing behavior.
- The complete package gate covers the generated extension bundle and all
  Senpi adapter behavior.
- The real TUI and RPC launches prove that the built plugin starts without the
  version-unknown warning when no environment-variable workaround is present.
- The QA agent directory is isolated from the user's configured Senpi agent
  directory.

## Omitted material

Raw TUI escape sequences, environment dumps, session files, credentials, and
other secret-bearing runtime logs were not recorded. Only the sanitized
boolean observations above are retained.
