# Extension bundle budget: measurement and decision basis

## What was tested
Rebuilt the senpi extension bundle from the current branch state and compared it against the
budget pinned in `packages/omo-senpi/src/bundle-size.test.ts`.

Command: `node packages/omo-senpi/plugin/scripts/build-extension.mjs`

## What was observed

| value | bytes |
| --- | --- |
| committed `plugin/extensions/omo.js` | 867,366 |
| rebuilt from current branch source | 929,784 |
| budget `BUDGET_BYTES` | 880,000 |
| overage after rebuild | +49,784 |

The COMMITTED bundle passes the budget test, so the failure only appears once the bundle is
rebuilt. CI rebuilds it: `test:senpi` runs `build:senpi-plugin` before the suite. This WILL fail CI
until it is addressed, and more feature todos are still landing, so the final number will be higher.

## Why a budget raise is the defensible resolution, not a workaround

The budget guards against DEPENDENCY BLOAT, and its own history shows raises are legitimate for
plan-scoped feature code (700,000 -> 710,000 for subagent-session-resume-revival, 710,000 -> 880,000
for the letta-memory-parity port), each justified as feature code with no new inlined dependency.

Verified for THIS change rather than assumed: `git diff origin/dev` over
`packages/omo-senpi/package.json`, `packages/memory-core/package.json` and the root `package.json`
shows NO added dependency. The only dependency line that differs is the `@code-yeongyu/senpi` pin,
where the branch is simply 2 commits behind `origin/dev`, not a change this work introduced.
`bundle-purity.test.ts` (the peer/leak boundary guard) passes, so nothing non-peer was smuggled in.

The growth is plan-scoped feature code: nudge wiring plus the new `GitMemoryRepo.log` API, the facts
durable queue, the dream selector and persona, people card formats and the palace people graph, the
run supervisor, and the new seeds.

## Decision, deliberately deferred
The new ceiling is NOT set yet. Todos 7, 9, 10, 12, 13, 14, 17, 18, 20 and 22 are still landing, so
any number chosen now would be stale. The budget is raised ONCE, at the end of the implementation
wave, from a single clean rebuild, with headroom rather than pinned to the failing value, which the
test comment explicitly forbids.
