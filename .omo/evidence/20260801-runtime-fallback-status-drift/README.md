# Runtime fallback session.status pattern drift QA

## Expected impact and scope

This change affects the OpenCode-connected runtime-fallback hook when OpenCode emits a `session.status` event whose status type is `retry`. The intended behavior is immediate fallback classification and dispatch for `Free usage exceeded, subscribe to Go`. Session error handling, fallback chain selection, prompt replay, and the first-prompt watchdog remain otherwise unchanged.

The drift fix shares the existing model-core runtime-fallback retryable regex set with both status-path classifiers. The auto-retry extractor retains its additional `retrying in`, `usage limit`, and `limit reached` signals.

## What was tested

1. Focused regression suite:
   - Command: `bun test packages/omo-opencode/src/hooks/runtime-fallback packages/model-core`
   - Artifact: `focused-tests-summary.txt`
   - Purpose: cover the exact signal extraction, direct session-status handler dispatch, shared-pattern identity, and existing runtime-fallback/model-core behavior.
2. Repository typecheck:
   - Command: `bun run typecheck`
   - Passing artifact after dependency refresh: `typecheck-after-install.txt`
   - Initial environment failure: `initial-verification-failure.txt`
3. Full Bun suite:
   - Command: `bun test`
   - Passing artifact after dependency refresh: `full-tests-summary.txt`
   - Initial environment failure: `initial-verification-failure.txt`
4. Worktree dependency refresh:
   - Command: `bun install`
   - Artifact: `bun-install-summary.txt`
   - Purpose: restore missing local Senpi and workspace package links in the dedicated worktree before rerunning repository-wide gates.
5. OpenCode QA harness self-check:
   - Command: `bash scripts/lib/common.sh --self-check` from `/Users/yeongyu/local-workspaces/omo/.agents/skills/opencode-qa`
   - Artifact: `opencode-qa-common-self-check.txt`
6. OpenCode SSE hook plumbing probe:
   - Command: `bash scripts/sse-hook-probe.sh --self-test` from the opencode-qa skill directory
   - Artifact: `opencode-sse-hook-probe.txt`
   - Purpose: prove an isolated OpenCode server publishes lifecycle events through the same event stream observed by plugin hooks.
7. Runtime-fallback hook module probe:
   - Command: `bun .omo/evidence/20260801-runtime-fallback-status-drift/runtime-fallback-hook-probe.ts`
   - Script: `runtime-fallback-hook-probe.ts`
   - Output: `runtime-fallback-hook-probe.txt`
   - Purpose: create the production runtime-fallback hook, drive `session.created` followed by the exact mocked `session.status` retry event through its public event handler, and assert one immediate abort plus one fallback prompt dispatch to `openai/gpt-5.4`.
8. OpenCode isolation proof:
   - Before: `opencode-before.txt`
   - After: `opencode-after.txt`
   - Both report the live DB session count as `21932`.
9. Language-server diagnostics:
   - All changed TypeScript files were checked. No diagnostics remained after adding the required `git_master` fields to the touched test fixture.

## What was observed

- The focused suite passed: 580 tests, 0 failures.
- Typecheck passed after `bun install` restored the worktree package links.
- After rebasing onto current `origin/dev`, the full suite passed: 12,665 tests, 3 expected skips, 0 failures.
- The OpenCode QA self-check passed all dependency, sandbox, HOME, DB path, SQL escaping, and cleanup checks.
- The isolated SSE probe received `server.connected` from `/event`.
- The production hook module probe handled `Free usage exceeded, subscribe to Go` immediately, recorded one abort, and dispatched one prompt using `openai/gpt-5.4` with the persisted user text.
- The real OpenCode DB session count was unchanged before and after QA, proving the spawned OpenCode server stayed isolated.
- Installed OpenCode version was 1.18.7.

## Why this is enough

The deterministic tests cover both classifier seams named in issue #6538 and the consumer behavior that previously returned through the non-matching diagnostic path. The shared-array identity test prevents the OpenCode status fallback list from becoming a separate copy again. The model-core extractor now consumes the same canonical array directly, so future additions to that runtime-fallback set automatically reach both status checks.

The public hook probe exercises the real runtime-fallback module boundary and dispatch flow, not only a standalone regex. The SSE probe separately proves OpenCode lifecycle event plumbing in an isolated harness. The unchanged live DB count demonstrates that QA did not pollute the user's OpenCode state.

## What was omitted

- No real provider quota was exhausted. Forcing a live account into quota exhaustion is impractical and could affect user billing or availability. The exact provider message was injected deterministically through the production hook module instead.
- No TUI smoke was run because the changed behavior is an event-hook classification and prompt dispatch path with no visual interaction.
- Full per-test output from the 12,668-test repository suite was summarized instead of committed because it was over 1 MB. The reviewer-readable counts and result are in `full-tests-summary.txt`.
- No raw environment dump, credentials, auth headers, provider tokens, or private session contents were captured.

## Residual risk

Low. The change broadens the auto-retry status extractor to every pattern already accepted by the runtime-fallback session-error classifier. This is intentional drift prevention, and focused plus full-suite coverage found no behavior regressions. A provider can still introduce a new retry phrase not represented in the canonical pattern set, which would continue to use the existing non-matching diagnostic until classified.
