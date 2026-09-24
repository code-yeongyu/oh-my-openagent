# WHAT WAS OBSERVED

Before (captured in red-run.txt, real module import pre-fix):

```
prefix carries trigger literal: true "[SYSTEM DIRECTIVE: OH-MY-OPENCODE"
outbound payload carries trigger: TODO CONTINUATION -> [SYSTEM DIRECTIVE: OH-MY-OPENCODE - TODO CONTINUATION]
outbound payload carries trigger: BOULDER CONTINUATION -> [SYSTEM DIRECTIVE: OH-MY-OPENCODE - BOULDER CONTINUATION]
outbound payload carries trigger: DELEGATION REQUIRED -> [SYSTEM DIRECTIVE: OH-MY-OPENCODE - DELEGATION REQUIRED]
outbound payload carries trigger: SINGLE TASK ONLY -> [SYSTEM DIRECTIVE: OH-MY-OPENCODE - SINGLE TASK ONLY]
outbound payload carries trigger: COMPACTION CONTEXT -> [SYSTEM DIRECTIVE: OH-MY-OPENCODE - COMPACTION CONTEXT]
outbound payload carries trigger: CONTEXT WINDOW MONITOR -> [SYSTEM DIRECTIVE: OH-MY-OPENCODE - CONTEXT WINDOW MONITOR]
outbound payload carries trigger: PROMETHEUS READ-ONLY -> [SYSTEM DIRECTIVE: OH-MY-OPENCODE - PROMETHEUS READ-ONLY]
```

After:

- `bun test` scoped suite: `680 pass, 0 fail, 1451 expect() calls` across 77
  files (green-run.txt). Includes the pre-existing fixture in
  todo-continuation-enforcer/non-idle-events.test.ts that hardcodes the legacy
  `[SYSTEM DIRECTIVE: OH-MY-OPENCODE - RALPH LOOP 2/500]` format and still
  passes through the legacy-recognition branch.
- `tsgo --noEmit -p packages/omo-opencode/tsconfig.json`: exit code 0
  (typecheck.txt).

Isolation proof: no harness was spawned; all verification is hermetic unit-level
(bun test + tsgo) inside the task worktree. No user-level state read or written;
no network calls to model providers.
