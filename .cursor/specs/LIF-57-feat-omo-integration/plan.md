# LIF-57: Revised Enhancement Plan for Oh-My-OpenCode

**Linear Issue**: [LIF-57](https://linear.app/lifelogger/issue/LIF-57)
**Created**: 2025-12-17
**Revised**: 2025-12-17 (Critical Finding: OpenCode Native Agent Loading)
**Author**: Strategic Architect

---

> **CRITICAL REVISION NOTICE**
> 
> **New Finding**: OpenCode NATIVELY supports `.opencode/agent/` agents.
> OmO's Claude agent loader (`.claude/agents/`) is SUPPLEMENTARY for Claude Code users only.
> 
> **Impact**:
> - ~~Task 3.6 (Agent Loader Extension)~~ → **REMOVED** (unnecessary)
> - ~~Format conversion scripts~~ → **REMOVED** (unnecessary)
> - ~~Agent sync mechanisms~~ → **REMOVED** (unnecessary)
> - Our agents in `.opencode/agent/` already work natively with OpenCode
> 
> **Revised Scope**: Focus ONLY on:
> 1. Creating 3 governance hooks
> 2. Creating 5 custom tools
> 3. Wiring hooks/tools into OmO
> 4. Updating OmO prompt for governance awareness

---

## Executive Summary

### What Changed

| Aspect | Original Plan | Revised Plan |
|--------|---------------|--------------|
| Agent Loader | Extend to support `.opencode/agent/` | **NOT NEEDED** - OpenCode native support |
| Agent Format | Convert to comma-separated tools | **NOT NEEDED** - YAML object format works |
| Total Tasks | 23 tasks | **15 tasks** (-8 tasks removed) |
| Total Hours | 80 hours | **52 hours** (-28 hours saved) |
| Critical Path | Agent loader first | Hooks/tools in parallel |

### Revised Scope

**IN SCOPE (What We're Building)**:
1. **3 Governance Hooks**: Path validator, Historian, Linear injector
2. **5 Custom Tools**: linear_branch, linear_update_status, linear_create_issue, read_context, create_spec_folder
3. **Hook Wiring**: Register hooks in `src/index.ts` lifecycle events
4. **Tool Wiring**: Export tools from `src/tools/index.ts`, add to plugin object
5. **OmO Prompt Updates**: Add governance awareness to `src/agents/omo.ts`
6. **Configuration**: Add governance schema to `src/config/schema.ts`

**OUT OF SCOPE (What's Already Working)**:
- Agent loading (OpenCode native)
- Agent format conversion (already correct)
- Agent discovery (already works)
- Agent sync scripts (unnecessary)

---

## Architecture Decision: OpenCode Native Agent Loading

### Decision

**USE OpenCode's native agent loading** from `.opencode/agent/`. Do NOT extend OmO's Claude agent loader.

### Rationale

1. **OpenCode natively loads from `.opencode/agent/`** - This is the primary agent location for OpenCode projects
2. **Our agents already use correct format** - YAML object format for tools (`tools: { read: true }`)
3. **OmO's `.claude/agents/` loader is supplementary** - Only for Claude Code compatibility
4. **No conversion needed** - Our existing agents work as-is

### Evidence

From `.opencode/agent/context-steward.md`:
```yaml
---
mode: subagent
model: opencode/gemini-3-flash
tools:
  read: true
  list: true
  glob: true
  task: true
description: Context Steward - Enforce path discipline
---
```

This is the **OpenCode native format**, NOT OmO's comma-separated format.

### Consequences

- All agent-related tasks removed from plan
- Focus shifts to hooks, tools, and OmO prompt updates
- Significant time savings (~28 hours)

---

## Architecture Overview

### System Integration Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Integration Architecture                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                        OpenCode Native Layer                         │    │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐   │    │
│  │  │  .opencode/agent/ │  │ .opencode/tool/  │  │  opencode.json   │   │    │
│  │  │  (ALREADY WORKS)  │  │ (ALREADY WORKS)  │  │   (config)       │   │    │
│  │  └──────────────────┘  └──────────────────┘  └──────────────────┘   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    ↓                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                        OmO Plugin Layer (WE ADD)                     │    │
│  │                                                                       │    │
│  │  ┌──────────────────────────────────────────────────────────────┐    │    │
│  │  │                    Governance Hooks (NEW)                      │    │    │
│  │  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐   │    │    │
│  │  │  │   path-     │  │  historian  │  │  linear-injector    │   │    │    │
│  │  │  │  validator  │  │             │  │                     │   │    │    │
│  │  │  └─────────────┘  └─────────────┘  └─────────────────────┘   │    │    │
│  │  └──────────────────────────────────────────────────────────────┘    │    │
│  │                                                                       │    │
│  │  ┌──────────────────────────────────────────────────────────────┐    │    │
│  │  │                    Custom Tools (NEW)                          │    │    │
│  │  │  ┌────────────┐ ┌───────────────┐ ┌────────────────────┐     │    │    │
│  │  │  │linear_branch│ │linear_update_ │ │linear_create_issue │     │    │    │
│  │  │  └────────────┘ │    status     │ └────────────────────┘     │    │    │
│  │  │  ┌────────────┐ └───────────────┘ ┌────────────────────┐     │    │    │
│  │  │  │read_context│                    │create_spec_folder  │     │    │    │
│  │  │  └────────────┘                    └────────────────────┘     │    │    │
│  │  └──────────────────────────────────────────────────────────────┘    │    │
│  │                                                                       │    │
│  │  ┌──────────────────────────────────────────────────────────────┐    │    │
│  │  │                    OmO Prompt Updates (NEW)                    │    │    │
│  │  │  • <Tools> section with governance tools                       │    │    │
│  │  │  • <Decision_Matrix> with governance decisions                 │    │    │
│  │  │  • <Governance> section with workflow patterns                 │    │    │
│  │  └──────────────────────────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
User Request
    │
    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. Linear Context Injection (governance-linear-injector)                 │
│    - Detect LIF-XXX references in prompt                                 │
│    - Fetch issue details via Linear MCP                                  │
│    - Inject context into prompt                                          │
└─────────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 2. Tool Selection (OmO with governance awareness)                        │
│    - OmO decides which tools to use                                      │
│    - Governance tools available: linear_branch, create_spec_folder, etc. │
└─────────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 3. Pre-Execution Validation (governance-path-validator)                  │
│    - Intercept write/edit tool calls                                     │
│    - Validate path is in allowed locations                               │
│    - Warn or block invalid paths                                         │
└─────────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 4. Tool Execution                                                        │
│    - Execute write, edit, bash, or governance tools                      │
└─────────────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 5. Post-Execution Tracking (governance-historian)                        │
│    - Track file modifications                                            │
│    - Create changelog entry on session end                               │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Governance Hooks (Week 1)

### 1.1 Path Validation Hook

**File**: `src/hooks/governance-path-validator/index.ts`

**Purpose**: Enforce path discipline for `context/specs/` and `context/memory/`

**Hook Point**: `tool.execute.before` for `write`, `edit` tools

**Behavior**:
- **Mode: warn (default)**: Log warning but allow operation
- **Mode: block**: Prevent operation with helpful error
- **Mode: disabled**: No validation

**Configuration Schema**:
```typescript
governance: {
  path_validation: {
    enabled: true,
    mode: "warn",  // "warn" | "block" | "disabled"
    allowed_paths: [
      "context/specs/",
      "context/memory/",
      "src/",
      "tests/",
      "docs/",
      ".opencode/",
    ]
  }
}
```

**Deliverables**:
- [ ] `src/hooks/governance-path-validator/index.ts`
- [ ] `src/hooks/governance-path-validator/types.ts`
- [ ] Export from `src/hooks/index.ts`

### 1.2 Historian Hook

**File**: `src/hooks/governance-historian/index.ts`

**Purpose**: Track file modifications and create changelog entries

**Hook Point**: `tool.execute.after` for `write`, `edit` tools

**Behavior**:
- Track files modified per session
- Create changelog entry on session end or explicit trigger
- Format: `changelog/YYYY-MM-DD__{agent}__{scope}.md`

**Deliverables**:
- [ ] `src/hooks/governance-historian/index.ts`
- [ ] `src/hooks/governance-historian/types.ts`
- [ ] Export from `src/hooks/index.ts`

### 1.3 Linear Context Injector Hook

**File**: `src/hooks/governance-linear-injector/index.ts`

**Purpose**: Inject Linear issue context into prompts

**Hook Point**: `event` handler for `session.created`, `session.updated`

**Behavior**:
- Detect Linear issue references (LIF-XXX pattern)
- Fetch issue details via Linear MCP (already configured in opencode.json)
- Inject context into session

**Deliverables**:
- [ ] `src/hooks/governance-linear-injector/index.ts`
- [ ] `src/hooks/governance-linear-injector/types.ts`
- [ ] Export from `src/hooks/index.ts`

---

## Phase 2: Custom Tools (Week 1-2)

### 2.1 Linear Tools

**File**: `src/tools/linear/tools.ts`

**Tools**:

```typescript
// linear_branch - Get branch name for Linear issue
export const linear_branch = tool({
  description: "Get the git branch name for a Linear issue",
  args: {
    issueId: z.string().describe("Linear issue ID (e.g., 'LIF-123')")
  },
  async execute(args) {
    // Use Linear MCP to fetch issue
    // Return branch name, title, URL
  }
});

// linear_update_status - Update issue status
export const linear_update_status = tool({
  description: "Update Linear issue status with optional comment",
  args: {
    issueId: z.string(),
    status: z.enum(['todo', 'in_progress', 'in_review', 'done', 'canceled']),
    comment: z.string().optional(),
  },
  async execute(args) {
    // Use Linear MCP to update issue
  }
});

// linear_create_issue - Create new issue
export const linear_create_issue = tool({
  description: "Create a new Linear issue",
  args: {
    title: z.string(),
    description: z.string().optional(),
    team: z.string().default('Lifelogger'),
    labels: z.array(z.string()).optional(),
  },
  async execute(args) {
    // Use Linear MCP to create issue
  }
});
```

**Deliverables**:
- [ ] `src/tools/linear/tools.ts`
- [ ] `src/tools/linear/types.ts`
- [ ] Export from `src/tools/index.ts`

### 2.2 Project Context Tool

**File**: `src/tools/project-context/tools.ts`

```typescript
export const read_context = tool({
  description: "Read project context configuration",
  args: {
    section: z.enum(['all', 'project', 'tech_stack', 'architecture', 'integrations']).optional(),
  },
  async execute(args) {
    // Read .opencode/project-context.yaml
    // Parse YAML and return requested section
  }
});
```

**Deliverables**:
- [ ] `src/tools/project-context/tools.ts`
- [ ] Export from `src/tools/index.ts`

### 2.3 Spec Tools

**File**: `src/tools/spec/tools.ts`

```typescript
export const create_spec_folder = tool({
  description: "Create a spec folder for a feature",
  args: {
    linearIssue: z.string().optional(),
    featureName: z.string(),
    type: z.enum(['feat', 'fix', 'chore', 'refactor', 'docs']).default('feat'),
  },
  async execute(args) {
    // Create context/specs/{ISSUE-ID}-{type}-{name}/ structure
    // Include spec.md, plan.md, tasks.md, status.md templates
  }
});
```

**Deliverables**:
- [ ] `src/tools/spec/tools.ts`
- [ ] Export from `src/tools/index.ts`

---

## Phase 3: System Integration (Week 2)

### 3.1 Hook Registration & Wiring

**File**: `src/index.ts`

**Changes Required**:

1. **Import hooks**:
```typescript
import {
  createGovernancePathValidatorHook,
  createGovernanceHistorianHook,
  createGovernanceLinearInjectorHook,
} from "./hooks";
```

2. **Instantiate hooks**:
```typescript
const governancePathValidator = isHookEnabled("governance-path-validator")
  ? createGovernancePathValidatorHook(ctx)
  : null;
const governanceHistorian = isHookEnabled("governance-historian")
  ? createGovernanceHistorianHook(ctx)
  : null;
const governanceLinearInjector = isHookEnabled("governance-linear-injector")
  ? createGovernanceLinearInjectorHook(ctx)
  : null;
```

3. **Wire into lifecycle**:
```typescript
"tool.execute.before": async (input, output) => {
  // ... existing hooks
  await governancePathValidator?.["tool.execute.before"](input, output);
},

"tool.execute.after": async (input, output) => {
  // ... existing hooks
  await governanceHistorian?.["tool.execute.after"](input, output);
},

event: async (input) => {
  // ... existing hooks
  await governanceLinearInjector?.event(input);
},
```

**Deliverables**:
- [ ] Export hooks from `src/hooks/index.ts`
- [ ] Add hook names to `HookNameSchema` in `src/config/schema.ts`
- [ ] Instantiate and wire hooks in `src/index.ts`

### 3.2 Tool Registration & Wiring

**File**: `src/index.ts`

**Changes Required**:

1. **Export from tools/index.ts**:
```typescript
export { linear_branch, linear_update_status, linear_create_issue } from "./linear/tools";
export { read_context } from "./project-context/tools";
export { create_spec_folder } from "./spec/tools";
```

2. **Add to plugin tool object**:
```typescript
return {
  tool: {
    ...builtinTools,
    ...backgroundTools,
    call_omo_agent: callOmoAgent,
    look_at: lookAt,
    // New governance tools
    linear_branch,
    linear_update_status,
    linear_create_issue,
    read_context,
    create_spec_folder,
  },
};
```

**Deliverables**:
- [ ] Export tools from `src/tools/index.ts`
- [ ] Add tools to plugin return object in `src/index.ts`

### 3.3 Configuration Schema

**File**: `src/config/schema.ts`

**Changes Required**:

1. **Add hook names**:
```typescript
export const HookNameSchema = z.enum([
  // ... existing hooks
  "governance-path-validator",
  "governance-historian",
  "governance-linear-injector",
]);
```

2. **Add governance config schema**:
```typescript
export const GovernanceConfigSchema = z.object({
  path_validation: z.object({
    enabled: z.boolean().default(true),
    mode: z.enum(["warn", "block", "disabled"]).default("warn"),
    allowed_paths: z.array(z.string()).optional(),
  }).optional(),
  historian: z.object({
    enabled: z.boolean().default(true),
    auto_create: z.boolean().default(true),
  }).optional(),
  linear: z.object({
    enabled: z.boolean().default(true),
    team_prefix: z.string().default("LIF"),
  }).optional(),
});

export const OhMyOpenCodeConfigSchema = z.object({
  // ... existing fields
  governance: GovernanceConfigSchema.optional(),
});
```

**Deliverables**:
- [ ] Update `HookNameSchema` with governance hooks
- [ ] Add `GovernanceConfigSchema`
- [ ] Update `OhMyOpenCodeConfigSchema`

---

## Phase 4: OmO Prompt Enhancement (Week 2)

### 4.1 Tools Section Update

**File**: `src/agents/omo.ts`

Add to `<Tools>` section:
```markdown
### Governance Tools
| Need | Tool |
|------|------|
| Get Linear branch name | linear_branch |
| Update Linear issue status | linear_update_status |
| Create Linear issue | linear_create_issue |
| Read project context | read_context |
| Create spec folder | create_spec_folder |
```

### 4.2 Decision Matrix Update

Add to `<Decision_Matrix>` section:
```markdown
| Situation | Action |
|-----------|--------|
| "Start work on Linear issue" | linear_branch → get branch name |
| "Complete a task" | linear_update_status → mark done |
| "New feature request" | linear_create_issue → create ticket |
| "Understand project setup" | read_context → get config |
| "Start new feature" | create_spec_folder → setup spec dir |
```

### 4.3 Governance Section

Add new `<Governance>` section:
```markdown
<Governance>
## Governance Integration

### Available Tools
- `linear_branch` - Get the correct branch name for a Linear issue
- `linear_update_status` - Update issue status (todo/in_progress/in_review/done)
- `linear_create_issue` - Create new Linear issues
- `read_context` - Read project-context.yaml for project configuration
- `create_spec_folder` - Create spec folder structure for new features

### Workflow Integration
When starting work on a Linear issue:
1. Call `linear_branch` to get the correct branch name
2. Create/checkout the branch
3. Call `create_spec_folder` if new feature work
4. Work on the feature
5. Call `linear_update_status` when done

### Path Discipline
- All spec work goes to `context/specs/{ISSUE-ID}-{type}-{name}/`
- Memory files go to `context/memory/`
- Code goes to `src/`, `tests/`, `docs/`

### Governance Agents (Available via @mention)
- `@context-steward` - Path validation, structure enforcement
- `@historian` - Manual changelog creation
- `@linear-coordinator` - Complex Linear operations
</Governance>
```

**Deliverables**:
- [ ] Update `<Tools>` section
- [ ] Update `<Decision_Matrix>` section
- [ ] Add `<Governance>` section

---

## Phase 5: Testing & Documentation (Week 3)

### 5.1 Integration Tests

**Test Scenarios**:

1. **Path Validation**:
   - Write to valid path → Allowed
   - Write to invalid path → Warning logged (warn mode)
   - Write to invalid path → Blocked (block mode)

2. **Historian**:
   - Single file change → Tracked
   - Multiple file changes → All tracked
   - Session end → Changelog created

3. **Linear Integration**:
   - `linear_branch` with valid issue → Returns branch name
   - `linear_update_status` → Updates issue
   - `linear_create_issue` → Creates issue

4. **OmO Behavior**:
   - User mentions "LIF-XXX" → OmO uses linear_branch
   - "New feature" request → OmO uses create_spec_folder

**Deliverables**:
- [ ] Hook unit tests
- [ ] Tool unit tests
- [ ] Integration test scenarios

### 5.2 Documentation

**Deliverables**:
- [ ] Update OmO README with governance features
- [ ] Create governance configuration guide
- [ ] Document rollback procedure

---

## Implementation Timeline

| Week | Phase | Tasks | Hours |
|------|-------|-------|-------|
| 1 | Hooks | 1.1, 1.2, 1.3 | 14h |
| 1-2 | Tools | 2.1, 2.2, 2.3 | 12h |
| 2 | Integration | 3.1, 3.2, 3.3 | 10h |
| 2 | OmO Prompt | 4.1, 4.2, 4.3 | 6h |
| 3 | Testing | 5.1, 5.2 | 10h |
| **Total** | | **15 tasks** | **52h** |

### Critical Path

```
Phase 1 (Hooks) ─────────────────┬──► Phase 3 (Integration)
                                 │
Phase 2 (Tools) ─────────────────┘
                                 │
                                 ▼
                    Phase 4 (OmO Prompt)
                                 │
                                 ▼
                    Phase 5 (Testing)
```

**Parallel Work Opportunities**:
- Phase 1 (Hooks) and Phase 2 (Tools) can be done in parallel
- Phase 3 (Integration) requires both Phase 1 and Phase 2
- Phase 4 requires Phase 2 (tools must exist for prompt to reference)
- Phase 5 requires all previous phases

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Governance Hooks | 3 hooks | All hooks wired and functional |
| Custom Tools | 5 tools | All tools available in OmO sessions |
| Path Validation | 100% | All file writes validated |
| Linear Integration | Working | Branch names, status updates functional |
| OmO Awareness | Complete | OmO uses governance tools when appropriate |

---

## Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Hook conflicts with existing | Medium | High | Position governance hooks LAST in lifecycle |
| Performance degradation | Low | Medium | Benchmark before/after, async operations |
| Linear MCP unavailable | Low | Medium | Graceful fallback with generated branch names |
| Path validation too strict | Medium | Low | Default to "warn" mode, configurable |

---

## Rollback Strategy

If governance features cause issues:

1. **Quick Disable**: Add hooks to `disabled_hooks` in config:
```json
{
  "disabled_hooks": [
    "governance-path-validator",
    "governance-historian",
    "governance-linear-injector"
  ]
}
```

2. **Full Rollback**: Revert OmO to previous version

3. **Partial Disable**: Use governance config:
```json
{
  "governance": {
    "path_validation": { "enabled": false },
    "historian": { "enabled": false },
    "linear": { "enabled": false }
  }
}
```

---

## References

- **Spec**: `./spec.md`
- **OmO Source**: `/Users/eru/Documents/GitHub/oh-my-opencode/`
- **Our System**: `/Users/eru/Documents/GitHub/project-template/.opencode/`
- **Linear Issue**: [LIF-57](https://linear.app/lifelogger/issue/LIF-57)
- **OpenCode Config**: `.opencode/opencode.json`
