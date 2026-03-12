---
description: Start Atlas Team Mode from Prometheus plan
argument-hint: [plan-name] [--worktree <path>]
agent: atlas
---

You are starting Atlas Team Mode.

<session-context>
Session ID: $SESSION_ID
Timestamp: $TIMESTAMP
</session-context>

## ARGUMENTS

- `/start-teammode [plan-name] [--worktree <path>]`
  - Reuse the same plan-discovery and worktree parsing flow as `/start-work`
  - Start a durable team runtime instead of a single-session run

## WHAT TO DO

1. Resolve or reuse the requested Prometheus plan.
2. Create or resume durable team runtime state under `.sisyphus/team/<team-id>/`.
3. Update `.sisyphus/boulder.json` with team-mode anchor metadata.
4. Launch tmux-backed Atlas worker sessions for the team runtime.
5. Keep leader coordination state durable so the run can resume safely.

## CRITICAL

- Preserve durable worker/task/mailbox/resume/shutdown semantics.
- Do not mutate `/start-work` behavior.
- Use the injected session id and timestamp values directly.
- Read the full plan before launching workers.
