# src/hooks/start-work/ -- /start-work Command Handler

**Generated:** 2026-08-17

## OVERVIEW

20 files (11 impl + 9 tests). Session Tier hook powering `/start-work`: detects the command template in the prompt, picks a Prometheus plan (explicit arg, session history affinity, or discovery), initializes/resumes boulder state, scaffolds notepads, and appends a context block to the first text part. Also parses `--worktree`, `--make-pr`, `--ship` flags.

## STRUCTURE

| File | Purpose |
|------|---------|
| `index.ts` | Barrel: `createStartWorkHook`, `detectWorktreePath`, `listWorktrees`, `parseUserRequest` |
| `start-work-hook.ts` | Hook factory. Handlers for `chat.message` + `command.execute.before`, both call `processStartWork`. `$SESSION_ID`/`$TIMESTAMP` substitution, marker-guarded injection |
| `parse-user-request.ts` | Extracts `<user-request>` body -> `{planName, explicitWorktreePath, makePr, ship}`. Strips `ultrawork|ulw` keywords and wrapping quotes |
| `context-info-builder.ts` | `buildStartWorkContextInfo`: routing brain. Multiple resume options -> pick list; single -> resume; none -> discovery |
| `plan-discovery-context.ts` | `shouldResume*` / `shouldDiscoverPlans` predicates + discovery output (no plans / all complete / auto-select / multi-plan pick list) |
| `explicit-plan-context.ts` | Named-plan path: match existing work, else `findPlanByName`, else fall back to sole incomplete plan, else "Plan Not Found" |
| `plan-selection.ts` | `findPlanByName` (exact -> normalized -> partial), `pickPreferredIncompletePlan`, list formatting, missing-plan context |
| `session-plan-affinity.ts` | `findRecentSessionPlanPath`: scans session messages (newest first) for `.omo|.sisyphus/plans/*.md` paths matching an available plan |
| `work-initializer.ts` | `addBoulderWork` or fresh `createBoulderState` + `writeBoulderState`; always `ensureNotepadScaffold` |
| `notepad-scaffold.ts` | Creates `.omo/notepads/{planName}/{learnings,decisions,issues,problems}.md` with `wx` flag (EEXIST -> skip) |
| `worktree-detector.ts` | `git worktree list --porcelain` parsing, `git rev-parse --show-toplevel` validation, realpath normalization |
| `worktree-block.ts` | "Worktree Active" enforcement block + PR delivery block (`--make-pr` hand off at PR, `--ship` work until merged) |

## FLOW

1. Gate: prompt must contain both `<session-context>` and the marker `"You are starting an Atlas work session."`; otherwise no-op.
2. Set session agent: `atlas` if registered, else `sisyphus` (`updateSessionAgent` + `output.message.agent`).
3. `parseUserRequest` on prompt text; `--worktree <path>` validated via `detectWorktreePath` (invalid -> setup instructions block).
4. No explicit plan? `findRecentSessionPlanPath` derives a preferred plan from session history (bare `ses_` id, #5285).
5. `buildStartWorkContextInfo` routes: resume existing work, auto-select preferred/sole incomplete plan (writes boulder state + notepads), or ask the user to pick.
6. Substitute `$SESSION_ID`/`$TIMESTAMP` inside every framework `<session-context>` region across all text parts (retry may re-issue the raw template, #4480).
7. Append context to first text part behind `<!-- omo-start-work-context -->`; marker presence makes double-firing idempotent.

## WIRING

Session Tier (`startWork` in `create-session-hooks.ts`); listed in parent tier table as the `/start-work` handler. Registers both `chat.message` and `command.execute.before`, since the command template can arrive by either route.

## CONVENTIONS

- All context output is prompt text, not state mutation, except auto-select paths which persist boulder state before returning text.
- Plan matching is progressively looser: exact name -> normalized (lowercase, dash-collapsed) -> substring.
- Git calls use `execFileSync` with 5s timeout; failures return null/empty, never throw.
- Session ids normalized via `normalizeSessionId(id, "opencode")` for storage; SDK calls take the bare id.

## ANTI-PATTERNS

- Don't inject without checking `CONTEXT_INFO_MARKER`; the hook fires on multiple routes for the same session.
- Don't overwrite notepad files; `wx` flag exists so re-runs skip existing files (append-only, enforced elsewhere by `notepadWriteGuard`).
- Don't resume a boulder state whose plan is complete or that conflicts with the session's preferred plan (`shouldResumeExistingState`).
- Don't pass the `opencode:`-prefixed id to `client.session.messages`.
