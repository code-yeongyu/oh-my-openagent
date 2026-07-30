# Third Exact-Head Review Finding

Reviewed head: `7d4e8424999d5fb888e8365dbc6f8d48258ad3e8`

## Finding

The watchdog excluded explicit `agent: "compaction"` user events, but the
repository's canonical compaction representation also permits a message to
retain its original agent and carry `parts: [{ type: "compaction" }]`. That
shape could incorrectly arm the new main-session watchdog during compaction.

## Failing-First Proof

Command:

```text
bun test packages/omo-opencode/src/hooks/runtime-fallback/first-prompt-watchdog.test.ts --test-name-pattern 'compaction-part'
```

Observed before the production fix:

```text
0 pass
1 fail
Expected calls.user: []
Received calls.user: [{ sessionID: "session-observed", agent: "sisyphus", ... }]
```

## Repair

Runtime head `5ae935e0c7754210faac62b36ccd0aeb170fd3e6` reuses the shared
`isCompactionMessage` predicate with both event-level and info-level parts.
The explicit-agent and retained-agent/compaction-part forms are both covered.

Final scoped results are captured in `third-review-repair-focused-tests.txt`
and `third-review-repair-runtime-fallback-suite.txt`.
