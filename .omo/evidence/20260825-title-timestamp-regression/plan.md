# Fix #5544: session title becomes timestamp (placeholder never replaced)

## Root cause analysis

OpenCode names a session from the task (`SessionPrompt.ensureTitle`, packages/opencode/src/session/prompt.ts)
only when ALL of these hold at step 1 of the first prompt loop:

1. `session.parentID` unset (not a child session)
2. `Session.isDefaultTitle(session.title)` is true (still `New session - <ISO ts>`)
3. history contains EXACTLY ONE real user message, where real = user message whose
   parts are NOT all `synthetic: true`
4. built-in `title` agent resolves and its small-model LLM call succeeds

oh-my-openagent defeats this in two provable ways:

- **A. CLI-run sessions are born pre-titled.** `cli/run/session-resolver.ts` creates
  sessions with `title: "oh-my-openagent run"`. Guard 2 then fails forever, so no
  `omo run` session ever gets a task-based title. All sisyphus-bot/automation
  sessions (the reporter ecosystem of #5544) hit this.
- **B. Internal control messages count as REAL user messages.** OpenCode core does
  not know OMO's `<!-- OMO_INTERNAL_INITIATOR -->` marker; only `synthetic: true`
  parts are excluded from guard 3's real-user count. Three main-session dispatch
  routes send marker-only or entirely unmarked text parts:
  - `features/background-agent/parent-wake-prompt-dispatch.ts` (marker-only)
  - `features/monitor/output-injector.ts` (marker-only)
  - `features/team-mode/member-session-routing.ts` `buildMemberPromptBody`
    (plain text, no marking at all; used by team live delivery into member sessions)

  Once any such message is present when titling runs (or before it), guard 3 fails
  and titling is permanently disabled for that session (later turns never retry
  because the count stays >= 2). The repo already uses synthetic-marked parts for
  runtime-fallback retries / todo continuation / compaction recovery
  (`createInternalAgentContinuationTextPart`); these three routes predate or bypass
  that convention.

Model-message delivery is unaffected by `synthetic: true`: OpenCode's
`MessageV2.toModelMessagesEffect` includes non-empty, non-ignored text parts
regardless of the synthetic flag, so wakes/deliveries still reach the model.
OMO-side detectors key on the marker TEXT, which is unchanged.

## Changes

1. `packages/omo-opencode/src/cli/run/session-resolver.ts`
   - Drop the custom `title` from the `session.create` body so OpenCode's
     ensureTitle names CLI-run sessions after the task.
2. `packages/omo-opencode/src/features/background-agent/parent-wake-prompt-dispatch.ts`
   - Build wake parts with `createInternalAgentContinuationTextPart`
     (synthetic: true) instead of `createInternalAgentTextPart`.
3. `packages/omo-opencode/src/features/team-mode/member-session-routing.ts`
   - `buildMemberPromptBody` marks its part synthetic via the same factory;
     widen `TeamMemberPromptBody["parts"]` accordingly.
4. `packages/omo-opencode/src/features/monitor/output-injector.ts`
   - Same swap for monitor batch injection (both reply and noReply branches).

## Verification (failing-first)

- `session-resolver.test.ts`: assert create body carries NO custom title (red
  against current code, green after fix 1).
- New `parent-wake-prompt-dispatch.test.ts`: drive ParentWakeNotifier flush with a
  capturing client; assert every dispatched wake text part satisfies OpenCode's
  synthetic filter (`part.synthetic === true`) while keeping the internal-initiator
  marker text (red before fixes 2).
- `member-session-routing.test.ts` (new assertions): `buildMemberPromptBody` parts
  are synthetic + marker-bearing (red before fix 3).
- Monitor injection-route test additions: dispatched monitor parts synthetic
  (red before fix 4).
- Scoped: `bun test` on touched dirs + `tsgo --noEmit` typecheck.
- Evidence: this directory (red/green runs, typecheck, notes).

## Residual risk

- Sessions already holding a non-default title are untouched (guard 2 unchanged).
- TUI first-turn titling for plain messages was already healthy; this PR removes
  the OMO-side mechanisms that suppress titling for automation flows and any
  session that receives OMO control traffic around its first turn.
