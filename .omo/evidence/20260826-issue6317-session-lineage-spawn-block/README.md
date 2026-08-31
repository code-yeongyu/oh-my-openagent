# Evidence — Issue 6317: subagent spawn blocked on session lineage resolution

Branch: `fix/session-lineage-spawn-block-6317` (worktree `/home/viprix/projects/oom-wt-6317`, base `origin/dev` @ `a17b91cdc`)

## What was tested

1. **Unit (TDD):** `subagent-spawn-limits.test.ts` + `manager.test.ts`. RED first: 4 new tests
   failed against the fail-closed implementation (see `red-subagent-spawn-limits.log`,
   `red-manager.log`). After the fix: 209 pass / 0 fail (`green-focused.log`).
2. **Focused suites:** all of `features/background-agent/`, `tools/delegate-task/`,
   `tools/call-omo-agent/` (the three consumers of the spawn gate): 1301 pass / 0 fail.
3. **Real-surface QA** (`qa-transcript.log`): real `opencode serve` 1.18.23 under a fully
   sandboxed XDG/HOME envelope in `/tmp/opencode/issue-6317/`, driven with the real
   `@opencode-ai/sdk` client and the real `resolveSubagentSpawnContext()` from this branch:
   - root + child sessions created via API; lineage resolves exactly (childDepth 1 and 2,
     correct rootSessionID, not degraded) through both matching and mismatching directory scopes.
   - dead-server case: returns `{rootSessionID: parent, parentDepth: 0, childDepth: 1,
     degraded: true}` instead of throwing. This is the code path ANY lineage lookup failure now
     takes (SDK error, missing data, thrown error, unreachable server), which is the class of
     failure reported in issue 6317.
   - bare (unscoped) `session.get` resolves by unique session ID.

## What was observed

- Before fix: any single lineage lookup failure threw
  `Subagent spawn blocked: failed to resolve session lineage ... [object Object]` and blocked
  every delegation route before agent resolution.
- After fix: scoped lookup retried unscoped; if still unresolvable the spawn proceeds with a
  degraded depth context plus a readable warning log; cycle detection still throws; depth limit
  still enforced for every resolvable lineage.

## Why it is sufficient

The defect was plugin-side control flow (fail-closed gate + `[object Object]` formatting), fully
covered by unit tests pinning the new contract at both the function level and the
BackgroundManager.launch level, plus a live-server QA run proving no false blocking on real
sessions and graceful degradation when resolution is impossible.

## What was omitted / redacted

- Could NOT reproduce the reporter's exact scoped-lookup failure on opencode 1.18.23: this
  server version answers cross-project directory-scoped gets successfully (scoped probe error=null
  in transcript). The reporter runs 1.18.4 with an apparent project-row FK mismatch. The retry +
  degrade path was therefore proven via the dead-server case, which exercises the identical
  failure branch any lookup error takes. Honest residual risk: behavior against opencode 1.18.4
  specifically was not exercised end-to-end.
- The reporter's observation that `app.agents()` is empty inside remotely-created sessions is
  OpenCode-core behavior, not plugin code; out of scope (documented-no-code).
- Session IDs in transcripts are sandbox-local; no tokens or credentials involved anywhere.
