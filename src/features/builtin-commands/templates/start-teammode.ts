export const START_TEAMMODE_TEMPLATE = `You are starting an Atlas team-runtime session through the dedicated tmux-first team-runtime entrypoint distinct from /start-work.

## ARGUMENTS

- \`/start-teammode [plan-name] [--workers N] [--team-name slug] [--worktree <path>]\`
  - \`plan-name\` (optional): name or partial match of the Prometheus plan to run in team mode
  - \`--workers N\` (optional): desired worker count for the tmux-first runtime (default from config)
  - \`--team-name slug\` (optional): stable persisted runtime identifier
  - \`--worktree <path>\` (optional): absolute path to an existing git worktree

## WHAT TO DO

1. Read the injected team-runtime manifest and persisted state paths.
2. Keep \`/start-work\` for the normal single-session Atlas execution path. This command is for tmux-first multi-worker execution only.
3. Reuse existing Prometheus plan output as the execution source of truth.
4. Launch or resume a tmux-first worker runtime with durable state, monitor snapshots, and guarded shutdown artifacts.
5. Use the manifest's persisted contract for worker orchestration, monitor/rebalance, and verification handoff.
6. Keep all worker execution inside the selected worktree when one is configured.

## CRITICAL

- Do not collapse this into a normal single-session Atlas run
- Persist monitor/rebalance state as work progresses
- Guard shutdown via shutdown-request + shutdown-ack artifacts
- Reuse existing tmux utilities and Atlas execution concepts where possible
- Treat the execution manifest as the authoritative team-runtime contract`
