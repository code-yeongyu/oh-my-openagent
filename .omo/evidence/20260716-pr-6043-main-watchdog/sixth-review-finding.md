# PR #6043 Exact-Head Gate Review

- recommendation: REJECT
- reviewedHead: `83ae672478b4fdc0a76e8343bffd1040d360189a`
- reviewedBase: `81180f3759c55262a49be6883bb9db5c102e2b4d`
- reviewDate: `2026-07-16`
- ulwStatus: `ULW_LOOP_PLAN_MISSING`; fallback report path used

## Original Intent

Fix issue #5982 by extending runtime-fallback's first-prompt watchdog to a
silent main Sisyphus session. The watchdog must abort the hung primary request,
dispatch the configured fallback once, preserve the historical subagent path,
and keep cancellation, compaction, retry ownership, generation provenance, and
cleanup behavior correct.

## Desired Outcome

A silent main-session first request recovers through the fallback chain without
starting competing requests. Internal fallback dispatches do not re-arm the
first-prompt watchdog. Abort ownership belongs only to the exact watchdog
generation that initiated it. A real user cancellation remains terminal at
every point in the abort/dispatch lifecycle. Compaction turns do not arm the
watchdog, and terminal/disposal/session cleanup invalidates stale work.

## Success Criteria

- `C1-main-watchdog`: a silent main session aborts the primary and dispatches one fallback.
- `C2-retry-ownership`: abort failure and internal fallback dispatch cannot create competing or duplicate retries.
- `C3-exact-generation-provenance`: an internal abort affects only its originating watchdog generation and cannot reset or cancel another turn.
- `C4-external-cancellation`: a genuine user cancellation is terminal regardless of whether it arrives before or after watchdog abort acknowledgement.
- `C5-compaction`: compaction-agent and compaction-marker turns do not arm the watchdog; later genuine turns can re-arm.
- `C6-cleanup`: terminal events, deletion, stale cleanup, and disposal prevent stale callbacks and clear owned state.
- `C7-regression`: historical subagent and zero-timeout behavior remains intact.

## User Outcome Review

The exact head satisfies the normal issue #5982 path: the production-duration
isolated OpenCode run reached the 90-second watchdog, aborted the silent main
request, dispatched `openai/fallback`, produced `QA_FALLBACK_OK`, did not re-arm
for the fallback-owned user update, and later classified a cancellation after a
new turn as external. Focused and full runtime-fallback tests also pass.

The result is still not releasable because abort provenance remains a
session-wide timing heuristic. The same abort-shaped `session.error` emitted by
the real user-abort surface is treated as internal whenever it arrives after
the watchdog abort promise is acknowledged. Conversely, clearing that marker
on a later genuine user turn allows a delayed internal abort from the prior
generation to cancel the newly armed watchdog and reset fallback state. Direct
exact-head probes reproduced both outcomes.

## Blockers

### B1: Post-acknowledgement external cancellation is swallowed as internal

- violatedCriterion: `C4-external-cancellation`
- observation: `onSessionTerminal()` returns without cancelling whenever an
  abort-shaped `session.error` sees both the session-wide internal marker and
  the current acknowledgement generation. The base event handler then consumes
  the same marker as internal and preserves retry state. A direct exact-head
  probe delivered a user-originated abort-shaped error after abort
  acknowledgement but before dispatch settled; fallback still dispatched and
  state remained on `openai/fallback` with `attemptCount=1`.
- reproducedResult: `{"dispatchCount":1,"internalMarker":false,"currentModel":"openai/fallback","attemptCount":1}`
- evidencePointer: `packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog.ts:253`, `packages/omo-opencode/src/hooks/runtime-fallback/event-handler.ts:182`, `packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog-lifecycle.test.ts:280`, `.omo/evidence/20260716-pr-6043-main-watchdog/live-sse-events.jsonl:25`
- requiredRepair: represent watchdog abort ownership with provenance that can
  distinguish its own abort event from the real user-abort `session.error`
  surface after acknowledgement. Add an integrated regression that issues the
  external abort after acknowledgement and before fallback dispatch settles,
  asserting zero dispatch and fully reset retry state.

### B2: A delayed prior-generation internal abort cancels the next genuine turn

- violatedCriterion: `C3-exact-generation-provenance`
- observation: the watchdog deletes its generation record after dispatch, and
  a later genuine user update arms the next watchdog before
  `message-update-handler` clears the session-wide internal marker. If the
  prior generation's internal abort event then arrives over SSE, it has no
  generation token and is classified as external: the new watchdog is
  cancelled and fallback state resets to primary. A direct exact-head probe
  dispatched generation 1, armed a silent generation 2, then delivered the
  delayed generation-1 abort; generation 2 never dispatched.
