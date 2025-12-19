# LIF-57: Revised Task Breakdown

**Linear Issue**: [LIF-57](https://linear.app/lifelogger/issue/LIF-57)
**Created**: 2025-12-17
**Revised**: 2025-12-17 (Critical Finding: OpenCode Native Agent Loading)

---

> **CRITICAL REVISION**
> 
> **Removed Tasks** (OpenCode native agent loading makes these unnecessary):
> - ~~Task 3.6: Agent Loader Extension~~ → OpenCode natively loads `.opencode/agent/`
> - ~~Task 2.1: Governance Markdown Agents~~ → Already exist and work
> - ~~Task 2.2: Planning Markdown Agents~~ → Already exist and work
> - ~~Task 2.3: Implementation Markdown Agents~~ → Already exist and work
> - ~~Task 2.4: OmO Prompt Enhancement (agent references)~~ → Merged into 4.x
> 
> **Revised Total**: 15 tasks, 52 hours (was 23 tasks, 80 hours)

---

## Task Summary

| Phase | Tasks | Hours | Status |
|-------|-------|-------|--------|
| Phase 1: Governance Hooks | 3 | 14h | Not Started |
| Phase 2: Custom Tools | 3 | 12h | Not Started |
| Phase 3: System Integration | 3 | 10h | Not Started |
| Phase 4: OmO Prompt Updates | 3 | 6h | Not Started |
| Phase 5: Testing & Documentation | 3 | 10h | Not Started |
| **Total** | **15** | **52h** | |

---

## Phase 1: Governance Hooks

### Task 1.1: Path Validation Hook

**Purpose**: Enforce path discipline for file operations
**Estimate**: 5 hours
**Dependencies**: None
**Priority**: Critical

**Input**:
- OmO hook patterns from `src/hooks/`
- Path validation rules from context-steward agent

**Output**:
- `src/hooks/governance-path-validator/index.ts`
- `src/hooks/governance-path-validator/types.ts`

**Steps**:
- [ ] Create `src/hooks/governance-path-validator/` directory
- [ ] Create `types.ts` with configuration interfaces:
  ```typescript
  export interface PathValidatorConfig {
    enabled: boolean;
    mode: "warn" | "block" | "disabled";
    allowed_paths: string[];
  }
  ```
- [ ] Create `index.ts` with hook factory:
  ```typescript
  export function createGovernancePathValidatorHook(ctx: PluginInput) {
    return {
      "tool.execute.before": async (input, output) => {
        // Validate path for write/edit tools
      }
    };
  }
  ```
- [ ] Implement path validation logic:
  - Check if tool is `write` or `edit`
  - Extract file path from args
  - Validate against allowed paths
  - Warn or block based on mode
- [ ] Add error handling for edge cases
- [ ] Export from `src/hooks/index.ts`

**Validation**:
- [ ] Hook compiles without errors
- [ ] Valid paths pass validation
- [ ] Invalid paths trigger warning (warn mode)
- [ ] Invalid paths are blocked (block mode)

**Risks**:
- Path matching may be too strict → Use glob patterns for flexibility
- Performance impact → Keep validation logic simple and fast

---

### Task 1.2: Historian Hook

**Purpose**: Track file modifications and create changelog entries
**Estimate**: 5 hours
**Dependencies**: Task 1.1 (pattern reference)
**Priority**: High

**Input**:
- OmO hook patterns
- Changelog format from `.cursor/templates/changelog-template.md`

**Output**:
- `src/hooks/governance-historian/index.ts`
- `src/hooks/governance-historian/types.ts`

**Steps**:
- [ ] Create `src/hooks/governance-historian/` directory
- [ ] Create `types.ts` with interfaces:
  ```typescript
  export interface HistorianConfig {
    enabled: boolean;
    auto_create: boolean;
    changelog_path: string;
  }
  
  export interface SessionState {
    modifiedFiles: string[];
    agent: string;
    startTime: Date;
  }
  ```
- [ ] Create `index.ts` with hook factory:
  ```typescript
  export function createGovernanceHistorianHook(ctx: PluginInput) {
    const sessionStates = new Map<string, SessionState>();
    
    return {
      "tool.execute.after": async (input, output) => {
        // Track file modifications
      },
      event: async ({ event }) => {
        // Create changelog on session end
      }
    };
  }
  ```
- [ ] Implement file tracking:
  - Track `write` and `edit` tool calls
  - Store modified files per session
- [ ] Implement changelog creation:
  - Trigger on `session.deleted` event
  - Generate markdown changelog entry
  - Write to `changelog/` directory
- [ ] Add error handling

**Validation**:
- [ ] File modifications are tracked correctly
- [ ] Changelog entry created on session end
- [ ] Changelog format matches template

**Risks**:
- Too many changelog entries → Implement minimum threshold
- Session state memory leak → Clean up on session delete

---

### Task 1.3: Linear Context Injector Hook

**Purpose**: Inject Linear issue context into prompts
**Estimate**: 4 hours
**Dependencies**: None
**Priority**: High

**Input**:
- Linear MCP configuration from `opencode.json`
- Linear issue reference patterns

**Output**:
- `src/hooks/governance-linear-injector/index.ts`
- `src/hooks/governance-linear-injector/types.ts`

**Steps**:
- [ ] Create `src/hooks/governance-linear-injector/` directory
- [ ] Create `types.ts` with interfaces:
  ```typescript
  export interface LinearInjectorConfig {
    enabled: boolean;
    team_prefix: string;
  }
  
  export interface LinearIssueContext {
    id: string;
    identifier: string;
    title: string;
    status: string;
    branchName?: string;
  }
  ```
- [ ] Create `index.ts` with hook factory:
  ```typescript
  export function createGovernanceLinearInjectorHook(ctx: PluginInput) {
    return {
      event: async ({ event }) => {
        // Detect Linear references and inject context
      }
    };
  }
  ```
- [ ] Implement Linear reference detection:
  - Regex pattern: `/\b(LIF-\d+)\b/g`
  - Extract issue IDs from session context
- [ ] Implement context injection:
  - Use Linear MCP to fetch issue details
  - Inject context into session
- [ ] Add graceful fallback for MCP errors

**Validation**:
- [ ] Linear references detected correctly
- [ ] Issue context fetched via MCP
- [ ] Context injected into session
- [ ] Graceful handling of MCP errors

**Risks**:
- Linear MCP unavailable → Graceful fallback with warning
- Rate limiting → Cache issue data per session

---

## Phase 2: Custom Tools

### Task 2.1: Linear Tools

**Purpose**: Provide Linear integration tools for OmO
**Estimate**: 6 hours
**Dependencies**: None
**Priority**: High

**Input**:
- OmO tool patterns from `src/tools/`
- Linear MCP API

**Output**:
- `src/tools/linear/tools.ts`
- `src/tools/linear/types.ts`

**Steps**:
- [ ] Create `src/tools/linear/` directory
- [ ] Create `types.ts` with interfaces:
  ```typescript
  export interface LinearBranchResult {
    branchName: string;
    issueTitle: string;
    issueUrl: string;
    issueIdentifier: string;
  }
  
  export interface LinearUpdateResult {
    success: boolean;
    issueId: string;
    newStatus: string;
    commentAdded: boolean;
  }
  ```
- [ ] Implement `linear_branch` tool:
  ```typescript
  export const linear_branch = tool({
    description: "Get the git branch name for a Linear issue",
    args: {
      issueId: z.string().describe("Linear issue ID (e.g., 'LIF-123')")
    },
    async execute(args) {
      // Fetch issue via Linear MCP
      // Return branch name and metadata
    }
  });
  ```
- [ ] Implement `linear_update_status` tool:
  ```typescript
  export const linear_update_status = tool({
    description: "Update Linear issue status with optional comment",
    args: {
      issueId: z.string(),
      status: z.enum(['todo', 'in_progress', 'in_review', 'done', 'canceled']),
      comment: z.string().optional(),
    },
    async execute(args) { /* ... */ }
  });
  ```
- [ ] Implement `linear_create_issue` tool:
  ```typescript
  export const linear_create_issue = tool({
    description: "Create a new Linear issue",
    args: {
      title: z.string(),
      description: z.string().optional(),
      team: z.string().default('Lifelogger'),
      labels: z.array(z.string()).optional(),
    },
    async execute(args) { /* ... */ }
  });
  ```
- [ ] Add error handling with graceful fallbacks
- [ ] Export from `src/tools/index.ts`

**Validation**:
- [ ] `linear_branch` returns branch name for valid issue
- [ ] `linear_update_status` updates issue status
- [ ] `linear_create_issue` creates new issue
- [ ] All tools handle errors gracefully

**Risks**:
- Linear API changes → Use MCP abstraction layer
- Authentication issues → Clear error messages

---

### Task 2.2: Project Context Tool

**Purpose**: Read project configuration
**Estimate**: 2 hours
**Dependencies**: None
**Priority**: Medium

**Input**:
- `.opencode/project-context.yaml` format
- YAML parsing library

**Output**:
- `src/tools/project-context/tools.ts`

**Steps**:
- [ ] Create `src/tools/project-context/` directory
- [ ] Implement `read_context` tool:
  ```typescript
  export const read_context = tool({
    description: "Read project context configuration",
    args: {
      section: z.enum(['all', 'project', 'tech_stack', 'architecture', 'integrations']).optional(),
    },
    async execute(args) {
      const contextPath = '.opencode/project-context.yaml';
      const content = await readFile(contextPath);
      const context = yaml.parse(content);
      
      if (args.section && args.section !== 'all') {
        return { [args.section]: context[args.section] };
      }
      return context;
    }
  });
  ```
- [ ] Add YAML parsing (use existing dependency or add)
- [ ] Add error handling for missing file
- [ ] Export from `src/tools/index.ts`

**Validation**:
- [ ] Tool reads project-context.yaml correctly
- [ ] Section filtering works
- [ ] Missing file handled gracefully

**Risks**:
- YAML parsing errors → Validate YAML format
- Missing file → Return helpful error message

---

### Task 2.3: Spec Tools

**Purpose**: Create spec folder structures
**Estimate**: 4 hours
**Dependencies**: Task 2.1 (Linear integration)
**Priority**: High

**Input**:
- Spec folder structure from `.cursor/specs/`
- Template files from `.cursor/templates/`

**Output**:
- `src/tools/spec/tools.ts`

**Steps**:
- [ ] Create `src/tools/spec/` directory
- [ ] Implement `create_spec_folder` tool:
  ```typescript
  export const create_spec_folder = tool({
    description: "Create a spec folder for a feature",
    args: {
      linearIssue: z.string().optional(),
      featureName: z.string(),
      type: z.enum(['feat', 'fix', 'chore', 'refactor', 'docs']).default('feat'),
    },
    async execute(args) {
      let folderId: string;
      
      if (args.linearIssue) {
        folderId = `${args.linearIssue}-${args.type}-${slugify(args.featureName)}`;
      } else {
        const nextNum = await getNextSequentialNumber();
        folderId = `${nextNum}-${args.type}-${slugify(args.featureName)}`;
      }
      
      const folderPath = `context/specs/${folderId}`;
      await createSpecStructure(folderPath);
      
      return {
        path: folderPath,
        structure: ['spec.md', 'plan.md', 'tasks.md', 'status.md'],
      };
    }
  });
  ```
- [ ] Implement `slugify` helper function
- [ ] Implement `getNextSequentialNumber` function
- [ ] Implement `createSpecStructure` with template files
- [ ] Export from `src/tools/index.ts`

**Validation**:
- [ ] Folder created with correct naming
- [ ] Template files created
- [ ] Sequential numbering works
- [ ] Linear issue ID integration works

**Risks**:
- Duplicate folder names → Check existence first
- Template file missing → Use inline defaults

---

## Phase 3: System Integration

### Task 3.1: Hook Registration & Wiring

**Purpose**: Wire governance hooks into OmO lifecycle
**Estimate**: 4 hours
**Dependencies**: Phase 1 complete
**Priority**: Critical

**Input**:
- Completed hooks from Phase 1
- `src/index.ts` structure
- `src/hooks/index.ts` exports

**Output**:
- Updated `src/hooks/index.ts`
- Updated `src/index.ts`

**Steps**:
- [ ] Update `src/hooks/index.ts` with exports:
  ```typescript
  export { createGovernancePathValidatorHook } from "./governance-path-validator";
  export { createGovernanceHistorianHook } from "./governance-historian";
  export { createGovernanceLinearInjectorHook } from "./governance-linear-injector";
  ```
- [ ] Update `src/index.ts` imports:
  ```typescript
  import {
    // ... existing imports
    createGovernancePathValidatorHook,
    createGovernanceHistorianHook,
    createGovernanceLinearInjectorHook,
  } from "./hooks";
  ```
- [ ] Add hook instantiation (after line 246):
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
- [ ] Wire into `tool.execute.before` (after line 496):
  ```typescript
  await governancePathValidator?.["tool.execute.before"](input, output);
  ```
- [ ] Wire into `tool.execute.after` (after line 531):
  ```typescript
  await governanceHistorian?.["tool.execute.after"](input, output);
  ```
- [ ] Wire into `event` (after line 397):
  ```typescript
  await governanceLinearInjector?.event(input);
  ```
- [ ] Test hook execution order

**Validation**:
- [ ] Hooks exported from `src/hooks/index.ts`
- [ ] Hooks instantiated in `src/index.ts`
- [ ] Hooks wired into correct lifecycle events
- [ ] Hooks execute in correct order (governance LAST)

**Risks**:
- Hook conflicts → Position governance hooks last
- Type errors → Ensure consistent interfaces

---

### Task 3.2: Tool Registration & Wiring

**Purpose**: Wire governance tools into OmO
**Estimate**: 3 hours
**Dependencies**: Phase 2 complete
**Priority**: Critical

**Input**:
- Completed tools from Phase 2
- `src/tools/index.ts` structure
- `src/index.ts` tool object

**Output**:
- Updated `src/tools/index.ts`
- Updated `src/index.ts`

**Steps**:
- [ ] Update `src/tools/index.ts` with exports:
  ```typescript
  export { linear_branch, linear_update_status, linear_create_issue } from "./linear/tools";
  export { read_context } from "./project-context/tools";
  export { create_spec_folder } from "./spec/tools";
  ```
- [ ] Update `src/index.ts` imports:
  ```typescript
  import {
    builtinTools,
    // ... existing imports
    linear_branch,
    linear_update_status,
    linear_create_issue,
    read_context,
    create_spec_folder,
  } from "./tools";
  ```
- [ ] Add tools to plugin return object (around line 271):
  ```typescript
  tool: {
    ...builtinTools,
    ...backgroundTools,
    call_omo_agent: callOmoAgent,
    look_at: lookAt,
    // Governance tools
    linear_branch,
    linear_update_status,
    linear_create_issue,
    read_context,
    create_spec_folder,
    ...(tmuxAvailable ? { interactive_bash } : {}),
  },
  ```
- [ ] Test tool availability

**Validation**:
- [ ] Tools exported from `src/tools/index.ts`
- [ ] Tools available in OmO sessions
- [ ] Tools execute correctly

**Risks**:
- Name collisions → Use unique tool names
- Import errors → Verify export paths

---

### Task 3.3: Configuration Schema Update

**Purpose**: Add governance configuration to OmO config schema
**Estimate**: 3 hours
**Dependencies**: None
**Priority**: High

**Input**:
- `src/config/schema.ts` structure
- Governance configuration requirements

**Output**:
- Updated `src/config/schema.ts`

**Steps**:
- [ ] Add governance hook names to `HookNameSchema`:
  ```typescript
  export const HookNameSchema = z.enum([
    // ... existing hooks (lines 44-65)
    "governance-path-validator",
    "governance-historian",
    "governance-linear-injector",
  ]);
  ```
- [ ] Add governance configuration schema:
  ```typescript
  export const GovernancePathValidationSchema = z.object({
    enabled: z.boolean().default(true),
    mode: z.enum(["warn", "block", "disabled"]).default("warn"),
    allowed_paths: z.array(z.string()).default([
      "context/specs/",
      "context/memory/",
      "src/",
      "tests/",
      "docs/",
      ".opencode/",
    ]),
  });

  export const GovernanceHistorianSchema = z.object({
    enabled: z.boolean().default(true),
    auto_create: z.boolean().default(true),
    changelog_path: z.string().default("changelog/"),
  });

  export const GovernanceLinearSchema = z.object({
    enabled: z.boolean().default(true),
    team_prefix: z.string().default("LIF"),
  });

  export const GovernanceConfigSchema = z.object({
    path_validation: GovernancePathValidationSchema.optional(),
    historian: GovernanceHistorianSchema.optional(),
    linear: GovernanceLinearSchema.optional(),
  });
  ```
- [ ] Update `OhMyOpenCodeConfigSchema` (around line 108):
  ```typescript
  export const OhMyOpenCodeConfigSchema = z.object({
    // ... existing fields
    governance: GovernanceConfigSchema.optional(),
  });
  ```
- [ ] Export new types

**Validation**:
- [ ] Schema compiles without errors
- [ ] Config validation works
- [ ] Default values applied correctly

**Risks**:
- Schema conflicts → Careful type naming
- Validation errors → Test with sample configs

---

## Phase 4: OmO Prompt Updates

### Task 4.1: Tools Section Update

**Purpose**: Add governance tools to OmO's tool awareness
**Estimate**: 2 hours
**Dependencies**: Task 3.2 complete
**Priority**: High

**Input**:
- `src/agents/omo.ts` structure
- Governance tool definitions

**Output**:
- Updated `src/agents/omo.ts` `<Tools>` section

**Steps**:
- [ ] Locate `<Tools>` section in `src/agents/omo.ts`
- [ ] Add governance tools table after existing tools:
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
- [ ] Verify tool names match actual implementations

**Validation**:
- [ ] Tools section updated
- [ ] Tool names correct
- [ ] Descriptions accurate

**Risks**:
- Prompt too long → Keep descriptions concise
- Tool names wrong → Verify against implementations

---

### Task 4.2: Decision Matrix Update

**Purpose**: Add governance decisions to OmO's decision matrix
**Estimate**: 2 hours
**Dependencies**: Task 4.1 complete
**Priority**: High

**Input**:
- `src/agents/omo.ts` `<Decision_Matrix>` section
- Governance workflow patterns

**Output**:
- Updated `src/agents/omo.ts` `<Decision_Matrix>` section

**Steps**:
- [ ] Locate `<Decision_Matrix>` section in `src/agents/omo.ts`
- [ ] Add governance decisions:
  ```markdown
  | "Start work on Linear issue" | linear_branch → get branch name |
  | "Complete a task" | linear_update_status → mark done |
  | "New feature request" | linear_create_issue → create ticket |
  | "Understand project setup" | read_context → get config |
  | "Start new feature" | create_spec_folder → setup spec dir |
  | "Create spec folder" | create_spec_folder → auto-creates structure |
  ```
- [ ] Verify decisions align with tool capabilities

**Validation**:
- [ ] Decision matrix updated
- [ ] Decisions trigger correct tools
- [ ] Patterns match user intent

**Risks**:
- Ambiguous triggers → Use specific phrases
- Conflicting decisions → Prioritize governance tools

---

### Task 4.3: Governance Section

**Purpose**: Add comprehensive governance section to OmO prompt
**Estimate**: 2 hours
**Dependencies**: Tasks 4.1, 4.2 complete
**Priority**: High

**Input**:
- OmO prompt structure
- Governance workflow patterns
- Agent references

**Output**:
- New `<Governance>` section in `src/agents/omo.ts`

**Steps**:
- [ ] Add new `<Governance>` section after `<Decision_Matrix>`:
  ```markdown
  <Governance>
  ## Governance Integration

  ### Available Governance Tools
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

  ### When to Use Governance Tools
  | Trigger | Tool/Action |
  |---------|-------------|
  | User mentions "LIF-XXX" | linear_branch → get branch |
  | Starting new feature | create_spec_folder |
  | Completing task | linear_update_status |
  | Need project config | read_context |
  </Governance>
  ```
- [ ] Verify section integrates with existing prompt flow

**Validation**:
- [ ] Governance section added
- [ ] Workflow patterns clear
- [ ] Agent references accurate

**Risks**:
- Prompt too long → Keep section focused
- Conflicting instructions → Align with existing patterns

---

## Phase 5: Testing & Documentation

### Task 5.1: Hook Tests

**Purpose**: Verify hook functionality
**Estimate**: 4 hours
**Dependencies**: Phase 3 complete
**Priority**: High

**Input**:
- Completed hooks
- OmO test patterns

**Output**:
- Test files for each hook

**Steps**:
- [ ] Create `src/hooks/governance-path-validator/__tests__/index.test.ts`
- [ ] Create `src/hooks/governance-historian/__tests__/index.test.ts`
- [ ] Create `src/hooks/governance-linear-injector/__tests__/index.test.ts`
- [ ] Test path validation:
  - Valid paths pass
  - Invalid paths warn/block
  - Configuration respected
- [ ] Test historian:
  - File modifications tracked
  - Changelog created on session end
- [ ] Test Linear injector:
  - References detected
  - Context injected

**Validation**:
- [ ] All tests pass
- [ ] Edge cases covered
- [ ] Error handling verified

---

### Task 5.2: Tool Tests

**Purpose**: Verify tool functionality
**Estimate**: 3 hours
**Dependencies**: Phase 3 complete
**Priority**: High

**Input**:
- Completed tools
- OmO test patterns

**Output**:
- Test files for each tool

**Steps**:
- [ ] Create `src/tools/linear/__tests__/tools.test.ts`
- [ ] Create `src/tools/project-context/__tests__/tools.test.ts`
- [ ] Create `src/tools/spec/__tests__/tools.test.ts`
- [ ] Test Linear tools with mock MCP
- [ ] Test project context with mock file system
- [ ] Test spec tools with mock file system

**Validation**:
- [ ] All tests pass
- [ ] MCP interactions mocked correctly
- [ ] Error handling verified

---

### Task 5.3: Documentation

**Purpose**: Document governance features
**Estimate**: 3 hours
**Dependencies**: All previous phases complete
**Priority**: Medium

**Input**:
- Completed implementation
- OmO README structure

**Output**:
- Updated OmO README
- Governance configuration guide

**Steps**:
- [ ] Update OmO README with governance features section
- [ ] Document configuration options:
  ```markdown
  ## Governance Configuration
  
  Add to `.opencode/oh-my-opencode.json`:
  
  ```json
  {
    "governance": {
      "path_validation": {
        "enabled": true,
        "mode": "warn"
      },
      "historian": {
        "enabled": true
      },
      "linear": {
        "enabled": true,
        "team_prefix": "LIF"
      }
    }
  }
  ```
  ```
- [ ] Document rollback procedure
- [ ] Add troubleshooting section

**Validation**:
- [ ] Documentation complete
- [ ] Configuration examples work
- [ ] Rollback procedure tested

---

## Priority Order

1. **Critical** (Do First - Foundation):
   - Task 1.1: Path Validation Hook
   - Task 1.2: Historian Hook
   - Task 1.3: Linear Context Injector Hook

2. **Critical** (Do Second - Tools):
   - Task 2.1: Linear Tools
   - Task 2.2: Project Context Tool
   - Task 2.3: Spec Tools

3. **Critical** (Do Third - Integration):
   - Task 3.1: Hook Registration & Wiring
   - Task 3.2: Tool Registration & Wiring
   - Task 3.3: Configuration Schema Update

4. **High** (Do Fourth - OmO Awareness):
   - Task 4.1: Tools Section Update
   - Task 4.2: Decision Matrix Update
   - Task 4.3: Governance Section

5. **Medium** (Do Fifth - Validation):
   - Task 5.1: Hook Tests
   - Task 5.2: Tool Tests
   - Task 5.3: Documentation

---

## Parallel Work Opportunities

```
Week 1:
├── Task 1.1 (Path Validator) ────────┐
├── Task 1.2 (Historian) ─────────────┼──► Week 2: Task 3.1 (Hook Wiring)
├── Task 1.3 (Linear Injector) ───────┘
│
├── Task 2.1 (Linear Tools) ──────────┐
├── Task 2.2 (Context Tool) ──────────┼──► Week 2: Task 3.2 (Tool Wiring)
└── Task 2.3 (Spec Tools) ────────────┘

Week 2:
├── Task 3.1 (Hook Wiring) ───────────┐
├── Task 3.2 (Tool Wiring) ───────────┼──► Task 4.x (OmO Prompt)
└── Task 3.3 (Config Schema) ─────────┘

Week 3:
├── Task 4.1-4.3 (OmO Prompt) ────────┐
└── Task 5.1-5.3 (Testing/Docs) ──────┘
```

---

## Integration Verification Checklist

Before marking integration complete:

```
HOOKS:
□ governance-path-validator exported from src/hooks/index.ts
□ governance-historian exported from src/hooks/index.ts
□ governance-linear-injector exported from src/hooks/index.ts
□ All 3 hook names added to HookNameSchema in src/config/schema.ts
□ All 3 hooks instantiated with isHookEnabled() in src/index.ts
□ governance-path-validator wired to tool.execute.before
□ governance-historian wired to tool.execute.after
□ governance-linear-injector wired to event

TOOLS:
□ linear_branch exported from src/tools/index.ts
□ linear_update_status exported from src/tools/index.ts
□ linear_create_issue exported from src/tools/index.ts
□ read_context exported from src/tools/index.ts
□ create_spec_folder exported from src/tools/index.ts
□ All 5 tools added to plugin tool object in src/index.ts

OmO AWARENESS:
□ <Tools> section includes governance tools
□ <Decision_Matrix> includes governance decisions
□ <Governance> section added with workflow patterns

CONFIG:
□ GovernanceConfigSchema added to src/config/schema.ts
□ governance field added to OhMyOpenCodeConfigSchema
□ Default configuration documented
```

---

## Next Action

Start with **Task 1.1: Path Validation Hook** and **Task 2.1: Linear Tools** in parallel.

These have no dependencies and establish the foundation for all other work.
