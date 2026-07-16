# PR #6043 QA Evidence

Reviewed integrated source head: `8dfd8d59440c52551f8fe682a86df94f980c8d52`

Integrated `dev`: `6457ca1da78fcfd2a39ea391ee559b8d945b240a`

Exact integrated QA head before this evidence-only refresh:
`8dfd8d59440c52551f8fe682a86df94f980c8d52`

The following evidence commit is content-only. It refreshes reviewer-readable
artifacts and does not change the tested runtime behavior.

## What Was Tested

1. Focused watchdog, abort-provenance, timeout-abort, and lifecycle tests:

   ```text
   bun test packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog.test.ts packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog-lifecycle.test.ts packages/omo-opencode/src/hooks/runtime-fallback/abort-provenance-race.test.ts packages/omo-opencode/src/hooks/runtime-fallback/message-update-handler.test.ts
   ```

   The final post-review repair run is captured in
   `seventh-exact-focused-tests.txt`.

2. Full runtime-fallback hook suite:

   ```text
   bun test packages/omo-opencode/src/hooks/runtime-fallback
   ```

   The final post-review repair run is captured in
   `seventh-exact-runtime-fallback-suite.txt`.

3. OpenCode adapter typecheck and scoped Biome linter:

   ```text
   bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json
   bunx --bun @biomejs/biome@2.4.16 check --javascript-formatter-enabled=false --assist-enabled=false --javascript-linter-enabled=true --error-on-warnings <changed files>
   ```

   The final post-review repair runs are captured in
   `seventh-exact-omo-opencode-typecheck.txt`,
   `seventh-exact-biome.txt`, and `seventh-exact-no-excuse.txt`.

4. OpenCode QA harness self-check:

   ```text
   bash .agents/skills/opencode-qa/scripts/lib/common.sh --self-check
   ```

   The final post-review repair run is captured in
   `seventh-exact-opencode-harness-self-check.txt` with local paths and
   transient port values redacted.

5. Real OpenCode live harness:

   ```text
   bash .omo/evidence/20260716-pr-6043-main-watchdog/run-live-watchdog-qa.sh
   ```

   The script loads the exact local plugin through `file://`, starts OpenCode
   under isolated `HOME` and `XDG_*` directories, and drives a real main
   session against `fake-silent-provider.mjs`. The primary model remains
   silent through the production 90-second watchdog. The fallback returns
   `QA_FALLBACK_OK`; a second user turn is then held open and cancelled through
   OpenCode's real abort endpoint.

## What Was Observed

- Focused suite: 55 pass, 0 fail across the event adapter, generation-race,
  deferred-hook, and progress suites.
- Full runtime-fallback suite: 273 pass, 0 fail.
- Scoped TypeScript and Biome linter checks: pass.
- The final gate review found that a fallback-owned user update could arm a
  second watchdog and that a pre-acknowledgement abort-shaped `session.error`
  could be mistaken for the watchdog's own abort. Failing-first tests
  reproduced both behaviors. The repaired watchdog skips fallback-owned user
  events and binds abort ownership to the exact acknowledged session
  generation; pre-acknowledgement abort errors now remain external
  cancellation, while acknowledged internal abort errors retain dispatch
  ownership.
- A failing-first lifecycle regression reproduced the live OpenCode race: the
  watchdog's own abort emitted assistant completion plus `session.idle` before
  the abort promise resolved, and the stale callback was incorrectly
  invalidated. The repaired exact head preserves ownership for that internal
  completion/idle pair while explicit terminal cancellation still suppresses
  fallback dispatch.
- A fresh exact-head review found the analogous `session.error` ordering: the
  watchdog observed the internal abort error before the base event handler
  consumed its provenance marker. A failing-first integrated lifecycle test
  reproduced the suppressed dispatch. The repaired head now preserves the
  watchdog generation for marked internal `session.error` while a real
  `session.stop` still cancels and resets retry state during the same abort
  window.
- The sixth exact-head review found two remaining abort-provenance races. A
  post-acknowledgement external abort could be swallowed as watchdog-owned,
  while a delayed generation-one abort could cancel a newly armed generation
  two. The repair retains acknowledged generations until their delayed event
  is consumed, consumes only a generation older than the active watchdog, and
  aborts a fallback request accepted while external cancellation was settling.
  Integrated regressions cover both event orders.
