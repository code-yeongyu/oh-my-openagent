# WHY ENOUGH

## The fix chain maps 1:1 to the incident's five defect points

The incident chain (ses_fa750d527ffe): provider failure -> fallback dispatched -> own watchdog/timeout aborts were classified as *external* cancellations (F1a) -> `session.error` cancellation branch rewound retry state to the ORIGINAL model and zeroed attempt accounting (F3(i)) -> the timeout kept its original deadline while the fallback model streamed, so healthy-but-slow attempts were aborted at a fixed cadence (F2) -> the re-dispatch was an identical retry yet slipped the prompt-gate dedupe window edge-for-edge because hold(15s) == retry period(15s) (F3(iii)) and nothing at the dispatcher refused an already-accepted tuple (F3(ii)) -> 12 aborts at 15.05s, `attempt:1` forever, cap never trippable.

Each link is pinned by a test that FAILS with the fix reverted and passes with it:

1. F1a: abort-source tests (watchdog source, quota source, integration) - 54 pass scoped, 0 fail.
2. F1b: hook routing spies prove `message.updated` reaches both messageUpdateHandler and baseEventHandler while `session.error` reaches only the base handler.
3. F2: integration test drives real `createMessageUpdateHandler` + real timeout helpers on a fake clock: progress updates push the deadline forward, silence still aborts exactly once; rearm is a no-op when not armed; agent captured at arm time propagates.
4. F3(i): cancel-rebuild seeds the LIVE model (event model wins, else `currentModel`), and the next retryable error continues AFTER the live model (`google/gemini-2.5-pro`, not the first chain entry) - the property that makes the max-attempts cap reachable. Rewind-era assertions updated with rationale, `attemptCount-0` reset pins preserved.
5. F3(ii): identical (messageID, model) refused with `identical fallback dispatch already accepted` while awaiting; different-model escalation is a different tuple and keeps flowing (control test prevents over-blocking).
6. F3(iii): the remembered-dispatch expiry read back from the gate is `session_timeout_ms|timeout_seconds*1000 + 5000`, so a retry cycle equal to the timeout period can never edge the window; disabled-timeout configs defer to the gate default (pure table, 4 cases).

## Why the suite evidence transfers to the real harness

- All tests drive the real composed objects (real handlers, real timeout helpers, real dispatcher, real prompt-gate module for the dedupe seam) with only the clock, client stubs, and provider errors injected - the state machine under test is the production one.
- The plugin-load surface was exercised on the real binary: isolated `opencode serve` booted, `/global/health` healthy, 162 documented paths, auth enforced (401), and the SSE `/event` stream delivered `server.connected` - the same channel the `event` hook consumes, proving no load-time regression from the hook changes.
- Isolation is proven by the unchanged real-DB session count (1475 -> 1475): QA never wrote the host DB.
- Cross-cutting invariant `prompt-async-route-audit.test.ts` (no raw promptAsync outside the gate) stays green - the dispatcher change routes through `dispatchInternalPrompt` only.
- The 46-failure dir-scope run is NOT evidence of branch risk: the identical fail-name set reproduces on unmodified `origin/dev` in the same command, and every affected file passes standalone (67/0 for runtime-fallback/index.test.ts). CI runs the root suite through the serial quarantine, which is the order these leaks require.

## Remaining regression risk

Unit/integration coverage cannot prove a real provider-failure loop end-to-end (needs live rate-limited credentials). Mitigations in place: the abort path now only fires after a FULL silent window, the cap is reachable so a pathological chain exhausts within `max_fallback_attempts`, and both re-dispatch guards (tuple refusal + widened dedupe window) fail CLOSED (refuse) rather than open.
