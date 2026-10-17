# Plan — Issue #7338: question tool prompt never renders in TUI after sync task completes

## Status: EXPLORATION (no edits yet)

## Problem statement
When a Sisyphus parent turn continues after a synchronous `task()` delegation
completes, a subsequent `question` tool call executes and blocks waiting for user
input, but the interactive prompt never renders in the TUI. No `session.idle` is
emitted while stuck. Typing plain text chat unblocks the pending ask.

## Reproduction surface
- Parent session turn continues post-sync-task; turn may originate from OMO
  internal dispatch chain (promptAsync machinery) rather than direct user message.
- OpenCode 1.18.x TUI renders QuestionPrompt only when:
  `permissions().length === 0 && questions().length > 0` where questions come from
  `question.asked` SSE events for the viewed top-level session + its children.
- Therefore "never renders" implies the TUI never received/kept the
  `question.asked` event, or a pending permission shadows it, or the tool never
  reached Question.ask (blocked earlier), or the event was dropped by scope.

## Hypotheses (ranked, to be confirmed by exploration)
H1. OMO-side hook chain on tool.execute.before blocks/hangs before Question.ask.
H2. Internal-dispatch turn state (session tools/permissions mutated by OMO)
    changes the question permission evaluation path (permission.ask shadow).
H3. OpenCode core drops question.asked events under specific conditions
    (directory scoping, hydration race) triggered by internal dispatch timing.
H4. A pending permission from the sync-task flow shadows the QuestionPrompt.

## Fix constraints
- Root cause first; minimal diff; no symptom patching.
- TDD RED -> GREEN with test reproducing exact ordering (sync task completion
  then question tool in same parent turn).
- Strict TS hygiene: no any/as-casts/@ts-ignore/non-null assertions.
- Gates: focused tests x2 clean; tsgo --noEmit per touched package;
  git diff --check; hygiene scan.
- Live QA in isolated XDG sandbox under /tmp; prove DB isolation
  (SELECT count(*) FROM session unchanged in real store).
- Evidence in this directory; reviewer-readable.
- Self-audit: two consecutive zero-finding waves over entire vertical after
  final edit; ledger recorded here.

## Root cause conclusion (2026-08-26, post live QA)

Live probes (evidence/: probe A = direct user turn continuing post sync-task;
probe B = internally dispatched synthetic-marker turn) against REAL
opencode 1.18.23 serve + this worktree's OMO plugin prove the server side is
CORRECT in both variants: `question.asked` is published on /global/event,
GET /question lists the pending ask, POST reply unblocks, session.idle follows.

The rendering failure therefore lives in the opencode TUI consumption layer
(v1.18.23 source, all verified):
1. QuestionPrompt is driven ONLY by the one-shot `question.asked` SSE event;
   no replay (SSE id undefined, no Last-Event-ID) and no catch-up on reconnect.
2. The TUI NEVER rehydrates pending questions: data.session.question.refresh()
   exists (context/data.tsx:443-451) with zero call sites; bootstrap() and
   session.sync() fetch messages/todo/diff only (context/sync.tsx).
3. QuestionPrompt renders only while permissions().length === 0 across the
   viewed session AND all direct child sessions
   (routes/session/index.tsx:233-242, 1298-1309); any stale/orphaned child
   permission shadows it.

Sync-task completion produces the densest event burst in the product (child
lifecycle + interleaved streaming + completion abort + parent continuation),
which maximizes exposure to the loss/shadow window - matching the issue trigger.

Upstream opencode dev (b72b500) has no fixes for this area as of 2026-08-26.

## Fix scope (this repo)