- The seventh exact-head review found that a current-generation user
  cancellation could arrive before a retained prior-generation abort. The
  session-level provenance queue then consumed the current cancellation as
  prior ownership and left generation two armed, producing a second fallback.
  The failing proof is `seventh-review-red-current-cancellation-order.txt`.
  The repaired watchdog suspends an ambiguous abort, correlates the following
  assistant error through `parentID`, replays the deferred terminal event
  through the normal handler, and resumes only when the parent belongs to the
  older user-message generation. A composed-hook regression verifies deferred
  replay order, while the two-turn race regression proves current cancellation
  resets state and prevents a second fallback.
- A compaction-agent `role=user` update no longer arms the main-session
  watchdog. The shared compaction-message predicate also excludes persisted
  compaction marker turns that retain the original agent and carry
  `parts: [{ type: "compaction" }]`, while a later genuine user turn can re-arm
  after normal progress.
- OpenCode accepted both asynchronous main-session prompts with HTTP 204.
- At the production watchdog deadline, the plugin aborted the silent primary
  request and dispatched `openai/fallback`.
- The fallback provider returned `QA_FALLBACK_OK` through the real SSE stream.
- The watchdog arm count stayed unchanged after the successful fallback
  settled (`2` before and after the settle window), proving the internally
  dispatched fallback turn did not re-arm the first-prompt watchdog.
- The later user abort returned HTTP 200 and the plugin logged that the
  cancellation cleared retry state, proving stale internal-abort provenance
  did not survive the completed fallback cycle.
- The isolated OpenCode database contained one QA session.
- The real OpenCode database count was unchanged before and after the run.

Artifacts:

- `live-plugin-watchdog.txt`: sanitized first-party watchdog, abort, fallback,
  and later external-cancellation markers.
- `live-fake-provider.txt`: primary silence/connection closure, successful
  fallback response, and held second request.
- `live-sse-events.jsonl`: sanitized lifecycle events from the real server.
- `live-isolation-receipt.txt`: HTTP results, request counts, isolated session
  count, and unchanged-real-DB assertion.
- `final-exact-live-watchdog-run.txt`: terminal harness result.
- `final-second-review-live-watchdog-run.txt`: successful production-duration
  live run pinned to runtime head `be630fc68e47b3c522556c3aec026c9b5c270247`.
- `final-second-review-live-watchdog-run-attempt1.txt`: retained failed harness
  startup attempt; the server started, but the bounded SSE watcher did not
  observe `server.connected`. No product request was exercised in that attempt.
- `final-third-review-live-watchdog-run.txt`: successful production-duration
  live run pinned to final runtime head
  `5ae935e0c7754210faac62b36ccd0aeb170fd3e6`.
- `final-fourth-review-live-watchdog-run.txt`: successful production-duration
  live run pinned to final runtime head
  `bdc5f644ba0185d594bd3b412d2189ef14a3c008`.
- `final-fifth-review-live-watchdog-run.txt`: successful production-duration
  live run pinned to final runtime head
  `dcdbaae5926e66a2165dfde00776c34052fabf61`.
- `sixth-review-finding.md`: exact-head gate report that reproduced the two
  final abort-provenance blockers against `83ae672478b4fdc0a76e8343bffd1040d360189a`.
- `final-sixth-review-live-watchdog-run-attempt1.txt`: retained harness-only
  startup attempt. Its OpenCode health probe hung before session creation; no
  product request was exercised. The harness now bounds both readiness curls.
- `final-sixth-review-live-watchdog-run.txt`: successful production-duration
  live run pinned to repaired runtime head
  `c4896f52a32bb429f4394d8041e8f8c159da02b7`.
- `seventh-review-finding.md`: exact-head reviewer blocker, reproduced event
  order, repair contract, and verification summary.
- `seventh-exact-focused-tests.txt`: 55 passing focused watchdog/event tests.
- `seventh-exact-runtime-fallback-suite.txt`: 273 passing runtime-fallback
  tests.
- `seventh-exact-omo-opencode-typecheck.txt`, `seventh-exact-biome.txt`, and
  `seventh-exact-no-excuse.txt`: exact-runtime static gates.
- `seventh-exact-opencode-harness-self-check.txt`: isolated harness preflight.
- `seventh-exact-live-watchdog-run.txt`: successful production-duration live
  run pinned to runtime head `50ca8e1cc705862b5534b293f83c20ef63da922c`.