- reproducedResult: `{"dispatchCount":1,"currentModel":"openai/primary","attemptCount":0}`
- evidencePointer: `packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog.ts:228`, `packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog.ts:235`, `packages/omo-opencode/src/hooks/runtime-fallback/message-update-handler.ts:45`, `packages/omo-opencode/src/hooks/runtime-fallback/event-handler.ts:182`
- requiredRepair: retain generation-bound abort provenance until the matching
  event is consumed or safely expired, without letting that record swallow a
  later external cancellation. Add a two-turn integrated regression where a
  delayed generation-1 internal abort arrives after generation 2 arms, and
  assert generation 2 remains armed and can perform its own fallback.

## Verification

- Exact local and PR refs both matched the required head/base SHAs.
- Full runtime-fallback suite reproduced: `269 pass, 0 fail` across 30 files.
- Focused lifecycle/watchdog/provenance/timeout suite reproduced: `58 pass, 0 fail`.
- OpenCode adapter typecheck reproduced: pass.
- Scoped Biome over all five changed production TypeScript files: pass.
- OpenCode QA harness self-check: pass with isolated XDG cleanup.
- `git diff --check`: pass.
- Exact-head GitHub CI checks were green on macOS, Ubuntu, and Windows.
- The live QA runtime source `dcdbaae5926e66a2165dfde00776c34052fabf61`
  has an empty runtime-fallback source diff to requested head `83ae672...`.

## Slop And Programming Review

Direct `remove-ai-slops` and `programming` review found no deletion-only tests,
requested-removal-only tests, tautological constant mirrors, needless
production parsing/normalization, dead production extraction, or speculative
abstraction. The tests generally assert behavior and the final production files
pass strict typecheck and scoped lint.

Non-blocking maintenance notes: the new
`first-prompt-watchdog-lifecycle.test.ts` is 356 pure LOC and the expanded
`first-prompt-watchdog.test.ts` is 551 pure LOC. They exceed the loaded skill's
250-LOC guidance and should be split by state-machine versus event-adapter
responsibility, but no repository success criterion makes file size alone a
gate blocker. An all-changed-test Biome run also reports a pre-existing
non-null assertion in `event-handler.test.ts:243`; the five changed production
files are clean.

The existing `.omo/evidence/pr-6043-code-review.md` explicitly records the
`remove-ai-slops`/`programming` perspectives and overfit criteria, but it is
pinned to an earlier head. The direct exact-head pass above supersedes its
verdict while confirming the required perspective coverage.

## Checked Artifacts

- `ROADMAP.md`
- `AGENTS.md`
- `packages/AGENTS.md`
- `packages/omo-opencode/src/AGENTS.md`
- `packages/omo-opencode/src/hooks/AGENTS.md`
- `packages/omo-opencode/src/hooks/runtime-fallback/AGENTS.md`
- `packages/omo-opencode/src/plugin/AGENTS.md`
- Full diff `81180f3759c55262a49be6883bb9db5c102e2b4d..83ae672478b4fdc0a76e8343bffd1040d360189a`
- PR #6043 body, commits, files, and exact-head checks via read-only `gh pr view`
- Issue #5982 body via read-only `gh issue view`
- `packages/omo-opencode/src/hooks/runtime-fallback/`
- `.omo/evidence/20260716-pr-6043-main-watchdog/README.md`
- `.omo/evidence/20260716-pr-6043-main-watchdog/fifth-review-finding.md`
- `.omo/evidence/20260716-pr-6043-main-watchdog/fifth-review-repair-focused-tests.txt`
- `.omo/evidence/20260716-pr-6043-main-watchdog/fifth-review-repair-runtime-fallback-suite.txt`
- `.omo/evidence/20260716-pr-6043-main-watchdog/final-fifth-review-live-watchdog-run.txt`
- `.omo/evidence/20260716-pr-6043-main-watchdog/live-plugin-watchdog.txt`
- `.omo/evidence/20260716-pr-6043-main-watchdog/live-sse-events.jsonl`
- `.omo/evidence/20260716-pr-6043-main-watchdog/live-isolation-receipt.txt`
- `.omo/evidence/pr-6043-code-review.md`
- `.omo/evidence/pr-6043-security-resource-safety-code-review.md`
- No ULW notepad was present for this goal.

## Exact Evidence Gaps

- No test or live scenario drives a real external abort-shaped `session.error`
  after watchdog abort acknowledgement but before fallback dispatch settles.
- No two-turn test delivers a delayed generation-1 internal abort after a
  genuine generation-2 user turn has armed.
- The production live run proves the ordinary event order only; it cannot close
  either adversarial ordering above.
