# PR #7857 local refresh

Goal: preserve terminal synchronous-child error propagation while integrating
origin/dev 820b02f040a53750ba5d53fb45d8bdc8d3b6b905 into exact PR head
512d2abd5aff4dd6294875d13b00618d664c1759. No commits or remote mutations.

## Inspection and scope

Codegraph's existing index located BackgroundManager, pollSyncSession,
runSyncTaskLoop and executeSyncContinuation, but missed getTerminalChildError.
The index predates the PR; direct source and the seven-file PR diff were read.
The manager records terminal session.error for untracked synchronous sessions;
the poller reads it after a ten-second fallback grace. Both initial execution
and continuation bind the manager callbacks. Message updates/deletion clear it.
Scope is the seven existing PR files in background-agent and delegate-task.
No unrelated Senpi timeout or platform changes are planned.

## Ordered checklist

- [x] Create task-owned sibling from exact head; inspect ROADMAP, scoped
  instructions, codegraph, source and opencode-qa Case B.
- [x] Write this plan with apply_patch before merge.
- [x] Merge origin/dev --no-commit --no-ff with command-only MoerAI identity.
  Inspect conflicts and preserve both upstream behavior and the PR callbacks.
- [x] Install dependencies with verified Bun 1.4.0 and Node 24. Install's prepare
  failed on file transport; the explicit scoped-transport full build passed.
- [x] Request diagnostics on all seven PR files (sibling LSP paths rejected;
  adapter compiler passed), run related manager/poller/continuation
  tests once, adapter tsgo compiler, and full build; retain exact raw logs.
- [x] Run real OpenCode under Docker or env-cleared isolated HOME/XDG with
  local deterministic provider, no credentials/config/private skills inherited.
  Subscribe to session.error before triggering a failing synchronous child;
  assert that its error reaches the caller, not generic model success. Record
  live database session counts before/after without spawning a real-home CLI.
- [x] Stage audited public replay/captures/evidence under
  .omo/evidence/20260915-pr7857-refresh; exclude raw machine paths and skills.
- [x] Inspect staged diff against current base and preserve merge uncommitted.

Results and exact limitations: `.omo/evidence/20260915-pr7857-refresh/README.md`.
Lead follow-up: bind the captured SSE error to the actual child/session output
and await that exact buffered or future event, fail on premature SSE closure,
and bound child cleanup with a force-kill timer. Replay once after this QA-only
change and record its result before committing.
Three live attempts: setup failure, SSE/caller pass, stronger database/isolation
pass. No production edits after the clean merge. Related tests: 243 pass, 0 fail.

Stop at verified integration or an exact documented blocker, with at most three
materially different verification attempts and no failure-masking retries.
