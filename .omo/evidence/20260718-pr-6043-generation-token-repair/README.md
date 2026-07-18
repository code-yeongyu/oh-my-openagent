# PR 6043 generation-token repair

## What was tested

- The complete runtime-fallback suite after binding retry dispatch, payload markers, status inspection, watchdog response provenance, duplicate abort inspection, and abort cleanup to their originating owner or generation.
- Repository TypeScript typecheck, scoped Biome, no-excuse rules, diff integrity, and the 250 pure-LOC ceiling.
- The real OpenCode adapter over HTTP and SSE with a local fake provider in an isolated HOME/XDG sandbox.

## What was observed

- Runtime fallback: 368 passed, 0 failed, 767 expectations.
- Typecheck, Biome, no-excuse, diff check, and 48 pure changed LOC passed.
- Live QA observed two active root sessions, restored the older root after deletion of the newer root, dispatched watchdog fallback once, did not re-arm after success, and classified a later user abort as external.
- The real OpenCode database remained at 5751 sessions; the isolated sandbox was removed.
- Source hashes before and after live QA matched.

## Why it is enough

The unit suite covers the affected retry, timeout, watchdog, deletion, same-ID reuse, delayed-terminal, and ownership-overlap boundaries. The live run proves the composed plugin and actual OpenCode event path preserve the intended main-session behavior without touching user state.

## What was omitted

Raw environments, credentials, authorization headers, and secret-bearing service logs were not captured. Cubic review was skipped under the team-wide exhausted quota authorization through August 1, 2026.
