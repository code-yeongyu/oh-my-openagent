# WHAT TESTED

Runtime-fallback cancel-poison loop fix (incident ses_fa750d527ffe: 12 consecutive aborts at a fixed 15.05s cadence, attempt:1 forever, fallback never completing). Branch `fix/runtime-fallback-cancel-poison-loop`, rebased onto `origin/dev b5cbae3fb`, HEAD `29261d02e`.

## Commits under test (all on branch)

| Commit | Fix |
|--------|-----|
| `2600e765a` | F1a: watchdog + quota aborts classified as internal-abort sources (INTERNALLY_ABORTED_SOURCES) |
| `80bf3ef75` | F1b: hook.ts forwards `message.updated` to the base event handler |
| `f3369b54c` | F2: assistant progress re-arms the fallback timeout (rearmSessionFallbackTimeout, armed-only, agent captured at arm) |
| `fb0050dde` | F3(i): cancel rebuild seeds the LIVE model, never rewinds to original (cap CAN trip) |
| `0d443d6c9` | F3(ii): dispatcher refuses re-dispatch of an accepted, progressing (messageID, model) tuple |
| `d88dd9cfc` -> rebase SHA in `29261d02e` history | F3(iii): semantic dedupe hold = effective timeout + 5s margin |

## Commands run (all from the worktree, after rebase onto latest origin/dev)

1. `bun test packages/omo-opencode/src/hooks/runtime-fallback/` -> `test-runtime-fallback.log`
   305 pass / 0 fail / 33 files. Covers: abort-source classification, watchdog progress, quota abort, timeout re-arm (unit + integration through createMessageUpdateHandler with real timeout helpers + fake clock), event-handler cancel-rebuild seeding (2 new tests) and 3 updated rewind pins, dispatcher identical-tuple refusal + escalation-still-allowed control, resolveRuntimeFallbackDedupeHoldMs table, dedupe-hold gate wiring (35s expiry read back from the gate).
2. `bun test packages/omo-opencode/src/shared/prompt-async-gate packages/omo-opencode/src/shared/prompt-async-route-audit.test.ts packages/utils/src/prompt-async-gate` -> `test-gate-audit.log`
   103 pass / 0 fail / 13 files. prompt-async-gate suites + the raw-prompt route audit (invariant: no raw session.promptAsync outside the gate).
3. `bun run typecheck` (tsgo root + script + all packages) -> `typecheck.log`, exit 0.
4. `bun test packages/omo-opencode/src/hooks/runtime-fallback/index.test.ts` -> `test-runtime-fallback-index-standalone.log`, 67 pass / 0 fail (the integration suite that appears in the dir-scope artifact list, green in isolation).
5. Scope-attribution run: `bun test packages/omo-opencode/src/hooks/` on the branch (`test-hooks-dir-scope-attribution.log`, 2137 pass / 46 fail) AND on `origin/dev` detached (`test-hooks-dir-scope-attribution-BASE-DEV.log`, 46 fail). Fail-name sets IDENTICAL (`hooks-dir-scope-fail-names-branch.txt` vs `hooks-dir-scope-fail-names-base-dev.txt`, diff exit 0).
6. opencode-qa minimal viable, isolated XDG sandbox (opencode 1.18.25): `scripts/server-smoke.sh` (`opencode-qa-server-smoke.log`) and `scripts/sse-hook-probe.sh --self-test` (`opencode-qa-sse-hook-probe.log`). Real `~/.local/share/opencode/opencode.db` session count before/after: 1475 -> 1475 (`opencode-qa-isolation.txt`).
