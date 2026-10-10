# Atlas Completion Loop Fix — QA Evidence

## Change
`packages/omo-opencode/src/hooks/atlas/resolve-active-boulder-session.ts` now returns `null` when the resolved boulder work has `status: "completed"` and `ended_at` is set. This prevents Atlas from re-injecting the `BOULDER_COMPLETE_PROMPT` on every `session.idle` once a plan is fully complete.

## Why this fixes the reported bug
Session `ses_091e682cdffeMgZXmRjfpYDE1A` showed Atlas injecting completion nudges in a loop after the `identity-verification` plan was already done:
- `boulder.json` had `status: "completed"`, `active_work_id: null`, all works `completed`.
- Despite that, every `session.idle` triggered `handleCompletedBoulderIdle`, which injected `BOULDER_COMPLETE_PROMPT` again.
- The in-memory guard `boulderCompletionNudgedAt` was lost on `session.compacted`, recreating the loop.

By making `resolveActiveBoulderSession` return `null` for completed+ended works, `handleAtlasSessionIdle` exits early on subsequent idle events, breaking the loop permanently (the guard is now in the persisted boulder state, not just memory).

## Unit-test evidence
```bash
cd /home/fciliberti/Trabajos/Tools/OmO/oh-my-openagent
bun test packages/omo-opencode/src/hooks/atlas
```

Result:
```
189 pass
0 fail
407 expect() calls
Ran 189 tests across 25 files.
```

Key new/updated tests:
- `resolve-active-boulder-session.test.ts`: "returns null for tracked work session when resolved work is completed and ended"
- `resolve-active-boulder-session.test.ts`: "returns complete progress when work is active even if plan is fully checked" (regression guard)
- `index.test.ts`: "should not re-inject completion nudge once boulder work is completed and ended" (simulates `session.idle`, then `session.compacted`, then `session.idle` again)

## Live `opencode run` QA attempt
An isolated sandbox (`source script/agent/qa-sandbox.sh`) was used to avoid touching the host `~/.config/opencode` or `~/.codex`.

The run failed before reaching the plugin/Atlas logic with:
```json
{"type":"error","error":{"name":"UnknownError","data":{"message":"Unexpected server error. Check server logs for details.","ref":"err_ebd7d444"}}}
```
This error occurs during OpenCode's own model/provider initialization, not in our code path. The session was created (`session.created` event) but no `session.idle` event was emitted, so Atlas could not be exercised end-to-end.

Tried providers:
- `litellm/deepseek-v4-flash` — APIError: "model whisper-large-v3-turbo does not support chat completions"
- `opencode/deepseek-v4-flash` — UnknownError
- `synthetic/echo` — UnknownError

Conclusion: the live-run QA path is blocked by an unrelated OpenCode server issue in this environment. The unit tests provide the authoritative regression coverage for this fix.

## Isolation proof
```bash
source script/agent/qa-sandbox.sh
# Host session counts unchanged before/after
sqlite3 ~/.local/share/opencode/opencode.db "select count(*) from session"  # 170 (unchanged)
```
All QA artifacts are in `/tmp/omo-qa-sandbox.*` and `/tmp/omo-qa-atlas-loop*`; they can be deleted after review.

## Files changed
- `packages/omo-opencode/src/hooks/atlas/resolve-active-boulder-session.ts`
- `packages/omo-opencode/src/hooks/atlas/resolve-active-boulder-session.test.ts`
- `packages/omo-opencode/src/hooks/atlas/index.test.ts`
