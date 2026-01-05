# OpenCode 1.1.1 Compatibility Sync Analysis

**Date**: 2026-01-04
**Fork Version**: 2.1.2
**Upstream Version**: 2.12.3
**Status**: Analysis Complete - Ready for Implementation

## Problem Statement

OpenCode 1.1.1 introduced a **breaking change** in the permission system:
- Old: `tools: { bash: true, edit: false }` (booleans)
- New: `permission: { bash: "allow", edit: "deny" }` (strings)

Our fork uses `@opencode-ai/plugin: ^1.0.150` and will break on OpenCode 1.1.1+.

## Solution: Hybrid Cherry-Pick Strategy

### Files to Add (from upstream)
1. `src/shared/opencode-version.ts` - Version detection
2. `src/shared/permission-compat.ts` - Version-aware permission helper

### Files to Modify
1. `src/shared/index.ts` - Export new utilities
2. `package.json` - Update `@opencode-ai/plugin: ^1.1.1`
3. `src/index.ts` - Add config migration
4. `src/config/schema.ts` - Expand permission schema
5. All 27+ agent files - Use `createAgentToolRestrictions()`

## Key Functions

```typescript
// opencode-version.ts
supportsNewPermissionSystem(): boolean  // Returns true if >= 1.1.1
getOpenCodeVersion(): string | null     // Cached version detection

// permission-compat.ts  
createAgentToolRestrictions(denyTools: string[]): VersionAwareRestrictions
migrateAgentConfig(config): config      // Converts tools ↔ permission
migrateToolsToPermission(tools): permission
migratePermissionToTools(permission): tools
```

## Agent Update Pattern

```typescript
// BEFORE (broken on 1.1.1+)
export const oracleAgent: AgentConfig = {
  tools: { write: false, edit: false, task: false }
}

// AFTER (compatible with all versions)
import { createAgentToolRestrictions } from "../shared"

export const oracleAgent: AgentConfig = {
  ...createAgentToolRestrictions(["write", "edit", "task"])
}
```

## Consensus from Expert Agents

| Agent | Recommendation |
|-------|----------------|
| Explore x4 | Update plugin dependency, all agents need permission format updates |
| Librarian x4 | Cherry-pick permission-compat.ts, CRITICAL migration required |
| Oracle x3 | **HYBRID strategy**: Keep fork features, import compatibility fixes |

## Risk Assessment

- **Full Merge**: HIGH risk (loses 27 agents, governance, Linear tools)
- **Cherry-Pick**: MEDIUM risk (must be thorough)
- **Hybrid**: LOW risk (recommended, preserves fork value)

## Estimated Effort

- Core compatibility layer: 2-4 hours
- Agent updates: 4-6 hours (mechanical)
- Testing: 2-4 hours
- **Total: 1-2 days**
