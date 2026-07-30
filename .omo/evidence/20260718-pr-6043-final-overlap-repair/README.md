# PR 6043 final overlap repair

## What was tested

- Failing-first regressions for a stale status transaction restoring a detached watchdog over a replacement retry owner and for a coalesced watchdog/status abort leaking ownership into the next genuine user abort.
- Generation-token regressions for payload-fetch cleanup and watchdog response-pending cleanup.
- The complete runtime-fallback suite, repository TypeScript typecheck, scoped Biome, no-excuse rules, diff integrity, and the 250 pure-LOC ceiling.
- The real OpenCode adapter over HTTP and SSE with a local fake provider in an isolated HOME/XDG sandbox.

## What was observed

- The pre-repair branches failed both overlap regressions: the stale watchdog fired again and the coalesced internal terminal was not consumed correctly.
- The repaired focused matrix passed 6 tests with 15 expectations.
- The complete runtime-fallback suite passed 372 tests with 776 expectations; typecheck, Biome, no-excuse, and source integrity passed.
- Live QA observed two active roots, restored the older root after deletion of the newer root, dispatched watchdog fallback once, did not re-arm after success, and classified a later user abort as external.
- The real OpenCode database remained at 5751 sessions, the isolated sandbox was removed, and source hashes were unchanged during QA.

## Why it is enough

The failing-first tests directly exercise the production watchdog ownership transfer and abort request implementation, so they discriminate both repaired races. The token tests cover the generation cleanup added by the preceding repair. The full suite covers adjacent retry, timeout, deletion, delayed-terminal, and fallback behavior, while the live run proves the composed plugin and actual OpenCode event path.

## What was omitted

Raw environments, credentials, authorization headers, and secret-bearing service logs were not captured. Cubic review remains skipped under the team-wide exhausted quota authorization through August 1, 2026.