- `eighth-exact-focused-tests.txt`: 55 focused watchdog/deferred-terminal tests
  plus 3 shared `session.status` timeout tests, all passing.
- `eighth-exact-runtime-fallback-suite.txt`: 275 passing runtime-fallback
  tests on integrated head `d4ab26633643e084931dd223c4c9f7c561fa050f`.
- `eighth-exact-omo-opencode-typecheck.txt`, `eighth-exact-biome.txt`, and
  `eighth-exact-no-excuse.txt`: exact integrated static gates over the 12
  touched TypeScript files.
- `eighth-exact-opencode-harness-self-check.txt`: isolated OpenCode harness
  preflight with sandbox cleanup.
- `eighth-exact-live-watchdog-run.txt`: production-duration live OpenCode run
  pinned to `d4ab26633643e084931dd223c4c9f7c561fa050f`; fallback observed, no
  fallback watchdog re-arm, later user abort external, real database unchanged.
- `ninth-review-finding.md`: fresh exact-head reviewer report for the
  delayed-abort-after-progress blocker.
- `ninth-review-red-progress-delayed-abort.txt`: failing composed-hook proof
  that the old abort reset the accepted fallback before the ninth repair.
- `ninth-exact-focused-tests.txt`: 56 focused watchdog/deferred-terminal tests
  plus 3 shared `session.status` tests, all passing.
- `ninth-exact-runtime-fallback-suite.txt`: 276 passing runtime-fallback tests.
- `ninth-exact-omo-opencode-typecheck.txt`, `ninth-exact-biome.txt`, and
  `ninth-exact-no-excuse.txt`: exact static gates for the ninth repair.
- `ninth-exact-opencode-harness-self-check.txt`: isolated harness preflight.
- `ninth-exact-live-watchdog-run.txt`: successful production-duration live run
  pinned to `7ef3442500100b9f8ee32401773fd7c80cfab6fc`.
- `tenth-review-finding.md`: fresh exact-head reviewer report for the
  `session.error -> session.idle -> assistant correlation` ordering defect.
- `tenth-review-red-idle-before-correlation.txt`: failing-first composed-hook
  proof that idle resolved the suspended abort and reset the accepted fallback.
- `tenth-exact-focused-tests.txt`: 56 focused watchdog/deferred-terminal tests
  plus 3 shared `session.status` tests, all passing.
- `tenth-exact-runtime-fallback-suite.txt`: 276 passing runtime-fallback tests.
- `tenth-exact-omo-opencode-typecheck.txt`, `tenth-exact-biome.txt`, and
  `tenth-exact-no-excuse.txt`: exact static gates for the tenth repair.
- `tenth-exact-integrity.txt`: exact runtime head and pure-LOC limits.
- `tenth-exact-live-watchdog-run.txt`: successful production-duration live run
  pinned to `423022fb1f3a8df2a34c07193e22e0a9677d7432`.
- `eleventh-review-finding.md`: fresh exact-head reviewer report that the real
  user prompt part was incorrectly treated as assistant progress.
- `eleventh-review-red-user-part-progress.txt`: failing-first proof that the
  user part cancelled the armed watchdog before silent-provider recovery.
- `eleventh-exact-focused-tests.txt`: 93 passing focused watchdog, lifecycle,
  provenance, message-handler, and shared status tests.
- `eleventh-exact-runtime-fallback-suite.txt`: 277 passing runtime-fallback
  tests across 35 files.
- `eleventh-exact-omo-opencode-typecheck.txt`, `eleventh-exact-biome.txt`, and
  `eleventh-exact-no-excuse.txt`: exact candidate static gates.
- `eleventh-exact-integrity.txt`: candidate head, diff check, changed paths,
  and pure-LOC measurements.
- `eleventh-exact-opencode-harness-self-check.txt`: isolated OpenCode harness
  preflight and sandbox cleanup proof.
- `eleventh-exact-live-watchdog-run.txt`: successful production-duration live
  run on the eleventh repaired candidate; the initial real user part did not
  cancel recovery, fallback was observed, no fallback watchdog re-armed, the
  later user abort remained external, and the real database was unchanged.

