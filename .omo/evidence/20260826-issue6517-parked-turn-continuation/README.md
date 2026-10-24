# Evidence - issue 6517: turn stays parked after a hook-stopped continuation until the user sends a message

Branch: `fix/parked-turn-continuation-6517` (worktree `/home/viprix/projects/oom-wt-6517`, base `origin/dev` @ `8c57e463e`)

## What was tested

1. **Unit / behavioral gate (RED -> GREEN)** - `gate-retry.test.ts` (new), driving the real
   production chain: `injectContinuation` -> real `dispatchInternalPrompt` gate ->
   real `SessionStateStore`, with virtualized timers (repo's established fake-timers harness).
   - RED log: `logs/red-gate-retry.log` - 3 failures, each for the right reason:
     transient "active" decline never re-dispatches; transient "reserved" decline never
     re-dispatches; no retry timer exists to cancel.
   - GREEN: all 5 new tests pass.
2. **Focused suites** - `bun test packages/omo-opencode/src/hooks/todo-continuation-enforcer/
   packages/omo-opencode/src/plugin/stop-continuation-entrypoints.test.ts`
   - Gate round 1: `logs/gates1-test.log` - 154 pass / 0 fail.
   - Gate round 2 (identical tree): `logs/gates2-test.log` - 154 pass / 0 fail.
3. **Strict typecheck** - `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json`
   - Round 1 exit 0 (`logs/gates1-tsgo.log`), round 2 exit 0 (`logs/gates2-tsgo.log`).
4. **Real-surface QA (isolated)** - real `opencode` 1.18.23 + this worktree's built plugin
   (`dist/index.js`) under a full XDG sandbox (`script/agent/qa-sandbox.sh` conventions:
   own XDG_DATA_HOME / XDG_CONFIG_HOME / XDG_STATE_HOME / XDG_CACHE_HOME / HOME / TMPDIR).
   - Boot proof: plugin loads and initializes under real opencode
     (`qa/plugin-log-first-boot.log`: ENTRY, live-server-route registered, tool-registry built).
   - Live turn proof: `opencode run --model opencode/big-pickle` completed a real model turn
     end-to-end with the changed build active (`qa/live-run-sanbox-ok.json`: step_start ->
     text "SANDBOX_OK" -> step_finish reason stop).
   - Enforcer live execution proof: via a long-lived `opencode serve` + server API, a session
     with one pending todo went idle and the REAL enforcer executed the changed code path:
     idle -> agent check -> countdown -> `Injecting continuation` -> prompt-async-gate
     dispatched via live listener -> `Injection successful` -> continuation turn ran ->
     turn-boundary pause ("directive-response") behaved exactly as before.
     Full log: `qa/plugin-log-enforcer-live.log`, excerpt: `qa/enforcer-live-excerpt.log`.
5. **Hygiene** - `GIT_MASTER=1 git grep "as any|@ts-ignore|@ts-expect-error|console.log"` on
   changed production paths: zero hits. `GIT_MASTER=1 git diff --check`: clean in both rounds.

## What was observed

- Before the fix, a transient gate decline ("active"/"reserved") dropped the continuation
  injection permanently (unit-proven by the RED run).
- After the fix, the decline schedules up to 3 bounded retries spaced 5s apart; retries
  re-run every guard plus the gate; `cancelCountdown()` tears down pending retries; the
  acceptance path resets the retry budget. No existing behavior changed: all 154 focused
  tests pass unchanged except an added timer-cleanup line in the peer-hold test.

## Why it is sufficient

The defect is the silent drop of a wake signal at `continuation-injection.ts` (the only
continuation path that dropped transient gate declines without retry; atlas, parent-wake,
and monitor all retry). The fix is confined to that drop point and its teardown, is covered
by tests that exercise the real gate and real state store, and the changed function was
proven executing correctly on a real opencode harness end-to-end. Residual regression risk
is limited to retry timing interactions, which are bounded (max 3 per idle cycle) and
gate-guarded (a live session can never be double-injected because every retry re-enters
`dispatchAfterSessionIdle`).

## Isolation proof

- Real `~/.local/share/opencode/opencode.db` session count 19013 before / 19016 after; the
  +3 delta comes from the host's own concurrently running opencode instance (this lane's
  subagent sessions). All four QA-created session IDs were queried against the real DB:
  0 rows each. Each sandbox DB contains exactly its own 1 session.
- Real `auth.json` sha256 identical before/after
  (`634feca22fa1fb9804b2d6fad5f62badf6642ccaca5f10c6264fd430d5e09073`); mtime advanced due
  to the same host activity, content untouched. It was cloned read-only into each sandbox.
- `~/.omo`, `~/.senpi`, `~/.codex` mtimes unchanged; `~/.config/opencode`,
  `~/.cache/opencode` mtimes unchanged within measurement tolerance (host activity).
  Snapshots: `qa/isolation-before.txt`, `qa/isolation-after.txt`.

## What was omitted / redacted

- Auth credentials: provider names only were listed from the sandbox-cloned auth copy;
  no tokens, keys, or auth.json contents were copied into evidence.
- Model output transcripts kept minimal (single-turn prompts); no system prompts or
  user-config-bearing dumps captured.
- Generated-bundle churn produced by `bun install` postinstall and by the plugin's own
  codegraph bootstrap during live QA (`packages/omo-codex/*/dist/*`,
  `packages/omo-senpi/plugin/extensions/*.js`,
  `packages/omo-codex/scripts/install-dist/install-local.mjs`) was reverted both times it
  appeared; it is not part of this change.

## Honest blockers

- The decline->retry branch could not be triggered against the LIVE harness: forcing a
  gate decline requires either seeding todos through an API that does not exist (todo
  endpoints are read-only in the SDK) or precise timing against a busy session with a
  nondeterministic model. That branch is proven by the unit gate, which drives the real
  `dispatchInternalPrompt` implementation and real `SessionStateStore`; only timers are
  virtualized there.
- tmux is unavailable on this machine, so no TUI smoke was performed; the change touches
  no TUI surface (verified: hook/event-tier logic only).
