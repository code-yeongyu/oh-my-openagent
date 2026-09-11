# Runtime fallback timeout: bounded failure QA

Date: 2026-09-01
PR: https://github.com/code-yeongyu/oh-my-openagent/pull/6669
Issue: #6637
Requested by: MoerAI review, https://github.com/code-yeongyu/oh-my-openagent/pull/6669#pullrequestreview-3898079500
("Then rerun current required CI and commit isolated provider-backed OpenCode
QA evidence under `.omo/evidence/`.")
HEAD at time of this QA: `904e13025`

## Scope

Verified the runtime-fallback change that makes a rejected `session.timeout`
fallback dispatch consume the attempt budget, and that surfaces a
caller-visible terminal failure once the fallback budget is exhausted, plus
the two ownership follow-ups from cubic-dev-ai's re-review:

- `packages/omo-opencode/src/hooks/runtime-fallback/auto-retry-timeout.ts`
  - rejected timeout dispatches consume the attempt budget instead of
    rewinding it
  - `failSessionFallbackTerminally()` ends the lifecycle with a toast + a real
    session abort instead of leaving the caller waiting forever
  - the post-rejection rollback and the terminal abort each revalidate
    ownership by value (not just object identity) before mutating or
    aborting, so a superseding retry that advances the same `FallbackState`
    object is never clobbered
- `packages/omo-opencode/src/hooks/runtime-fallback/auto-retry-timeout.test.ts`
  - timing races replaced with the deterministic fallback test clock
  - dedicated tests for the terminal-failure surface and both ownership fixes
- `packages/omo-opencode/src/hooks/runtime-fallback/auto-retry-timeout-prompt-gate.test.ts` (new)
  - drives the real internal-prompt gate (not a stub) through reserved
    rejection, active-queue acceptance, and a stale-completion-without-
    duplication case that exercises the gate's own `shouldDispatch`
    (`isCurrentFallbackGeneration`) revalidation

The change is layered on top of the merged #6611 generation-safe timeout and
queued-dispatch lifecycle (the branch was rebased onto current `dev` and that
lifecycle is untouched).

## Safety and environment

- Installed opencode: `1.18.18`
- Bun: `1.3.13`
- `sqlite3` and `tmux` are absent from this host and were supplied through
  `nix-shell -p sqlite tmux`.
- Every command that spawned opencode ran with a unique temporary `HOME`,
  `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME`, and
  `TMPDIR`.
- Real provider credential variables were unset. The only provider reachable
  from any sandbox was a local fake HTTP server bound to `127.0.0.1`.
- Auto-update and model fetching were disabled.
- All sandboxes, the fake provider process, and the isolated servers were
  removed at the end of each run.

## Results

### Harness self-check: PASS

```bash
nix-shell -p sqlite tmux --run \
  'bash .agents/skills/opencode-qa/scripts/lib/common.sh --self-check'
```

All 5 checks PASS, including isolated-HOME setup and automatic sandbox
cleanup. See `common-self-check.txt`.

### Isolated plugin load: PASS

An isolated opencode configuration loaded the worktree plugin at HEAD from
`file://<WORKTREE>/packages/omo-opencode/src/index.ts`. `opencode debug
config` exited `0` and rendered the full merged agent set. See
`isolated-plugin-load.txt` (`DEBUG_CONFIG_EXIT=0`). Live DB session count was
unchanged before and after (`987` -> `987`).

### Isolated CLI run: PASS

`opencode run "say hi" --format json` inside a separate isolated sandbox (no
provider credentials) produced a structured error event instead of hanging,
and the plugin logged its `ENTRY - plugin loading` line against the sandbox
directory. See `isolated-cli-run.txt`. Live DB session count was unchanged
before and after (`987` -> `987`).

### Provider-backed lifecycle attempt: PARTIAL (same result as the prior QA
round on this environment)

`provider-lifecycle-driver.sh` boots an isolated `opencode serve`, points the
`openai` provider at `fake-silent-provider.mjs`, and enables
`runtime_fallback` (`timeout_seconds: 5`, `max_fallback_attempts: 2`) through
`~/.omo/omo.jsonc` under the `[opencode]` harness block. The fake provider
answers the first request with a retryable HTTP 429 quota message and then
accepts every later request without ever responding - the shape described in
#6637.

