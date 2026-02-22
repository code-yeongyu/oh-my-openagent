# Design: 50-Enhancements Verify Fix

## Goal

Bring 50-enhancements from 20% pass rate to ≥90% by fixing integration gaps, enabling disabled code, and implementing missing features.

## Architecture

No new architecture. All fixes target existing components:

- **`src/index.ts`** — Primary integration point. Most fixes are adding imports + `await` calls here.
- **`src/hooks/`** — Individual hook modules (code exists, needs wiring)
- **`src/features/`** — Feature modules (code islands needing consumers)
- **`src/mcp/`** — MCP subsystem modules (templates, lazy-loader, health-checker)
- **`src/agents/`** — Agent prompt modifications (explore, oracle)

## Tech Stack

- Runtime: Bun
- Language: TypeScript
- Testing: bun test (BDD)
- Build: bun build + tsc

## Fix Strategy Per Pattern

### Pattern A: Call Commented Out (4 tasks)
```
Current:  // await secretScanner?.["tool.execute.before"]?.(input, output);
Fix:      await secretScanner?.["tool.execute.before"]?.(input, output);
Verify:   bun test + manual trigger
```

### Pattern B: Code Island (17 tasks)
```
Current:  Module exists at src/X/Y.ts, exported, tested — but src/index.ts never imports it
Fix:      Add import + call site in src/index.ts (or appropriate consumer)
Verify:   bun run typecheck + bun test + runtime observation
```

### Pattern C: Default Disabled (2 tasks)
```
Current:  DEFAULT_CONFIG.enabled = false
Fix:      Change to true, or make configurable with enabled default
Verify:   Runtime observation
```

### Pattern D: Not Implemented (9 tasks)
```
Current:  Zero code, or only test stubs
Fix:      Full TDD implementation per original spec
Verify:   RED-GREEN-REFACTOR + integration test
```

## Key Decisions

1. **Wave-based execution**: Fix by risk level, not by task number
2. **Test after each wave**: Full `bun test` between waves to catch regressions
3. **Keep `isHookEnabled` guards**: All hooks remain disableable via config
4. **PARTIAL tasks**: Accept design-level PARTIALs (3.1 Oracle soft prompt, 14.3 inline try/catch) as intentional — only fix clear gaps

## Edge Cases

- Hook conflicts: Some hooks may interfere when all enabled simultaneously
- Performance: Many hooks active = slower tool calls. Monitor.
- Config migration: Users with existing configs won't get new defaults automatically
