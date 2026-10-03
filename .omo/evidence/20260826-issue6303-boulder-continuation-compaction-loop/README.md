# Evidence — issue #6303: atlas boulder-continuation loops forever on failed compaction

Date: 2026-08-26 | Worktree: /home/viprix/projects/oom-wt-6303 | Base: origin/dev (a17b91cdc)

## What was tested

1. TDD RED: `atlas/compaction-loop-guard.test.ts` (5 full-hook tests through the real
   `createAtlasHook` composition) reproduced the defect pre-fix: non-retryable
   compaction-400 and token-limit `session.error` payloads each led to a continuation
   injection plus another injection on the following idle (the reported ~7s loop).
   Log: `red-log.txt` (4 fail / 1 pass; the passing test pins transient-error retry).
2. TDD GREEN: fix implemented (see plan.md); same suite 5/5 pass.
3. Focused gates, run TWICE consecutively over the identical final tree:
   - `bun test packages/omo-opencode/src/hooks/atlas packages/omo-opencode/src/hooks/todo-continuation-enforcer packages/omo-opencode/src/hooks/shared`
     -> 414 pass / 0 fail (both runs): `gates-run1-test.txt`, `gates-run2-test.txt`
   - `bunx tsgo --noEmit -p packages/omo-opencode/tsconfig.json` -> exit 0 (both runs)
   - `GIT_MASTER=1 git diff --check` -> clean (both runs)
   - hygiene scan `GIT_MASTER=1 git grep -n "as any\|@ts-ignore\|console\.log"` on all
     changed paths -> zero hits (both runs)
4. Regression sweep: `bun test packages/omo-opencode/src/hooks <2 tool guard tests>`
   with the fix = 2119 pass / 46 fail; the identical failing set exists on pristine
   origin/dev (verified by `git stash -u` round-trip: 44 fail on the same 270-file
   subset with and without the fix). Zero new failures attributable to this change.
5. Real-surface QA in an isolated XDG sandbox under `/tmp/opencode/issue-6303/`:
   real opencode 1.18.23 booted with the worktree-built bundle; plugin executed
   (plugin-owned storage artifact written inside the sandbox only); sandbox DB held
   exactly the one QA session; structured error event observed on the wire.
   Transcript: `qa-transcript.md`.

## Observed behavior after the fix

- Non-retryable request errors (status 400/422 with explicit `isRetryable: false`,
  e.g. the Anthropic compaction `tool_use`/`tool_result` split) classify as
  unrecoverable: flags + stall reason recorded, pending retry timer cleared, and the
  error branch returns WITHOUT invoking the idle handler -> no re-injection, loop broken
  at the error edge.
- Token-limit errors classify as token limit (precedence over unrecoverable, mirroring
  the #6109 enforcer else-if): same stop behavior.
- If the errored-compaction state is encountered without a live `session.error`
  (e.g. hook restart), the injection path itself skips when the latest persisted
  message is an ERRORED compaction marker or an aborted last assistant message;
  message-fetch failures fail OPEN so storage-only environments keep resuming after
  clean compactions (existing contract test
  `compaction-agent-filter.test.ts > should inject continuation when the latest message
  is compaction...` stays green untouched).
- A genuine user message clears the flags/stall so a manually repaired session resumes;
  a recurring 400 simply re-stalls after at most one visible failed turn.
- Transient runtime errors keep the existing single immediate retry
  (`skipNextIdleAfterRuntimeErrorRetry`) unchanged.

## Why this is sufficient

The defect is a deterministic event-path loop. The tests drive the actual composed
production handler with the exact provider error shape from the report and assert the
loop is broken at both edges (error event and injection decision), that recovery paths
(clean compaction resume, user intervention, transient retry) are preserved, and the
real-surface QA proves the changed bundle boots and executes inside real opencode.

## Omitted / redacted

- Live Anthropic 400 compaction repro omitted: needs provider credentials plus a
  context large enough to trigger auto-compaction (see qa-transcript.md).
- Host DB stat delta during the QA window was attributed to the host's own concurrent
  opencode sessions, not the sandboxed run (rationale in qa-transcript.md).
- No secrets, tokens, or auth headers appear in any evidence file.

## Self-audit wave ledger (mechanical state machine)

| Wave | Scope | Findings | Adjudication | Edits | clean_streak |
|------|-------|----------|--------------|-------|--------------|
| 1 | full git diff + adjacent callers | 6 candidates (P2 x5, noise x1) | documented-no-code x4 (completion-nudge-while-flagged is single deduped message; unconditional getState bounded by existing 10-min TTL prune; flag TTL prune = exact #6109 enforcer parity; context-recovery stickiness intentional fail-safe), out-of-scope x1 (goal hook default-off), noise x1 (split type/value import) | none | 0 |
| 2 | full-file reads, adjacent owners | F-2.1 (P3): atlas cleared stall flags on ANY user message.updated incl. synthetic/internal, deviating from enforcer parity | FIXED: gate reset on non-synthetic/internal user messages via shared isSyntheticOrInternalOnlyTextParts + regression test added | YES -> streak reset | 0 |
| 3 | re-audit of fixed tree | 0 | - | none | 1 |
| 4 | full hooks+tools sweep vs pristine baseline + evidence integrity | 0 new failures (46 fail identical to pristine dev on same file sets); RED proof for F-2.1 captured by temporary guard inversion, fully reverted (net zero content change) | - | none (net) | 1* |
| 5 | fresh full vertical re-read, sha256 of all 10 changed/new files pinned | 0 | - | none | 1 |
| 6 | immutability proof (sha -c pass), structural test verification | 0 | - | none | 2 -> STOP |

Authoritative gate runs on the FINAL tree: runs 5 and 6 (identical bytes, sha-pinned):
test 415/415 exit 0 both; tsgo exit 0 both; diff --check clean both; hygiene zero hits
on changed paths both. Runs 1-4 document earlier tree states.
F-2.1 RED evidence: red-log-f21-synthetic.txt (guard reverted -> 0 pass / 1 fail).
