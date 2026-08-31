# WHAT WAS TESTED

Issue #6336: subagent response stored but not rendered in the TUI until session reopen; `task()` returns empty / "No assistant text output found".

Root cause (file:line):
- Commit 9fc9667d0 ("fix(sync-subagent): abort session on completion to prevent todo-continuation re-awakening", landed between v3.17.15 and v4.16.3) added fire-and-forget `session.abort()` calls against completed sync subagent sessions at handback in three sites:
  - packages/omo-opencode/src/tools/call-omo-agent/sync-executor.ts (finally block)
  - packages/omo-opencode/src/tools/delegate-task/sync-task.ts (finally block)
  - packages/omo-opencode/src/tools/delegate-task/sync-continuation.ts (finally block)
- The unawaited abort races the parent's next prompt dispatched to the SAME session (`task_id` continuation). OpenCode applies the late abort to the now-active continuation turn: the assistant message shell renders but its live part updates are suppressed (empty assistant message in TUI), the plugin's own result fetch sees no text (`sync-result-fetcher.ts:159` "No assistant text output found in completed response"), while storage retains the full text, so `session_read` and a session reopen show it.
- Version corroboration: `git show v3.17.15:...sync-executor.ts | grep -c session.abort` = 0 (works); `git show v4.16.3:...sync-task.ts | grep -c session.abort` = 2 (affected). Matches the reporter's exact broken range (3.17.15 OK; 4.16.3/4.18.2/4.19.1 broken).
- The abort's original purpose is already covered by the `handedBackSyncSessions` guard added in 850415a79 and checked FIRST at packages/omo-opencode/src/hooks/todo-continuation-enforcer/idle-event.ts:57-60.

Commands:
- bun install (OMO_SKIP_MATERIALIZE=1; submodule materialize skip per repo constraint)
- bun test packages/omo-opencode/src/tools/call-omo-agent/ packages/omo-opencode/src/tools/delegate-task/
- bun run typecheck (tsgo --noEmit + typecheck:script + typecheck:packages)

# WHAT WAS OBSERVED

Failing-first (before fix), flipped assertions pinning the new invariant "no session.abort at sync handback":
- sync-executor-reawaken-guard.test.ts: FAIL - abort called 1 time, expected 0
- sync-task-reawaken-guard.test.ts: FAIL - abort called 1 time, expected 0
- sync-continuation.test.ts ("marks resumed sync session after successful handback without aborting it"): FAIL
- Red run: 17 pass / 3 fail across the three files.

After fix (removed the three fire-and-forget aborts; handedBackSyncSessions marking kept):
- Scoped suites: 556 pass / 0 fail (54 files, 1285 expect calls).
- bun run typecheck: all three stages clean.

Changed files:
- packages/omo-opencode/src/tools/call-omo-agent/sync-executor.ts
- packages/omo-opencode/src/tools/call-omo-agent/sync-executor-reawaken-guard.test.ts
- packages/omo-opencode/src/tools/delegate-task/sync-task.ts
- packages/omo-opencode/src/tools/delegate-task/sync-task-reawaken-guard.test.ts
- packages/omo-opencode/src/tools/delegate-task/sync-continuation.ts
- packages/omo-opencode/src/tools/delegate-task/sync-continuation.test.ts

# WHY IT IS ENOUGH

- The regression window matches the introducing commit exactly (0 aborts in v3.17.15, present from v4.16.3), and every reported symptom maps onto the single mechanism: unawaited abort on a just-completed session racing the next same-session prompt (empty live render + empty fetch result + stored-but-hidden text visible after reopen).
- The unit seam we own is the handback behavior: tests now pin that a completed sync subagent is marked handed-back (enforcer guard verified live in-test via handleSessionIdle -> countdown NOT armed) while NO session.abort is fired, so no late abort can clobber a continuation turn's rendering or result fetch.
- Reused-session path (isNew=false) already never aborted and its test still passes unchanged; failure-path test ("does not mark or abort ... when handback fails") still passes unchanged.
- tsgo typecheck green across root, script, and all workspace packages.

# WHAT WAS OMITTED

- Live OpenCode TUI reproduction (driving real `opencode` with a parent Sisyphus + Quick subagent and screenshotting before/after reopen): this environment has no opencode binary/model credentials; the QA would require an interactive TUI session. Mitigation: the failing-first unit tests pin the exact handback seam that produces the bug, and the version archaeology above ties it to the reporter's exact affected releases. Residual risk: if OpenCode's abort-on-idle semantics change, the guard-only handback remains safe because it issues no abort at all.
- Full root `bun test` suite: out of 15-minute scope; scoped suites cover every file touched plus their directories.
- No secrets appear in this evidence; no environment dumps were captured.
