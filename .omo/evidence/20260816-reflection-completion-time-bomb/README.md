# QA Evidence: reflection completion fixture time bomb

Change scope: test-only fix in
`packages/omo-senpi/src/components/memory/worker/completion.test.ts`.

## WHAT WAS TESTED

- Root cause: the shared `record()` fixture hardcoded
  `finishedAt: "2026-08-09T12:00:01.000Z"`. `consumePendingReflectionCompletions`
  (`completion-delivery.ts`, `COMPLETION_MAX_AGE_MS` = 7 days against `Date.now()`)
  silently consumes records older than 7 days: no `appendEntry`, no notify. The fixture
  therefore expired at 2026-08-16T12:00:01Z, and from that instant the two tests that
  assert detailed delivery ("pending offline completion" and "throwing reflection UI")
  fail on every platform. This matches the dev CI red that started today
  (run for merge commit `3cb1d63c4`, jobs `test (*)` / `senpi-compatibility (*)`).
- Fix: fixture timestamps are now derived from `Date.now()` (started -60s / finished
  -59s), and the two assertions that pinned the literal string now reference the fixture
  constant. No production code changed; every behavioral assertion is preserved.
- Sweep: scanned `packages/omo-senpi/src/components/memory/` for other hardcoded ISO
  dates flowing into real-clock freshness cutoffs. `completion-delivery.ts` is the only
  `Date.now()` cutoff consumer; all other dated fixtures pair with an injected `now`
  (e.g. `run-finalization-*`, `dream-trigger.test-support.ts` `NOW_MS`) or feed
  clock-free code (`health.ts` has no `Date.now`).

## WHAT WAS OBSERVED

- BEFORE (clean origin/dev checkout, after 2026-08-16T12:00Z):
  `bun test .../completion.test.ts` -> 8 pass / 2 fail (`api.entries` received `[]`).
- AFTER (this branch): same file -> 10 pass / 0 fail / 39 expect() calls.
- Package gate `bun run test:senpi` (build daemon + stage plugin + typecheck +
  `bun test packages/omo-senpi`): 1728 pass / 6 skip / 0 fail.

## WHY IT IS ENOUGH

The change touches only test fixtures/assertions; the package gate re-runs the entire
omo-senpi suite including the memory worker integration tests, proving no assertion was
weakened and nothing else depends on the literal timestamps. The stale-record behavior
itself stays covered by the dedicated "eight pending completions including two older than
seven days" test, which already used relative timestamps.

## WHAT WAS OMITTED

- No live Senpi QA driver run: per `packages/omo-senpi/AGENTS.md` that surface is for
  adapter code changes; this change contains none.
- No secrets in any captured output; nothing redacted.