The eighth repair closes the final cancellation-ownership ambiguity. When a
current identity-free terminal event is followed by a delayed old-parent
assistant abort, the hook now uses the bounded shared `session.status` helper:
an active replacement request preserves the old internal abort, while idle,
unavailable, error, or timeout resolves the terminal as current cancellation.
Suspended watchdogs also retain their original deadline instead of restarting
the full timeout. Tests use deterministic completion signals rather than real
sleeps, and the watchdog firing logic is split into a focused module.

The first fresh post-push reviewer then found a distinct post-progress race:
normal assistant progress for generation two cleared generation-one abort
provenance, so a still-delayed old abort could reset the accepted fallback.
`ninth-review-red-progress-delayed-abort.txt` reproduces the reset before the
repair. Runtime commit `7ef3442500100b9f8ee32401773fd7c80cfab6fc`
stops the timer on progress while retaining generation context for later abort
correlation; a consumed old abort does not rearm a watchdog that already saw
assistant output. The exact ninth cycle passes 56 focused tests plus 3 shared
status tests, all 276 runtime-fallback tests, static gates, and isolated live
OpenCode QA.

The next fresh reviewer found that the real OpenCode terminal sequence includes
`session.idle` between the deferred abort and its assistant-parent correlation.
That idle edge resolved the deferred error too early and reset the accepted
fallback state. The failing proof is
`tenth-review-red-idle-before-correlation.txt`. Runtime commit
`423022fb1f3a8df2a34c07193e22e0a9677d7432` preserves suspended correlation
across idle while leaving genuine stop/delete/error terminal handling intact.
The exact tenth cycle passes the same 56 focused plus 3 shared status tests,
all 276 runtime-fallback tests, static gates, integrity limits, and isolated
production-duration OpenCode QA.

The eleventh fresh reviewer found a distinct first-turn event-classification
defect. OpenCode emits the user's `message.part.updated` after the user
`message.updated` arms the watchdog, but the adapter treated that user part as
assistant progress and cancelled the timer. The red regression in
`eleventh-review-red-user-part-progress.txt` failed with no watchdog abort.
The repair forwards the part's message ID and ignores only ordinary progress
belonging to the current user message. Assistant and identity-free progress
retain their prior behavior. The exact candidate passes 93 focused tests, all
277 runtime-fallback tests, typecheck, Biome, the no-excuse audit, the OpenCode
harness self-check, and production-duration live QA. The captured SSE stream
shows the real user-part ordering, followed by the watchdog dispatching the
fallback after silence rather than cancelling immediately.

The twelfth fresh reviewer found a three-generation abort race. Resolving
generation two's external cancellation cleared generation one's retained abort
provenance; if generation three armed before that old abort arrived, the old
event cancelled generation three. Two failing-first toggles cover direct
assistant-parent correlation and status resolution. Runtime commit
`03762c06deaee52f60b07d9c227c634a9e7e955e` preserves older tombstones only
while clearing current cancellation state. Explicit terminal cleanup still
clears provenance. The exact twelfth cycle passes 26 focused tests, all 279
runtime-fallback tests, typecheck, Biome, no-excuse, file-size integrity, the
isolated harness self-check, and production-duration live OpenCode QA.

Twelfth-cycle artifacts:

- `twelfth-review-finding.md`: reviewer finding, root cause, repair, and scope.
- `twelfth-review-red-three-generation-abort.txt`: direct-correlation red proof.
- `twelfth-review-red-status-resolution-provenance.txt`: status-resolution red proof.
- `twelfth-review-green-split-generation-races.txt`: split regression green proof.
- `twelfth-exact-focused-tests.txt`: 26 focused tests passing.
- `twelfth-exact-runtime-fallback-suite.txt`: 279 tests passing across 36 files.
- `twelfth-exact-omo-opencode-typecheck.txt`, `twelfth-exact-biome.txt`, and
  `twelfth-exact-no-excuse.txt`: exact runtime-head static gates.
- `twelfth-exact-integrity.txt`: clean runtime head, call-site audit, and pure-LOC limits.
- `twelfth-exact-opencode-harness-self-check.txt`: isolated harness preflight.
- `twelfth-exact-live-watchdog-run.txt`: exact-head production-duration live proof.

