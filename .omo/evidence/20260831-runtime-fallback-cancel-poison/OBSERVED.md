# OBSERVED

All runs below executed in the worktree AFTER rebasing onto `origin/dev b5cbae3fb`.

## Green gates (branch)

- `test-runtime-fallback.log`: `305 pass / 0 fail / 575 expect() calls / 33 files`, exit 0.
  - New behavior visible in the pass list: `rearmSessionFallbackTimeout` (3 tests), cancel-seed-live + cancel-then-continue (event-handler), `identical fallback dispatch already accepted` refusal + escalation control (dispatcher), `resolveRuntimeFallbackDedupeHoldMs` (4), dedupe-window-35s gate seam.
- `test-gate-audit.log`: `103 pass / 0 fail / 13 files`, exit 0. Includes `prompt-async-route-audit.test.ts` (raw-prompt-route invariant intact).
- `typecheck.log`: exit 0 (tsgo root, script, all 30 packages; no errors).
- `test-runtime-fallback-index-standalone.log`: `67 pass / 0 fail`, exit 0.

## RED-first confirmations (captured during implementation, per commit)

- F2: 3/3 rearm tests failed pre-fix (abort fired at original deadline while progress updated arrived - the incident's fixed-cadence abort signature); green after `rearmSessionFallbackTimeout`.
- F3(i): both new event-handler tests failed pre-fix (state rewound to `openai/gpt-5.4` / chain restarted from original); green after live-model seeding. Three pre-existing tests asserted the rewind itself and were updated with rationale in commit `fb0050dde` (they encoded the bug; `attemptCount-0` pins untouched).
- F3(ii): refusal test failed pre-fix (identical tuple accepted a second promptAsync), escalation control already passing and stayed passing; green after dispatcher tuple map.
- F3(iii): gate-seam test observed remembered-dispatch delta 15000ms pre-fix vs expected 35000ms; green after `semanticDedupeHoldMs` pass-through.

## Dir-scope artifact (pre-existing, NOT caused by this branch)

`bun test packages/omo-opencode/src/hooks/` shows 46 failures on the branch (log: `test-hooks-dir-scope-attribution.log`) AND the byte-identical fail-name set on `origin/dev` detached checkout (log: `test-hooks-dir-scope-attribution-BASE-DEV.log`; `diff` of name sets exit 0). Failures name files that pass standalone (e.g. `runtime-fallback/index.test.ts`: 67/0 standalone; `sanitizeEmptyMessagesBeforeSummarize`, `processFilePathForReadmeInjection` - unrelated dirs). This is cross-file state/mock leakage under directory-wide `bun test` ordering on base dev, reproduced identically with zero branch changes. CI's serial-quarantine root runner is the authoritative full-suite gate.

## opencode-qa (isolated sandbox, opencode 1.18.25)

- `opencode-qa-server-smoke.log`: `/global/health` healthy; `GET /doc` 162 documented paths (>=100); unauthenticated `GET /session` -> HTTP 401; `PASS: server-smoke`.
- `opencode-qa-sse-hook-probe.log`: SSE `/event` opened, delivered `server.connected`; `PASS`.
- `opencode-qa-isolation.txt`: real DB session count 1475 before, 1475 after -> QA touched only the throwaway XDG sandbox.
