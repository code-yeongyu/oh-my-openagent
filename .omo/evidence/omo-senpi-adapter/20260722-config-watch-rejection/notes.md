# QA Evidence — config-watch rejection re-register loop fix

Change: `packages/omo-senpi/src/components/config-watch/` — stop the
synchronous re-registration recursion on `config-watch:rejected` and stop
emitting watch targets that senpi's config-reload host deterministically
rejects.

Root cause: when cwd is under `$HOME`, the ancestor walk emitted a bare-`$HOME`
creation target. That target covers the senpi agent dir's protected paths
(`<agent>/auth.json`, `sessions/`, `logs/`), so senpi's restricted-target check
rejected the registration EVERY time. The omo REJECTED handler re-emitted
`config-watch:register` synchronously on the same stack, recursing with senpi's
synchronous rejection until `RangeError: Maximum call stack size exceeded`.

## What was tested

1. Repro driver (real component + a fake senpi host that rejects every
   registration synchronously, mimicking the deterministic restricted-target
   rejection), run BEFORE the fix: process crashed with
   `RangeError: Maximum call stack size exceeded` after 7,954 synchronous
   re-registrations. See `emit-sequence-before.log`.
2. Same driver AFTER the fix: survives; emit sequence is bounded at
   1 initial registration + 3 deferred retries, then stops.
   See `emit-sequence-after.log`.
3. Unit: `bun test packages/omo-senpi/src/components/config-watch` ->
   29 pass / 0 fail (3 new + 1 updated case in `index.test.ts`, 2 new cases in
   `paths.test.ts`). See `test-and-typecheck.log`.
4. Scoped typecheck: `tsgo --noEmit -p packages/omo-senpi/tsconfig.json` ->
   exit 0. See `test-and-typecheck.log`.

New/updated unit cases:

- paths: default agent dir under fake HOME -> no emitted target contains or is
  contained by `<home>/.senpi/agent/{auth.json,sessions,logs}`; the bare-HOME
  ancestor creation target is dropped while cwd..work ancestors stay watched.
- paths: explicit `SENPI_CODING_AGENT_DIR` under HOME -> covering ancestor
  dropped; existing tests pin the agent dir OUTSIDE home so the full
  cwd-to-home walk stays covered.
- index: REJECTED no longer synchronously re-emits (emit count stays 1 until
  the deferred timer fires) and the refreshed registration keeps the sticky
  validator.
- index: a deterministic rejecting host produces exactly 4 register emissions
  (1 + 3 capped retries), then silence, with one
  `retry budget exhausted` warning and no stack overflow.
- index: a changed registration payload (repair landing) resets the retry
  budget and re-registers again.

## What was observed

- Before: `{"result": "crashed", "error": "RangeError: Maximum call stack size
  exceeded.", "registerCount": 7954}`.
- After: `{"result": "survived", "registerCount": 4}` — sequence
  `REGISTER#1..#4` only; each retry fires on its own macrotask
  (`setTimeout(0)`), so the host's synchronous rejection can never recurse.

## Why it is enough

The recursion had exactly two ingredients, and both are now pinned by tests:
the omo handler never re-registers on the rejection's own stack (deferred +
capped retry), and the resolution never emits a target the senpi host must
reject deterministically (restricted-path filter). The unit suite covers the
wire behavior against the same fake-event harness the pre-existing tests use;
the repro driver covers the real component end to end against the exact host
behavior that caused the crash. No live senpi session is required: the host
contract exercised (synchronous deterministic REJECTED) is the documented
senpi-side behavior and is reproduced verbatim by the fake host.

## What was omitted

- No real senpi agent dir was touched; the repro uses a fake HOME and an
  in-memory event bus. No tokens, credentials, or environment dumps recorded.
