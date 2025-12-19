# Implementation Plan: Command Workflow Harmonization

**Branch**: `hello/lif-65-command-workflow-harmonization-unified-contract-governance` | **Date**: 2025-12-18 | **Spec**: [spec.md](./spec.md)  
**Linear Issue**: [LIF-65](https://linear.app/lifelogger/issue/LIF-65)

## Summary

Unify all 35+ commands under a shared workflow contract (`WorkflowContext` + `commandPreflight()`) with consistent Linear integration policy, governance tool usage, and quality workflow commands (`/review`, `/test`). This addresses fundamental gaps identified through deep analysis where commands were created at different times with varying patterns.

**Technical Approach**: 
1. Create shared `WorkflowContext` type and resolution logic
2. Implement `commandPreflight()` that all workflow commands call
3. Standardize Linear policy as configurable (`off|optional|required`)
4. Add thin `/review` and `/test` commands leveraging existing agents
5. Retrofit existing commands incrementally via compatibility shim

## Constitution Check

*GATE: Verified against `.cursor/memory/constitution.md`*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Plugin-First Architecture | ✅ PASS | All changes use `@opencode-ai/plugin` SDK patterns |
| II. Multi-Model Excellence | ✅ PASS | No model changes; existing agent assignments preserved |
| III. Multi-Layered Agent Orchestration | ✅ PASS | New commands delegate to existing specialized agents |
| IV. Bun-Native Development | ✅ PASS | All TypeScript, Bun runtime |
| V. Hook-Driven Enhancement | ✅ PASS | Governance hooks already exist; commands will call them |
| VI. Dogfooding | ✅ PASS | We use these commands to build this feature |
| VII. GitHub Actions Publishing Only | ✅ N/A | No publishing changes |

**No violations. Proceed to implementation.**

## Research

### Phase 0 Findings (from analysis session)

**Command Pattern Analysis** (35+ commands analyzed):

| Pattern | Older Commands | Newer Commands |
|---------|---------------|----------------|
| Linear Integration | None | Inconsistent (mandatory/optional/absent) |
| Spec Folder Awareness | None | Core workflow only |
| Agent Delegation | Historian only | Multi-agent + Historian |
| Artifacts Produced | None | spec.md, plan.md, tasks.md |
| Governance Tools | Not called | Referenced but not called |

**Key Insight**: Commands evolved from isolated utilities to integrated workflow components, but integration is incomplete.

**Oracle Recommendations** (3 consultations):

1. **Architecture Oracle**: Add single "command runtime contract" shared by all commands: `preflight → context → execute → record → govern`
2. **Failure Mode Oracle**: Persisted workflow state prevents session loss; preflight validation prevents mid-execution failures
3. **UX Oracle**: Keep 35+ commands but make navigable via progressive disclosure + `/help` grouping

**Best Practices Research**:
- Spec-driven development emerging as standard (GitHub Spec Kit, JetBrains Junie)
- AGENTS.md adopted by 20k+ GitHub repos as "README for machines"
- Session checkpoints prevent context loss across sessions
- Markdown + YAML frontmatter is emerging standard for AI artifacts

## Data Model

### WorkflowContext

```typescript
interface WorkflowContext {
  // Core identifiers
  specPath: string | null;           // e.g., ".cursor/specs/LIF-65-feat-..."
  linearIssueId: string | null;      // e.g., "LIF-65"
  branchName: string | null;         // e.g., "hello/lif-65-..."
  
  // Configuration
  policy: LinearPolicy;              // "off" | "optional" | "required"
  
  // Runtime
  runId: string;                     // Unique execution ID
  repoRoot: string;                  // Absolute path to repo root
  
  // Resolution metadata
  resolvedFrom: ContextSource;       // How context was resolved
}

type LinearPolicy = "off" | "optional" | "required";

type ContextSource = 
  | "cli_args"           // Explicit arguments
  | "spec_folder"        // Detected from spec folder metadata
  | "branch_parsing"     // Parsed from git branch name
  | "user_prompt"        // User responded to prompt
  | "default";           // Fallback defaults
```

### WorkflowState (Persisted)

```typescript
interface WorkflowState {
  // Progress tracking
  currentStep: WorkflowStep;
  completedSteps: WorkflowStep[];
  
  // Artifact integrity
  artifactHashes: Record<string, string>;  // filename -> sha256
  
  // Linear integration
  linearIssueId: string | null;
  linearStatus: string | null;
  
  // Metadata
  createdAt: string;      // ISO timestamp
  updatedAt: string;      // ISO timestamp
  lastCommand: string;    // e.g., "/plan"
}

type WorkflowStep = 
  | "specify"
  | "plan" 
  | "tasks"
  | "implement"
  | "review"
  | "test"
  | "complete";
```

### PreflightResult

```typescript
interface PreflightResult {
  status: "ok" | "blocked" | "warning";
  context: WorkflowContext;
  
  // If blocked/warning
  issues: PreflightIssue[];
  fixes: PreflightFix[];
}

interface PreflightIssue {
  code: string;           // e.g., "MISSING_SPEC"
  message: string;        // Human-readable
  severity: "error" | "warning";
}

interface PreflightFix {
  action: string;         // e.g., "Run `/specify` first"
  command?: string;       // Optional command to run
  auto?: boolean;         // Can be auto-fixed
}
```

## Contracts

### commandPreflight() Function

```typescript
/**
 * Validates prerequisites and resolves context before command execution.
 * MUST be called by all workflow commands.
 */
async function commandPreflight(options: PreflightOptions): Promise<PreflightResult>;

interface PreflightOptions {
  // Command identification
  command: string;                    // e.g., "plan"
  
  // Required artifacts (validated)
  requiredArtifacts?: string[];       // e.g., ["spec.md"]
  
  // Context hints (optional)
  specDir?: string;                   // Explicit spec directory
  linearIssueId?: string;             // Explicit Linear issue
  
  // Behavior flags
  createSpecFolder?: boolean;         // Create if missing (for /specify)
  requireLinear?: boolean;            // Override policy to require Linear
  skipLinearUpdate?: boolean;         // Skip status update
}
```

### Command Frontmatter Extensions

```yaml
---
description: Create implementation plan from spec
# NEW: Workflow metadata
workflow:
  step: plan
  requires: [spec.md]
  produces: [plan.md]
  next: [tasks, implement]
  linear_status: in_progress
# NEW: Category for /help grouping
category: workflow
primary: true
---
```

### Linear Policy Configuration

In `project-context.yaml`:
```yaml
integrations:
  linear:
    policy: optional  # off | optional | required
    team_prefix: LIF
    auto_status_update: true
```

Or environment variable:
```bash
OPENCODE_LINEAR_POLICY=required
```

## Technical Context

**Language/Version**: TypeScript 5.7+ (Bun runtime)  
**Primary Dependencies**: `@opencode-ai/plugin` ^1.0.150, Zod ^4.1.8  
**Storage**: Filesystem (JSON files in spec folders)  
**Testing**: Not configured (manual verification via dogfooding)  
**Target Platform**: macOS, Linux, Windows (via Bun)  
**Project Type**: Single project (OpenCode plugin)  
**Performance Goals**: <100ms preflight validation, <500ms context resolution  
**Constraints**: No new dependencies, backward compatible with existing commands  
**Scale/Scope**: 35+ commands, ~40 tools, 7 agents

## Project Structure

### Documentation (this feature)

```text
.cursor/specs/LIF-65-feat-command-workflow-harmonization/
├── spec.md              # Feature specification ✅ (complete)
├── plan.md              # This file ✅ (complete)
├── tasks.md             # Task breakdown (next: /tasks)
├── status.md            # Feature status tracking
├── changelog/           # Feature changelog entries
│   └── index.md
└── implementation/      # Implementation notes
```

### Source Code Changes

```text
src/
├── shared/
│   ├── workflow-context.ts      # NEW: WorkflowContext type + resolution
│   ├── command-preflight.ts     # NEW: commandPreflight() implementation
│   └── index.ts                 # Export new modules
├── tools/
│   └── slashcommand/
│       └── tools.ts             # MODIFY: Add help grouping, category support

.opencode/
├── command/
│   ├── specify.md               # MODIFY: Add workflow frontmatter, use preflight
│   ├── plan.md                  # MODIFY: Add workflow frontmatter, use preflight
│   ├── tasks.md                 # MODIFY: Add workflow frontmatter, use preflight
│   ├── implement.md             # MODIFY: Add workflow frontmatter, use preflight
│   ├── review.md                # NEW: Code review command
│   └── test.md                  # NEW: Testing command
├── templates/
│   └── project-context.example.yaml  # MODIFY: Add linear.policy example
```

**Structure Decision**: Single project structure. Changes are additions to existing `src/shared/` and modifications to command markdown files.

## Implementation Phases

### Phase 1: Foundation (P0) - ~4 hours

**Goal**: Create shared WorkflowContext and commandPreflight infrastructure.

**Tasks**:
1. Create `src/shared/workflow-context.ts` with types and resolution logic
2. Create `src/shared/command-preflight.ts` with validation logic
3. Add Linear policy configuration to project-context schema
4. Export from `src/shared/index.ts`

**Verification**: Unit test context resolution from branch name, spec folder, CLI args.

### Phase 2: Prove Pattern (P0) - ~3 hours

**Goal**: Update `/specify` and `/tasks` to use new contract, proving the pattern works.

**Tasks**:
1. Add workflow frontmatter to `specify.md` and `tasks.md`
2. Add preflight instructions to command prompts
3. Verify Linear status updates work
4. Test full `/specify` → `/plan` → `/tasks` flow

**Verification**: Run `/specify test feature` → `/plan` → `/tasks` and verify:
- Context auto-detected at each step
- Linear status updated (if configured)
- Clear error if prerequisites missing

### Phase 3: Quality Commands (P0) - ~2 hours

**Goal**: Add `/review` and `/test` commands.

**Tasks**:
1. Create `.opencode/command/review.md` delegating to code-reviewer agent
2. Create `.opencode/command/test.md` delegating to test-engineer agent
3. Add workflow frontmatter with spec folder awareness
4. Ensure commands read spec.md for context

**Verification**: After `/implement`, run `/review` and verify it:
- Finds spec folder automatically
- Invokes code-reviewer with spec context
- References requirements from spec.md

### Phase 4: Workflow State (P1) - ~2 hours

**Goal**: Persist workflow state for session continuity.

**Tasks**:
1. Create `workflow-state.json` in spec folder after each command
2. Update preflight to read state and show "Resuming from: [step]"
3. Add artifact hash tracking for drift detection
4. Implement state update on command completion

**Verification**: Run `/specify` + `/plan`, close session, reopen, run `/tasks`:
- Should show "Resuming from: plan"
- Should auto-detect spec folder

### Phase 5: Help Grouping (P1) - ~2 hours

**Goal**: Improve command discoverability.

**Tasks**:
1. Add `category` and `primary` frontmatter to all commands
2. Modify `src/tools/slashcommand/tools.ts` to group by category
3. Implement `/help workflow` subcommand
4. Add unknown command suggestions

**Verification**: Run `/help` and verify:
- Core workflow commands highlighted
- Categories visible (Workflow, Quality, Utility, etc.)
- Running unknown command suggests alternatives

### Phase 6: Retrofit (P2) - Incremental

**Goal**: Update remaining commands to use preflight (incremental, not blocking).

**Tasks**:
1. Add workflow frontmatter to legacy commands
2. Add preflight instructions where beneficial
3. Document which commands are "workflow-aware" vs "standalone"

**Approach**: Compatibility shim - legacy commands work unchanged, but gain spec awareness if spec folder exists.

## Complexity Tracking

No constitution violations requiring justification.

| Consideration | Decision | Rationale |
|---------------|----------|-----------|
| New TypeScript files | 2 files (~200 LOC total) | Minimal footprint, focused responsibility |
| Command modifications | Frontmatter + prompt additions | No structural changes to command system |
| Backward compatibility | Preserved | Preflight is additive; old patterns still work |

## Risk Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking existing workflows | Phase 2 proves pattern on 2 commands before broader rollout |
| Over-enforcement blocks users | Default policy is `optional`; gentle prompts, not hard blocks |
| Context resolution conflicts | Clear priority order documented; explicit prompts on ambiguity |
| State file corruption | Atomic writes (write to .tmp, rename); artifact hashes detect tampering |

## Next Steps

1. **`/tasks`** - Break this plan into implementable tasks
2. **`/implement`** - Execute phases sequentially
3. **Verification** - Dogfood by using these commands to build LIF-65

## References

- Spec: [spec.md](./spec.md)
- Constitution: `.cursor/memory/constitution.md`
- Architecture: `.cursor/memory/architecture.md`
- Tech Stack: `.cursor/memory/tech-stack.md`
- Analysis: Deep analysis session (2025-12-18)
- Oracle consultations: 3 (architecture, failure modes, UX)
