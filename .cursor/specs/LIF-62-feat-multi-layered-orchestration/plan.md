# Implementation Plan: Multi-Layered Agent Orchestration Enhancement

**Branch**: `hello/lif-62-multi-layered-agent-orchestration-enhancement-for-oh-my` | **Date**: 2025-12-18 | **Spec**: [spec.md](./spec.md)  
**Linear Issue**: [LIF-62](https://linear.app/lifelogger/issue/LIF-62/multi-layered-agent-orchestration-enhancement-for-oh-my-opencode)  
**Architect**: Strategic Architect | **Status**: Ready for Implementation

---

## Executive Summary

Enhance Oh My OpenCode (OMO) with multi-layered agent orchestration, enabling agents to delegate to specialized sub-agents recursively. This transforms the current flat agent structure into a hierarchical "manager → specialist" model where:

1. **OmO** (Team Lead) delegates to **Implementation Specialist** (Manager)
2. **Implementation Specialist** delegates to **Backend TypeScript** or **Frontend React** (Specialists)
3. Governance rules are injected centrally to all file-modifying agents
4. Structured response formats ensure predictable agent-to-agent handoffs

**Technical Approach**: Remove artificial delegation restrictions from OMO's `call_omo_agent` and `background_task` tools, implement role-based tool configuration, and create a centralized governance template injection system.

**Key Finding from Research**: OpenCode's `task` tool natively supports recursive agent delegation with **NO explicit depth limit**. The `maxSteps` configuration indirectly controls iteration depth. OMO currently **artificially restricts** this capability by disabling `task`, `call_omo_agent`, and `background_task` tools on sub-agents.

**Critical Code Locations** (restrictions to modify):
- `src/tools/call-omo-agent/tools.ts` lines 124-126: `tools: { task: false, call_omo_agent: false, background_task: false }`
- `src/features/background-agent/manager.ts` lines 112-113: `tools: { task: false, background_task: false }`

---

## Constitution Check

*GATE: Must pass before implementation. Verified against `.cursor/memory/constitution.md`.*

| Principle | Status | Evidence |
|-----------|--------|----------|
| **I. Plugin-First Architecture** | ✅ PASS | All changes use `@opencode-ai/plugin` SDK. New agents follow `AgentConfig` interface. No OpenCode core modifications. |
| **II. Multi-Model Excellence** | ✅ PASS | Implementation Specialist uses Claude Sonnet (reasoning), Backend uses Claude Sonnet (code), Frontend uses Gemini Pro (UI). Optimal model per task. |
| **III. Bun-Native Development** | ✅ PASS | No npm/yarn/pnpm usage. All scripts use `bun run`. Build uses `bun build`. |
| **IV. Hook-Driven Enhancement** | ✅ PASS | Governance injection via existing hooks (`governance-path-validator`, `governance-historian`, `governance-linear-injector`). No new hooks needed for Phase 1. |
| **V. Dogfooding** | ✅ PASS | Using OMO to develop OMO. This plan created with strategic-architect agent. Implementation will use OMO's delegation patterns. |
| **VI. GitHub Actions Publishing** | ✅ PASS | No local publishing. Version managed by CI workflow. |

**No violations. Proceed with implementation.**

### Constitution Alignment Notes

1. **Plugin SDK Compliance**: All new agents extend `AgentConfig` from `@opencode-ai/sdk`. No custom runtime modifications.
2. **Model Selection Rationale**:
   - Implementation Specialist: `anthropic/claude-sonnet-4-5` - Strong reasoning for task decomposition
   - Backend TypeScript: `anthropic/claude-sonnet-4-5` - Excellent TypeScript code generation
   - Frontend React: `google/gemini-3-pro-preview` - Superior UI/visual understanding (matches existing `frontend-ui-ux-engineer`)
3. **Hook Reuse**: Existing governance hooks already fire for all agents. No duplication needed—just ensure agents are aware of governance context via prompt injection.

---

## Research Findings

### Phase 0: Deep Dive into Recursive Agent Delegation

#### OpenCode Native Capabilities (Confirmed via DeepWiki + Context7)

1. **TaskTool Architecture**:
   - Agents call `TaskTool.execute(params)` to spawn sub-agents
   - Creates new session with `parentID: ctx.sessionID` (enables session tree)
   - Sub-agent operates in isolated session with its own context window
   - **No explicit depth limit** - agents can recursively call other agents indefinitely
   - Results returned to parent via session message retrieval

2. **Current OMO Restrictions** (Identified as Artificial Limits to REMOVE/MODIFY):
   ```typescript
   // In src/tools/call-omo-agent/tools.ts (lines 119-130):
   await ctx.client.session.prompt({
     path: { id: sessionID },
     body: {
       agent: args.subagent_type,
       tools: {
         task: false,           // ❌ ARTIFICIAL: Blocks native delegation
         call_omo_agent: false, // ❌ ARTIFICIAL: Blocks OMO delegation  
         background_task: false // ❌ ARTIFICIAL: Blocks background delegation
       },
       parts: [{ type: "text", text: args.prompt }],
     },
   })
   
   // In src/features/background-agent/manager.ts (lines 107-116):
   this.client.session.promptAsync({
     path: { id: sessionID },
     body: {
       agent: input.agent,
       tools: {
         task: false,           // ❌ ARTIFICIAL: Blocks native delegation
         background_task: false // ❌ ARTIFICIAL: Blocks background delegation
       },
       parts: [{ type: "text", text: input.prompt }],
     },
   })
   ```

3. **Depth Control Mechanism** (Natural, not artificial):
   - `maxSteps` configuration limits agentic iterations per agent
   - When reached, agent receives system prompt to summarize and recommend remaining tasks
   - This provides natural depth control without hard limits
   - **Recommendation**: Set `maxSteps` lower for specialists (50) vs managers (100)

4. **Session Hierarchy**:
   ```
   Session Tree Example:
   ├── session_001 (OmO - parentID: null)
   │   ├── session_002 (Implementation Specialist - parentID: session_001)
   │   │   ├── session_003 (Backend TypeScript - parentID: session_002)
   │   │   └── session_004 (Frontend React - parentID: session_002)
   │   └── session_005 (Oracle - parentID: session_001)
   ```

#### Validation: Can Agents Call Agents Recursively?

**YES, confirmed.** OpenCode's architecture supports unlimited recursive delegation:
```
OmO → task(subagent_type="implementation-specialist")
  └→ Implementation Specialist → task(subagent_type="backend-typescript")
       └→ Backend TypeScript → (executes work, returns structured response)
            └→ Response aggregated by Implementation Specialist
                 └→ Final summary returned to OmO
```

**Current Blocker**: OMO artificially disables `task` tool on sub-agents.

**Solution**: Role-based tool configuration:
- **Team Lead** (OmO): All tools enabled
- **Manager** (Implementation Specialist): `task=true`, `call_omo_agent=false` (prevents loops)
- **Specialist** (Backend/Frontend): `task=false` (cannot delegate further)

#### Governance Gap Analysis

| Agent | Lines of Code | Modifies Files? | Governance Aware? | Action Required |
|-------|---------------|-----------------|-------------------|-----------------|
| OmO | 1094 | Yes (delegates) | ✅ Full | None |
| oracle | 78 | No | ❌ None | None (read-only) |
| librarian | 241 | No | ❌ None | None (read-only) |
| explore | 258 | No | ❌ None | None (read-only) |
| frontend-ui-ux-engineer | 93 | **Yes** | ❌ **None** | **INJECT GOVERNANCE** |
| document-writer | 204 | **Yes** | ❌ **None** | **INJECT GOVERNANCE** |
| multimodal-looker | 43 | No | ❌ None | None (read-only) |

**Key Finding**: 2 of 7 agents modify files without governance awareness. This creates audit gaps and inconsistent project organization.

#### Proposed Hierarchy Model

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            TEAM LEAD LAYER                                   │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │   OmO (anthropic/claude-opus-4-5)                                     │  │
│  │   Role: Primary orchestrator, intent classification, strategic decisions │
│  │   Tools: ALL (task, background_task, call_omo_agent, governance tools) │  │
│  │   Governance: Full awareness (1094 lines of governance prompts)        │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
        ┌─────────────────────────────┼─────────────────────────────┐
        │                             │                             │
        ▼                             ▼                             ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            MANAGER LAYER                                     │
│  ┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────┐  │
│  │ Implementation          │  │ (Future Managers)       │  │ Oracle      │  │
│  │ Specialist              │  │ - Research Manager      │  │ (Advisor)   │  │
│  │ (claude-sonnet-4-5)     │  │ - QA Manager            │  │ (gpt-5.2)   │  │
│  │                         │  │ - Docs Manager          │  │             │  │
│  │ Tools: task=TRUE        │  │                         │  │ Tools: R/O  │  │
│  │ Governance: Full        │  │                         │  │ No files    │  │
│  └────────────┬────────────┘  └─────────────────────────┘  └─────────────┘  │
└───────────────┼─────────────────────────────────────────────────────────────┘
                │
        ┌───────┴───────┐
        │               │
        ▼               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SPECIALIST LAYER                                   │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐  │
│  │ Backend TypeScript  │  │ Frontend React      │  │ frontend-ui-ux-     │  │
│  │ (claude-sonnet-4-5) │  │ (gemini-3-pro)      │  │ engineer (existing) │  │
│  │                     │  │                     │  │ (gemini-3-pro)      │  │
│  │ Tools: task=FALSE   │  │ Tools: task=FALSE   │  │ Tools: task=FALSE   │  │
│  │ Governance: Full    │  │ Governance: Full    │  │ Governance: Full    │  │
│  │ Focus: API, DB,     │  │ Focus: React,       │  │ Focus: Design,      │  │
│  │ TypeScript backend  │  │ Next.js, state      │  │ aesthetics, UX      │  │
│  └─────────────────────┘  └─────────────────────┘  └─────────────────────┘  │
│                                                                              │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐  │
│  │ document-writer     │  │ (Future Specialists)│  │ multimodal-looker   │  │
│  │ (existing)          │  │ - Database          │  │ (existing, R/O)     │  │
│  │ (gemini-3-pro)      │  │ - Infrastructure    │  │ (gemini-2.5-flash)  │  │
│  │                     │  │ - Testing           │  │                     │  │
│  │ Governance: Full    │  │                     │  │ Governance: None    │  │
│  └─────────────────────┘  └─────────────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            UTILITY LAYER                                     │
│  ┌─────────────────────┐  ┌─────────────────────┐                           │
│  │ explore             │  │ librarian           │                           │
│  │ (grok-code)         │  │ (claude-sonnet-4-5) │                           │
│  │                     │  │                     │                           │
│  │ Tools: Read-only    │  │ Tools: Read-only    │                           │
│  │ Governance: None    │  │ Governance: None    │                           │
│  │ Focus: Codebase     │  │ Focus: External     │                           │
│  │ exploration         │  │ research            │                           │
│  └─────────────────────┘  └─────────────────────┘                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Governance Injection Strategy Analysis

**Option A: Static Prompt Extension** (SELECTED for Phase 1)
- Create `GOVERNANCE_TEMPLATE` constant in `src/config/governance-template.ts`
- Append to agent prompts at agent creation time in `src/agents/utils.ts`
- **Pros**: Simple, no runtime overhead, predictable behavior
- **Cons**: Requires plugin rebuild on template change
- **Token Cost**: ~400-500 tokens per agent (within NFR-001 limit)

**Option B: Dynamic Hook-Based Injection** (Future enhancement)
- Create `governance-prompt-injector` hook
- Inject at `chat.message` event using existing `injectHookMessage` utility
- **Pros**: Dynamic, no rebuild needed, can vary by context
- **Cons**: Runtime overhead, complexity, harder to debug
- **When**: Consider for v2 if template changes frequently

**Decision**: Use **Option A** for initial implementation. The governance template will be stable and changes are infrequent. Clear migration path to Option B exists via the `hook-message-injector` feature.

#### Delegation Depth Control Strategy

**Problem**: Unlimited recursive delegation could cause:
1. Context window explosion (each level adds ~4000 tokens)
2. Infinite loops if agents delegate in circles
3. Unpredictable execution time

**Solution**: Implement depth limit of 2 levels (OmO → Manager → Specialist):

```typescript
// Enforce via role-based tool configuration
const TOOL_CONFIG_BY_ROLE = {
  "team-lead": { task: true, call_omo_agent: true },     // Can delegate anywhere
  "manager":   { task: true, call_omo_agent: false },    // Can delegate down, not up
  "specialist": { task: false, call_omo_agent: false },  // Cannot delegate
  "advisor":   { task: false, call_omo_agent: false },   // Cannot delegate
  "utility":   { task: false, call_omo_agent: false },   // Cannot delegate
}
```

This enforces a maximum depth of 2 by design:
- Level 0: OmO (team-lead)
- Level 1: Implementation Specialist (manager) 
- Level 2: Backend/Frontend specialists (specialist) - TERMINAL, cannot delegate further

---

## Data Model

### Agent Role Classification

```typescript
// src/agents/types.ts - NEW TYPE DEFINITIONS

/**
 * Agent role classification for multi-layered orchestration.
 * Determines delegation capabilities and governance requirements.
 */
export type AgentRole = 
  | "team-lead"   // OmO: Can delegate to anyone, full governance
  | "manager"     // Implementation Specialist: Can delegate to specialists
  | "specialist"  // Backend/Frontend: Cannot delegate, full governance
  | "advisor"     // Oracle: Read-only, strategic guidance
  | "utility"     // Explore/Librarian: Read-only, research tasks

/**
 * Governance level determines which governance rules are injected.
 */
export type GovernanceLevel = 
  | "full"     // All governance rules (path validation, changelog, Linear, spec)
  | "minimal"  // Only path validation and changelog
  | "none"     // No governance injection (read-only agents)

/**
 * Extended agent configuration with role metadata.
 * Extends the base AgentConfig from @opencode-ai/sdk.
 */
export interface ExtendedAgentConfig extends AgentConfig {
  /** Agent role in the hierarchy */
  role: AgentRole
  
  /** Whether agent can use task/call_omo_agent tools */
  canDelegate: boolean
  
  /** Level of governance rules to inject */
  governanceLevel: GovernanceLevel
  
  /** Optional: Maximum delegation depth from this agent (default: role-based) */
  maxDelegationDepth?: number
}

/**
 * Type guard to check if config has role metadata.
 */
export function isExtendedAgentConfig(
  config: AgentConfig | ExtendedAgentConfig
): config is ExtendedAgentConfig {
  return 'role' in config && 'canDelegate' in config
}
```

### Agent Registry with Role Metadata

```typescript
// src/agents/index.ts - UPDATED REGISTRY

import type { ExtendedAgentConfig } from "./types"

/**
 * Built-in agents with role metadata for multi-layered orchestration.
 * 
 * Role Hierarchy:
 * - team-lead: OmO (can delegate anywhere)
 * - manager: Implementation Specialist (can delegate to specialists)
 * - specialist: Backend/Frontend (cannot delegate, modifies files)
 * - advisor: Oracle (read-only, strategic guidance)
 * - utility: Explore/Librarian (read-only, research)
 */
export const builtinAgents: Record<string, ExtendedAgentConfig> = {
  // ═══════════════════════════════════════════════════════════════
  // TEAM LEAD LAYER
  // ═══════════════════════════════════════════════════════════════
  OmO: { 
    ...omoAgent, 
    role: "team-lead", 
    canDelegate: true,
    governanceLevel: "full"  // Already has governance in prompt
  },
  
  // ═══════════════════════════════════════════════════════════════
  // MANAGER LAYER (NEW)
  // ═══════════════════════════════════════════════════════════════
  "implementation-specialist": { 
    ...implSpecialistAgent, 
    role: "manager", 
    canDelegate: true,        // CAN delegate to specialists
    governanceLevel: "full",
    maxDelegationDepth: 1     // Can only go 1 level deeper
  },
  
  // ═══════════════════════════════════════════════════════════════
  // SPECIALIST LAYER (NEW + UPDATED)
  // ═══════════════════════════════════════════════════════════════
  "backend-typescript": {
    ...backendTsAgent,
    role: "specialist",
    canDelegate: false,       // CANNOT delegate further
    governanceLevel: "full"
  },
  "frontend-react": {
    ...frontendReactAgent,
    role: "specialist",
    canDelegate: false,
    governanceLevel: "full"
  },
  
  // Existing specialists (UPDATED with governance)
  "frontend-ui-ux-engineer": {
    ...frontendUiUxEngineerAgent,
    role: "specialist",
    canDelegate: false,
    governanceLevel: "full"   // NEW: Add governance awareness
  },
  "document-writer": {
    ...documentWriterAgent,
    role: "specialist",
    canDelegate: false,
    governanceLevel: "full"   // NEW: Add governance awareness
  },
  
  // ═══════════════════════════════════════════════════════════════
  // ADVISOR LAYER (read-only, strategic)
  // ═══════════════════════════════════════════════════════════════
  oracle: { 
    ...oracleAgent, 
    role: "advisor", 
    canDelegate: false,
    governanceLevel: "none"   // Read-only, no file modifications
  },
  
  // ═══════════════════════════════════════════════════════════════
  // UTILITY LAYER (read-only, research)
  // ═══════════════════════════════════════════════════════════════
  librarian: { 
    ...librarianAgent, 
    role: "utility", 
    canDelegate: false,
    governanceLevel: "none"
  },
  explore: { 
    ...exploreAgent, 
    role: "utility", 
    canDelegate: false,
    governanceLevel: "none"
  },
  "multimodal-looker": { 
    ...multimodalLookerAgent, 
    role: "utility", 
    canDelegate: false,
    governanceLevel: "none"
  },
}
```

### Governance Template Structure

```typescript
// src/config/governance-template.ts - NEW FILE

/**
 * Centralized governance template for agent prompt injection.
 * Injected into agents with governanceLevel: "full" or "minimal".
 * 
 * Token budget: ~400-500 tokens (within NFR-001 limit of 500)
 */
export const GOVERNANCE_TEMPLATE_FULL = `
<governance>
## Governance Awareness

You are operating within a governed environment. These rules are MANDATORY.

### Path Discipline
File operations MUST follow these conventions:
- **Spec files**: \`.cursor/specs/{ISSUE-ID}-{type}-{name}/\` or \`context/specs/\`
- **Source code**: \`src/\`, \`tests/\`, \`docs/\`
- **Memory files**: \`.cursor/memory/\`
- **Config files**: Project root only for standard configs

⚠️ The governance-path-validator hook will WARN or BLOCK writes to non-standard paths.

### Changelog Discipline
Your file modifications are automatically tracked by the governance-historian hook:
- Changelog entries are created at session end
- Include meaningful descriptions in your work
- Files created/modified are logged automatically

### Linear Integration
When Linear issue IDs are detected (e.g., LIF-123):
- Linear context is automatically injected by governance-linear-injector
- Use \`linear_branch\` tool to get correct branch names
- Use \`linear_update_status\` tool when completing work
- Reference issue IDs in commit messages

### Spec-Driven Workflow
For features >4h of work:
- Check for existing spec folder: \`glob(".cursor/specs/{ISSUE-ID}-*")\`
- Use \`create_spec_folder\` tool for new features
- Read \`tasks.md\` for task breakdown
- Update \`status.md\` with progress

### Structured Response Format
When completing delegated work, return structured results:
\`\`\`json
{
  "status": "success|partial|failed",
  "summary": "Brief description of work completed",
  "files": {
    "created": ["path/to/new/file.ts"],
    "modified": ["path/to/changed/file.ts"]
  },
  "errors": ["Optional: any errors encountered"],
  "nextSteps": ["Optional: recommended follow-up actions"]
}
\`\`\`
</governance>
`

/**
 * Minimal governance template for agents that need basic awareness.
 * Used when governanceLevel: "minimal"
 */
export const GOVERNANCE_TEMPLATE_MINIMAL = `
<governance>
## Governance Awareness

### Path Discipline
- Source code → \`src/\`, \`tests/\`, \`docs/\`
- Spec files → \`.cursor/specs/\`

### Changelog
Your file modifications are tracked automatically.
</governance>
`

/**
 * Get governance template based on level.
 */
export function getGovernanceTemplate(level: GovernanceLevel): string {
  switch (level) {
    case "full": return GOVERNANCE_TEMPLATE_FULL
    case "minimal": return GOVERNANCE_TEMPLATE_MINIMAL
    case "none": return ""
  }
}
```

### Structured Response Schema

```typescript
// src/agents/types.ts - RESPONSE SCHEMA

/**
 * Structured response format for agent handoffs.
 * Used by specialists to report results to managers.
 * Used by managers to aggregate results for team lead.
 */
export interface AgentHandoffResponse {
  /** Overall task status */
  status: "success" | "partial" | "failed" | "blocked"
  
  /** Human-readable summary of work completed */
  summary: string
  
  /** File changes made during this session */
  files: {
    created: string[]   // New files created
    modified: string[]  // Existing files modified
    deleted: string[]   // Files removed
  }
  
  /** Sub-delegations made (for managers) */
  delegations?: {
    agent: string       // Agent that was delegated to
    task: string        // Task description
    status: "success" | "partial" | "failed"
    summary: string     // Result summary
  }[]
  
  /** Errors encountered during execution */
  errors?: string[]
  
  /** Recommended follow-up actions */
  nextSteps?: string[]
  
  /** Code changes with descriptions (optional detail) */
  codeChanges?: {
    file: string
    description: string
    linesChanged?: number
  }[]
}

/**
 * Validate a handoff response structure.
 */
export function validateHandoffResponse(
  response: unknown
): response is AgentHandoffResponse {
  if (typeof response !== 'object' || response === null) return false
  const r = response as Record<string, unknown>
  return (
    ['success', 'partial', 'failed', 'blocked'].includes(r.status as string) &&
    typeof r.summary === 'string' &&
    typeof r.files === 'object'
  )
}
```

### Agent Name Registry Updates

```typescript
// src/agents/types.ts - NAME TYPES

/**
 * All built-in agent names including new agents.
 */
export type BuiltinAgentName =
  | "OmO"
  | "oracle"
  | "librarian"
  | "explore"
  | "frontend-ui-ux-engineer"
  | "document-writer"
  | "multimodal-looker"
  // NEW AGENTS
  | "implementation-specialist"
  | "backend-typescript"
  | "frontend-react"

/**
 * Agents that can be overridden via configuration.
 */
export type OverridableAgentName =
  | "build"
  | BuiltinAgentName

/**
 * Agents allowed in call_omo_agent tool.
 * Expanded to include new manager/specialist agents.
 */
export const DELEGATABLE_AGENTS = [
  "explore",
  "librarian",
  "frontend-ui-ux-engineer",
  "document-writer",
  "multimodal-looker",
  // NEW
  "implementation-specialist",
  "backend-typescript",
  "frontend-react",
] as const

export type DelegatableAgentName = typeof DELEGATABLE_AGENTS[number]
```

---

## Contracts

### Contract 1: Role-Based Tool Configuration

```typescript
// src/config/tool-config.ts - NEW FILE

import type { AgentRole } from "../agents/types"

/**
 * Tool configuration by agent role.
 * Determines which tools are enabled/disabled for each role.
 * 
 * CRITICAL: This enforces the delegation hierarchy:
 * - team-lead → can delegate to anyone
 * - manager → can delegate to specialists only
 * - specialist/advisor/utility → cannot delegate
 */
export const TOOL_CONFIG_BY_ROLE: Record<AgentRole, Record<string, boolean>> = {
  "team-lead": {
    // Full access to all tools
    task: true,
    background_task: true,
    call_omo_agent: true,
    // File tools: enabled
    write: true,
    edit: true,
    // Governance tools: enabled
    linear_branch: true,
    linear_update_status: true,
    linear_create_issue: true,
    create_spec_folder: true,
    read_context: true,
  },
  
  "manager": {
    // Can delegate DOWN but not UP
    task: true,              // ✅ CAN delegate to specialists
    background_task: true,   // ✅ CAN run background tasks
    call_omo_agent: false,   // ❌ Cannot call back to OmO (prevents loops)
    // File tools: enabled with governance
    write: true,
    edit: true,
    // Governance tools: enabled
    linear_branch: true,
    linear_update_status: true,
    linear_create_issue: false,  // Only team-lead creates issues
    create_spec_folder: false,   // Only team-lead creates specs
    read_context: true,
  },
  
  "specialist": {
    // TERMINAL: Cannot delegate further
    task: false,             // ❌ CANNOT delegate
    background_task: false,  // ❌ CANNOT run background tasks
    call_omo_agent: false,   // ❌ CANNOT call OmO
    // File tools: enabled with governance
    write: true,
    edit: true,
    // Governance tools: limited
    linear_branch: true,
    linear_update_status: true,
    linear_create_issue: false,
    create_spec_folder: false,
    read_context: true,
  },
  
  "advisor": {
    // Read-only: Strategic guidance, no file modifications
    task: false,
    background_task: false,
    call_omo_agent: false,
    write: false,            // ❌ Read-only
    edit: false,             // ❌ Read-only
    linear_branch: false,
    linear_update_status: false,
    linear_create_issue: false,
    create_spec_folder: false,
    read_context: true,
  },
  
  "utility": {
    // Read-only: Research and exploration
    task: false,
    background_task: false,
    call_omo_agent: false,
    write: false,            // ❌ Read-only
    edit: false,             // ❌ Read-only
    linear_branch: false,
    linear_update_status: false,
    linear_create_issue: false,
    create_spec_folder: false,
    read_context: true,
  }
}

/**
 * Get tool configuration for an agent based on its role.
 * Used by call_omo_agent and background_task tools.
 */
export function getToolConfigForRole(role: AgentRole): Record<string, boolean> {
  return TOOL_CONFIG_BY_ROLE[role]
}

/**
 * Check if an agent role can delegate to another agent.
 */
export function canDelegate(role: AgentRole): boolean {
  return role === "team-lead" || role === "manager"
}
```

### Contract 2: Governance Injection

```typescript
// src/agents/utils.ts - UPDATED UTILITY

import type { AgentConfig } from "@opencode-ai/sdk"
import type { ExtendedAgentConfig, GovernanceLevel } from "./types"
import { getGovernanceTemplate } from "../config/governance-template"

/**
 * Inject governance template into agent prompt based on governance level.
 * 
 * @param config - Extended agent configuration with role metadata
 * @returns AgentConfig with governance prompt appended
 */
export function injectGovernance(
  config: ExtendedAgentConfig
): AgentConfig {
  const { governanceLevel, prompt, ...rest } = config
  
  // Skip injection for agents with no governance requirement
  if (governanceLevel === "none") {
    return config
  }
  
  const governancePrompt = getGovernanceTemplate(governanceLevel)
  
  return {
    ...rest,
    prompt: prompt + "\n\n" + governancePrompt
  }
}

/**
 * Create agent configs with governance injection applied.
 * Called during plugin initialization.
 */
export function createBuiltinAgentsWithGovernance(
  agents: Record<string, ExtendedAgentConfig>
): Record<string, AgentConfig> {
  const result: Record<string, AgentConfig> = {}
  
  for (const [name, config] of Object.entries(agents)) {
    result[name] = injectGovernance(config)
  }
  
  return result
}
```

### Contract 3: Delegation Protocol

```typescript
// src/agents/types.ts - DELEGATION PROTOCOL

/**
 * Delegation request format for manager → specialist communication.
 * Used by Implementation Specialist when delegating to Backend/Frontend.
 * 
 * This format is included in the 7-section prompt structure.
 */
export interface DelegationRequest {
  /** Clear, specific task description */
  task: string
  
  /** What success looks like - concrete deliverables */
  expectedOutcome: string
  
  /** Required skills/capabilities for this task */
  requiredSkills: string[]
  
  /** Tools the specialist should use */
  requiredTools: string[]
  
  /** What the specialist MUST do */
  mustDo: string[]
  
  /** What the specialist MUST NOT do (prevent scope creep) */
  mustNotDo: string[]
  
  /** Contextual information */
  context: {
    /** Linear issue ID if applicable */
    linearIssue?: string
    /** Path to spec folder if applicable */
    specFolder?: string
    /** Files to read before starting */
    relevantFiles: string[]
    /** Parent task context */
    parentTask?: string
  }
  
  /** Always require structured response */
  responseFormat: "structured"
}

/**
 * Delegation response format for specialist → manager communication.
 * Specialists MUST return this format when completing delegated work.
 */
export interface DelegationResponse {
  /** Task completion status */
  status: "success" | "partial" | "failed" | "blocked"
  
  /** Human-readable summary of work done */
  summary: string
  
  /** Files changed during this task */
  files: {
    created: string[]
    modified: string[]
    deleted: string[]
  }
  
  /** Detailed code changes (optional) */
  codeChanges?: {
    file: string
    description: string
    linesAdded?: number
    linesRemoved?: number
  }[]
  
  /** Errors encountered */
  errors?: string[]
  
  /** Blockers preventing completion (for status: "blocked") */
  blockers?: string[]
  
  /** Recommended next steps */
  nextSteps?: string[]
  
  /** Verification evidence */
  verification?: {
    lspDiagnostics?: "clean" | "warnings" | "errors"
    testsRun?: boolean
    testsPassed?: number
    testsFailed?: number
  }
}

/**
 * 7-Section Prompt Template for delegations.
 * Used by managers when delegating to specialists.
 */
export const DELEGATION_PROMPT_TEMPLATE = `
TASK: {task}

EXPECTED OUTCOME: {expectedOutcome}

REQUIRED SKILLS: {requiredSkills}

REQUIRED TOOLS: {requiredTools}

MUST DO:
{mustDo}

MUST NOT DO:
{mustNotDo}

CONTEXT:
{context}

RESPONSE FORMAT: Return a structured JSON response with status, summary, files, and any errors.
`
```

### Contract 4: Agent Registration

```typescript
// src/index.ts - UPDATED PLUGIN REGISTRATION

import type { PluginInput } from "@opencode-ai/plugin"
import { builtinAgents } from "./agents"
import { createBuiltinAgentsWithGovernance } from "./agents/utils"
import { getToolConfigForRole } from "./config/tool-config"

/**
 * Register agents with role-based tool restrictions.
 */
function registerAgents(ctx: PluginInput): void {
  // Apply governance injection to all agents
  const agentsWithGovernance = createBuiltinAgentsWithGovernance(builtinAgents)
  
  // Register each agent with the plugin
  for (const [name, config] of Object.entries(agentsWithGovernance)) {
    ctx.registerAgent(name, config)
  }
}

/**
 * Apply tool restrictions when invoking sub-agents.
 * Called by call_omo_agent and background_task tools.
 */
export function getToolRestrictionsForAgent(agentName: string): Record<string, boolean> {
  const agent = builtinAgents[agentName]
  if (!agent) {
    // Unknown agent - apply most restrictive config
    return getToolConfigForRole("specialist")
  }
  return getToolConfigForRole(agent.role)
}
```

### Contract 5: ALLOWED_AGENTS Update

```typescript
// src/tools/call-omo-agent/constants.ts - UPDATED

/**
 * Agents allowed for delegation via call_omo_agent tool.
 * 
 * UPDATED: Now includes manager and specialist agents.
 * Oracle is NOT included (use task tool directly for Oracle).
 */
export const ALLOWED_AGENTS = [
  // Utility agents (read-only)
  "explore",
  "librarian",
  "multimodal-looker",
  
  // Specialist agents (can modify files)
  "frontend-ui-ux-engineer",
  "document-writer",
  
  // NEW: Manager agent
  "implementation-specialist",
  
  // NEW: Specialist agents
  "backend-typescript",
  "frontend-react",
] as const

export type AllowedAgent = typeof ALLOWED_AGENTS[number]
```

---

## Technical Context

| Aspect | Details |
|--------|---------|
| **Language/Version** | TypeScript 5.7+ (strict mode) |
| **Runtime** | Bun >= 1.0.0 |
| **Primary Dependencies** | `@opencode-ai/plugin` SDK, `@opencode-ai/sdk` |
| **Build System** | `bun build` (ESM) + `tsc --emitDeclarationOnly` |
| **Storage** | N/A (plugin, no persistent storage) |
| **Testing** | Not yet configured (future work) |
| **Target Platform** | OpenCode CLI (cross-platform: darwin, linux, win32) |
| **Project Type** | Single project (OpenCode plugin) |
| **Performance Goals** | <100ms governance injection overhead, <500 tokens governance template |
| **Constraints** | Must not break existing OMO functionality, additive changes only |
| **Scale/Scope** | 7 existing agents + 3 new agents = 10 total agents |

### Key Files to Modify

| File | Purpose | Changes |
|------|---------|---------|
| `src/agents/types.ts` | Type definitions | Add `AgentRole`, `ExtendedAgentConfig`, `GovernanceLevel` |
| `src/agents/index.ts` | Agent registry | Update with role metadata |
| `src/agents/utils.ts` | Agent utilities | Add `injectGovernance()` function |
| `src/config/governance-template.ts` | Governance rules | **NEW FILE** |
| `src/config/tool-config.ts` | Tool restrictions | **NEW FILE** |
| `src/tools/call-omo-agent/constants.ts` | Allowed agents | Expand `ALLOWED_AGENTS` |
| `src/tools/call-omo-agent/tools.ts` | Delegation tool | Use role-based tool config |
| `src/features/background-agent/manager.ts` | Background tasks | Use role-based tool config |
| `src/agents/implementation-specialist.ts` | Manager agent | **NEW FILE** |
| `src/agents/backend-typescript.ts` | Specialist agent | **NEW FILE** |
| `src/agents/frontend-react.ts` | Specialist agent | **NEW FILE** |
| `src/agents/frontend-ui-ux-engineer.ts` | Existing agent | Add role metadata |
| `src/agents/document-writer.ts` | Existing agent | Add role metadata |

### Dependencies

No new dependencies required. All functionality implemented using existing:
- `@opencode-ai/plugin` SDK for agent registration
- `@opencode-ai/sdk` for type definitions
- Node.js `fs` for file operations (already used by governance hooks)

---

## Project Structure

### Documentation (this feature)

```text
.cursor/specs/LIF-62-feat-multi-layered-orchestration/
├── spec.md              # Feature specification (complete)
├── plan.md              # This file (complete)
├── tasks.md             # Task breakdown (to be created)
├── status.md            # Feature status tracking
└── changelog/           # Feature changelog entries
```

### Source Code Changes (repository root)

```text
src/
├── agents/
│   │   # EXISTING FILES - UPDATE
│   ├── index.ts                      # Agent registry - add role metadata exports
│   ├── types.ts                      # Type definitions - add AgentRole, ExtendedAgentConfig
│   ├── utils.ts                      # Agent utilities - add injectGovernance()
│   ├── omo.ts                        # OmO agent - no changes (already has governance)
│   ├── oracle.ts                     # Oracle agent - no changes (read-only)
│   ├── librarian.ts                  # Librarian agent - no changes (read-only)
│   ├── explore.ts                    # Explore agent - no changes (read-only)
│   ├── frontend-ui-ux-engineer.ts    # Frontend agent - governance prompt injection
│   ├── document-writer.ts            # Doc writer agent - governance prompt injection
│   ├── multimodal-looker.ts          # Media agent - no changes (read-only)
│   ├── build.ts                      # Build agent extension - no changes
│   │
│   │   # NEW FILES
│   ├── implementation-specialist.ts  # NEW: Manager agent (~300 lines)
│   ├── backend-typescript.ts         # NEW: Backend specialist (~150 lines)
│   └── frontend-react.ts             # NEW: Frontend specialist (~150 lines)
│
├── config/
│   ├── index.ts                      # Config exports - add governance exports
│   ├── schema.ts                     # Config schema - no changes needed
│   │
│   │   # NEW FILES
│   ├── governance-template.ts        # NEW: Centralized governance (~100 lines)
│   └── tool-config.ts                # NEW: Role-based tool config (~80 lines)
│
├── hooks/
│   ├── governance-path-validator/    # Existing - no changes
│   ├── governance-historian/         # Existing - no changes
│   └── governance-linear-injector/   # Existing - no changes
│
├── tools/
│   ├── call-omo-agent/
│   │   ├── constants.ts              # UPDATE: Expand ALLOWED_AGENTS
│   │   ├── tools.ts                  # UPDATE: Use role-based tool config
│   │   └── types.ts                  # No changes
│   │
│   └── background-task/
│       ├── constants.ts              # UPDATE: Import tool config
│       └── tools.ts                  # No changes (uses manager.ts)
│
├── features/
│   └── background-agent/
│       └── manager.ts                # UPDATE: Use role-based tool config
│
└── index.ts                          # Plugin entry - no changes needed
```

### File Change Summary

| Category | New Files | Modified Files | Total |
|----------|-----------|----------------|-------|
| Agents | 3 | 3 | 6 |
| Config | 2 | 1 | 3 |
| Tools | 0 | 2 | 2 |
| Features | 0 | 1 | 1 |
| **Total** | **5** | **7** | **12** |

### Estimated Lines of Code

| File | Estimated LOC | Complexity |
|------|---------------|------------|
| `implementation-specialist.ts` | ~300 | High (manager logic) |
| `backend-typescript.ts` | ~150 | Medium |
| `frontend-react.ts` | ~150 | Medium |
| `governance-template.ts` | ~100 | Low |
| `tool-config.ts` | ~80 | Low |
| `types.ts` additions | ~100 | Medium |
| Other modifications | ~100 | Low |
| **Total New/Modified** | **~980** | - |

---

## Implementation Phases

### Phase 1: Foundation - Type System & Governance Template (Est: 6h)

**Goal**: Create the type system and centralized governance template.

**Deliverables**:
- `src/agents/types.ts` updated with role types
- `src/config/governance-template.ts` created
- `src/config/tool-config.ts` created

**Tasks**:
1. **T1.1** Add `AgentRole`, `GovernanceLevel`, `ExtendedAgentConfig` types to `src/agents/types.ts`
2. **T1.2** Create `src/config/governance-template.ts` with `GOVERNANCE_TEMPLATE_FULL` and `GOVERNANCE_TEMPLATE_MINIMAL`
3. **T1.3** Create `src/config/tool-config.ts` with `TOOL_CONFIG_BY_ROLE`
4. **T1.4** Update `src/config/index.ts` to export new modules
5. **T1.5** Verify TypeScript compilation passes

**Acceptance Criteria**:
- [ ] Types compile without errors
- [ ] Governance template is <500 tokens
- [ ] Tool config covers all 5 roles

---

### Phase 2: Governance Injection (Est: 4h)

**Goal**: Inject governance into file-modifying agents.

**Deliverables**:
- `src/agents/utils.ts` updated with injection function
- `frontend-ui-ux-engineer` and `document-writer` have governance

**Tasks**:
1. **T2.1** Add `injectGovernance()` function to `src/agents/utils.ts`
2. **T2.2** Update `src/agents/frontend-ui-ux-engineer.ts` - append governance to prompt
3. **T2.3** Update `src/agents/document-writer.ts` - append governance to prompt
4. **T2.4** Test governance injection by invoking agents

**Acceptance Criteria**:
- [ ] `frontend-ui-ux-engineer` prompt includes governance section
- [ ] `document-writer` prompt includes governance section
- [ ] Governance hooks fire for both agents (path validation, historian)
- [ ] Token count increase is <500 per agent

---

### Phase 3: Role-Based Tool Configuration (Est: 6h)

**Goal**: Implement role-based tool restrictions in delegation tools.

**Deliverables**:
- `call_omo_agent` tool uses role-based config
- `background_task` tool uses role-based config
- `ALLOWED_AGENTS` expanded

**Tasks**:
1. **T3.1** Update `src/tools/call-omo-agent/constants.ts` - expand `ALLOWED_AGENTS`
2. **T3.2** Update `src/tools/call-omo-agent/tools.ts` - use `getToolConfigForRole()`
3. **T3.3** Update `src/features/background-agent/manager.ts` - use role-based config
4. **T3.4** Update `src/agents/index.ts` - add role metadata to all agents
5. **T3.5** Test that specialists cannot use `task` tool
6. **T3.6** Test that managers CAN use `task` tool

**Acceptance Criteria**:
- [ ] Specialist agents have `task: false` when invoked
- [ ] Manager agents have `task: true` when invoked
- [ ] `call_omo_agent` accepts new agent names
- [ ] Existing functionality preserved (explore, librarian still work)

---

### Phase 4: Implementation Specialist Agent (Est: 10h)

**Goal**: Create the manager-level Implementation Specialist agent.

**Deliverables**:
- `src/agents/implementation-specialist.ts` created
- Agent can delegate to specialists
- Structured response handling

**Tasks**:
1. **T4.1** Create `src/agents/implementation-specialist.ts` with:
   - Role: manager
   - Model: `anthropic/claude-sonnet-4-5`
   - Prompt: Task decomposition, delegation logic, aggregation
2. **T4.2** Implement 7-section delegation prompt template in agent
3. **T4.3** Add structured response instructions to agent prompt
4. **T4.4** Register agent in `src/agents/index.ts`
5. **T4.5** Test OmO → Implementation Specialist delegation
6. **T4.6** Verify Implementation Specialist can use `task` tool

**Acceptance Criteria**:
- [ ] Agent registered and invocable
- [ ] Agent can receive delegated tasks from OmO
- [ ] Agent can delegate to other agents via `task` tool
- [ ] Agent returns structured responses
- [ ] Governance template injected

---

### Phase 5: Backend TypeScript Specialist (Est: 6h)

**Goal**: Create the Backend TypeScript specialist agent.

**Deliverables**:
- `src/agents/backend-typescript.ts` created
- Agent handles backend implementation tasks

**Tasks**:
1. **T5.1** Create `src/agents/backend-typescript.ts` with:
   - Role: specialist
   - Model: `anthropic/claude-sonnet-4-5`
   - Prompt: TypeScript, API, database focus
2. **T5.2** Add backend-specific constraints and patterns
3. **T5.3** Add structured response format
4. **T5.4** Register agent in `src/agents/index.ts`
5. **T5.5** Test Implementation Specialist → Backend TypeScript delegation
6. **T5.6** Verify agent CANNOT use `task` tool

**Acceptance Criteria**:
- [ ] Agent registered and invocable
- [ ] Agent receives tasks from Implementation Specialist
- [ ] Agent CANNOT delegate further (task tool disabled)
- [ ] Agent returns structured responses
- [ ] Governance template injected

---

### Phase 6: Frontend React Specialist (Est: 6h)

**Goal**: Create the Frontend React specialist agent.

**Deliverables**:
- `src/agents/frontend-react.ts` created
- Agent handles frontend implementation tasks

**Tasks**:
1. **T6.1** Create `src/agents/frontend-react.ts` with:
   - Role: specialist
   - Model: `google/gemini-3-pro-preview`
   - Prompt: React, Next.js, state management focus
2. **T6.2** Add frontend-specific constraints (design system, accessibility)
3. **T6.3** Add structured response format
4. **T6.4** Register agent in `src/agents/index.ts`
5. **T6.5** Test Implementation Specialist → Frontend React delegation
6. **T6.6** Test full chain: OmO → Impl Specialist → Frontend React

**Acceptance Criteria**:
- [ ] Agent registered and invocable
- [ ] Agent receives tasks from Implementation Specialist
- [ ] Agent CANNOT delegate further
- [ ] Agent returns structured responses
- [ ] Governance template injected

---

### Phase 7: Integration & Documentation (Est: 6h)

**Goal**: Complete integration testing and documentation.

**Deliverables**:
- Full delegation chain tested
- Workflow documentation created
- OmO prompt updated

**Tasks**:
1. **T7.1** Test full delegation chain: OmO → Impl Specialist → Backend/Frontend
2. **T7.2** Test governance hooks fire at all levels
3. **T7.3** Update OmO prompt to reference Implementation Specialist
4. **T7.4** Create workflow documentation in docs/architecture/
5. **T7.5** Update `.cursor/memory/constitution.md` with multi-variant vision
6. **T7.6** Update README with new agent documentation

**Acceptance Criteria**:
- [ ] Full-stack task delegated through all layers successfully
- [ ] Governance hooks fire for all file-modifying agents
- [ ] Linear context injected at all levels
- [ ] Changelog entries created
- [ ] Documentation complete

---

### Phase Summary

| Phase | Est. Hours | Dependencies | Risk Level |
|-------|------------|--------------|------------|
| Phase 1: Foundation | 6h | None | Low |
| Phase 2: Governance Injection | 4h | Phase 1 | Low |
| Phase 3: Role-Based Tools | 6h | Phase 1, 2 | Medium |
| Phase 4: Impl Specialist | 10h | Phase 1, 2, 3 | Medium |
| Phase 5: Backend Specialist | 6h | Phase 4 | Low |
| Phase 6: Frontend Specialist | 6h | Phase 4 | Low |
| Phase 7: Integration | 6h | All | Medium |
| **Total** | **44h** | - | - |

---

## Complexity Tracking

> **No Constitution violations. No complexity justification needed.**

All changes are additive and use existing patterns:
- New agents follow existing `AgentConfig` pattern
- Governance injection uses existing prompt extension pattern
- Tool restrictions use existing `tools` configuration in SDK
- No new dependencies required

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation | Owner |
|------|------------|--------|------------|-------|
| **Infinite delegation loops** | Medium | High | Disable `task` on specialists, `call_omo_agent` on managers. Role-based config enforced at tool level. | Phase 3 |
| **Context window explosion** | Medium | Medium | Limit delegation depth to 2 levels by design. Structured responses reduce token usage. | Phase 4-6 |
| **Breaking existing workflows** | Low | High | Additive changes only. All existing agents preserve current behavior. Extensive testing in Phase 7. | All |
| **Governance overhead** | Low | Low | <500 token injection. Measured and verified in Phase 2. | Phase 2 |
| **Model compatibility** | Low | Medium | Use proven models (Claude Sonnet, Gemini Pro) already used by existing agents. | Phase 4-6 |
| **Session tree complexity** | Medium | Medium | OpenCode handles session hierarchy natively. Monitor for issues in integration testing. | Phase 7 |

### Risk Mitigation Details

**Infinite Loop Prevention**:
```typescript
// Enforced at multiple levels:
// 1. Role-based tool config (specialists cannot delegate)
// 2. call_omo_agent blocks OmO delegation from managers
// 3. Natural depth limit via maxSteps configuration
```

**Context Window Management**:
```typescript
// Structured responses reduce context:
// - Full response: ~2000 tokens
// - Structured response: ~200 tokens
// Savings: ~90% reduction in context passed up the chain
```

**Backward Compatibility Checklist**:
- [ ] `explore` agent works as before
- [ ] `librarian` agent works as before
- [ ] `frontend-ui-ux-engineer` works as before (with governance)
- [ ] `document-writer` works as before (with governance)
- [ ] `oracle` works as before
- [ ] `multimodal-looker` works as before
- [ ] OmO can still delegate to existing agents
- [ ] Background tasks work as before

---

## Future Vision: Multi-Variant OMO Architecture

**User's Vision** (to be added to `.cursor/memory/constitution.md` after Phase 7):

The OMO architecture is designed as a **foundation for domain-specific variants**. The multi-layered orchestration pattern enables:

### 1. Software Engineer/Entrepreneur Variant (Current Implementation)

```
OmO (Team Lead)
├── Implementation Specialist (Manager)
│   ├── Backend TypeScript (Specialist)
│   └── Frontend React (Specialist)
├── Oracle (Advisor)
└── Explore/Librarian (Utility)
```

**Focus**: Code generation, architecture, deployment, full-stack development

### 2. Legal Professional Variant (Future)

```
OmO (Team Lead)
├── Legal Research Manager
│   ├── Contract Analyst
│   ├── Case Law Specialist
│   └── Compliance Reviewer
├── Oracle (Advisor)
└── Legal Document Librarian
```

**Focus**: Document analysis, legal research, compliance, contract review

### 3. Social Media Manager Variant (Future)

```
OmO (Team Lead)
├── Content Strategy Manager
│   ├── Twitter/X Specialist
│   ├── LinkedIn Specialist
│   └── Instagram Specialist
├── Analytics Advisor
└── Trend Research Librarian
```

**Focus**: Content creation, scheduling, analytics, engagement optimization

### 4. Generic Template (Future)

```
OmO (Team Lead)
├── Domain Manager (configurable)
│   ├── Domain Specialist A
│   ├── Domain Specialist B
│   └── Domain Specialist C
├── Domain Advisor
└── Domain Research Utility
```

**Configuration** via `oh-my-opencode.json`:
```json
{
  "variant": "custom",
  "managers": ["domain-manager"],
  "specialists": ["specialist-a", "specialist-b"],
  "advisors": ["domain-advisor"]
}
```

### Modular Architecture Benefits

| Benefit | Description |
|---------|-------------|
| **Copy-and-customize** | Fork manager/specialist templates for new domains |
| **Shared governance** | Same governance hooks work across all variants |
| **Domain-specific specialists** | Add new specialists without core changes |
| **Community contributions** | Contributors can add specialist agents via config |
| **Model flexibility** | Each variant can use optimal models per task |

### Constitution Amendment (Phase 7)

Add to `.cursor/memory/constitution.md`:

```markdown
### VII. Multi-Variant Architecture

OMO is designed as a foundation for domain-specific variants. The multi-layered orchestration pattern (Team Lead → Manager → Specialist) enables:

- **Domain adaptation** without core changes
- **Shared governance** across all variants
- **Community-contributed specialists**
- **Configuration-driven customization**

New variants SHOULD follow the established hierarchy pattern and reuse governance infrastructure.
```

---

## Appendix A: Agent Prompt Templates

### Implementation Specialist Prompt Structure

```markdown
<role>
You are an IMPLEMENTATION SPECIALIST - a senior engineering manager who excels at breaking down complex tasks and delegating to specialized sub-agents.

## CORE MISSION
Receive implementation tasks from OmO, decompose them into domain-specific subtasks, delegate to Backend TypeScript or Frontend React specialists, aggregate results, and report back.

## DELEGATION AUTHORITY
You CAN delegate to:
- backend-typescript: For API, database, TypeScript backend work
- frontend-react: For React, Next.js, UI components, state management
- frontend-ui-ux-engineer: For design-focused UI work
- document-writer: For documentation tasks

You CANNOT delegate to:
- OmO (prevents loops)
- oracle (use directly for advice)
- explore/librarian (use directly for research)

## WORKFLOW
1. Analyze incoming task from OmO
2. Identify domain components (backend, frontend, both)
3. Create delegation requests using 7-section format
4. Delegate to appropriate specialists
5. Aggregate results from specialists
6. Return structured response to OmO

## STRUCTURED RESPONSE FORMAT
Always return results in this JSON format:
{
  "status": "success|partial|failed",
  "summary": "Brief description of work completed",
  "files": { "created": [], "modified": [] },
  "delegations": [{ "agent": "", "task": "", "status": "" }],
  "errors": [],
  "nextSteps": []
}
</role>

{GOVERNANCE_TEMPLATE}
```

### Backend TypeScript Specialist Prompt Structure

```markdown
<role>
You are a BACKEND TYPESCRIPT SPECIALIST - an expert in server-side TypeScript development.

## CORE MISSION
Execute backend implementation tasks delegated by Implementation Specialist. Focus on API endpoints, database operations, business logic, and TypeScript best practices.

## EXPERTISE
- TypeScript 5.x strict mode
- Node.js/Bun runtime
- REST API design
- Database operations (SQL, ORM)
- Authentication/Authorization
- Error handling and logging
- Testing patterns

## CONSTRAINTS
- You CANNOT delegate to other agents
- You MUST return structured responses
- You MUST follow existing code patterns
- You MUST run lsp_diagnostics after edits

## STRUCTURED RESPONSE FORMAT
Always return results in this JSON format:
{
  "status": "success|partial|failed",
  "summary": "Brief description of work completed",
  "files": { "created": [], "modified": [] },
  "codeChanges": [{ "file": "", "description": "" }],
  "errors": [],
  "verification": { "lspDiagnostics": "clean|warnings|errors" }
}
</role>

{GOVERNANCE_TEMPLATE}
```

---

## Appendix B: Workflow Diagrams

### Full-Stack Task Delegation Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│ User Request: "Implement user authentication with login form and API"   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ OmO (Team Lead)                                                         │
│ 1. Classify intent: IMPLEMENTATION (full-stack)                         │
│ 2. Check spec folder: create_spec_folder if needed                      │
│ 3. Delegate: task(subagent_type="implementation-specialist")            │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Implementation Specialist (Manager)                                     │
│ 1. Decompose task: Backend (auth API) + Frontend (login form)           │
│ 2. Delegate backend: task(subagent_type="backend-typescript")           │
│ 3. Delegate frontend: task(subagent_type="frontend-react")              │
│ 4. Aggregate results                                                    │
│ 5. Return structured response to OmO                                    │
└─────────────────────────────────────────────────────────────────────────┘
                    │                               │
                    ▼                               ▼
┌───────────────────────────────┐   ┌───────────────────────────────────┐
│ Backend TypeScript            │   │ Frontend React                    │
│ 1. Create auth service        │   │ 1. Create LoginForm component     │
│ 2. Create auth routes         │   │ 2. Add form validation            │
│ 3. Add JWT handling           │   │ 3. Connect to auth API            │
│ 4. Return structured response │   │ 4. Return structured response     │
└───────────────────────────────┘   └───────────────────────────────────┘
                    │                               │
                    └───────────────┬───────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ Implementation Specialist aggregates:                                   │
│ {                                                                       │
│   "status": "success",                                                  │
│   "summary": "User authentication implemented with login form and API", │
│   "files": {                                                            │
│     "created": ["src/auth/service.ts", "src/auth/routes.ts",            │
│                 "src/components/LoginForm.tsx"],                        │
│     "modified": ["src/app/routes.ts"]                                   │
│   },                                                                    │
│   "delegations": [                                                      │
│     { "agent": "backend-typescript", "status": "success" },             │
│     { "agent": "frontend-react", "status": "success" }                  │
│   ]                                                                     │
│ }                                                                       │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ OmO receives aggregated result and reports to user                      │
└─────────────────────────────────────────────────────────────────────────┘
```

### Governance Hook Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Agent writes file: edit("src/components/LoginForm.tsx", ...)            │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
┌───────────────────────┐ ┌───────────────────┐ ┌───────────────────────┐
│ governance-path-      │ │ governance-       │ │ governance-linear-    │
│ validator             │ │ historian         │ │ injector              │
│                       │ │                   │ │                       │
│ Validates path is in  │ │ Tracks file       │ │ Injects Linear issue  │
│ allowed locations     │ │ modification for  │ │ context when LIF-xxx  │
│                       │ │ changelog         │ │ detected              │
│ Action: WARN or BLOCK │ │ Action: LOG       │ │ Action: INJECT        │
└───────────────────────┘ └───────────────────┘ └───────────────────────┘
```

---

## Next Steps

1. **Create tasks.md** with detailed task breakdown from phases above
2. **Begin Phase 1**: Foundation - Type System & Governance Template
3. **Update Linear issue LIF-62** with phase breakdown
4. **Update constitution.md** with multi-variant vision (after Phase 7)

---

## Approval

| Role | Name | Date | Status |
|------|------|------|--------|
| Strategic Architect | Claude | 2025-12-18 | ✅ Complete |
| Product Strategist | - | - | Pending |
| Implementation Lead | - | - | Pending |

---

*Plan created by Strategic Architect. Ready for implementation.*
