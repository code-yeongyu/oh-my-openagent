# Memory reflection worker: empty console window flash on Windows

Change under test: add `windowsHide: true` to every `spawn`/`spawnSync` in the memory reflection
worker launch chain (`spawn-supervisor.ts`, `memory-run-supervisor.ts`,
`supervisor-process-identity.ts`).

## Reported symptom

On Windows, an empty terminal window occasionally flashes open and closes again while omo is
running normally. It is intermittent, not once per turn.

## Mechanism (proven, not assumed)

The reflection supervisor is launched with `detached: true`, which on Windows means
`DETACHED_PROCESS`: the supervisor and everything below it run with **no console at all**. A
console-subsystem program started from a console-less parent gets a **brand new console**, and that
console owns a **visible window** unless the process is created with `CREATE_NO_WINDOW`
(Node's `windowsHide: true`).

The production path that hits this is the win32 tree kill: `terminateSupervisorChildHard` ->
`spawnTerminationCommand` -> `taskkill /pid <pid> /T /F`. That runs only on deadline, hard-kill, and
cleanup paths, which is why the window appears only sometimes.

## What was tested

### 1. Mechanism isolation - `probe-console-allocation.mjs` -> `probe-console-allocation.json`

- **What was tested:** a console-subsystem child (`cmd.exe`) spawned from a detached, console-less
  parent, once without `windowsHide` and once with it. Win32 `AttachConsole` + `GetConsoleWindow` +
  `IsWindowVisible` report whether that child owns a visible console window.
- **Observed result:** without the flag `windowHandle = 4789456`, `windowVisible = true` (a real
  empty console window on the desktop). With the flag `windowHandle = 0`, `windowVisible = false`.
- **Why sufficient:** it pins the exact mechanism behind the symptom, independent of omo code.

### 2. Production path A/B - `qa-taskkill-console.mjs` -> `taskkill-baseline.json`, `taskkill-after.json`

- **What was tested:** the REAL production function `terminateSupervisorChildHard` called from
  inside a detached, console-less process, i.e. the exact shape the supervisor runs as. Only the
  killed command is swapped, through the module's own documented test seam
  (`OMO_MEMORY_SUPERVISOR_TASKKILL_COMMAND`), for a long-lived stand-in so the spawned process can
  be probed while alive. The spawn call and its options are untouched production code.
- **Observed result:**
  - baseline (fix reverted via `git stash`): `windowHandle = 34671160`, `windowVisible = true`,
    `visibleConsoleWindows = 1`.
  - after (fix applied): `windowHandle = 0`, `windowVisible = false`, `visibleConsoleWindows = 0`.
- **Why sufficient:** the user-visible defect (a visible console window) is produced and then
  removed by this change alone, through production code.

### 3. Supervisor chain smoke - `qa-windows-console.mjs` -> `after.json`

- **What was tested:** the real supervisor chain (`memory-run-supervisor.ts` -> child bootstrap ->
  model child) launched end to end with a harmless sleeping stand-in for the model command, probing
  every process in the resulting tree.
- **Observed result:** supervisor, bootstrap, and model child all report `windowHandle = 0`,
  `windowVisible = false`; `processesWithConsoleWindow = 0`.
- **Why sufficient:** it confirms the fixed chain starts and runs with no console window anywhere.
  Note this run does NOT reproduce the defect on the baseline, because the stand-in model command
  never touches a console and therefore never allocates one. The defect reproduction lives in
  evidence 2, which is why that A/B is the load-bearing proof.

### 4. Regression test - `windows-console-hide.test.ts`

- **What was tested:** `bun test packages/omo-senpi/src/components/memory/worker/windows-console-hide.test.ts`,
  a source audit asserting every `spawn`/`spawnSync` in the three chain files passes
  `windowsHide: true`, plus a count assertion so the audit cannot silently stop covering calls.
- **Observed result:** failing-first with the fix reverted (5 offenders: `spawn-supervisor.ts:208`,
  `memory-run-supervisor.ts:47`, `memory-run-supervisor.ts:98`,
  `supervisor-process-identity.ts:115`, `supervisor-process-identity.ts:119`), green with the fix
  (2 pass, 0 fail).
- **Why sufficient:** the flag is invisible at runtime on non-Windows CI, so a source-level audit is
  the only gate that keeps a future spawn in this chain from reintroducing the window.

### 5. Full Senpi package gate - `typecheck-senpi.log`, `test-senpi.log`

- **What was tested:** `tsgo --noEmit -p packages/omo-senpi/tsconfig.json` followed by the complete
  `bun run test:senpi`, the adapter-wide gate AGENTS.md requires for any `packages/omo-senpi`
  change. Both ran on Linux (WSL Ubuntu, node 24.17.0, bun 1.4.0) in a native-filesystem clone of
  this branch at `e7cdeb311` after `bun install --frozen-lockfile --ignore-scripts`, matching the CI
  job environment.
- **Observed result:** typecheck exit 0 with no diagnostics; gate exit 0 with 2114 pass / 0 fail
  across the adapter suite plus 10 pass / 0 fail for the evidence-path contract suite. The
  `error: subscriber exploded` lines in the log are a deliberate fixture in a passing test, not a
  failure.
- **Why sufficient:** it replaces the earlier worker-scoped run and proves the whole adapter gate is
  green on the same OS CI verifies.
- **Note:** the gate cannot complete on this Windows host - `packages/omo-senpi/scripts/qa/task-rpc-e2e.windows.test.ts`
  blocks indefinitely without a Linux-native senpi binary on PATH - which is why the gate was run
  under WSL.

### 6. Live Senpi QA - `live-drive.json` (driver), `probe-live-drive.mjs` (diagnostics)

- **What was tested:** `packages/omo-senpi/scripts/qa/drive.mjs --self-test`, then the live driver
  itself against the REAL `senpi` binary (`@code-yeongyu/senpi@2026.8.20-2`, installed natively in
  WSL) with a decoy `SENPI_CODING_AGENT_DIR` exported by the caller to prove the driver ignores it.
- **Observed result:** self-test `SELF-TEST OK`; live run
  `{"result":"PASS","ultraworkInjected":true,"commentChecker":"PASS","realSenpiUntouched":true,"providedSenpiCodingAgentDir":"IGNORED","sandboxAgentDir":"/tmp/omo-senpi-qa-fPWcOj/agent","sandboxCwd":"/tmp/omo-senpi-qa-fPWcOj/project"}`.
  The decoy agent directory the caller supplied still held 0 entries afterwards.
- **Why sufficient:** it is the harness proof AGENTS.md requires - a real senpi session with this
  branch's plugin loaded, the ultrawork directive reaching the session, the comment-checker lane
  firing, and the real agent directory untouched.
- **Attempts that could NOT produce this proof, recorded so the numbers above are not mistaken for
  something cheaper:** running the driver from Windows fails before senpi starts, because Node
  refuses to `spawnSync` a `.cmd` without a shell (`EINVAL`), and the Windows-installed senpi CLI
  driven by Linux node hangs with no output until the driver's 60s cap (`ETIMEDOUT`, empty
  stdout/stderr, zero sessions written). `probe-live-drive.mjs` is the diagnostic that established
  this: it reuses the driver's own `createSandbox`/`seedSandbox` exports and repeats its exact senpi
  invocation, printing status/stdout/stderr instead of a verdict. A Linux-native senpi install is
  what made the lane runnable.

