# team-core — Team-Mode Domain Primitives (Core)

**Generated:** 2026-06-16 (updated 2026-08-24)

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

Team specs live under `~/.omo/teams/{name}/config.json` (user) and `<project>/.omo/teams/{name}/config.json` (project). Runtime state, mailbox inboxes, and tasks are stored under `~/.omo/runtime/{teamRunId}/`. Worktrees are under `~/.omo/worktrees/{teamRunId}/{member}/`.

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
