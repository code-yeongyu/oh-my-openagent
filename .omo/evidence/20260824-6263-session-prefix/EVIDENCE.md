# Evidence — 20260824 — issue #6263 session-existence prefix false negatives

## WHAT WAS TESTED

- Command: `bun test packages/omo-opencode/src/features/background-agent/session-existence.test.ts`
- Surface: `checkSessionExistence()` in `packages/omo-opencode/src/features/background-agent/session-existence.ts` — the cheap existence check consumed by `task-poller.ts` (lines 238, 288) for background-task recovery decisions.
- Behavior under test: a platform-prefixed session id (`opencode:` / `codex:` / `senpi:`, the format boulder.json stores via `normalizeSessionId` in `@oh-my-opencode/boulder-state`) must resolve to the same existence result as the raw id, because the storage layer resolves bare ids only.
- Regression fixture: mock client resolves ONLY the bare id (`ses_bare123`) and returns a 404 "Session not found" error for anything else — mirroring the real storage layer's behavior described in issue #6263.

## WHAT WAS OBSERVED

- RED (before fix): prefixed lookups returned `"missing"` while raw lookup returned `"exists"`:
  - `(fail) #given an opencode:-prefixed session id ... Expected: "exists" Received: "missing"` at session-existence.test.ts:74
  - `(fail) #given codex:- or senpi:-prefixed session ids ... Expected: "exists" Received: "missing"` at session-existence.test.ts:88
  - This reproduces the issue's production failure mode: live subagent sessions classified as gone every poll cycle, triggering recovery re-sends (the reported 6.09M-token runaway loop).
- GREEN (after fix): `5 pass, 0 fail` in session-existence.test.ts; prefixed ids are stripped to bare form before `client.session.get({ path: { id } })` (asserted via captured requested ids), missing-behind-prefix still classifies `"missing"`.
- Scoped suite: `bun test packages/omo-opencode/src/features/background-agent/` → `746 pass, 0 fail` across 59 files (includes all task-poller consumer tests).
- Typecheck: `bun run typecheck` (tsgo --noEmit + typecheck:script + typecheck:packages) → exit 0.

## WHY IT IS ENOUGH

- The failing-first pair proves both the defect (prefixed != raw) and the fix (prefixed == raw) at the exact boundary named in the issue triage (`session-existence.ts`, SDK path construction).
- The fixture encodes the real-world contract (bare-id-only resolution), so the test fails again if anyone reverts to passing the raw/prefixed id through.
- All 746 background-agent tests stay green, covering every caller of `checkSessionExistence`/`verifySessionExists` (task-poller recovery paths); repo-wide typecheck confirms no signature drift from the new exported `bareSessionId()` helper.
- Residual risk: other subsystems that consume prefixed ids from boulder.json against the SDK were out of scope; this change is confined to the session-existence boundary named by the issue and its owner triage comment.

## WHAT WAS OMITTED

- No live OpenCode harness drive: the fix surface is a pure SDK-path normalization verified deterministically at unit level; no opencode spawn was required and none was performed, so there is no DB/session-count isolation proof to record.
- No secrets, tokens, env dumps, or auth headers appear in this evidence or the test fixtures; mock ids are synthetic (`ses_bare123`, `ses_gone999`).
- `bun install` was run with `--ignore-scripts`: the prepare script hangs fetching submodules in this environment (known-harmless per worktree setup notes); dependency resolution itself completed cleanly.