## Cleanup receipt

`rm -rf /tmp/omo-senpi-qa-* ~/decoy-agent-dir ~/omo-live` - leftover QA sandboxes went from 3 to 0
(the three were left by the timed-out probe runs; the driver removes its own on a completed run).
The Windows console probes tear their process trees down with `taskkill /T /F` inside each script.

## Isolation

The console probes run in a `mktemp` directory under the OS temp dir and spawn only stand-in
processes (`cmd.exe ping`, `node setTimeout`); they involve no senpi binary and no real reflection
run, so no user state could be read or written. The live Senpi QA in evidence 6 does drive a real
senpi binary, and its isolation is the driver's own: an isolated `SENPI_CODING_AGENT_DIR` under
`/tmp`, a caller-provided agent dir reported `IGNORED` and verified empty afterwards, and
`realSenpiUntouched: true`. All spawned trees are torn down per the cleanup receipt above.

## Omitted

The probe scripts inherit `process.env` when launching their stand-in children (the production
supervisor does the same). Captured JSON records only pids, window handles, and process names, so
no environment values, tokens, or credentials are written to disk here.

## Residual risk

`packages/omo-senpi/src/components/memory/commands/people-ask.ts`,
`worker/model-preflight.ts`, and the `init-deep-advisor` git calls also spawn without
`windowsHide`, but they run in the main senpi process, which owns a console, so they inherit it and
show no window. They are left unchanged and out of scope for this fix.
