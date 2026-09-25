# Issue #7338 - question tool prompt never renders in TUI after sync task completes

Branch: fix/7338-question-tool-parent-turn (base: origin/dev 8c57e463e)
Date: 2026-08-26

## WHAT WAS TESTED

Two live reproduction probes drove REAL opencode 1.18.23 (`opencode serve`,
isolated XDG sandbox under /tmp) with THIS worktree's OMO plugin loaded via
`plugin: ["file://<worktree>/packages/omo-opencode/src/index.ts"]`:

- Probe A (evidence: ../probe-a/): direct user turn -> sync `task()` delegation
  -> child completes -> parent continues -> parent calls `question`.
- Probe B (evidence: ../probe-b/): internally dispatched parent turn (synthetic
  internal-initiator marker part sent through prompt_async, same shape as OMO's
  parent-wake dispatch) calling `question`.
- Probe R (evidence: probe-r/): probe A plus the new
  question-visibility-watchdog; asserts the watchdog toast reaches the wire.

Assertion surface: SSE stream at GET /global/event (the same stream the TUI
consumes), GET /question pending list, POST /question/{id}/reply, session
message transcript.

## WHAT WAS OBSERVED

Server side is CORRECT in every variant:
- `question.asked` published on /global/event with full question payload.
- Pending question queryable via GET /question.
- POST reply unblocks the tool; assistant message completes; session.idle fires.

The rendering failure therefore lives in the opencode TUI consumption layer
(v1.18.23 source-verified):
1. QuestionPrompt renders ONLY from the one-shot `question.asked` SSE event;
   no replay (SSE id undefined, no Last-Event-ID) and no catch-up on reconnect.
2. The TUI never rehydrates pending questions: data.session.question.refresh()
   exists (packages/tui/src/context/data.tsx:443-451) with ZERO call sites;
   bootstrap() and session.sync() fetch messages/todo/diff only.
3. QuestionPrompt renders only while permissions().length === 0 across the
   viewed session AND all direct child sessions
   (packages/tui/src/routes/session/index.tsx:233-242, 1298-1309); any stale or
   orphaned child-session permission permanently shadows it.

Sync-task completion produces the densest event burst in the product (child
session lifecycle + interleaved streaming + completion abort + parent
continuation), maximizing exposure to the loss/shadow window - matching the
issue trigger exactly. Upstream opencode dev has no fixes for this area as of
2026-08-26 (checked b72b500).

## THE FIX (this repo)

question-visibility-watchdog feature module
(packages/omo-opencode/src/features/question-visibility-watchdog/):
- Wired at the existing question branch of plugin/tool-execute-before.ts where
  OMO already observes every question tool execution.
- 30s after execution starts, probes the question tool part state via
  client.session.messages; if still awaiting the user, emits client.tui.showToast.
- The toast travels over POST /tui/show-toast -> published as `tui.toast.show`
  on the event bus - a delivery channel INDEPENDENT of the missed
  `question.asked` event, so it survives event loss, shadowing and reconnects.
- Toast body tells the user an answer is awaited and that replying as a normal
  chat message answers it (the reporter's own proven workaround).

This follows the repo's established pattern of compensating for core-state
divergence (cf. 837a43386 "surface terminal errors after internal wakes",
61086114c "complete sync poller after internal wake").

## WHY IT IS ENOUGH

- Unit tests (7) pin the watchdog contract: pending -> one toast; resolved ->
  silent; duplicate registrations collapse; per-call probing; dispose cancels;
  probe failure stays silent.
- Probe R proves end-to-end on a real server that the watchdog toast reaches
  the event wire during the exact issue scenario.
- Focused suites + tsgo --noEmit gates recorded in gates.txt.

## WHAT WAS OMITTED / BLOCKED

- TUI smoke (tmux): NO tmux binary exists in this environment; the interactive
  TUI cannot be driven here. Documented as an environment blocker. The toast
  wire assertion (tui.toast.show on SSE) is the strongest headless equivalent:
  it proves the TUI would receive the toast payload.
- Real-model caveat: probes A/C used the ambient provider for the parent turns
  (OMO fallback resolved away from the fake model); branch scripting still
  forced the sync-delegation shape. Probe B was fully scripted.
- Raw logs are summarized; no secrets or tokens appear in any artifact.

## ISOLATION PROOF

isolation.txt in each probe dir records real-store session counts before/after
(unchanged). Sandboxes live under /tmp only (mktemp oqa-xdg.*), HOME/XDG_*
redirected; the real ~/.local/share/opencode DB was never opened for writes.
