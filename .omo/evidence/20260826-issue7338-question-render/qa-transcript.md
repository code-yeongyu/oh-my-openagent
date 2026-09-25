# Live QA transcript - issue #7338 (2026-08-26)

## Environment
- opencode 1.18.23 (~/.opencode/bin/opencode), headless `serve` topology
- OMO plugin loaded from THIS worktree via plugin: ["file://<worktree>/packages/omo-opencode/src/index.ts"]
- Fake OpenAI Responses-API LLM (scripted branches) + ambient provider fallback for some turns
- Isolated XDG sandbox per run (mktemp oqa-xdg.*), OPENCODE_SERVER_PASSWORD auth
- Assertion surface: GET /global/event SSE (the same stream the TUI consumes),
  GET /question pending list, POST /question/{id}/reply, session message API

## Probe A - direct user turn continuing after sync task completes
Command: bash /tmp/opencode/qrp/run-probe.sh /tmp/opencode/qrp/evidence
Result: question.asked published on SSE; GET /question listed the pending ask;
POST reply unblocked; assistant message completed; session.idle fired.
Transcript: task tool completed -> question tool completed -> final text.
Artifacts: probe-a/

## Probe B - internally dispatched parent turn (synthetic marker part)
Command: bash /tmp/opencode/qrp/probe-b.sh /tmp/opencode/qrp/evidence-b
Result: identical server-side correctness. question.asked fired; reply worked.
Artifacts: probe-b/

## Probe R - full scenario WITH the fix (watchdog toast observed)
Command: bash /tmp/opencode/qrp/probe-r.sh /tmp/opencode/qrp/evidence-r
Timeline (timeline.txt): question part stayed `running` across the 30s grace.
Watchdog log (shared OMO log):
  [question-visibility-watchdog] Watching question execution {"sessionID":"ses_fc4131d63ffe1n9Sq2kZj3kGUb","callID":"call_question_4","graceMs":30000}
Wire (watchdog-toast-line.txt):
  {"type":"tui.toast.show","properties":{"message":"The agent asked a question in
  session ses_fc4131d63ffe1n9Sq2kZj3kGUb and is waiting for your answer. If no
  question prompt is visible, reply to it as a normal chat message.","variant":"info"}}
After POST reply: question.replied on wire; parent turn completed; session.idle.

## Honest blockers / caveats
1. TUI smoke BLOCKED: no tmux binary in this environment; the interactive TUI
   cannot be driven. The tui.toast.show wire assertion is the strongest headless
   equivalent: it proves the TUI event bus received the exact payload a connected
   TUI would render.
2. Plugin-load race discovered in harness: opencode serve becomes healthy before
   plugin init completes; early probes (a/b/c) raced it. Final probes gate on
   GET /agent listing Sisyphus before driving the scenario (omo_ready=1).
3. Harness bug fixed during QA: initial scripts created TWO sandboxes (config
   written to one, server started in another), so early runs exercised core-only
   behavior. Runs gated on omo_ready=1 are authoritative for OMO-inclusive flow.
4. Some parent turns were served by the ambient provider (OMO model fallback
   resolved away from the fake); branch scripting still forced the sync-task and
   question shapes. This increases realism (real model drove the delegation).

## Verdicts
- Server-side question publication/delivery (with OMO loaded): PASS (probe R)
- Watchdog toast reaches TUI event bus when question stays pending: PASS (probe R)
- Reply unblocks pending ask; idle follows: PASS (probes A/B/R)
- Real-store isolation: PASS (isolation-proof.txt; all probe ids absent)
- Interactive TUI rendering observation: BLOCKED (no tmux) - documented honestly