Observed (`hanging-provider.log`, `provider-server-lifecycle.txt`):
- the isolated server came up (`CONFIG_OK`) and a session was created,
- the fake provider recorded `QUOTA_429 call=1` followed by a `HANG_REQUEST`
  call, so the silent-provider condition was genuinely produced.

Not claimed: a full live `Session fallback timeout reached` ->
`Session fallback exhausted` sequence was not reproduced against the live
opencode server in this run. Reproducing the full escalation needs opencode
to keep the session in a state where the internal retry loop repeatedly
surfaces the same rejected fallback dispatch, and that did not occur reliably
within the bounded run window on this sandboxed host, matching the earlier QA
round for this same driver. This is an environment limitation of driving a
live `opencode serve` process against a synthetic provider, not evidence
against the fix.

Live DB isolation for this run: `987` -> `987` (delta `0`), and
`SELECT count(*) FROM session WHERE directory LIKE '/tmp/%'` returned `0`, so
no sandbox session reached the real database.

### Deterministic gate coverage (the actual proof of the fix): PASS

`auto-retry-timeout-prompt-gate.test.ts` drives the real internal-prompt gate
(`dispatchInternalPrompt` through `createAutoRetryHelpers`), not a stub, and
now covers three cases:

1. A genuine session reservation makes the gate return `reserved`; the
   dispatcher exhausts its reserved-retry backoff, no prompt is ever sent, the
   attempt count advances monotonically to the cap, and the caller is failed
   terminally with a single `Model Fallback Failed` toast.
2. A `busy` session status makes the gate return `active`; the dispatch is
   queued and accepted, and exactly one prompt is sent for that accepted
   retry.
3. A timeout dispatch is queued behind a still-active session, and the
   session's `FallbackState` is replaced with a fresh generation before the
   queue drains. The gate's own `shouldDispatch` revalidation
   (`isCurrentFallbackGeneration`) sees the generation change and the queued
   entry is dropped without ever sending a prompt for the stale generation -
   proving "reject stale completion without duplication" against the real
   gate, per MoerAI's explicit request. Confirmed this case fails (a
   duplicate prompt is sent for the stale generation) when the dispatcher's
   `shouldDispatch` wiring is removed, and passes with it in place.

All timing in both test files is driven by `installRuntimeFallbackTestClock`;
no wall-clock races remain.

Both ownership fixes from cubic-dev-ai's re-review are covered the same way:
each has a unit test in `auto-retry-timeout.test.ts` that fails when the
corresponding value-level ownership check is reverted to identity-only (or
removed), and passes with the fix in place. This was verified by temporarily
reverting each fix locally and re-running the affected test before restoring
it.

### Test suites and typecheck: PASS

- Focused: 11 tests pass / 54 expects (`focused-tests.txt`).
- Runtime-fallback suite: 293 tests pass / 575 expects
  (`runtime-fallback-suite.txt`).
- `tsgo --noEmit -p packages/omo-opencode/tsconfig.json` exit `0`
  (`typecheck.txt`).

## Why this is enough

The behavior this change introduces and the ownership follow-ups it required
are state-machine properties: a rejected dispatch must consume an attempt,
the exhausted budget must end the lifecycle instead of re-arming it forever,
and neither the rollback nor the terminal abort may act on a `FallbackState`
a newer retry has already taken over. Every one of those properties is
exercised against the real prompt gate with real reservations, real
session-status rejection, and the gate's own generation-revalidation
mechanism - the same code path that produced the infinite loop in #6637. The
plugin was additionally proven to load and run under a real installed
opencode, in full isolation from the operator's live database, both with and
without a reachable (fake-backed) provider.

## What was omitted

- No provider API keys, tokens, or auth headers were used or captured; the
  only credential in any artifact is the literal placeholder
  `sk-fake-local-only` accepted by the local fake server.
- `provider-server-plugin.log` is the sandboxed plugin log copied verbatim; it
  contains no secrets because the sandbox had no real credentials.
- A live end-to-end `Session fallback exhausted` capture against a real
  `opencode serve` process is explicitly not claimed, for the environment
  reason stated above; the gate-level test is the load-bearing evidence for
  this behavior.