OMO cannot patch the TUI. Following the established OMO pattern of compensating
for core-state divergence (cf. 837a43386 "surface terminal errors after internal
wakes", 61086114c "complete sync poller after internal wake"):

ADD question-visibility-watchdog (features/question-visibility-watchdog/):
- Wired at the EXISTING question branch in plugin/tool-execute-before.ts
  (lines 112-128) where OMO already observes every top-level question execution.
- After a grace window, if the question request is STILL pending (queried via
  the server's GET /question - a channel independent of the missed SSE event),
  emit client.tui.showToast telling the user an answer is awaited and that a
  plain chat message replies to it (the reporter's own proven workaround).
- Delivery-independent by construction: survives question.asked event loss,
  shadowing, and reconnect gaps.
- Fully dependency-injected for RED->GREEN tests: pending-list reader, toast
  sink, scheduler. No fire when the question resolves within the window.

Verification map:
- RED/GREEN: packages/omo-opencode/src/features/question-visibility-watchdog/
  index.test.ts (pending -> toast once; resolved -> silent; scheduler honored;
  dispose clears timers).
- Focused suites x2 clean: watchdog test + plugin/tool-execute-before.test.ts.
- tsgo --noEmit for omo-opencode package.
- Live QA: rerun probe harness with watchdog build; capture toast emission on
  the wire is NOT observable headlessly (toasts are TUI-surface) - instead
  assert watchdog unit behavior + document TUI smoke as environment-blocked
  (no tmux binary). Isolation proof: real DB session count unchanged.

## Findings log

### 2026-08-26 — opencode core v1.18.23 mechanics (verified from source clone /tmp/opencode/oc-src/oc)
- Active question tool = packages/opencode/src/tool/question.ts (V1). NO permission
  gate on the tool itself; directly calls Question.Service.ask.
- Question service (packages/opencode/src/question/index.ts): publishes
  `question.asked` via EventV2Bridge, then parks on a Deferred until reply/reject.
- TUI question store is EVENT-DRIVEN ONLY: context/sync.tsx adds on
  `question.asked`, removes on `question.replied`/`question.rejected`.
  `data.session.question.refresh()` exists but is never called anywhere in the TUI.
- TUI render gate (routes/session/index.tsx ~237-241, 1304-1310):
  questions() returns [] if viewed session has parentID; otherwise
  children().flatMap(x => sync.data.question[x.id]). QuestionPrompt renders only
  when permissions().length === 0 && questions().length > 0. A pending PERMISSION
  shadows the QuestionPrompt entirely.
- session.promptAsync handler (server handlers/session.ts ~311) forks the same
  promptSvc.prompt() used by sync prompt. In prompt() (session/prompt.ts ~1060):
  if the request body carries `tools`, OpenCode OVERWRITES session permission
  rules with {permission: t, action: allow|deny, pattern: "*"} per entry.
- OMO child sessions get tools.question=false via prompt body (sync-prompt-sender
  buildSyncPromptTools) -> deny rule on CHILD sessions only. Parent wake dispatch
  (parent-wake-prompt-dispatch.ts) sends parts only, no tools map.
- No tmux binary on this machine -> TUI smoke must be documented as blocked;
  server API + SSE probes are the sanctioned assertion surface per AGENTS.md.

### Open questions (delegated to explore agents)
- bg_3aad6b82: OMO-side vertical (idle-hook continuations, tool.execute.before
  hang candidates, parent-session state mutations, abort paths).
- bg_a7eb844e: opencode-core event delivery filters + how plain text resolves a
  pending ask + whether plugin tool.execute.before can block pre-ask.

## Post-implementation notes (2026-08-26)
- Harness discovery 1: opencode serve becomes healthy BEFORE plugin init
  finishes; probes must gate on GET /agent listing Sisyphus (omo_ready=1).
- Harness discovery 2: initial scripts created two sandboxes (configs written
  to one, server started in the other) so early runs exercised core-only
  behavior. Fixed by using a single oqa_mk_isolated_xdg sandbox.
- Harness discovery 3: common.sh symlinks the real ~/.opencode into the sandbox
  HOME; the host config carries its own plugin array and can break OMO loading.
  Final probes remove the symlink for a hermetic HOME.
- Watchdog probe reads message state WITH query.directory (instance-scoped);
  without it the SDK hits the wrong instance in serve topology.
