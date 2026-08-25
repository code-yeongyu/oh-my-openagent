# team-runtime — Team Lifecycle Engine

**Generated:** 2026-08-24

**Score:** 12 (22 files, 3.3k LOC, distinct domain; one line in `team-mode/AGENTS.md`)

## OVERVIEW

Lifecycle engine behind `team_create` / `team_status` / `team_shutdown_request`(+approve/reject) / `team_delete`. Tool layer lives in `../tools/`; this directory owns spawning, state transitions, member resolution, layout activation, and rollback.

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Create a team run | `create.ts` (`createTeamRun`) — spawns members via BackgroundManager, inits mailbox/tasklist/worktrees, activates optional tmux layout |
| Status | `status.ts` |
| Shutdown handshake | `shutdown.ts` + `shutdown-helpers.ts`, `shutdown-test-fixtures.ts` |
| Delete + background cancel | `delete-team.ts`, `delete-team-bg-cancel.ts` |
| Resource cleanup / rollback | `cleanup-team-run-resources.ts` |
| Member resolution | `resolve-member.ts`, `resolve-member-dependencies.ts`, `unresolved-team-members.ts` (`assertNoUnresolvedTeamMembers`) |
| Layout activation | `activate-team-layout.ts` (delegates to `../team-layout-tmux/`) |
| Session-scoped cleanup registry | `session-team-run-registry.ts` (`registerTeamRunForSessionCleanup`), `session-cleanup.ts` |
| Barrel | `index.ts` (exports only `resolve-member` + `shutdown`; create/delete/status consumed directly by `../tools/`) |

## CONVENTIONS

- Partial-failure rollback: `create.ts` throws `TeamRunCreateError` carrying a `cleanupReport` (`cancelledTaskIds`, `removedLayout`, `removedWorktrees`, `errors`) — every resource acquired mid-create must appear in that report on failure.
- Session IDs are polled (`SESSION_ID_POLL_MS = 25`) until known, then `registerTeamSession()` is called synchronously (spawn-race rule from parent `AGENTS.md`).
- Caller-lead reuse decided by `shouldReuseCallerLeadSession` (`../resolve-caller-team-lead.ts`).

## ANTI-PATTERNS

- NEVER spawn members without registering the session in `../team-session-registry.ts` first.
- NEVER leave a failed `create` partially provisioned — rollback path must run even when individual cleanup steps error.
- Do not add direct state writes here; durable state goes through `../team-state-store/` (atomic locks).
