# PR 6043 Twenty-First Review Repair

## Blocked Head

Independent reviewer 1 blocked exact evidence head
`38fbb576823955386e9a78a8362305d4af9aa110`. The full report is preserved as
`../pr-6043-code-review.md`.

## Findings And Repairs

1. **Live QA did not exercise two active roots.**
   `run-live-watchdog-qa.sh` now loads `root-state-probe.ts` alongside the real
   plugin, creates roots A and B through the OpenCode HTTP API, proves both are
   active, prompts silent A until the real watchdog dispatches fallback, deletes
   B through the API, and proves A is active/current again.
2. **Qualified static checks were described as exact-source passes.**
   The README now labels the twentieth temporary-copy/manual artifacts as
   qualified diagnostics. The three exact files were corrected, and the
   twenty-first exact-source Biome and bundled no-excuse helper both pass.
3. **Missing-ID coverage checked only the latest getter.**
   The focused lifecycle test asserts both `getMainSessionID()` and
   `isMainSession()` after the malformed event.
4. **Deletion tests exposed private generation bookkeeping.**
   The production injection parameter was removed. Tests now advance stale
   timers and resolve deferred terminals, asserting only observable absence of
   abort/retry behavior.
5. **Lifecycle cases extended an oversized test module.**
   The cases moved to `plugin/event-main-session-lifecycle.test.ts`; the prior
   additions were removed from `plugin/event.test.ts`.

## Exact-Source Verification

- Source commit: `243a25ca97c46cfbf5fdb472aeef3da37c301906`
- Runtime fallback: 291 pass, 0 fail across 45 files.
- Lifecycle/state: 53 pass, 0 fail across 4 files.
- OpenCode adapter typecheck: pass.
- Exact-source Biome: pass.
- Bundled TypeScript no-excuse helper: `No violations in 7 file(s)`.
- OpenCode harness self-check: pass with isolated HOME/XDG cleanup.
- Live OpenCode QA: two active roots observed; silent older root fallback
  observed; deleting newer root restored older root; fallback watchdog did not
  re-arm; later user abort remained external; real DB count unchanged.

## Cleanup

The live harness terminated its SSE watcher, OpenCode server, and fake provider
and removed the temporary XDG sandbox. Raw credentials, auth headers, private
environment values, unsanitized session IDs, and unrelated service logs are
omitted.

## Verdict

PASS for the repaired candidate at
`243a25ca97c46cfbf5fdb472aeef3da37c301906`, subject to a fresh exact-head CI,
five-reviewer, Cubic, and merge gate after the evidence commit is pushed.