The thirteenth fresh reviewer found a suspended-generation ownership defect.
When generation three arrived while generation two was suspended for delayed
abort correlation, the new user message was ignored. Busy status resolution
then re-armed generation two's original deadline and aborted generation three
after only the 8 ms remaining on the stale timer. The same review identified
that an authoritative main-session ID was available but unused, allowing
unregistered parent-linked internal sessions to inherit main-session watchdog
eligibility. Failing-first tests reproduce both boundaries. The repair lets a
new user message replace suspended ownership, prevents deferred resolution
from overwriting a newer armed generation, and skips unregistered non-main
sessions when the authoritative main ID is known. Four boundary tests were
also split from the oversized original test module.

Thirteenth-cycle artifacts:

- `thirteenth-review-finding.md`: exact-head reviewer report and requested repairs.
- `thirteenth-review-red-suspended-generation.txt`: failing-first stale-deadline proof.
- `thirteenth-review-red-parent-linked-child.txt`: failing-first main-session scope proof.
- `thirteenth-review-green-blockers.txt`, `thirteenth-review-green-suspended-generation.txt`, and `thirteenth-review-green-split-and-boundaries.txt`: repaired focused tests.
- `thirteenth-review-runtime-fallback-suite.txt`: 281 tests passing across 39 files.
- `thirteenth-review-omo-opencode-typecheck.txt`, `thirteenth-review-biome.txt`, and `thirteenth-review-no-excuse.txt`: repaired-candidate static gates.
- `thirteenth-review-integrity.txt`: diff and pure-LOC integrity checks.
- `thirteenth-review-opencode-harness-self-check.txt`: isolated harness preflight and cleanup proof.
- `thirteenth-review-live-watchdog-run.txt`: production-duration isolated OpenCode proof for the repaired candidate.
- `thirteenth-exact-runtime-fallback-suite.txt`: 281 tests passing across 39 files on runtime head `0e7223d60b6cbbb04ddc92801f62fd6c09749e92`.
- `thirteenth-exact-omo-opencode-typecheck.txt`, `thirteenth-exact-biome.txt`, and `thirteenth-exact-no-excuse.txt`: exact-head static gates.
- `thirteenth-exact-integrity.txt`: exact head/base identity, changed paths, diff check, and pure-LOC limits.
- `thirteenth-exact-opencode-harness-self-check.txt`: exact-head isolated harness preflight and cleanup proof.
- `thirteenth-exact-live-watchdog-run.txt`: production-duration live OpenCode run pinned to `0e7223d60b6cbbb04ddc92801f62fd6c09749e92`; fallback observed, no fallback watchdog re-arm, later user abort external, and real database unchanged.

The fourteenth fresh reviewer found that every assistant `info.error` was
classified as abort correlation. During deferred correlation of an older
watchdog abort, a current retryable provider error therefore reset retry state
and repeated fallback one instead of advancing to fallback two. The failing
composed proof observed `anthropic/fallback-1` twice. The repair classifies the
assistant error with `isAbortError(info.error)` before forwarding it to the
watchdog, preserving abort correlation only for actual abort-shaped errors.
The repaired composed proof advances to `google/fallback-2` with attempt count
two, while the adjacent event-observation suite remains green.

Fourteenth-cycle artifacts:

