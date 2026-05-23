# Session Replay & Debugger Visual

Step-by-step replay of agent sessions with decision tree visualization.

## API

### Snapshot Capture
- `captureSnapshot(params)` — Capture a tool call, result, decision, error, or state change
- `captureDecision(params)` — Capture a decision node with reasoning and outcome

### Replay
- `startReplay(sessionId)` — Load session snapshots into replay buffer
- `nextStep(replayId)` / `prevStep(replayId)` — Navigate forward/backward
- `goToStep(replayId, index)` — Jump to specific step
- `listReplayableSessions()` — List sessions with snapshots

### Diff & Analysis
- `computeDiff(snapshots)` — Compute diffs between consecutive snapshots
- `formatReplayStep(step)` — Human-readable step output
