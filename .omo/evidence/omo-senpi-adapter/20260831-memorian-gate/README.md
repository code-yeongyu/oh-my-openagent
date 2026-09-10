# Memorian gate - live QA + hermetic gates (plan todo 9)

> **SUPERSEDED — see `post-stale-ctx-fix.md`.** The defect documented below was fixed
> (`d2085bc58` snapshot fix + `d6d2f8b07` persona staging) and the driver re-run: **7/7 PASS**
> (`live-gate-postfix/`). This file is kept verbatim as the original QA capture.

Branch `feat/memorian-gate` @ `32188aa8c4b2c46665e540a8c1c3069bde1767da` (pushed).
Plan: `.omo/plans/memorian-m3-gate.md`, todo 9 with the "Metis fold - Plan-Version 2" corrections.

## VERDICT

**Live QA result: FAIL. A real, reproducible production defect blocks the memorian gate.**

The gate child NEVER spawns in a real senpi session. Every scenario that depends on a spawned
child fails; every scenario that asserts silence passes; the REAL-CHILD smoke gate (which bypasses
the settle path by calling the production payload builder directly) passes completely.

Per the task contract the defect was captured, NOT fixed: no production file was modified.

| # | Scenario | Verdict | Note |
|---|---|---|---|
| a | HAPPY (two-turn injection) | **FAIL** | child never spawned -> no pending -> no turn-2 injection |
| b | DISABLED | PASS | zero entries, no spawn |
| c | NO-CANDIDATES | PASS | runner never spawns |
| d | INVALID-NUDGE | **FAIL** | zero injection observed (correct outcome) but reached by the WRONG cause: the child never ran, so the parent validator was never exercised live |
| e | LOOP | **FAIL** | the filter assertion passes (0 recall-derived projections); the precondition "session really contains an injection" fails because (a) failed |
| f | REAL-CHILD SMOKE (required gate) | **PASS** | real senpi child, exact production argv, NDJSON matches the scripted nudge byte-for-byte |
| g | SINGLE-TURN | **FAIL** | zero entries as intended, but again via the defect rather than via the accepted next-turn semantics |

Hermetic gates at branch HEAD: **4/4 green** (see below). The unit suites pass because they inject
`resolveModelRegistry` as a test double and never exercise a disposed senpi ctx. This defect is
only reachable through a live session, which is exactly the gap this QA exists to close.

## THE DEFECT

`memorian gate launch failed :: "This extension ctx is stale after session replacement or reload."`

Chain, confirmed from a captured stack trace (`live-gate/driver-console.log`, and reproducible via
`repro-stale-ctx.mjs`):

1. `wiring-static.ts` settle handler calls `memorianGateWiring.onSettled(eventCtx)` **fire-and-forget
   by contract** - the comment there states the turn must never wait for the advice.
2. `memorian-wiring.ts` `onSettled` starts an async task: `collectCandidates(eventCtx)` succeeds
   (candidates are found, the runner is entered).
3. `memorian-runner.ts` `launchOnce` calls `this.options.resolveModelRegistry()`.
4. That resolves to `wiring-runtime.ts` `resolveMemoryModelRegistry(lastEventCtx.current)`, which
   READS the `modelRegistry` property off the senpi extension ctx.
5. By then `AgentSession` dispose has run `_extensionRunner.invalidate(...)`
   (`node_modules/@code-yeongyu/senpi/dist/core/agent-session.js:2024`), so the `modelRegistry`
   getter hits `assertActive()` (`runner.js:520`) and throws.
6. `launch()` catches, logs the warning, returns `{ status: "failed" }`. No child, no nudge, no
   pending file, and therefore no next-turn injection - ever.

The facts extractor uses the identical `resolveModelRegistry()` pattern and does NOT break, because
the settle handler `await`s it (`await factsWiringFor(identity).onSettled(sessionId)`) while the
gate is deliberately not awaited. The fire-and-forget contract and the ctx-lifetime requirement are
in direct conflict; the gate loses that race deterministically.

Determinism: reproduced 3/3 in the isolated probe plus 2/2 full driver runs plus the standalone
repro. Never once did the stub child record an invocation.

Scope note (why "-p one-shot" is not a get-out): dispose is not a `-p` artifact - it is
`AgentSession` teardown on session replacement/reload as well. What `-p` does is make the settle and
the dispose adjacent, so the race resolves the same way every time. An interactive session that
settles a turn and is then closed, reloaded, forked, or switched hits the same read of a disposed
ctx. Nothing in the current code sequences the gate's registry read before dispose.

## WHAT WAS TESTED

