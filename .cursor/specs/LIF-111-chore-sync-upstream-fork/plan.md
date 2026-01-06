# Upstream Fork Sync - Implementation Plan

**Linear Issue**: [LIF-111](https://linear.app/lifelogger/issue/LIF-111/sync-fork-with-upstream-code-yeongyuoh-my-opencode-397-commits)
**Created**: 2026-01-02
**Last Updated**: 2026-01-06
**Author**: Strategic Planner (OmO)

## Executive Summary

This plan details a **9-phase implementation** (originally 7, added 2 new phases) for synchronizing our heavily customized fork (DomGrieco/oh-my-opencode) with upstream (code-yeongyu/oh-my-opencode). The fork is **397+ commits behind** upstream and **118 commits ahead** with unique customizations.

**Update (2026-01-06)**: Added 106 new commits discovered since spec creation, including critical **OpenCode v1.1.1 permission system overhaul**. Two new phases added: Phase 1.5 (OpenCode 1.1.1 Compat) and Phase 4.5 (v2.12.4-v2.13.2 Features).

**Key Strategy**: Treat fork's architecture as the "spine" (ours), integrate upstream features as selective "organs" (theirs), with hard verification gates between phases. Use **phased manual merge** approach rather than git-imerge due to the complexity of our customizations.

**Estimated Total Time**: 9-11 days (62-74 hours)

## Technical Context

| Aspect | Details |
|--------|---------|
| **Language** | TypeScript 5.7+ |
| **Runtime** | Bun >= 1.0.0 |
| **Framework** | @opencode-ai/plugin SDK |
| **Target Files** | ~504 files with differences, ~110 high-conflict files |
| **Build** | `bun build` (ESM) + `tsc --emitDeclarationOnly` |

## Constitution Check

| Principle | Compliance |
|-----------|------------|
| **I. Plugin-First Architecture** | ✅ All features via @opencode-ai/plugin SDK |
| **II. Multi-Model Excellence** | ✅ Preserves model-per-task assignments |
| **III. Multi-Layered Orchestration** | ✅ Maintains OmO hierarchy, adds Sisyphus option |
| **IV. Bun-Native Development** | ✅ No npm/yarn/pnpm |
| **V. Hook-Driven Enhancement** | ✅ Adds upstream hooks selectively |
| **VI. Dogfooding** | ✅ Using OMO to plan this sync |
| **VII. GitHub Actions Publishing** | ✅ No local publish |

## Architecture

### Agent Coexistence Model

```
┌─────────────────────────────────────────────────────────────────┐
│                    Configuration Layer                          │
│  primary_orchestrator: "OmO" | "Sisyphus" (default: "OmO")     │
│  omo_agent: { disabled?: boolean }                              │
│  sisyphus_agent: { disabled?: boolean }                         │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌─────────────────────────┐     ┌─────────────────────────┐
│      OmO (Fork)         │     │   Sisyphus (Upstream)   │
│  - Multi-layer hierarchy│     │  - Ralph-loop workflow  │
│  - Linear integration   │     │  - GH Actions automation│
│  - Governance injection │     │  - Upstream patterns    │
│  - 24 specialist agents │     │  - Simpler delegation   │
└─────────────────────────┘     └─────────────────────────┘
              │                               │
              └───────────┬───────────────────┘
                          ▼
        ┌─────────────────────────────────────┐
        │     Shared Governance Spine         │
        │  - AGENT_ROLE_REGISTRY (team-lead)  │
        │  - Tool permission boundaries       │
        │  - Linear policy enforcement        │
        │  - Background task management       │
        └─────────────────────────────────────┘
```

### Hook Execution Order (Combined System)

```
┌─ chat.message ──────────────────────────────────────────────────┐
│  1. claudeCodeHooks (compatibility layer)                       │
│  2. thinking-block-validator (NEW - preventive)                 │
│  3. keyword-detector + think-mode                               │
│  4. governance-linear-injector                                  │
│  5. workflow-state-enforcer                                     │
└─────────────────────────────────────────────────────────────────┘

┌─ tool.execute.before ───────────────────────────────────────────┐
│  1. claudeCodeHooks                                             │
│  2. non-interactive-env                                         │
│  3. git-safety-validator (validation)                           │
│  4. security-scanner (validation)                               │
│  5. read-before-write (validation)                              │
│  6. governance-path-validator (validation)                      │
│  7. governance-docs-delegation (validation)                     │
│  8. conflict-detector (lock acquisition - LAST)                 │
└─────────────────────────────────────────────────────────────────┘

┌─ tool.execute.after ────────────────────────────────────────────┐
│  1. claudeCodeHooks                                             │
│  2. tool-output-truncator (with early-exit fix)                 │
│  3. context-window-monitor                                      │
│  4. directory-*-injector, rules-injector                        │
│  5. empty-task-response-detector                                │
│  6. security-scanner, conflict-detector (release locks)         │
│  7. governance-historian                                        │
└─────────────────────────────────────────────────────────────────┘

┌─ event (session lifecycle) ─────────────────────────────────────┐
│  session.error:                                                 │
│    1. session-recovery (reactive)                               │
│    2. todo-continuation-enforcer (500ms grace)                  │
│  session.idle:                                                  │
│    1. preemptive-compaction (NEW - at 85% threshold)            │
│    2. todo-continuation-enforcer                                │
│    3. context-window-monitor (70% reminder)                     │
└─────────────────────────────────────────────────────────────────┘
```

## Data Models

### Config Schema Changes

```typescript
// NEW: Primary orchestrator selector
export const PrimaryOrchestratorSchema = z.enum(["OmO", "Sisyphus"]).default("OmO")

// NEW: Sisyphus agent config (parallel to omo_agent)
export const SisyphusAgentConfigSchema = z.object({
  disabled: z.boolean().default(false),
}).optional()

// UPDATED: Add to OhMyOpenCodeConfigSchema
export const OhMyOpenCodeConfigSchema = z.object({
  // ... existing fields ...
  primary_orchestrator: PrimaryOrchestratorSchema.optional(),
  sisyphus_agent: SisyphusAgentConfigSchema.optional(),
  
  // NEW: Experimental features from upstream
  experimental: z.object({
    preemptive_compaction: z.boolean().default(true),
    preemptive_compaction_threshold: z.number().min(0.5).max(0.95).default(0.85),
    dcp_for_compaction: z.boolean().default(false),
    auto_resume: z.boolean().default(false),
  }).optional(),
})

// UPDATED: HookNameSchema (add new hooks)
export const HookNameSchema = z.enum([
  // ... existing hooks ...
  "preemptive-compaction",        // NEW
  "compaction-context-injector",   // NEW
  "thinking-block-validator",      // NEW
  "empty-message-sanitizer",       // NEW
  "ralph-loop",                    // NEW (optional)
])

// UPDATED: AgentNameSchema (add Sisyphus)
export const OverridableAgentNameSchema = z.enum([
  "OmO",
  "Sisyphus",  // NEW
  // ... existing agents ...
])
```

### Agent Role Registry Update

```typescript
// src/agents/index.ts - ADD Sisyphus
export const AGENT_ROLE_REGISTRY: Record<string, AgentRole> = {
  // Team Leads (can delegate to anyone)
  OmO: "team-lead",
  Sisyphus: "team-lead",  // NEW - same privileges as OmO
  
  // ... existing roles unchanged ...
}
```

## Implementation Steps

### Phase 0: Preparation (2h)

| Step | Task | Files | Estimate |
|------|------|-------|----------|
| 0.1 | Create backup branch | - | 5min |
| 0.2 | Enable git rerere for conflict reuse | - | 5min |
| 0.3 | Fetch upstream and analyze divergence | - | 15min |
| 0.4 | Document fork customizations checklist | FORK_CUSTOMIZATIONS.md | 30min |
| 0.5 | Set up verification environment | - | 30min |
| 0.6 | Create sync integration branch | - | 5min |

**Commands**:
```bash
# 0.1 Backup
git branch backup-before-sync-$(date +%Y%m%d)
git push origin backup-before-sync-$(date +%Y%m%d)

# 0.2 Enable rerere
git config rerere.enabled true

# 0.3 Fetch upstream
git remote add upstream https://github.com/code-yeongyu/oh-my-opencode.git 2>/dev/null || true
git fetch upstream

# 0.4 Analyze divergence
git log --oneline HEAD...upstream/master --left-right | head -50

# 0.6 Create sync branch
git checkout -b sync/lif-111-upstream-$(date +%Y%m%d)
```

**Verification Gate 0**: Branch created, upstream fetched, divergence documented

---

### Phase 1: Critical Bug Fixes (4h)

Cherry-pick critical upstream fixes BEFORE the main merge to stabilize the codebase.

| Step | Task | Commits/Files | Estimate |
|------|------|---------------|----------|
| 1.1 | Recovery pipeline early exit | d4787c4 | 30min |
| 1.2 | Compaction sufficient check + charsPerToken fix | dc057e9 | 45min |
| 1.3 | API path parameter fix (sessionID → id) | b64b3f9 | 30min |
| 1.4 | Context duplication fix (22k → 11k) | f3db564 | 45min |
| 1.5 | TTL pruning for background agents | d0694e5 | 45min |
| 1.6 | Todo enforcer improvements | 8b99133, f6b066e | 45min |

**Strategy**: Cherry-pick each fix individually, test after each.

```bash
# For each commit
git cherry-pick -x <commit-hash>
bun run typecheck
bun test
```

**Verification Gate 1**:
- [ ] `bun run typecheck` passes
- [ ] `bun test` passes
- [ ] `bun run build` passes
- [ ] Context token usage < 12k baseline

---

### Phase 1.5: OpenCode 1.1.1 Compatibility (6h) [NEW] - **75% COMPLETE**

**This phase was added on 2026-01-06 after discovering 106 new upstream commits.**

**Status Update (2026-01-06)**: Core implementation merged from `origin/dev` commit `4e30f83`. Only tests and verification remaining.

| Step | Task | Files | Estimate | Status |
|------|------|-------|----------|--------|
| 1.5.1 | Create version detection utilities | src/shared/opencode-version.ts | 1h | ✅ Done |
| 1.5.2 | Create permission compatibility layer | src/shared/permission-compat.ts | 1h | ✅ Done |
| 1.5.3 | Add comprehensive test coverage | src/shared/*.test.ts | 1h | ⏳ Pending |
| 1.5.4 | Update all specialist agents | src/agents/*.ts (~20 files) | 1.5h | ✅ Done |
| 1.5.5 | Update background agent manager | src/features/background-agent/manager.ts | 30min | ✅ Done |
| 1.5.6 | Update main plugin initialization | src/index.ts | 30min | ✅ Done |
| 1.5.7 | Test with both OpenCode 1.0.x and 1.1.x | - | 30min | ⏳ Pending |

**Merged Implementation** (from `origin/dev`):

```typescript
// src/shared/opencode-version.ts (110 lines)
export function getOpenCodeVersion(): string;
export function isOpenCodeV11Plus(): boolean;
export function parseOpenCodeVersion(version: string): OpenCodeVersion;

// src/shared/permission-compat.ts (79 lines)
export function convertPermissionsForVersion(
  permissions: Record<string, unknown>,
  openCodeVersion: string
): Record<string, unknown>;
```

**Why This Is Critical**:
- OpenCode 1.1.1 changed the permission format from string-based to object-based
- All agents MUST use the compat layer or they will fail with permission errors
- Runtime migration needed for existing user configs

**Verification Gate 1.5**:
- [x] Version detection returns correct OpenCode version
- [x] Permissions convert correctly for OpenCode 1.0.x format
- [x] Permissions convert correctly for OpenCode 1.1.x format
- [x] All agents use permission compat layer
- [ ] No runtime errors when starting with either OpenCode version (needs testing)

**Remaining Work**: ~1.5h (sync tests from upstream, verify with both OpenCode versions)

---

### Phase 2: Dependencies & Schema (6h)

| Step | Task | Files | Estimate |
|------|------|-------|----------|
| 2.1 | Merge package.json (theirs for deps, ours for scripts) | package.json | 1h |
| 2.2 | Regenerate bun.lock | bun.lock | 15min |
| 2.3 | Merge config schema (ours base + upstream additions) | src/config/schema.ts | 2h |
| 2.4 | Update schema JSON | assets/oh-my-opencode.schema.json | 30min |
| 2.5 | Fix type errors from schema changes | src/config/index.ts | 1h |
| 2.6 | Validate backward compatibility | - | 1h |

**package.json Strategy**:
- **THEIRS**: Dependency versions (especially @opencode-ai/plugin, @modelcontextprotocol/sdk)
- **OURS**: Scripts, build commands, Bun conventions
- **OURS**: Version number (managed by CI)

**Schema Strategy**:
- **OURS BASE**: All existing fork schemas
- **ADD**: Upstream schemas as optional fields
- **MIGRATE**: `disabled_hooks` to accept unknown strings with warnings

```typescript
// Backward-compatible hook name handling
const DisabledHooksSchema = z.array(z.string()).transform((arr) => {
  const known = new Set(Object.values(HookNameSchema.enum));
  return arr.filter(name => {
    if (!known.has(name)) {
      console.warn(`[oh-my-opencode] Unknown hook name: ${name} (will be ignored)`);
      return false;
    }
    return true;
  });
});
```

**Verification Gate 2**:
- [ ] `bun install` succeeds
- [ ] `bun run typecheck` passes
- [ ] `bun run build:schema` succeeds
- [ ] Existing fork configs parse successfully
- [ ] New upstream configs parse successfully

---

### Phase 3: Agent Integration (8h)

| Step | Task | Files | Estimate |
|------|------|-------|----------|
| 3.1 | Add Sisyphus agent implementation | src/agents/sisyphus.ts | 2h |
| 3.2 | Add Sisyphus prompt builder | src/agents/sisyphus-prompt-builder.ts | 1h |
| 3.3 | Update agent index (manual merge) | src/agents/index.ts | 1h |
| 3.4 | Update agent types | src/agents/types.ts | 30min |
| 3.5 | Add primary_orchestrator config handling | src/index.ts | 1.5h |
| 3.6 | Add agent name normalization | src/index.ts | 30min |
| 3.7 | Update tool-config for Sisyphus | src/config/tool-config.ts | 1h |
| 3.8 | Test agent coexistence | tests/ | 30min |

**Agent Coexistence Logic** (src/index.ts):
```typescript
// Determine primary orchestrator
const primaryOrchestrator = 
  pluginConfig.primary_orchestrator ??
  (pluginConfig.sisyphus_agent && !pluginConfig.sisyphus_agent.disabled ? "Sisyphus" : "OmO");

// Register both as team-leads, but only one is primary
if (primaryOrchestrator === "OmO" && builtinAgents.OmO) {
  config.agent = {
    OmO: builtinAgents.OmO,
    Sisyphus: { ...builtinAgents.Sisyphus, mode: "subagent" },
    // ... rest
  };
} else if (primaryOrchestrator === "Sisyphus" && builtinAgents.Sisyphus) {
  config.agent = {
    Sisyphus: builtinAgents.Sisyphus,
    OmO: { ...builtinAgents.OmO, mode: "subagent" },
    // ... rest
  };
}
```

**Verification Gate 3**:
- [ ] `bun run typecheck` passes
- [ ] OmO agent works as before (default)
- [ ] Sisyphus agent can be enabled via config
- [ ] Both agents have correct role permissions

---

### Phase 3.5: Agent Architecture Migration (6h) [NEW - CRITICAL]

**This phase implements FR-12: Migrate OmO to Sisyphus base + fork extensions.**

**Goal**: Refactor OmO to use Sisyphus's dynamic prompt builder architecture while preserving all our fork-specific customizations. This reduces long-term maintenance burden and makes future upstream syncs easier.

**Why This Phase Is Critical**:
- Sisyphus uses a composable `buildXxxSection()` pattern (more maintainable)
- Our OmO uses a static ~1100 line prompt (harder to maintain/merge)
- Without migration, every upstream Sisyphus improvement requires manual porting
- Migration now prevents exponential divergence

| Step | Task | Files | Estimate |
|------|------|-------|----------|
| 3.5.1 | Analyze OmO prompt sections and map to builders | Analysis doc | 1h |
| 3.5.2 | Create sisyphus-fork-extensions.ts scaffolding | src/agents/sisyphus-fork-extensions.ts | 30min |
| 3.5.3 | Extract buildGovernanceSection() | sisyphus-fork-extensions.ts | 45min |
| 3.5.4 | Extract buildSpecWorkflowSection() | sisyphus-fork-extensions.ts | 45min |
| 3.5.5 | Extract buildLinearIntegrationSection() | sisyphus-fork-extensions.ts | 30min |
| 3.5.6 | Extract buildDecisionMatrixExtensions() | sisyphus-fork-extensions.ts | 30min |
| 3.5.7 | Extract buildIntentGateExtensions() | sisyphus-fork-extensions.ts | 45min |
| 3.5.8 | Refactor omo.ts to compose Sisyphus + extensions | src/agents/omo.ts | 45min |
| 3.5.9 | Test OmO behavior matches previous (regression test) | - | 30min |

**Dependency Analysis Reference**: See `context/memory/omo-sisyphus-dependency-analysis.md` for detailed 21-section analysis.

**Key Findings to Handle**:
1. **Todo⇄Spec Cycle**: Todo_Management and Spec_Workflow have mutual references. Handle by having Spec extensions emit task data that Todo extensions consume (not direct section cross-references).
2. **Taxonomy Coupling**: Task types defined in Intent_Gate are referenced elsewhere. Our extensions should reference Sisyphus's base taxonomy where possible.
3. **Decision_Matrix Consistency**: Consider deriving our Decision_Matrix extensions from Intent_Gate additions to prevent drift.

**Architecture After Migration**:

```
src/agents/
├── sisyphus.ts                    # FROM UPSTREAM (unmodified, sync-able)
├── sisyphus-prompt-builder.ts     # FROM UPSTREAM (unmodified, sync-able)
├── sisyphus-fork-extensions.ts    # FORK-ONLY (our customizations)
│   ├── buildGovernanceSection()           # ~100 lines
│   ├── buildSpecWorkflowSection()         # ~150 lines
│   ├── buildLinearIntegrationSection()    # ~80 lines
│   ├── buildDecisionMatrixExtensions()    # ~60 lines
│   ├── buildIntentGateExtensions()        # ~120 lines
│   └── composeForkExtensions()            # Combines all sections
└── omo.ts                         # THIN WRAPPER (~50 lines)
    └── createOmoAgent() {
          const base = createSisyphusAgent(...)
          const extensions = composeForkExtensions()
          return { ...base, prompt: base.prompt + extensions }
        }
```

**Key Implementation Details**:

```typescript
// src/agents/sisyphus-fork-extensions.ts

/**
 * Fork-specific extensions for OmO agent.
 * These sections are UNIQUE to our fork and must be preserved.
 * They compose with upstream Sisyphus to create OmO.
 */

export function buildGovernanceSection(): string {
  return `<Governance>
## Governance Integration

Governance = Automatic Hooks + Explicit Tools

### What Hooks Do Automatically
- **Path Validation**: Validates file paths on write/edit operations.
- **Historian Tracking**: Tracks file modifications during sessions.
- **Linear Context Injection**: Detects Linear issue references and injects context.

### Governance Tools (Use Explicitly)
| Tool | Purpose |
|------|---------|
| \`linear_branch\` | Get the correct git branch name for a Linear issue |
| \`linear_update_status\` | Update issue status |
| \`linear_create_issue\` | Create new Linear issues |
| \`read_context\` | Read project-context.yaml |
| \`create_spec_folder\` | Create spec folder structure |

... (full governance content) ...
</Governance>`
}

export function buildSpecWorkflowSection(): string {
  return `<Spec_Workflow>
## Spec-Driven Task Management

Spec folders provide **persistent planning** that survives session boundaries.

### Spec Folder Detection (MANDATORY on Linear issue mention)
... (full spec workflow content) ...
</Spec_Workflow>`
}

// ... other builder functions ...

export function composeForkExtensions(): string {
  return [
    buildGovernanceSection(),
    buildSpecWorkflowSection(),
    buildLinearIntegrationSection(),
    buildDecisionMatrixExtensions(),
    buildIntentGateExtensions(),
  ].join("\n\n")
}
```

```typescript
// src/agents/omo.ts (REFACTORED)

import { createSisyphusAgent } from "./sisyphus"
import { composeForkExtensions } from "./sisyphus-fork-extensions"
import type { AgentConfig } from "@opencode-ai/sdk"

const OMO_DESCRIPTION = 
  "Powerful AI orchestrator for OpenCode (fork). " +
  "Built on Sisyphus foundation with spec-driven workflow, " +
  "Linear integration, and governance features."

export function createOmoAgent(): AgentConfig {
  // Start with Sisyphus base
  const sisyphusBase = createSisyphusAgent()
  
  // Add our fork-specific extensions
  const forkExtensions = composeForkExtensions()
  
  return {
    ...sisyphusBase,
    // Override name and description
    description: OMO_DESCRIPTION,
    // Compose prompts: Sisyphus base + fork extensions
    prompt: sisyphusBase.prompt + "\n\n" + forkExtensions,
    color: "#00CED1",  // Keep our OmO color
  }
}

export const omoAgent = createOmoAgent()
```

**Sections to Extract from Current OmO** (omo.ts lines ~1-1126):

| Section | Lines | Builder Function |
|---------|-------|-----------------|
| `<Intent_Gate>` | ~3-182 | `buildIntentGateExtensions()` |
| `<Todo_Management>` | ~184-235 | Part of `buildSpecWorkflowSection()` |
| `<Blocking_Gates>` | ~237-275 | Part of `buildIntentGateExtensions()` |
| `<Governance>` | ~960-1003 | `buildGovernanceSection()` |
| `<Spec_Workflow>` | ~1005-1110 | `buildSpecWorkflowSection()` |
| `<Decision_Matrix>` | ~924-958 | `buildDecisionMatrixExtensions()` |

**What Sisyphus Already Has** (no need to duplicate):
- Role section
- Phase 0-3 (Exploration, Implementation, Completion)
- Tool selection tables
- Delegation patterns
- Task management basics
- Tone and style
- Anti-patterns
- Parallel execution

**Verification Gate 3.5**:
- [ ] `src/agents/sisyphus-fork-extensions.ts` created with all 5 builder functions
- [ ] `src/agents/omo.ts` refactored to use Sisyphus base + extensions
- [ ] OmO agent produces equivalent prompt to previous static version
- [ ] All spec-driven workflow features work (spec folder detection, tasks.md → todos)
- [ ] All governance features work (Linear tools, path validation)
- [ ] `bun run typecheck` passes
- [ ] Regression test: OmO behavior unchanged from user perspective

---

### Phase 3.5.1: Architecture Cleanup (OPTIONAL - 4-8h)

**This is an OPTIONAL follow-up phase** for deeper architectural improvements identified in the dependency analysis. Not required for the sync but recommended for long-term maintainability.

| Step | Task | Estimate | Priority |
|------|------|----------|----------|
| 3.5.1.1 | Extract shared Taxonomy module (task types, scope levels) | 2h | Medium |
| 3.5.1.2 | Break Todo⇄Spec cycle with neutral artifact pattern | 2h | Medium |
| 3.5.1.3 | Auto-generate Decision_Matrix from Intent_Gate | 1-2h | Low |
| 3.5.1.4 | Define formal Evidence schema | 1h | Low |
| 3.5.1.5 | Unify governance constraints (Anti_Patterns, Gates, Verification) | 1-2h | Low |

**When to Execute**: After sync is complete and stable. Can be a separate Linear issue.

**Rationale**: The dependency analysis (see `context/memory/omo-sisyphus-dependency-analysis.md`) identified these as improvements for "clean modular architecture" but they're not blocking the sync. Deferring keeps Phase 3.5 focused on the critical path.

---

### Phase 4: Hook Integration (10h)

| Step | Task | Files | Estimate |
|------|------|-------|----------|
| 4.1 | Add preemptive-compaction hook | src/hooks/preemptive-compaction/ | 2h |
| 4.2 | Add compaction-context-injector hook | src/hooks/compaction-context-injector/ | 1h |
| 4.3 | Add thinking-block-validator hook | src/hooks/thinking-block-validator/ | 1.5h |
| 4.4 | Add empty-message-sanitizer hook | src/hooks/empty-message-sanitizer/ | 1h |
| 4.5 | Update session-recovery with upstream fixes | src/hooks/session-recovery/ | 1.5h |
| 4.6 | Update anthropic-auto-compact (DCP) | src/hooks/anthropic-auto-compact/ | 1h |
| 4.7 | Update hooks index (manual merge) | src/hooks/index.ts | 1h |
| 4.8 | Wire hooks in correct order | src/index.ts | 1h |

**Hook Wiring Order** (critical for correctness):
```typescript
// src/index.ts - event handler
event: async (input) => {
  // Session lifecycle
  await autoUpdateChecker?.event(input);
  await claudeCodeHooks.event(input);
  await backgroundNotificationHook?.event(input);
  await sessionNotification?.(input);
  
  // Recovery (before continuation)
  await sessionRecovery?.event(input);  // MUST be before todoContinuation
  
  // Compaction (preemptive)
  await preemptiveCompaction?.event(input);  // NEW
  
  // Continuation enforcement
  await todoContinuationEnforcer?.handler(input);
  
  // Context management
  await contextWindowMonitor?.event(input);
  
  // ... rest unchanged
}
```

**Verification Gate 4**:
- [ ] `bun run typecheck` passes
- [ ] `bun test` passes (all hook tests)
- [ ] Preemptive compaction triggers at 85%
- [ ] Thinking-block-validator prevents errors
- [ ] Hook ordering is correct (no races)

---

### Phase 4.5: New Features (v2.12.4 - v2.13.2) (8h) [NEW]

**This phase was added on 2026-01-06 after discovering new upstream releases.**

#### 4.5.1: Background Agent Concurrency (2h)

| Step | Task | Files | Estimate |
|------|------|-------|----------|
| 4.5.1.1 | Create concurrency management module | src/features/background-agent/concurrency.ts | 45min |
| 4.5.1.2 | Add concurrency tests | src/features/background-agent/concurrency.test.ts | 45min |
| 4.5.1.3 | Update schema with concurrency config | src/config/schema.ts | 15min |
| 4.5.1.4 | Integrate with background manager | src/features/background-agent/manager.ts | 15min |

**Key Implementation**:
```typescript
// src/features/background-agent/concurrency.ts
export interface ConcurrencyConfig {
  maxConcurrentPerModel?: number;
  defaultLimit?: number;
}

export function shouldThrottleAgent(
  model: string, 
  activeCount: number, 
  config: ConcurrencyConfig
): boolean;
```

#### 4.5.2: /refactor Command (3h)

| Step | Task | Files | Estimate |
|------|------|-------|----------|
| 4.5.2.1 | Create refactor command template | src/features/builtin-commands/templates/refactor.ts | 2h |
| 4.5.2.2 | Register command | src/features/builtin-commands/commands.ts | 15min |
| 4.5.2.3 | Add refactor types | src/features/builtin-commands/types.ts | 10min |
| 4.5.2.4 | Test refactor operations | - | 30min |

**Features**:
- LSP-based rename operations
- AST-Grep structural transformations
- Intelligent pattern matching
- Multi-file refactoring support

#### 4.5.3: Critical Bug Fixes (2h)

| Step | Task | Commit | Files | Estimate |
|------|------|--------|-------|----------|
| 4.5.3.1 | Fix session notification GC crash | 4a38e70 | src/hooks/session-notification/ | 30min |
| 4.5.3.2 | Prevent recursive subagent spawning | 375e7f7 | src/tools/call-omo-agent/ | 30min |
| 4.5.3.3 | Fix skill content lazy loading | ad44af9 | src/tools/slashcommand/ | 20min |
| 4.5.3.4 | Add zsh verification for hooks | d331b48 | Hook utilities | 20min |
| 4.5.3.5 | Test all fixes | - | - | 20min |

#### 4.5.4: Slashcommand & MCP Updates (1h)

| Step | Task | Commit | Files | Estimate |
|------|------|--------|-------|----------|
| 4.5.4.1 | Add slashcommand options/caching | 4e5b356 | src/tools/slashcommand/ | 30min |
| 4.5.4.2 | Restore Exa websearch MCP | a2bfb5e | MCP config | 20min |
| 4.5.4.3 | Update librarian for conditional web search | - | src/agents/librarian.ts | 10min |

**Verification Gate 4.5**:
- [ ] Background agent concurrency limits work correctly
- [ ] /refactor command performs LSP rename operations
- [ ] /refactor command performs AST-Grep transformations
- [ ] Session notification doesn't cause GC crash
- [ ] Recursive subagent spawning is prevented
- [ ] Skill content loads lazily
- [ ] zsh existence verified before hook execution
- [ ] Exa websearch MCP functional
- [ ] `bun run typecheck` passes
- [ ] `bun test` passes

---

### Phase 5: Tools & Features Integration (8h)

| Step | Task | Files | Estimate |
|------|------|-------|----------|
| 5.1 | Add session-manager tool (if valuable) | src/tools/session-manager/ | 2h |
| 5.2 | Update skill tool with MCP display | src/tools/skill/ | 1h |
| 5.3 | Add builtin-commands templates | src/features/builtin-commands/ | 1.5h |
| 5.4 | Update tools index (manual merge) | src/tools/index.ts | 1h |
| 5.5 | Update features index | src/features/index.ts | 30min |
| 5.6 | Verify Linear tools preserved | src/tools/linear/ | 1h |
| 5.7 | Verify sync-fork tool preserved | src/tools/sync-fork/ | 30min |
| 5.8 | Verify memory tools preserved | src/tools/memory/ | 30min |

**Tool Integration Strategy**:
- **KEEP ALL**: Linear tools, sync-fork, memory, spec, extract-learnings
- **ADD**: Session-manager, skill updates, builtin-commands
- **VERIFY**: No tool name collisions

**Verification Gate 5**:
- [ ] `bun run typecheck` passes
- [ ] `bun run build` passes
- [ ] All Linear tools functional
- [ ] All fork custom tools functional
- [ ] New upstream tools functional

---

### Phase 6: Main Plugin Wiring (6h)

| Step | Task | Files | Estimate |
|------|------|-------|----------|
| 6.1 | Merge src/index.ts (ours base, selective theirs) | src/index.ts | 3h |
| 6.2 | Verify all hooks wired correctly | - | 1h |
| 6.3 | Verify all tools exported | - | 30min |
| 6.4 | Verify config loading order | - | 30min |
| 6.5 | Integration testing | - | 1h |

**src/index.ts Merge Strategy**:
```
OURS (keep):
- Governance hooks initialization
- Linear tools initialization
- Background manager with TTL
- Config loading flow
- All existing hook wiring

THEIRS (add):
- New hook initializations (preemptive-compaction, etc.)
- New experimental config handling
- Updated recovery state tracking
- New tool initializations

MANUAL MERGE:
- Hook ordering (combine both sets in correct order)
- Agent initialization (add Sisyphus alongside OmO)
- Config type updates
```

**Verification Gate 6**:
- [ ] `bun run typecheck` passes
- [ ] `bun run build` passes
- [ ] `bun test` passes (all tests)
- [ ] Full integration test passes

---

### Phase 7: Documentation & Cleanup (4h)

| Step | Task | Files | Estimate |
|------|------|-------|----------|
| 7.1 | Update AGENTS.md | AGENTS.md | 1h |
| 7.2 | Update README with new features | README.md | 1h |
| 7.3 | Create migration notes | docs/guides/upstream-sync-migration.md | 1h |
| 7.4 | Update changelog | changelog/ | 30min |
| 7.5 | Final verification | - | 30min |

**Verification Gate 7** (FINAL):
- [ ] `bun run typecheck` passes
- [ ] `bun run build` passes
- [ ] `bun test` passes
- [ ] All documentation updated
- [ ] No TypeScript errors
- [ ] Context tokens ≤ 12k at startup
- [ ] All Linear tools functional
- [ ] All spec folders preserved

---

## Dependencies

### Internal (This Repo)

| Dependency | Status | Notes |
|------------|--------|-------|
| src/agents/omo.ts | Exists | Preserve, add Sisyphus peer |
| src/hooks/session-recovery/ | Exists | Update with upstream fixes |
| src/tools/linear/ | Exists | Must preserve completely |
| src/config/schema.ts | Exists | Extend with upstream schemas |

### External

| Dependency | Status | Notes |
|------------|--------|-------|
| @opencode-ai/plugin | Update | Match upstream version |
| @modelcontextprotocol/sdk | Add | For skill-MCP if adopted |
| js-yaml | May Update | Check upstream version |

## Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Merge conflicts in core files | HIGH | HIGH | Manual merge with ours as base, verification gates |
| Breaking Linear integration | MEDIUM | HIGH | Test all 7 Linear tools after each phase |
| Sisyphus/OmO config conflict | MEDIUM | MEDIUM | Config precedence rules, backward compat |
| Hook ordering race conditions | MEDIUM | HIGH | Explicit ordering, recovery state gating |
| Build failures from deps | MEDIUM | HIGH | Resolve package.json first, regenerate lock |
| Performance regression | LOW | MEDIUM | Benchmark tokens pre/post, hook health metrics |
| Loss of spec folders | LOW | HIGH | Verify .cursor/ preserved, backup first |

## Rollback Plan

### Per-Phase Rollback

After each phase, create a checkpoint:
```bash
git tag checkpoint-phase-N
```

If phase fails, rollback:
```bash
git reset --hard checkpoint-phase-(N-1)
```

### Full Rollback

If sync cannot be completed:
```bash
git checkout main
git branch -D sync/lif-111-upstream-*
git checkout backup-before-sync-*
```

### Rollback Triggers

Abort and rollback if ANY of these occur:
- [ ] Typecheck has 100+ errors across unrelated files
- [ ] Config parsing breaks for known-good fork configs
- [ ] Tool/hook name collision requires renaming (add alias instead)
- [ ] Linear integration tests fail
- [ ] Build output size increases >50%

## Testing Strategy

### Unit Tests (Per Phase)
```bash
bun test
```

### Type Checking (Per Phase)
```bash
bun run typecheck
```

### Build Verification (Per Phase)
```bash
bun run build
```

### Integration Tests (Phase 6-7)
1. Start OpenCode with oh-my-opencode plugin
2. Verify OmO agent responds
3. Test `/commit` command
4. Test Linear issue creation
5. Test background agent delegation
6. Verify context tokens < 12k

### Performance Benchmarks

| Metric | Pre-Sync Target | Post-Sync Target |
|--------|-----------------|------------------|
| Startup context tokens | ~22k | ≤12k |
| Hook chain latency (p95) | Baseline | ≤110% baseline |
| Background task memory | Unbounded | TTL-pruned (30min) |
| Build time | Baseline | ≤120% baseline |

## Success Metrics

| Metric | Target |
|--------|--------|
| TypeScript errors | 0 |
| Build failures | 0 |
| Test failures | 0 |
| Context tokens at startup | ≤12k |
| Linear tools functional | 7/7 |
| Spec folders preserved | 27/27 |
| Upstream hooks integrated | 5+ |
| Sisyphus agent available | Yes |
| Backward config compatibility | 100% |

## Time Summary (Updated 2026-01-06)

| Phase | Estimate | Cumulative | Status |
|-------|----------|------------|--------|
| Phase 0: Preparation | 2h | 2h | Not Started |
| Phase 1: Critical Bug Fixes | 4h | 6h | Not Started |
| **Phase 1.5: OpenCode 1.1.1 Compat** | ~~6h~~ **1.5h remaining** | **7.5h** | **75% Complete** |
| Phase 2: Dependencies & Schema | 6h | 13.5h | Not Started |
| Phase 3: Agent Integration | 8h | 21.5h | Not Started |
| **Phase 3.5: Agent Architecture Migration** | **6h** | **27.5h** | **Not Started** |
| Phase 4: Hook Integration | 10h | 37.5h | Not Started |
| **Phase 4.5: New Features (v2.12.4-v2.13.2)** | **8h** | **45.5h** | Not Started |
| Phase 5: Tools & Features | 8h | 53.5h | Not Started |
| Phase 6: Main Plugin Wiring | 6h | 59.5h | Not Started |
| Phase 7: Documentation & Cleanup | 4h | 63.5h | Not Started |
| **Buffer (20%)** | 12.7h | **76.2h** | - |
| **TOTAL** | | **~10-12 days** | - |

**Time Saved**: ~4.5h from Phase 1.5 (already implemented in origin/dev merge)
**Time Added**: +6h for Phase 3.5 (Agent Architecture Migration) - critical for long-term maintainability

**Note on Phase 3.5 Estimate**: 6h is for targeted extension extraction. The dependency analysis suggests 10-20h for full modular decomposition. We're deferring deeper architectural cleanup to optional Phase 3.5.1 (4-8h) to keep the sync focused. If extraction proves more complex due to the Todo⇄Spec cycle, budget an additional 2-4h buffer.

### Change Log

| Date | Change |
|------|--------|
| 2026-01-02 | Initial plan created (7 phases, 48-56h) |
| 2026-01-06 | Added Phase 1.5 (OpenCode 1.1.1 Compat) and Phase 4.5 (v2.12.4-v2.13.2 Features) after discovering 106 new upstream commits |
| 2026-01-06 | Merged origin/dev with OpenCode 1.1.1 compat layer - Phase 1.5 now 75% complete, ~4.5h saved |
| 2026-01-06 | **MAJOR**: Added Phase 3.5 (Agent Architecture Migration) - Migrate OmO to Sisyphus base + fork extensions. Revised DD-1 from "coexistence" to "migration". Added FR-12. Total time now ~76h (~10-12 days). This is critical for long-term maintainability and reduces future sync complexity. |

## Next Steps

After plan approval:
1. Run `/tasks` to create detailed task breakdown
2. Create Linear sub-issues for each phase
3. Begin Phase 0: Preparation
4. Execute phases sequentially with verification gates

## Appendix

### A. Fork Customizations to Preserve

| Category | Items | Files |
|----------|-------|-------|
| **Documentation** | Constitution, architecture, tech-stack, glossary | .cursor/memory/* |
| **Spec Workflow** | 27 spec folders | .cursor/specs/* |
| **Linear Integration** | 7 tools, 1 governance hook | src/tools/linear/, src/hooks/governance-linear-injector/ |
| **Custom Agents** | 18 agent definitions | .opencode/agent/*.md |
| **Workflow Hooks** | read-before-write, workflow-state-enforcer, meta-learning | src/hooks/* |
| **Memory Tools** | 5 memory management tools | src/tools/memory/ |
| **Sync Fork Tool** | AI-driven sync analysis | src/tools/sync-fork/ |
| **Changelog System** | Session changelogs | changelog/ |

### B. Upstream Features to Integrate (Updated 2026-01-06)

| Category | Items | Priority |
|----------|-------|----------|
| **OpenCode 1.1.1 Compat** | Permission system, version detection | CRITICAL (P0) |
| **Session Notification Fix** | Bun shell GC crash prevention | CRITICAL (P0) |
| **Recursive Subagent Fix** | call_omo_agent guard | CRITICAL (P0) |
| **Sisyphus Agent** | Orchestrator, prompt builder | HIGH (P1) |
| **Recovery Fixes** | Early exit, sufficient check, API fix | CRITICAL (P0) |
| **Context Optimization** | Duplication fix (50% reduction) | HIGH (P1) |
| **TTL Pruning** | Background agent memory management | HIGH (P1) |
| **Background Concurrency** | Model-based concurrent limits | HIGH (P1) |
| **/refactor Command** | LSP/AST-based refactoring | HIGH (P1) |
| **Preemptive Compaction** | 85% threshold auto-compact | MEDIUM (P2) |
| **Thinking Validator** | Prevention-layer hook | MEDIUM (P2) |
| **Slashcommand Options** | Caching, options support | MEDIUM (P2) |
| **Exa Websearch MCP** | Restored after removal | MEDIUM (P2) |
| **CLI System** | run, doctor, install commands | LOW (optional) |
| **Skill-MCP** | MCP server support in skills | LOW (optional) |

### B.1 New Commits Since Spec Creation (106 commits)

**Key Releases**:
| Version | Key Changes |
|---------|-------------|
| v2.12.4 | OpenCode 1.1.1 Planner-Sisyphus visibility fix |
| v2.13.0 | Slashcommand options/caching, Gemini quota routing, ultrawork mode |
| v2.13.1 | /refactor command, skip permission migration for Claude Code agents |
| v2.13.2 | Recursive subagent prevention, Exa websearch restoration |

**Critical Commits**:
| Commit | Description |
|--------|-------------|
| 09f72e2 | OpenCode v1.1.1 permission system compatibility |
| 4e30f83 | Add compat layer for all agents |
| 4a38e70 | Fix session notification Bun shell GC crash |
| 375e7f7 | Prevent recursive subagent spawning |
| f25f7ed | Background agent model-based concurrency |
| b78e564 | /refactor command (624 lines) |
| a2bfb5e | Restore Exa websearch MCP |

### C. Configuration Migration Examples

**Existing fork config (must work after sync):**
```json
{
  "omo_agent": { "disabled": false },
  "disabled_hooks": ["comment-checker"],
  "governance": {
    "linear": { "team_prefix": "LIF" }
  }
}
```

**New upstream-style config (should also work):**
```json
{
  "primary_orchestrator": "Sisyphus",
  "sisyphus_agent": { "disabled": false },
  "experimental": {
    "preemptive_compaction": true,
    "preemptive_compaction_threshold": 0.85
  }
}
```

**Combined config (both features):**
```json
{
  "primary_orchestrator": "OmO",
  "omo_agent": { "disabled": false },
  "sisyphus_agent": { "disabled": true },
  "experimental": {
    "preemptive_compaction": true
  },
  "governance": {
    "linear": { "team_prefix": "LIF" }
  }
}
```

---

**Plan Version**: 1.0.0
**Last Updated**: 2026-01-02
**Research Sources**: 10 explore/librarian agents + 3 oracle consultations
