# Fix Governance Hook Blocking Document-Writer - Implementation Plan

**Linear Issue**: [LIF-70](https://linear.app/lifelogger/issue/LIF-70)
**Created**: 2025-12-21
**Author**: Implementation Specialist

## Architecture

No architecture changes required. This is a surgical fix to register session agents properly.

### Current Flow (Broken)
```
BackgroundManager.launch()
  → client.session.create()
  → client.session.promptAsync() with agent
  → [session agent NOT registered]
  → Hook checks getAgentForSession() → returns "main"
  → isAllowedAgent() returns false
  → BLOCKED
```

### Fixed Flow
```
BackgroundManager.launch()
  → client.session.create()
  → setSessionAgent(sessionID, agent)  ← NEW
  → client.session.promptAsync() with agent
  → Hook checks getAgentForSession() → returns actual agent
  → isAllowedAgent() returns true for allowed agents
  → ALLOWED
```

## Implementation Steps

1. Add import for `setSessionAgent` from agent-registry
2. Call `setSessionAgent(sessionID, input.agent)` after session creation, before prompt

## File Changes

| File | Change | Lines |
|------|--------|-------|
| `src/features/background-agent/manager.ts` | Add import + setSessionAgent call | 2 lines |

## Dependencies

- `setSessionAgent` function from `../claude-code-session-state/agent-registry`

## Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Circular import | Low | Medium | Import is sibling feature, no cycles |
| Wrong session ID timing | Low | High | Session ID available immediately after create |

## Verification

1. Build passes (`bun run typecheck`)
2. document-writer can write .md files
3. Non-allowed agents still blocked