- **Live harness** `memorian-gate-live-e2e.mjs` (run with `bun run`; the LOOP scenario imports repo
  TypeScript, which node's ESM resolver rejects with `ERR_UNSUPPORTED_DIR_IMPORT`). Adapted from the
  proven M1 driver `20260831-memorian-recall/recall-live-e2e-r2.mjs`. It drives the REAL senpi
  binary through the senpi-qa isolation helpers (`createSandbox`/`seedSandbox`), one fresh sandbox
  per scenario, each with a PREP session that creates the identity repo and a corpus note committed
  at HEAD (`reference/project/test-note.md`).
  - `SENPI_BIN` is pinned to the **worktree's** `node_modules/@code-yeongyu/senpi/dist/cli.js`
    (2026.8.31); the globally installed binary drifts from the version this branch's bundle targets.
  - The plugin is loaded explicitly with `-e packages/omo-senpi/plugin/extensions/omo.js`.
  - The gate child is stubbed through the **production launcher seam**, not a code seam: senpi-task's
    `resolveSenpiExecutable` honors `SENPI_BIN` from the parent env
    (`packages/senpi-task/src/runners/rpc/spawn.ts:92`), and the memory component threads
    `process.env` straight into the runner. The stub records its argv/env/payload and writes scripted
    NDJSON to the real `$MEMORIAN_NUDGE_PATH` sink, so everything downstream of it is production code.
- **Standalone reproduction** `repro-stale-ctx.mjs`: one command, prints `REPRO=CONFIRMED`, cleans up
  its own sandbox.
- **Hermetic gates at branch HEAD**, offloaded per fleet policy to `mengmotaMac` over the bunshin mesh
  (`remote-gates-driver.ts`), in a namespaced temp worktree `/tmp/memorian-gate-qa-20260901`:
  `bun test packages/memory-core/src/`, `bun test packages/omo-config-core/src/`,
  `bun run test:senpi`, `bun x tsgo --noEmit -p packages/omo-senpi/tsconfig.json`.
- **Committed plugin bundle** rebuilt with `bun packages/omo-senpi/plugin/scripts/build-extension.mjs`
  and verified to contain the new wiring symbols before committing.

## WHAT WAS OBSERVED

### Live driver (`live-gate/driver-result.json`, console in `live-gate/driver-console.log`)

- `result: FAIL`, 7 scenario verdicts as tabled above (3 PASS, 4 FAIL).
- Every FAIL reduces to one root cause: `STUB_INVOCATIONS=0`. The stub child was never launched in
  any scenario, in either driver run.
- The stale-ctx warning appears on the parent's stderr on exactly the turns where candidates existed
  (HAPPY, INVALID-NUDGE, SINGLE-TURN) and is absent where the gate correctly declined to run
  (DISABLED, NO-CANDIDATES).
- **REAL-CHILD (the required gate) passed on all 4 assertions** - this is the load-bearing positive
  result. Calling the production `prepareMemorianSpawn` and running the argv it produced:
  - `--no-extensions` is present TOGETHER with `-e <runDir>/nudge-extension.ts` (the fold's R1
    correction holds live: `--no-extensions` suppresses discovery only, never explicit `-e`).
  - `--tools nudge,read` exactly (fold R2).
  - the real child booted and exited 0, and the NDJSON it wrote was
    `{"path":"reference/project/test-note.md","hint":"Rebase the oldest reviewed branch first so the dependent stack never inverts."}`
    - matching the scripted tool call byte-for-byte. The mock provider CAN script tool calls, so the
    strong form of the assertion was used, not the weaker advertised-tool-list fallback.
  - Artifact: `live-gate/real-child-state.json` (full production argv, argv actually run, NDJSON).
- LOOP's substantive assertion passed: over the real HAPPY session entries,
  `projectSessionEntries` produced 4 projections, 0 of them recall-derived
  (`live-gate/loop-facts-projection.json`). Its precondition failed only because scenario (a)
  produced no injection to re-ingest.

### Isolation

- `realSenpiUntouched: true` - real `~/.senpi/agent` digest identical before/after
  (`4a361868d294` both sides, volatile paths excluded).
- `realOmoMemoryUntouched: true` - the attributable footprint under the real `~/.omo/memory`
  (412 agent dirs) gained zero pending-nudge files and zero copies of this run's corpus note.
  A whole-directory digest is deliberately NOT used: a live host session writes there continuously,
  so it could not attribute a change to this QA.
- `providedSenpiCodingAgentDir: IGNORED` - the drivers build their own agent dir.
- Every sandbox removed and verified absent (`cleanup: every sandbox removed` PASS).

### Hermetic gates (`remote-gates/`, all EXIT=0)

| Gate | Result |
|---|---|
| `bun test packages/memory-core/src/` | 615 pass / 0 fail, 76 files, 121.97s |
| `bun test packages/omo-config-core/src/` | 204 pass / 0 fail, 33 files |
| `bun run test:senpi` | build + tsgo + **2497 pass / 0 fail across 331 files**, then 10 pass (evidence-dir test) |
| `bun x tsgo --noEmit -p packages/omo-senpi/tsconfig.json` | `TSGO_NO_DIAGNOSTICS` |

Worktree HEAD verified equal to the pushed tip before running
(`02-head-is-pushed-tip.txt`: `HEAD_MATCHES_PUSHED_TIP`).

**Teardown receipt** (`remote-gates/99-teardown.txt`): `TEARDOWN=REMOVED`,
`DIR_CONFIRMED_ABSENT` for `/tmp/memorian-gate-qa-20260901`, and the mac's main checkout
`status --porcelain` shows only two pre-existing evidence-file modifications unrelated to this run
(present in the `00-...-clean-before` snapshot too). No stray worktree left behind.

## WHY IT IS ENOUGH

- The failing path is proven at the level that matters: a real senpi process, the real plugin bundle,
  the real launcher resolution, the real settle event. The stub replaces only the model-backed child,
  which is the one component whose judgment is not under test here.
- The defect is not inferred from a log line: the stack trace names the throwing frame
  (`assertActive` -> `modelRegistry` -> `launchOnce`), and a standalone script reproduces it in one
  command.
- The positive half of the feature is genuinely proven, not assumed: REAL-CHILD boots a real child on
  the exact production argv and gets the exact scripted NDJSON back, so the nudge tool, the `-e` +
  `--no-extensions` combination, the `--tools` allowlist, and the extension's NDJSON append all work.
  Once the ctx-lifetime defect is fixed, the remaining scenarios exercise wiring whose two ends are
  each already verified.
- Silence scenarios (DISABLED, NO-CANDIDATES) pass for the right reason: no stale-ctx warning is
  emitted on those turns, so the gate declined before ever reaching the registry read.
- Gate coverage is at the exact pushed commit on an independent machine, with tsgo clean and 3300+
  unit tests green, so the failure is isolated to the live-only seam.

### Residual risk

- The exact fix is not prescribed here (out of scope for this node). The two obvious shapes -
  resolving the registry synchronously at settle before handing it to the async task, or awaiting the
  gate launch - trade off differently against the "gate never blocks the turn" guardrail, and that
  decision belongs to the implementing todo.
- Scenarios a/d/e/g remain unproven end to end until the defect is fixed; they must be re-run, not
  waived, because d and g currently reach the right observable outcome through the wrong mechanism.

## WHAT WAS OMITTED

- No secrets, tokens, auth headers, or credential material appear in any artifact. The sandbox
  `auth.json` holds only the literal mock key `"mock"` for the fake `omo-mock` provider, and those
  sandboxes were deleted.
- Session JSONL is included only for the HAPPY scenario (`live-gate/happy-final-session.jsonl`); the
  other scenarios ship distilled state JSON instead of full transcripts, since their assertions are
  about absence and the raw logs add no reviewable signal.
- Remote gate logs are the drivers' own captured stdout/stderr, tail-trimmed by the driver at 40
  lines per step in the console stream; the full per-step files are included verbatim under
  `remote-gates/`.
- The mac's unrelated pre-existing worktrees and its two modified evidence files are shown in the
  teardown receipt for honesty but were not touched by this run.
- No production source file was modified. A temporary one-line stack-trace log was added locally to
  identify the throwing frame, then reverted; the rebuilt bundle is byte-identical to the committed
  one, confirmed by a clean `git status` after rebuilding.

## FILES

| Path | What |
|---|---|
| `memorian-gate-live-e2e.mjs` | the live driver (7 fold-final scenarios) |
| `live-gate/driver-result.json` | machine verdict: result, 7 scenario verdicts, isolation, cleanup |
| `live-gate/driver-console.log` | full driver console output incl. the stale-ctx stack trace |
| `live-gate/real-child-state.json` | REQUIRED GATE: production argv + real child NDJSON match |
| `live-gate/happy-*.json`, `happy-final-session.jsonl` | HAPPY turn-1/turn-2 state and raw session |
| `live-gate/{disabled,no-candidates,invalid-nudge,single-turn}-state.json` | per-scenario state |
| `live-gate/loop-facts-projection.json` | re-ingestion filter proof over the live session |
| `repro-stale-ctx.mjs` / `repro-stale-ctx-output.txt` | one-command defect reproduction |
| `remote-gates-driver.ts` | bunshin driver for the hermetic gates + mandatory teardown |
| `remote-gates/*.txt` | per-gate remote logs, `99-teardown.txt` is the teardown receipt |
