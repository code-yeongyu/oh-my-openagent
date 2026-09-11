# team-core — Team-Mode Domain Primitives (Core)

**Generated:** 2026-06-16 (updated 2026-09-08)

## OVERVIEW

Harness-neutral domain primitives for team-mode: registry, mailbox, tasklist, state store, worktree, and tmux layout. Consumed by the OpenCode adapter at [omo-opencode team-mode](../omo-opencode/src/features/team-mode/AGENTS.md) (gated on `team_mode.enabled`). Package: `@oh-my-opencode/team-core`.

## DOMAIN PRIMITIVES

| Area | Files | Purpose |
|------|-------|---------|
| **Registry** | `team-registry/paths.ts`, `loader.ts`, `validator.ts`, `team-spec-input-normalizer.ts` | Discover/load `config.json` from `~/.omo/teams/{name}/` and `<project>/.omo/teams/{name}/`. Validate member eligibility, hyperplan composition, and path traversal guards. |
| **Mailbox** | `team-mailbox/send.ts`, `inbox.ts`, `poll.ts`, `ack.ts`, `reservation.ts` | Async member messaging with payload caps, broadcast gating, unread polling, delivery reservations, and pending-delivery recovery. |
| **Tasklist** | `team-tasklist/store.ts`, `list.ts`, `get.ts`, `claim.ts`, `update.ts`, `dependencies.ts` | Shared task CRUD with atomic claiming, dependency tracking, and status transitions. |
| **State Store** | `team-state-store/store.ts`, `locks.ts`, `resume.ts`, `runtime-cleanup.ts`, `session-liveness.ts` | Durable runtime `state.json` with atomic file locks, allowed status transitions, resume/recovery, and stale-run cleanup. |
| **Worktree** | `team-worktree/manager.ts`, `cleanup.ts` | Per-member git worktree creation, validation, and orphan removal. |
| **Tmux Layout** | `team-layout-tmux/layout.ts`, `resolve-caller-tmux-session.ts`, `rebalance-team-window.ts`, `sweep-stale-team-sessions.ts` | Optional tmux focus + grid pane layout, stale session sweep, and pane cleanup. |

## STORAGE

With the standalone team-core default base directory, team specs live under `~/.omo/teams/{name}/config.json` (user) and `<project>/.omo/teams/{name}/config.json` (project), runtime state, mailbox inboxes, and tasks under `~/.omo/runtime/{teamRunId}/`, and worktrees under `~/.omo/worktrees/{teamRunId}/{member}/` (`src/team-registry/paths.ts`). Senpi overrides this base directory as described below.

## On-disk layout (consumed by omo-desktop)

For senpi-task projects, `resolveStateDir(config)` defaults to `<project>/.omo/senpi-task`, unless `task.state_dir` is configured (`packages/senpi-task/src/store/state-dir.ts`). The senpi team storage base is `<stateDir>/teams` (`packages/senpi-task/src/team/storage.ts`, `teamStorageBaseDir`). The runtime state file is therefore `<stateDir>/teams/runtime/<teamRunId>/state.json`, or concretely `<project>/.omo/senpi-task/teams/runtime/<teamRunId>/state.json` by default (`src/team-registry/paths.ts`, `getRuntimeStateDir`; `src/team-state-store/store.ts`, `getStatePath`).

Senpi-task child records live at `<stateDir>/tasks/<task_id>.json` (`packages/senpi-task/src/store/record-store.ts`). Each `st_*.json` file is a `TaskRecord` (`packages/senpi-task/src/state/types.ts`): identity fields include `task_id`, `parent_session_id`, `root_session_id`, and optional `child_session_id` (the spawned child's own session id, written from the spawn handle at launch and kept across reattach/resume rewrites). External readers join a grandchild session (`parent_session_id`) back to its parent task via `child_session_id`. The field is optional so records written before it was persisted still parse.

The JSON follows `RuntimeStateSchema` in `src/types.ts`: `version: 1`, UUID `teamRunId`, `teamName`, `specSource`, epoch-ms `createdAt`, `status`, optional `leadSessionId`, optional `tmuxLayout`, `members`, `shutdownRequests`, and `bounds`. Each member has `name`, optional `sessionId`, `agentType: "leader" | "general-purpose"`, optional `subagent_type`, optional `category`, optional `model`, `status`, optional `worktreePath`, and runtime injection fields. `model` uses `providerID` and `modelID` (plus optional variant/reasoning parameters), not the task record's resolved-model naming. The external-reader member projection is `members[{name, sessionId, agentType, subagent_type, category, model, status, worktreePath}]`; absent optional routing/model metadata must remain absent rather than be inferred.

The tasklist directory is `<stateDir>/teams/runtime/<teamRunId>/tasks` (`src/team-registry/paths.ts`, `getTasksDir`; `src/team-tasklist/store.ts`). Each task file is `<stateDir>/teams/runtime/<teamRunId>/tasks/<id>.json`, with a decimal tasklist id distinct from senpi's `st_*` ids (`src/team-registry/paths.ts`, `getTaskFilePath`; `src/team-tasklist/store.ts`). `listTasks` (`src/team-tasklist/list.ts`) parses non-hidden JSON files as `TaskSchema` (`src/types.ts`): `version: 1`, `id`, `subject`, `description`, optional `activeForm`, `status`, optional `owner`, `blocks`, `blockedBy`, optional `metadata`, epoch-ms `createdAt` and `updatedAt`, and optional `claimedAt`. Missing dependency arrays default to empty.

A member mailbox inbox is `<stateDir>/teams/runtime/<teamRunId>/inboxes/<memberName>` (`src/team-registry/paths.ts`, `getInboxDir`; `packages/senpi-task/src/team/storage.ts`, `resolveTeamMemberInboxDir`). Unread files are `<messageId>.json` (`src/team-mailbox/send.ts`); `listUnreadMessages` reads non-hidden JSON files and sorts by timestamp (`src/team-mailbox/inbox.ts`). Each file follows `MessageSchema` (`src/types.ts`): `version: 1`, UUID `messageId`, `from`, `to`, `kind`, `body`, optional `summary`, optional `references`, positive epoch-ms `timestamp`, optional UUID `correlationId`, and optional `color`. During delivery the same directory holds `.delivering-<messageId>.json`; acknowledged history is under `processed/<messageId>.json` (`src/team-mailbox/reservation.ts`, `src/team-mailbox/ack.ts`). These are not unread messages; external history readers should deduplicate by `messageId`.

## NOTES

- **82 TypeScript files** across the 6 primitives plus shared top-level modules (`types.ts`, `config.ts`, `logger.ts`, `member-parser.ts`, `session-client.ts`, `shell-quote.ts`, `tolerant-fsync.ts`, `resolve-caller-team-lead.ts`).
- **Zod schemas** in `types.ts` define `TeamSpec`, `Member`, `Message`, `Task`, `RuntimeState`, and `AGENT_ELIGIBILITY_REGISTRY`.
- **Eligible agents** are sisyphus, atlas, sisyphus-junior, and hephaestus (conditional). Hard-reject agents are blocked at parse time.
- **Atomic writes** via `team-state-store/locks.ts`: temp file + rename, with file-based locking for task claims and state transitions.
- Parent: [`packages/AGENTS.md`](../AGENTS.md).

## QA

```sh
bun run typecheck        # tsgo --noEmit -p tsconfig.json
bun test src/*.test.ts src/**/*.test.ts
```

`team-layout-tmux/live-tmux-smoke.test.ts` is opt-in via `OMO_LIVE_TMUX=1` (it fakes `TMUX`/`TMUX_PANE` itself); the rest run filesystem-backed against temp dirs.