- `fourteenth-review-finding.md`: exact-head reviewer report and provider-error correlation finding.
- `fourteenth-review-red-provider-error-correlation.txt`: failing-first proof that fallback one repeated.
- `fourteenth-review-green-provider-error-correlation.txt`: repaired composed regression plus adjacent event-observation coverage, 30 tests passing.
- `fourteenth-review-runtime-fallback-suite.txt`: 282 tests passing across 40 files.
- `fourteenth-review-omo-opencode-typecheck.txt`, `fourteenth-review-biome.txt`, and `fourteenth-review-no-excuse.txt`: repaired-candidate static gates.
- `fourteenth-review-integrity.txt`: changed-path, diff, and pure-LOC integrity checks.
- `fourteenth-review-opencode-harness-self-check.txt`: isolated OpenCode harness preflight and cleanup proof.
- `fourteenth-review-live-watchdog-run.txt`: production-duration isolated OpenCode proof; fallback observed, no fallback watchdog re-arm, later user abort external, and real database unchanged.
- `fourteenth-exact-runtime-fallback-suite.txt`: 282 tests passing across 40 files on runtime head `2417ac2081c1e9614185a3340d560dc0d35a1ea5`.
- `fourteenth-exact-omo-opencode-typecheck.txt`, `fourteenth-exact-biome.txt`, and `fourteenth-exact-no-excuse.txt`: exact-head static gates.
- `fourteenth-exact-integrity.txt`: exact runtime head, observed live `dev` tip, changed paths, diff check, and pure-LOC limits.
- `fourteenth-exact-opencode-harness-self-check.txt`: exact-head isolated harness preflight and cleanup proof.
- `fourteenth-exact-live-watchdog-run.txt`: production-duration live OpenCode run pinned to `2417ac2081c1e9614185a3340d560dc0d35a1ea5`; fallback observed, no fallback watchdog re-arm, later user abort external, and real database unchanged.
- `fourteenth-integrated-runtime-fallback-suite.txt`: 282 tests passing across 40 files after merging `dev`.
- `fourteenth-integrated-omo-opencode-typecheck.txt`, `fourteenth-integrated-biome.txt`, and `fourteenth-integrated-no-excuse.txt`: integrated-head static gates.
- `fourteenth-integrated-integrity.txt`: integrated head `1a427eb83fc722249e6e7562d0097fe5a113db9d`, merged `dev` parent, retained runtime fix, diff check, and pure-LOC limits.
- `fourteenth-integrated-opencode-harness-self-check.txt`: integrated-head isolated harness preflight and cleanup proof.
- `fourteenth-integrated-live-watchdog-run.txt`: production-duration live OpenCode run pinned to integrated head `1a427eb83fc722249e6e7562d0097fe5a113db9d`; fallback observed, no fallback watchdog re-arm, later user abort external, and real database unchanged.

The fifteenth fresh reviewer found the sibling provider-error transport. When
the current retryable failure arrived as `session.error` while an older abort
was suspended for correlation, the watchdog removed the internal ownership
marker before replaying the deferred abort. The replay therefore reset retry
state, and normal provider handling repeated fallback one. The failing
composed proof observed `anthropic/fallback-1` twice. The repair consumes the
older tombstone, preserves one internal marker for the deferred replay, and
then lets the unchanged current provider error advance to
`google/fallback-2` with attempt count two.

Fifteenth-cycle artifacts:

- `fifteenth-review-finding.md`: exact-head reviewer report and sibling `session.error` transport finding.
- `fifteenth-review-red-session-error-correlation.txt`: failing-first proof that fallback one repeated.
- `fifteenth-review-green-session-error-correlation.txt`: repaired composed coverage for assistant and `session.error` provider transports.
- `fifteenth-exact-runtime-fallback-suite.txt`: 283 tests passing across 40 files on runtime head `43a3704e92d66fdd7b7133568fe4c9e5e99b4b3a`.
- `fifteenth-exact-omo-opencode-typecheck.txt`, `fifteenth-exact-biome.txt`, and `fifteenth-exact-no-excuse.txt`: exact-head static gates.
- `fifteenth-exact-integrity.txt`: exact runtime head/base/merge-base identity, diff check, and pure-LOC limits.
- `fifteenth-exact-opencode-harness-self-check.txt`: exact-head isolated OpenCode harness preflight and sandbox cleanup proof.
- `fifteenth-exact-live-watchdog-run.txt`: production-duration live OpenCode run pinned to `43a3704e92d66fdd7b7133568fe4c9e5e99b4b3a`; fallback observed, no fallback watchdog re-arm, later user abort external, and real database unchanged.

The sixteenth fresh reviewer found a multiple-terminal correlation gap. Two
older watchdog aborts can both remain delayed while a third request is active.
The first terminal suspends generation three, but the second previously fell
through to broad cancellation, cleared the current watchdog, and replayed the
first terminal without internal ownership. The failing composed proof stopped
at two aborts and reset retry state. The repair adds an explicit
`consume-terminal` decision for an additional prior-generation terminal, so it
is absorbed without disturbing the suspended current request. Correlation then
resumes the third watchdog and the fallback chain reaches attempt three.

Sixteenth-cycle artifacts:

