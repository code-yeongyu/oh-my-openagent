# P1: terminal errors for attached completed background tasks

Starting HEAD: 6ada7212a696770a5f8f5f3041db343f38f85610. No remote mutations.

Source confirms attachSyncContinuation retains the completed task in tasks;
resolveTaskAttemptBySession therefore returns a current terminal task. Both
the outer error guard and its inner !resolved check miss synchronous waiters.

1. Add fake-clock manager regressions for completed/error attachments, ordinary
   terminal tasks, recovery clearing, transient errors and historical attempts.
   Run the new tests before the production fix and retain the failure.
2. Move terminal recording before the background routing guard; accept unknown
   sessions or current sync-attached sessions, never stale attempts. Keep ordinary
   background handling and fallback routing unchanged.
3. Extend terminal-probe.ts using real trackTask, real successful model output,
   and the manager completion callback before resuming with a missing model.
   No mocked client/events/poller; await exact completion with bounded timeout.
4. Extend replay.mjs with fresh/attached cases. Preserve lead's exact SSE match
   wait and bounded cleanup. Preserve existing captures; write P1-specific files.
5. Run related tests, adapter/probe compilers, build and both live cases using
   explicit Bun 1.4.0/Node24 and isolated HOME/XDG. Keep real ten-second grace.
6. Audit/stage only the focused patch and public evidence. Preserve raw logs,
   existing evidence and workspace. Stop verified or with a precise blocker;
   at most three materially different live verification attempts.
