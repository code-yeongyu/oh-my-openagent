# Teammode Component

**Generated:** 2026-07-03

## OVERVIEW

Codex team-mode component. Two deliverables in one dir:

- **PostToolUse hook** (`@sisyphuslabs/codex-teammode`): fires after `create_thread` / `codex_app.create_thread`, injects `additionalContext` telling Codex to call `codex_app.set_thread_title` NOW with the real task/role. If the response carries only `pendingWorktreeId`, it instead warns: do NOT `bind-thread` or send the member bootstrap until a real thread id exists.
- **`teammode` skill**: script-driven orchestration of a named team of Codex threads. Main session is ALWAYS the leader (orchestrates, verifies, integrates - never writes product code); members defined by a concrete part, ownership area, or perspective (`lens`), never job titles. Durable state under `.omo/teams/{session_id}/`: `team.json` + auto-generated `guide.md` member field manual + `artifacts/` exchange dir.

## KEY FILES

- `src/codex-hook.ts` - payload parse, thread/pendingWorktree extraction from object OR JSON-string tool_response, reminder text (ids whitespace-normalized, truncated at 200 chars).
- `src/cli.ts` - argv dispatch; only `hook post-tool-use`.
- `hooks/hooks.json` - matcher `^(create_thread|codex_app\.create_thread)$`, runs `node ${PLUGIN_ROOT}/dist/cli.js hook post-tool-use`, timeout 10.
- `skills/teammode/SKILL.md` - leader protocol: team-vs-subagent decision matrix, ulw-plan parallel-wave mapping, "Let members work - do not rush them" (4-reason message gate; quiet between heartbeats = working, not stalled), archive/delete/stop rules.
- `skills/teammode/scripts/team.mjs` - controller CLI: init / add-member / bind-thread / member-prompt / set-status / worktree-add / worktree-remove / integrate / archive / delete / status / guide. Zero npm deps, node builtins only, runs under node or bun on all 3 OSes.
- `skills/teammode/scripts/team-state.mjs` - state model + persistence: per-team `.team.lock` dir lock (`owner.json`; `OMO_TEAMMODE_LOCK_TIMEOUT_MS` / `OMO_TEAMMODE_LOCK_RETRY_MS`), atomic tmp+rename writes, symlink- and escape-guarded team dirs, schemaVersion 2, `MIN_MEMBERS = 2`, unique focus/name/threadTitle invariants.
- `skills/teammode/scripts/team-worktree.mjs` - git worktree provisioning + `merge --no-ff --no-edit` integration; conflict leaves the tree mid-merge for the leader to resolve and re-run.
- `skills/teammode/scripts/team-guide.mjs` - pure string builders for `guide.md` + the short member bootstrap trigger (`codex://threads/<id>` deep links, `WORKING:` / `BLOCKED:` heartbeat rules, English-only member traffic).
- `test/thread-title-hook.test.ts` - hook unit tests (vitest-style imports, run via `bun test`).

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Hook reminder text | `src/codex-hook.ts` `threadTitleReminder` + `test/thread-title-hook.test.ts`; `plugin/test/teammode-thread-title.test.mjs` pins the exact strings |
| Skill protocol text | `skills/teammode/SKILL.md`; contract tests `plugin/test/teammode-{communication,worktree,safety,archive-ambiguity,thread-links}.test.mjs` pin phrases |
| team.json shape | `team-state.mjs` (single source of the shape; `validateTeam` rejects schemaVersion != 2) |
| Branch naming, worktree paths, merge | `team-worktree.mjs` (`team/<sessionId>/<memberId>` branches, worktrees confined to `<team dir>/worktrees/<memberId>`) |
| Hook wiring | `hooks/hooks.json` (component) + `plugin/hooks/post-tool-use-checking-thread-title-hygiene.json` (aggregate; adds `commandWindows` powershell node-dispatch) |

## NOTES

- `plugin/skills/teammode/` is a gitignored synced COPY (`plugin/scripts/sync-skills.mjs` maps `teammode -> components/teammode/skills/teammode`). Edit here; `test:codex` overwrites the synced copy.
- `dist/cli.js` is gitignored build output (`bun build src/cli.ts --target node --format esm`); the aggregate hook invokes it at `${PLUGIN_ROOT}/components/teammode/dist/cli.js`, so a stale/missing dist silently no-ops the hook.
- Worktree isolation is conflict-triggered: the first `worktree-add` flips `team.worktree.enabled` for the whole team. Decide mid-run when a file collision appears, not only at init.
- `worktree-add` idempotence matches on branch ref + `realpathSync` (`samePath`). Plain `resolve()` comparison missed Windows 8.3 short names (RUNNER~1) and re-ran `git worktree add` into a fatal error; keep it realpath-based.
- All mutating subcommands serialize through `withTeamLock` and re-read committed state before writing. "team state is locked by ..." means the mutation did NOT happen; retry, or inspect `.team.lock/owner.json` after a crash.
- Archive ambiguity: "Ambiguous Codex thread id" from `codex_app.set_thread_archived` is an app-thread archival blocker, not a team-state blocker. Record it via `archive --note`, never claim the thread was archived, never delete team state before evidence is copied or the user accepts the loss.
- `integrate` lands member branches with merge commits only (`--no-ff`); never squash or rebase.
- `bind-thread` refuses while the team has fewer than 2 members; a single-member team is a subagent, not a team. Member focus, name, and threadTitle must each be unique (case/whitespace-insensitive).
- Every member is a real `codex_app.create_thread` thread bound via `bind-thread`; `multi_agent_v1.spawn_agent` is never a substitute.
- The hook must stay silent (empty stdout) on unrelated tools and malformed payloads; it never blocks a Codex turn.
- `init` with an explicit `--session <leader thread id>` makes `leader.sessionId` messageable; without it members cannot report and the leader is stuck polling. Re-running `init` is a safe no-op.