- `sixteenth-review-finding.md`: exact-head reviewer report and multiple delayed-terminal finding.
- `sixteenth-review-red-multiple-delayed-terminals.txt`: failing-first composed proof; generation three never fired (`abortCount = 2`).
- `sixteenth-review-green-multiple-delayed-terminals.txt`: repaired composed proof; generation three fired and advanced to the third fallback.
- `sixteenth-integrated-runtime-fallback-suite.txt`: 284 tests passing across 41 files after merging current `dev`.
- `sixteenth-integrated-omo-opencode-typecheck.txt`, `sixteenth-integrated-biome.txt`, and `sixteenth-integrated-no-excuse.txt`: integrated-head static gates.
- `sixteenth-integrated-integrity.txt`: integrated head `c385befaae1ea080ca28e19249f74b9f8a649e96`, merge parents, current `dev`, merge-base identity, diff check, and pure-LOC limits.
- `sixteenth-integrated-opencode-harness-self-check.txt`: isolated OpenCode harness preflight and sandbox cleanup proof.
- `sixteenth-integrated-live-watchdog-run.txt`: production-duration live OpenCode run pinned to `c385befaae1ea080ca28e19249f74b9f8a649e96`; fallback observed, no fallback watchdog re-arm, later user abort external, and real database unchanged.

The seventeenth fresh reviewer found the same-generation sibling of the
delayed-terminal race. After the watchdog dispatched an accepted fallback,
the transient internal-abort marker was retired while the exact-generation
provenance remained. A delayed abort for that same generation was not
recognized as owned, so the base handler reset the accepted fallback model,
attempt count, and awaiting-result state. The failing composed proof observed
the model rewind from `anthropic/fallback` to `openai/gpt-5.4-mini`. The repair
adds one-shot exact-generation provenance consumption only when no watchdog is
armed and an accepted fallback result is pending. A second abort remains a
genuine external cancellation.

Seventeenth-cycle artifacts:

- `seventeenth-review-finding.md`: exact-head reviewer report and same-generation delayed-terminal finding.
- `seventeenth-review-red-current-generation-terminal.txt`: failing-first composed proof of the fallback-state rewind.
- `seventeenth-review-green-current-generation-terminal.txt`: initial repaired proof for both one-shot ownership and the second-abort boundary.
- `seventeenth-review-final-focused.txt`: 8 adjacent delayed-terminal and generation-race tests passing after the file-size cleanup.
- `seventeenth-review-final-runtime-fallback-suite.txt`: 286 tests passing across 42 files.
- `seventeenth-review-final-omo-opencode-typecheck.txt`, `seventeenth-review-final-biome.txt`, and `seventeenth-review-final-no-excuse.txt`: final repaired-candidate static gates.
- `seventeenth-review-integrity.txt`: source identity, changed paths, diff check, and initial pure-LOC measurement that caught the temporary 256-line overage.
- `seventeenth-review-final-integrity.txt`: final diff check and pure-LOC receipt, including `first-prompt-watchdog.ts` restored to 248 pure lines.
- `seventeenth-review-opencode-harness-self-check.txt`: isolated OpenCode harness preflight and sandbox cleanup proof.
- `seventeenth-review-live-watchdog-run.txt`: production-duration live OpenCode proof pinned to `af1ce820bfc9ef7cb90ce9f6d22290151ad36399`; fallback observed, no fallback watchdog re-arm, later user abort external, and real database unchanged.

The eighteenth fresh reviewer found that the same-generation ownership fix
still depended on the transient `sessionAwaitingFallbackResult` flag. A
visible successful fallback response clears that flag before the original
watchdog abort terminal is guaranteed to arrive, so the delayed terminal
rewound the session from `anthropic/fallback` to the failed primary model.
The completed-fallback composed regression reproduces the rewind after
accepted dispatch, persisted assistant output, and `session.idle`. Runtime
commit `7020af726e1f21cea5eb1a57febd8bfa38832c1c` records completion for the
exact watchdog generation and permits one final owned-terminal consumption.
The marker is consumed or cleared with the generation, and a later-generation
user cancellation still follows the ordinary external-cancellation path.

Eighteenth-cycle artifacts:

