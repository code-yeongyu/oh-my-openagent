# MetaGovernor

Self-judging agent orchestration layer. Observes each `tool.execute.after` event, reads from 3 memory systems, scores the session against weighted evidence, and dispatches a decision: `continue`, `warn`, `escalate`, or `stop`.

## Status

Experimental (PR 8 of 8). Opt-in via `meta_governor.enabled`.

## What it does

The MetaGovernor runs after every tool call and:

- Reads from 3 memory systems in parallel (agentmemory, magic-context, boulder-state) with per-source timeouts and graceful degradation.
- Predicts token-budget exhaustion from recent turn metrics.
- Scores the session against 6 weighted evidence sources (oracle verification, no-progress detector, deviation detector, iteration budget, lesson recall, token predictor).
- Dispatches a decision through a pure handler that records per-session history.
- Writes lessons back to agentmemory when a deviation exceeds the configured severity threshold.
- Force-continues after N consecutive stops to prevent infinite loops.
- Records every decision in a per-session history map for debugging.

## When to enable

- Long-running sessions that risk drifting off-task without an automated watchdog.
- Multi-agent orchestration sessions where one stuck member should escalate to a healthier strategy.
- Workflows where you want the system to remember its own mistakes across sessions (closed-loop learning).
- Debugging loop pathologies: the decision history shows you exactly when and why the governor acted.

## When NOT to enable

- Single-shot Q&A where the cost of memory reads outweighs the benefit.
- Sessions where you want unconstrained exploration without the governor intervening.
- Production code paths where MetaGovernor's `tool.execute.after` hook latency matters.

## Enable

Add to user config `~/.config/opencode/oh-my-openagent.jsonc` or project config `.opencode/oh-my-openagent.jsonc`:

```jsonc
{
  "meta_governor": {
    "enabled": true
  }
}
```

All other sub-configs are optional. Defaults are conservative. After enabling, restart opencode.

## Config schema (6 sub-objects)

All fields live under `meta_governor`:

### `enabled` (boolean, default `false`)

Master feature flag. When `false`, the orchestrator is registered as a no-op.

### `memory` (object, optional)

- `query` (string, default `"meta_governor_context"`) — natural-language query passed to all 3 memory backends.
- `agentmemoryTimeoutMs` (int, default `2000`) — timeout for the agentmemory read.
- `magicContextTimeoutMs` (int, default `1000`) — timeout for the magic-context read.
- `boulderStateTimeoutMs` (int, default `1000`) — timeout for the boulder-state read.

### `tokenPredictor` (object, optional)

- `compactBurnRateThreshold` (int, default `500`) — tokens/sec above which to recommend compact-now.
- `compactUsageThreshold` (float `0..1`, default `0.85`) — context usage ratio above which to recommend compact-now.
- `switchModelUsageThreshold` (float `0..1`, default `0.95`) — context usage ratio above which to recommend switch-model.
- `delegateConsecutiveHighBurn` (int, default `5`) — max consecutive high-burn turns before recommending delegate.

### `scoring` (object, optional)

- `continueThreshold` (float `-1..1`, default `0.3`) — score above this triggers silent continue.
- `warnThreshold` (float `0..1`, default `0.3`) — score magnitude below this triggers warn.
- `escalateThreshold` (float `0..1`, default `0.6`) — score magnitude above warn but below this triggers escalate.
- `stopThreshold` (float `0..1`, default `0.8`) — score magnitude above escalate but below this triggers stop.

### `decision` (object, optional)

- `maxHistoryPerSession` (int, default `50`) — maximum number of decision records kept per session.
- `forceContinueAfterStops` (int, default `3`) — number of consecutive stop decisions that triggers a forced continue with warning.

### `closedLoop` (object, optional)

- `saveDecisions` (boolean, default `true`) — whether to persist every decision to agentmemory.
- `saveLessons` (boolean, default `true`) — whether to write lessons on severe deviations.

## How it decides

```
                tool.execute.after
                       |
              +--------v--------+
              |  memory         |  ← 3 sources, parallel, with timeouts
              |  aggregator     |
              +--------+--------+
                       |
              +--------v--------+
              |  token          |  ← predicts budget exhaustion
              |  predictor      |
              +--------+--------+
                       |
              +--------v--------+
              |  scoring        |  ← 6 weighted evidence sources
              |  engine         |
              +--------+--------+
                       |
              +--------v--------+
              |  decision       |  ← continue | warn | escalate | stop
              |  handler        |  ← force-continue after N stops
              +--------+--------+
                       |
              +--------v--------+
              |  closed-loop    |  ← write lesson on severe deviation
              |  learning       |
              +-----------------+
```

Each step is independently testable. The integration test in `src/features/meta-governor/integration.test.ts` covers the full pipeline end-to-end.

## Observability

- **Decision history** — call `getDecisionHistory(sessionID)` from `decision-handler.ts` to retrieve the last N decisions for a session.
- **Lessons** — written to agentmemory with `type: "lesson"` and `concepts: ["meta_governor", ...]`. Query via agentmemory's `smartSearch`.
- **Errors** — MetaGovernor never crashes a tool call. Errors are logged to `console.error` with prefix `[meta-governor]`. Inspect `oh-my-opencode.log` for details.
- **Token predictions** — returned in `MetaGovernorOutput.tokenPrediction` (orchestrator output). Inspect `recommendation` field for `compact-now` / `switch-model` / `delegate`.

## Tradeoffs

- The 3-source memory read adds latency. Defaults are conservative (1-2s per source). If you observe tool execution slowing, lower the timeouts.
- Lessons are written to agentmemory. They persist across sessions and may influence future runs. Review lessons periodically to avoid drift.
- The decision handler force-continues after N stops. If your session legitimately needs to terminate, lower `forceContinueAfterStops` to `1`.
- Scoring weights are fixed in this PR. A future PR may expose weight tuning per agent or per session.

## Disabling per-session

Set `meta_governor.enabled = false` in the config to disable globally. There is no per-session override in this PR.

## Related

- `docs/guide/team-mode.md` — parallel multi-agent coordination (orthogonal to MetaGovernor; both can be enabled).
- `docs/guide/orchestration.md` — broader omo orchestration patterns.
- PR 1: `feat(meta-governor): define 5 type contracts` (#5087)
- PR 2: `feat(meta-governor): memory-aggregator reads from 3 systems in parallel` (#5091)
- PR 3: `feat(meta-governor): closed-loop learning writes lessons on deviation` (#5093)
- PR 4: `feat(meta-governor): token predictor flags budget exhaustion early` (#5094)
- PR 5: `feat(meta-governor): scoring engine weighs 6 evidence sources` (#5095)
- PR 6: `feat(meta-governor): decision handler dispatches continue/warn/escalate/stop` (#5096)
- PR 7: `feat(meta-governor): orchestrator integrates all 6 modules` (#5097)
- PR 8: `feat(meta-governor): integration hook + feature flag` (this PR, #5098)