- `eighteenth-review-finding.md`: exact-head reviewer report and the completed-fallback delayed-terminal blocker.
- `eighteenth-review-red-completed-fallback-terminal.txt`: failing-first composed proof of the fallback-state rewind.
- `eighteenth-review-green-completed-fallback-terminal.txt`: repaired completed-fallback and later-generation cancellation boundaries.
- `eighteenth-exact-runtime-fallback-suite.txt`: 286 tests passing across 42 files on runtime head `7020af726e1f21cea5eb1a57febd8bfa38832c1c`.
- `eighteenth-exact-omo-opencode-typecheck.txt`, `eighteenth-exact-biome.txt`, and `eighteenth-exact-no-excuse.txt`: exact-source static gates.
- `eighteenth-exact-integrity.txt`: exact source/base identity, clean tracked status, diff check, and pure-LOC limits.
- `eighteenth-exact-opencode-harness-self-check.txt`: isolated OpenCode harness preflight and sandbox cleanup proof.
- `eighteenth-exact-live-watchdog-run.txt`: production-duration live OpenCode run pinned to `7020af726e1f21cea5eb1a57febd8bfa38832c1c`; fallback observed, no fallback watchdog re-arm, later user abort external, and real database unchanged.

The nineteenth fresh reviewer combined the completed-generation and
multi-generation boundaries. Two visible fallback completions could leave
abort provenance for both generations while retaining completion ownership
for only the newest one. If the newer delayed terminal arrived first, it
consumed the single completion marker; the older delayed terminal then fell
through as an external cancellation and rewound the newest successful
fallback to the primary model. The repair retains independently consumable
completion ownership for every retained generation. It also clears the
private generation counter on session deletion after invalidating any armed
or suspended callback, closing the adjacent lifecycle leak without changing
timer or retry behavior.

Nineteenth-cycle artifacts:

- `nineteenth-review-finding.md`: exact-head reviewer report for the two-completed-generation rewind and deletion cleanup gap.
- `nineteenth-review-red-two-completed-generations.txt` and `nineteenth-review-red-two-completed-generations-hook.txt`: failing-first provenance and composed-hook proofs.
- `nineteenth-review-red-deletion-cleanup.txt`: failing-first armed and suspended deletion cleanup proof.
- `nineteenth-review-green.txt`: repaired provenance, composed-hook, later-generation cancellation, and deletion boundaries.
- `nineteenth-exact-runtime-fallback-suite.txt`: 296 tests passing across 43 files on runtime head `8dfd8d59440c52551f8fe682a86df94f980c8d52`.
- `nineteenth-exact-omo-opencode-typecheck.txt`, `nineteenth-exact-biome.txt`, and `nineteenth-exact-no-excuse.txt`: exact-source static gates.
- `nineteenth-exact-integrity.txt`: exact source/base identity and pure-LOC limits.
- `nineteenth-exact-opencode-harness-self-check.txt`: isolated OpenCode harness preflight and sandbox cleanup proof.
- `nineteenth-exact-live-watchdog-run.txt`: production-duration live OpenCode run pinned to `8dfd8d59440c52551f8fe682a86df94f980c8d52`; fallback observed, no fallback watchdog re-arm, later user abort external, and real database unchanged.

The live harness intentionally records only sanitized fake-provider, plugin,
and SSE evidence. Authentication values, raw environment dumps, private
credentials, and unrelated service logs are omitted.

## Why It Is Enough

The tests cover main and subagent watchdog ownership, progress and terminal
cancellation, cancellation while abort is in flight, pre-acknowledgement
external abort errors, acknowledged internal abort errors, expected
internal-abort completion/idle events, removed-subagent suppression, abort failure,
zero-timeout semantics, retry dedupe, fallback timeout, delayed abort
provenance across watchdog generations, current cancellation before a delayed
prior abort, post-acknowledgement external cancellation, compaction exclusion,
re-arming after progress, disposal during asynchronous work, and cleanup
boundaries. The live harness covers what unit
tests cannot: local plugin loading, real OpenCode lifecycle events, production
watchdog timing, active-request abort, fallback dispatch after the internal
idle edge, visible assistant output, no fallback-owned watchdog re-arm, a
later genuine user cancellation, and database isolation.

## What Was Omitted

Raw environment dumps, credentials, tokens, auth headers, session IDs, local
paths, transient diagnostic runs, and unrelated shared logs are omitted or
redacted. The provider API key and server password in the harness are fixed
local-only dummy values. The TypeScript no-excuse helper, strict package
typecheck, and scoped Biome check all completed successfully over the changed
runtime-fallback TypeScript files.

## Cleanup

Each live run terminates the SSE watcher, OpenCode server, and fake provider,
then removes its temporary sandbox. Final branch/worktree/process cleanup is
recorded in the terminal review artifact after merge.
