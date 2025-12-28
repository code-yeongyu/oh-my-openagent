# Workflow Control System Design

**Document Version**: 1.0
**Date**: 2025-12-28
**Author**: OmO Deep Analysis
**Status**: Design Complete - Ready for Implementation

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Current Architecture Analysis](#3-current-architecture-analysis)
4. [Proposed Solution](#4-proposed-solution)
5. [Flag Specification](#5-flag-specification)
6. [Workflow State Changes](#6-workflow-state-changes)
7. [Command Changes](#7-command-changes)
8. [OmO Behavior Changes](#8-omo-behavior-changes)
9. [Implementation Plan](#9-implementation-plan)
10. [Testing Strategy](#10-testing-strategy)
11. [Migration & Compatibility](#11-migration--compatibility)

---

## 1. Executive Summary

### The Problem
Users want control over when OmO continues through workflow stages. Currently, after completing a command like `/review`, OmO may automatically proceed to `/implement` without asking - driven by its Agency rules that say "NEVER ask whether to continue. Iterate until done."

### The Solution
Introduce **command flags** for workflow commands that provide explicit, opt-in control over continuation behavior:

| Flag | Behavior |
|------|----------|
| *(default)* | Pause after command, report completion, ask user |
| `--continue` | Continue to next stage automatically |
| `--until=STAGE` | Continue until reaching STAGE (inclusive), then pause |
| `--full` | Continue through all stages to completion |

### Affected Commands
All spec-driven workflow commands:
- `/specify` → `/plan` → `/tasks` → `/implement` → `/review` → `/test`

---

## 2. Problem Statement

### 2.1 User Feedback
> "This is cool that AI just decided to build it all automatically but as a user I want control over this"
> "maybe command flags to force continuing until implementation, reviews, test, etc are complete"

### 2.2 Root Cause Analysis

**Finding 1: Conflicting Instructions**

OmO's `<Agency>` section (omo.ts lines 832-844) contains:
```
- If user asks to complete a task → NEVER ask whether to continue. Iterate until done.
- There are no 'Optional' jobs. Complete everything.
```

And the `<Final_Reminders>` section (line 1124):
```
- Do not stop until the user's request is fully fulfilled
```

These rules make OmO interpret workflow command completion as "task not yet fulfilled" because commands report "Next steps" suggesting more work.

**Finding 2: No Stage Gate Mechanism**

- Commands have `next` metadata field (e.g., `next: plan`) but it's not used for enforcement
- `workflow-state.json` tracks progress but doesn't signal "pause here"
- `workflow-state-enforcer` hook recommends agents but doesn't control continuation
- Only `/specify` has explicit "CRITICAL: Do NOT continue" instruction

**Finding 3: Current Flow After Each Stage**

| Command | Current Behavior |
|---------|------------------|
| `/specify` | Has explicit CRITICAL stop instruction (worktree switch) |
| `/plan` | Reports "Next steps: /tasks or /implement" → OmO continues |
| `/tasks` | Reports "Next steps: /implement" → OmO continues |
| `/implement` | Reports "Next steps: /review or /test" → OmO continues |
| `/review` | Reports "Next steps: /test" → OmO continues |
| `/test` | Terminal step, but may continue with PR creation |

---

## 3. Current Architecture Analysis

### 3.1 Workflow Commands Structure

**Location**: `.opencode/command/*.md`

**Frontmatter Schema**:
```yaml
---
description: string
step: specify|plan|tasks|implement|review|test
requires: string[]  # Required artifacts
produces: string[]  # Output artifacts
next: string|null   # Logical next step (metadata only, NOT enforced)
linear_status: string
category: workflow
primary: boolean
handoffs:           # UI hints only, NOT used for automation
  - label: string
    agent: string
    prompt: string
---
```

**Key Finding**: The `next` and `handoffs` fields are purely metadata - they don't trigger automatic invocation.

### 3.2 Workflow State Management

**Location**: `src/shared/workflow-context.ts`

**WorkflowState Interface** (lines 45-62):
```typescript
interface WorkflowState {
  currentStep: WorkflowStep
  completedSteps: WorkflowStep[]
  artifactHashes: Record<string, string>
  linearIssueId: string | null
  linearStatus: string | null
  createdAt: string
  updatedAt: string
  lastCommand: string
}
```

**Extension Points Identified**:
- Add new fields to `WorkflowState` interface
- Modify `createInitialWorkflowState()` and `updateWorkflowState()` 
- Update `update_workflow_state` tool to accept new parameters

### 3.3 Command Execution Flow

**Location**: `src/tools/slashcommand/tools.ts`

**Current Flow**:
1. Tool receives command name via `args.command`
2. Strip leading slash, find exact match in discovered commands
3. If workflow step defined, run `commandPreflight()` for validation
4. Resolve `@file` references and `!`command`` shell injections
5. Return formatted content with metadata sections

**Key Finding**: NO flag parsing exists. The `$ARGUMENTS` placeholder is replaced with raw user input. Commands must parse their own flags.

### 3.4 OmO Orchestrator

**Location**: `src/agents/omo.ts`

**Agent Config**:
```typescript
{
  model: "anthropic/claude-opus-4-5",
  thinking: { type: "enabled", budgetTokens: 32000 },
  maxTokens: 64000,
  mode: "primary",
  tools: { task: false }
}
```

**Decision Logic**: Uses 5-step intent classification embedded in prompt:
1. Identify Task Type (TRIVIAL, EXPLORATION, IMPLEMENTATION, ORCHESTRATION)
2. Estimate Scope (Tiny to Epic)
3. Assess Search Scope
4. Select Workflow
5. Handle Ambiguity

**Continuation Triggers**:
- Todo workflow: Mark in_progress → Complete → Move to next
- Agency rules: "Iterate until done"
- Final reminders: "Do not stop until fulfilled"

### 3.5 Hook System

**workflow-state-enforcer** (`src/hooks/workflow-state-enforcer/`):
- Detects workflow commands via `detectWorkflowCommand()`
- Validates prerequisites via `checkPrerequisites()`
- Injects guidance messages recommending agent delegation
- Has `mode: warn|block|disabled` but only "warn" is implemented

**hook-message-injector** (`src/features/hook-message-injector/`):
- Injects synthetic user messages into sessions
- Used by multiple hooks to inject context/warnings
- Could inject stage gate messages

---

## 4. Proposed Solution

### 4.1 Design Principles

1. **Opt-in Automation**: Default is pause; user explicitly enables continuation
2. **Explicit Over Implicit**: Flags make user intent clear
3. **Stage-Aware**: System knows which stages exist and their order
4. **Backward Compatible**: Existing commands work without flags
5. **Consistent UX**: Same flags work across all workflow commands

### 4.2 Solution Components

```
┌─────────────────────────────────────────────────────────────────┐
│                    WORKFLOW CONTROL SYSTEM                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────┐    ┌──────────────┐    ┌────────────────────┐  │
│  │ Flag Parser │───>│ Workflow     │───>│ Stage Gate         │  │
│  │ (new)       │    │ State        │    │ Controller (new)   │  │
│  └─────────────┘    │ (extended)   │    └────────────────────┘  │
│                      └──────────────┘             │              │
│                                                   │              │
│  ┌─────────────┐    ┌──────────────┐             │              │
│  │ Command     │───>│ OmO Prompt   │<────────────┘              │
│  │ Frontmatter │    │ (modified)   │                            │
│  │ (extended)  │    └──────────────┘                            │
│  └─────────────┘                                                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 4.3 Workflow Stages (Canonical Order)

```
specify → plan → tasks → implement → review → test → complete
   1        2       3         4          5       6        7
```

---

## 5. Flag Specification

### 5.1 Flag Definitions

| Flag | Short | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--pause` | `-p` | boolean | `true` | Pause after command completes (default behavior) |
| `--continue` | `-c` | boolean | `false` | Continue to next stage automatically |
| `--until=STAGE` | `-u STAGE` | string | `null` | Continue until reaching STAGE (inclusive) |
| `--full` | `-f` | boolean | `false` | Continue through all stages to completion |

### 5.2 Flag Semantics

**`--pause` (default)**
```
/plan --pause
```
- Complete the plan stage
- Report completion with summary
- STOP and wait for user input
- Do NOT invoke next stage

**`--continue`**
```
/plan --continue
```
- Complete the plan stage
- Automatically invoke next stage (`/tasks`)
- Continue ONLY one stage
- Then pause

**`--until=STAGE`**
```
/plan --until=implement
```
- Complete the plan stage
- Continue through: plan → tasks → implement
- STOP after reaching `implement` (inclusive)
- Valid stages: `specify`, `plan`, `tasks`, `implement`, `review`, `test`, `complete`

**`--full`**
```
/plan --full
```
- Equivalent to `--until=complete`
- Run through all remaining stages
- Only stop on errors or when workflow is complete

### 5.3 Shorthand Aliases

For convenience, add shorthand flags that expand to `--until=X`:

| Shorthand | Expands To | Description |
|-----------|------------|-------------|
| `--plan` | `--until=plan` | Run until plan complete |
| `--tasks` | `--until=tasks` | Run until tasks complete |
| `--implement` | `--until=implement` | Run until implementation complete |
| `--review` | `--until=review` | Run until review complete |
| `--test` | `--until=test` | Run until tests complete |

### 5.4 Flag Interactions

**Mutual Exclusivity**:
- `--pause`, `--continue`, `--until`, and `--full` are mutually exclusive
- If multiple specified, priority: `--full` > `--until` > `--continue` > `--pause`

**Stage Validation**:
- `--until=STAGE` must specify a stage AFTER current stage
- `/implement --until=plan` → Error: "plan is before implement"
- `/test --until=review` → Error: "review is before test"

### 5.5 Usage Examples

```bash
# Default - pause after plan completes
/plan

# Continue to tasks automatically  
/plan --continue

# Run plan, tasks, and implement, then stop
/plan --until=implement

# Run entire workflow from plan to completion
/plan --full

# Shorthand: same as --until=implement
/specify --implement

# Start fresh and run everything
/specify --full
```

---

## 6. Workflow State Changes

### 6.1 Extended WorkflowState Interface

**Location**: `src/shared/workflow-context.ts`

```typescript
interface WorkflowState {
  // Existing fields
  currentStep: WorkflowStep
  completedSteps: WorkflowStep[]
  artifactHashes: Record<string, string>
  linearIssueId: string | null
  linearStatus: string | null
  createdAt: string
  updatedAt: string
  lastCommand: string
  
  // NEW: Workflow control fields
  continuationMode: ContinuationMode
  targetStep: WorkflowStep | null
  pauseAfterSteps: WorkflowStep[]
  lastFlags: WorkflowFlags | null
}

type ContinuationMode = 'pause' | 'continue' | 'until' | 'full'

interface WorkflowFlags {
  pause: boolean
  continue: boolean
  until: WorkflowStep | null
  full: boolean
  raw: string  // Original flag string for debugging
}
```

### 6.2 New Type Definitions

**Location**: `src/tools/spec/types.ts`

```typescript
export type ContinuationMode = 'pause' | 'continue' | 'until' | 'full'

export interface WorkflowFlags {
  pause: boolean
  continue: boolean
  until: WorkflowStep | null
  full: boolean
  raw: string
}

export interface UpdateWorkflowStateArgs {
  specPath: string
  step: WorkflowStep
  linearStatus?: string
  // NEW
  continuationMode?: ContinuationMode
  targetStep?: WorkflowStep | null
  flags?: WorkflowFlags
}
```

### 6.3 Updated updateWorkflowState Tool

**Location**: `src/tools/spec/tools.ts`

Add new parameters to the tool:

```typescript
args: {
  specPath: tool.schema.string().describe("..."),
  step: tool.schema.enum([...]).describe("..."),
  linearStatus: tool.schema.string().optional(),
  // NEW
  continuationMode: tool.schema
    .enum(["pause", "continue", "until", "full"])
    .describe("Continuation behavior for workflow")
    .optional()
    .default("pause"),
  targetStep: tool.schema
    .enum(["specify", "plan", "tasks", "implement", "review", "test", "complete"])
    .describe("Target step for --until mode")
    .optional(),
}
```

### 6.4 Stage Gate Check Function

**Location**: `src/shared/workflow-context.ts` (new function)

```typescript
export interface StageGateResult {
  shouldContinue: boolean
  nextStep: WorkflowStep | null
  reason: string
  message: string
}

export function checkStageGate(state: WorkflowState): StageGateResult {
  const { currentStep, continuationMode, targetStep } = state
  const stepOrder: WorkflowStep[] = ['specify', 'plan', 'tasks', 'implement', 'review', 'test', 'complete']
  const currentIndex = stepOrder.indexOf(currentStep)
  const nextStep = currentIndex < stepOrder.length - 1 ? stepOrder[currentIndex + 1] : null
  
  switch (continuationMode) {
    case 'pause':
      return {
        shouldContinue: false,
        nextStep,
        reason: 'pause_mode',
        message: `✅ ${currentStep} complete. Run /${nextStep} to continue.`
      }
    
    case 'continue':
      return {
        shouldContinue: true,
        nextStep,
        reason: 'continue_one',
        message: `Continuing to /${nextStep}...`
      }
    
    case 'until':
      const targetIndex = targetStep ? stepOrder.indexOf(targetStep) : -1
      const shouldContinue = currentIndex < targetIndex
      return {
        shouldContinue,
        nextStep: shouldContinue ? nextStep : null,
        reason: shouldContinue ? 'until_target' : 'reached_target',
        message: shouldContinue 
          ? `Continuing to /${nextStep} (target: ${targetStep})...`
          : `✅ Reached target stage: ${targetStep}. Workflow paused.`
      }
    
    case 'full':
      const isComplete = currentStep === 'complete' || currentStep === 'test'
      return {
        shouldContinue: !isComplete,
        nextStep: isComplete ? null : nextStep,
        reason: isComplete ? 'workflow_complete' : 'full_auto',
        message: isComplete
          ? `✅ Workflow complete!`
          : `Continuing to /${nextStep}...`
      }
    
    default:
      return {
        shouldContinue: false,
        nextStep,
        reason: 'default_pause',
        message: `✅ ${currentStep} complete.`
      }
  }
}
```

---

## 7. Command Changes

### 7.1 Flag Parsing Utility

**Location**: `src/shared/parse-workflow-flags.ts` (new file)

```typescript
import type { WorkflowStep, WorkflowFlags, ContinuationMode } from '../tools/spec/types'

const WORKFLOW_STEPS: WorkflowStep[] = ['specify', 'plan', 'tasks', 'implement', 'review', 'test', 'complete']

const SHORTHAND_MAP: Record<string, WorkflowStep> = {
  '--plan': 'plan',
  '--tasks': 'tasks',
  '--implement': 'implement',
  '--review': 'review',
  '--test': 'test',
}

export interface ParsedCommand {
  command: string
  flags: WorkflowFlags
  args: string
}

export function parseWorkflowFlags(input: string): ParsedCommand {
  const parts = input.trim().split(/\s+/)
  const command = parts[0].replace(/^\//, '')
  
  const flags: WorkflowFlags = {
    pause: true,  // Default
    continue: false,
    until: null,
    full: false,
    raw: ''
  }
  
  const remainingArgs: string[] = []
  const flagParts: string[] = []
  
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i]
    
    if (part === '--pause' || part === '-p') {
      flags.pause = true
      flagParts.push(part)
    } else if (part === '--continue' || part === '-c') {
      flags.continue = true
      flags.pause = false
      flagParts.push(part)
    } else if (part === '--full' || part === '-f') {
      flags.full = true
      flags.pause = false
      flagParts.push(part)
    } else if (part.startsWith('--until=') || part.startsWith('-u=')) {
      const stage = part.split('=')[1] as WorkflowStep
      if (WORKFLOW_STEPS.includes(stage)) {
        flags.until = stage
        flags.pause = false
        flagParts.push(part)
      } else {
        throw new Error(`Invalid stage: ${stage}. Valid stages: ${WORKFLOW_STEPS.join(', ')}`)
      }
    } else if (part === '--until' || part === '-u') {
      // Next part should be the stage
      const stage = parts[++i] as WorkflowStep
      if (WORKFLOW_STEPS.includes(stage)) {
        flags.until = stage
        flags.pause = false
        flagParts.push(`${part} ${stage}`)
      } else {
        throw new Error(`Invalid stage: ${stage}. Valid stages: ${WORKFLOW_STEPS.join(', ')}`)
      }
    } else if (SHORTHAND_MAP[part]) {
      flags.until = SHORTHAND_MAP[part]
      flags.pause = false
      flagParts.push(part)
    } else {
      remainingArgs.push(part)
    }
  }
  
  flags.raw = flagParts.join(' ')
  
  // Apply priority: full > until > continue > pause
  if (flags.full) {
    flags.continue = false
    flags.until = null
  } else if (flags.until) {
    flags.continue = false
  }
  
  return {
    command,
    flags,
    args: remainingArgs.join(' ')
  }
}

export function getContinuationMode(flags: WorkflowFlags): ContinuationMode {
  if (flags.full) return 'full'
  if (flags.until) return 'until'
  if (flags.continue) return 'continue'
  return 'pause'
}

export function validateUntilFlag(currentStep: WorkflowStep, targetStep: WorkflowStep): void {
  const currentIndex = WORKFLOW_STEPS.indexOf(currentStep)
  const targetIndex = WORKFLOW_STEPS.indexOf(targetStep)
  
  if (targetIndex <= currentIndex) {
    throw new Error(
      `Invalid --until target: ${targetStep} is not after ${currentStep}. ` +
      `Workflow order: ${WORKFLOW_STEPS.join(' → ')}`
    )
  }
}
```

### 7.2 Updated Slashcommand Tool

**Location**: `src/tools/slashcommand/tools.ts`

Modify the `execute()` function to parse flags:

```typescript
import { parseWorkflowFlags, getContinuationMode } from '../../shared/parse-workflow-flags'

async execute(args) {
  const commands = discoverCommandsSync()

  if (!args.command) {
    return formatCommandList(commands) + "\n\nProvide a command name to execute."
  }

  // NEW: Parse flags from command string
  const { command: cmdName, flags, args: remainingArgs } = parseWorkflowFlags(args.command)

  // ... existing matching logic ...

  if (exactMatch) {
    // NEW: Pass flags to formatLoadedCommand
    const result = await formatLoadedCommand(exactMatch, flags, remainingArgs)
    return result.content
  }
  
  // ... rest of function ...
}
```

### 7.3 Updated formatLoadedCommand Function

```typescript
async function formatLoadedCommand(
  cmd: CommandInfo, 
  flags?: WorkflowFlags,
  userArgs?: string
): Promise<FormatCommandResult> {
  const sections: string[] = []
  let preflight: PreflightResult | null = null
  let blocked = false

  // ... existing preflight logic ...

  // NEW: Add workflow control section if workflow command
  if (cmd.metadata.step && flags) {
    const mode = getContinuationMode(flags)
    
    sections.push("\n---\n")
    sections.push("## Workflow Control\n")
    sections.push(`**Mode**: ${mode}`)
    if (flags.until) {
      sections.push(`**Target Stage**: ${flags.until}`)
    }
    sections.push(`**Flags**: \`${flags.raw || '(none - default pause)'}\``)
    sections.push("")
    
    // Inject stage gate instruction
    if (mode === 'pause') {
      sections.push("**INSTRUCTION**: After completing this command, STOP and report completion. Do NOT proceed to the next stage unless user explicitly requests it.")
    } else if (mode === 'continue') {
      sections.push(`**INSTRUCTION**: After completing this command, automatically proceed to /${cmd.metadata.next}.`)
    } else if (mode === 'until') {
      sections.push(`**INSTRUCTION**: After completing this command, check if current stage equals ${flags.until}. If not, proceed to next stage. If yes, STOP.`)
    } else if (mode === 'full') {
      sections.push("**INSTRUCTION**: After completing this command, automatically proceed to the next stage until workflow is complete.")
    }
    sections.push("")
  }

  // ... rest of existing function ...
}
```

### 7.4 Updated Command Frontmatter

Add `flags` field to frontmatter schema for command documentation:

**Example: `.opencode/command/plan.md`**:

```yaml
---
description: Create implementation plan from feature specification.
step: plan
requires:
  - spec.md
produces:
  - plan.md
next: tasks
linear_status: in_progress
category: workflow
primary: true
flags:
  - name: "--pause"
    short: "-p"
    description: "Pause after command completes (default)"
  - name: "--continue"
    short: "-c"  
    description: "Continue to next stage automatically"
  - name: "--until=STAGE"
    short: "-u STAGE"
    description: "Continue until reaching STAGE"
  - name: "--full"
    short: "-f"
    description: "Run through all remaining stages"
argument-hint: "[--continue | --until=STAGE | --full]"
---
```

---

## 8. OmO Behavior Changes

### 8.1 New Prompt Section: Stage Gate Protocol

Add new section to OmO prompt after `<Spec_Workflow>`:

```markdown
<Stage_Gate_Protocol>
## Workflow Stage Gates

Workflow commands (/specify, /plan, /tasks, /implement, /review, /test) have **explicit continuation control**.

### Default Behavior (--pause)
After completing ANY workflow command:
1. Report completion with summary
2. Show "Next steps" suggestions
3. **STOP AND WAIT** for user input
4. Do NOT invoke next stage automatically
5. This OVERRIDES the Agency rule "iterate until done" for workflow commands

### With --continue Flag
1. Complete current stage
2. Automatically invoke the NEXT stage only
3. Then apply default pause behavior

### With --until=STAGE Flag
1. Complete current stage
2. Check: Is current stage the target?
   - NO → Automatically invoke next stage
   - YES → STOP and report "Reached target stage"

### With --full Flag
1. Complete current stage
2. Automatically invoke next stage
3. Repeat until workflow is complete (test stage finished)

### Reading Continuation Mode

When a workflow command is invoked, check the **Workflow Control** section injected by the command:

```
## Workflow Control
**Mode**: pause|continue|until|full
**Target Stage**: (if --until mode)
**Flags**: (raw flag string)
**INSTRUCTION**: (what to do after completion)
```

ALWAYS follow the **INSTRUCTION** in this section for workflow commands.

### Exception: Agency Rules

The Agency rules "iterate until done" and "NEVER ask whether to continue" apply to:
- Bug fixes
- Feature implementation within a stage
- Non-workflow tasks

They do NOT apply to workflow stage transitions when no continuation flag is set.
</Stage_Gate_Protocol>
```

### 8.2 Modified Agency Section

Update the `<Agency>` section to distinguish workflow stages:

```markdown
<Agency>
## Behavior Guidelines

1. **Take initiative** - Do the right thing until complete
2. **Don't surprise users** - If they ask "how", answer before doing
3. **Be concise** - No code explanation summaries unless requested
4. **Be decisive** - Write common-sense code, don't be overly defensive

### CRITICAL Rules
- If user asks to complete a task → Iterate until done
- There are no 'Optional' jobs. Complete everything.
- NEVER leave "TODO" comments instead of implementing

### EXCEPTION: Workflow Stage Transitions
The above "iterate until done" rule has ONE exception:

**Workflow commands** (/specify, /plan, /tasks, /implement, /review, /test) are stage boundaries.
After completing a workflow command:
- Check the **Workflow Control** section for continuation mode
- If mode is `pause` (default): STOP and report completion
- If mode is `continue`/`until`/`full`: Follow the INSTRUCTION

This allows users to control when stages transition.
</Agency>
```

### 8.3 Updated Decision Matrix

Add workflow continuation to the Decision Matrix:

```markdown
| Situation | Action |
|-----------|--------|
| ... existing entries ... |
| "Completed workflow command (no flags)" | STOP, report completion, suggest next steps |
| "Completed workflow command (--continue)" | Invoke next stage, then STOP |
| "Completed workflow command (--until=X)" | Check if at X, if not continue, if yes STOP |
| "Completed workflow command (--full)" | Continue to next stage until complete |
```

---

## 9. Implementation Plan

### Phase 1: Foundation (Priority: HIGH)

**Tasks**:
1. Create `src/shared/parse-workflow-flags.ts` with flag parsing logic
2. Add new types to `src/tools/spec/types.ts`
3. Extend `WorkflowState` interface in `src/shared/workflow-context.ts`
4. Implement `checkStageGate()` function

**Files**:
- `src/shared/parse-workflow-flags.ts` (NEW)
- `src/tools/spec/types.ts` (MODIFY)
- `src/shared/workflow-context.ts` (MODIFY)

**Estimated Effort**: 2-3 hours

### Phase 2: Tool Integration (Priority: HIGH)

**Tasks**:
1. Update `slashcommand` tool to parse flags
2. Modify `formatLoadedCommand()` to inject Workflow Control section
3. Update `update_workflow_state` tool with new parameters

**Files**:
- `src/tools/slashcommand/tools.ts` (MODIFY)
- `src/tools/spec/tools.ts` (MODIFY)

**Estimated Effort**: 2-3 hours

### Phase 3: OmO Prompt Changes (Priority: HIGH)

**Tasks**:
1. Add `<Stage_Gate_Protocol>` section to OmO prompt
2. Modify `<Agency>` section with workflow exception
3. Update Decision Matrix

**Files**:
- `src/agents/omo.ts` (MODIFY)

**Estimated Effort**: 1-2 hours

### Phase 4: Command Updates (Priority: MEDIUM)

**Tasks**:
1. Update all workflow command frontmatter with `flags` field
2. Update `argument-hint` to show available flags
3. Add explicit stage gate instructions to command bodies

**Files**:
- `.opencode/command/specify.md` (MODIFY)
- `.opencode/command/plan.md` (MODIFY)
- `.opencode/command/tasks.md` (MODIFY)
- `.opencode/command/implement.md` (MODIFY)
- `.opencode/command/review.md` (MODIFY)
- `.opencode/command/test.md` (MODIFY)

**Estimated Effort**: 1-2 hours

### Phase 5: Hook Enhancement (Priority: LOW)

**Tasks**:
1. Update `workflow-state-enforcer` to detect and display flags
2. Consider adding a `workflow-continuation` hook for validation

**Files**:
- `src/hooks/workflow-state-enforcer/index.ts` (MODIFY)

**Estimated Effort**: 1 hour

### Phase 6: Testing & Documentation (Priority: MEDIUM)

**Tasks**:
1. Add unit tests for flag parsing
2. Add integration tests for stage gate logic
3. Update README with flag documentation
4. Update command help text

**Estimated Effort**: 2-3 hours

### Total Estimated Effort: 10-14 hours

---

## 10. Testing Strategy

### 10.1 Unit Tests

**File**: `tests/shared/parse-workflow-flags.test.ts`

```typescript
describe('parseWorkflowFlags', () => {
  it('parses --pause flag', () => {
    const result = parseWorkflowFlags('/plan --pause')
    expect(result.flags.pause).toBe(true)
    expect(result.flags.continue).toBe(false)
  })
  
  it('parses --continue flag', () => {
    const result = parseWorkflowFlags('/plan --continue')
    expect(result.flags.continue).toBe(true)
    expect(result.flags.pause).toBe(false)
  })
  
  it('parses --until=stage flag', () => {
    const result = parseWorkflowFlags('/plan --until=implement')
    expect(result.flags.until).toBe('implement')
  })
  
  it('parses shorthand --implement', () => {
    const result = parseWorkflowFlags('/plan --implement')
    expect(result.flags.until).toBe('implement')
  })
  
  it('validates stage order', () => {
    expect(() => validateUntilFlag('implement', 'plan')).toThrow()
  })
})
```

### 10.2 Integration Tests

**File**: `tests/tools/slashcommand-flags.test.ts`

```typescript
describe('slashcommand with flags', () => {
  it('injects Workflow Control section for --continue', async () => {
    const result = await slashcommand.execute({ command: 'plan --continue' })
    expect(result).toContain('## Workflow Control')
    expect(result).toContain('**Mode**: continue')
  })
  
  it('defaults to pause mode', async () => {
    const result = await slashcommand.execute({ command: 'plan' })
    expect(result).toContain('**Mode**: pause')
  })
})
```

### 10.3 E2E Test Scenarios

| Scenario | Input | Expected Behavior |
|----------|-------|-------------------|
| Default pause | `/plan` | Complete plan, STOP |
| Continue one | `/plan --continue` | Complete plan, auto-run /tasks, STOP |
| Until implement | `/plan --until=implement` | Run plan → tasks → implement, STOP |
| Full auto | `/specify --full` | Run all stages to completion |
| Invalid until | `/implement --until=plan` | Error: plan is before implement |

---

## 11. Migration & Compatibility

### 11.1 Backward Compatibility

**Guaranteed**:
- Commands without flags work exactly as before (default pause)
- Existing `workflow-state.json` files remain valid
- No breaking changes to existing APIs

**New Fields Are Optional**:
- `continuationMode` defaults to `'pause'`
- `targetStep` defaults to `null`
- Old state files without these fields will use defaults

### 11.2 Migration Path

1. **No migration required** - new fields have defaults
2. **Gradual adoption** - users can start using flags immediately
3. **Full compatibility** - old and new behavior coexist

### 11.3 Deprecation Notes

None - this is a purely additive feature.

---

## Appendix A: Complete Type Definitions

```typescript
// src/tools/spec/types.ts

export type WorkflowStep = 
  | 'specify' 
  | 'plan' 
  | 'tasks' 
  | 'implement' 
  | 'review' 
  | 'test' 
  | 'complete'

export type ContinuationMode = 'pause' | 'continue' | 'until' | 'full'

export interface WorkflowFlags {
  pause: boolean
  continue: boolean
  until: WorkflowStep | null
  full: boolean
  raw: string
}

export interface WorkflowState {
  currentStep: WorkflowStep
  completedSteps: WorkflowStep[]
  artifactHashes: Record<string, string>
  linearIssueId: string | null
  linearStatus: string | null
  createdAt: string
  updatedAt: string
  lastCommand: string
  // New fields
  continuationMode: ContinuationMode
  targetStep: WorkflowStep | null
  pauseAfterSteps: WorkflowStep[]
  lastFlags: WorkflowFlags | null
}

export interface StageGateResult {
  shouldContinue: boolean
  nextStep: WorkflowStep | null
  reason: string
  message: string
}

export interface ParsedCommand {
  command: string
  flags: WorkflowFlags
  args: string
}
```

---

## Appendix B: Flag Examples Reference

```bash
# Pause after each stage (default)
/specify                    # Create spec, STOP
/plan                       # Create plan, STOP
/tasks                      # Create tasks, STOP

# Continue one stage
/plan --continue            # plan → tasks, STOP
/tasks --continue           # tasks → implement, STOP

# Continue until specific stage
/specify --until=tasks      # specify → plan → tasks, STOP
/plan --until=review        # plan → tasks → implement → review, STOP
/implement --until=test     # implement → review → test, STOP

# Full automation
/specify --full             # Run entire workflow
/plan --full                # plan → tasks → implement → review → test

# Shorthand flags
/specify --implement        # Same as --until=implement
/plan --test                # Same as --until=test
/tasks --review             # Same as --until=review

# Short flags
/plan -c                    # Same as --continue
/plan -u implement          # Same as --until=implement
/plan -f                    # Same as --full
```

---

**End of Design Document**
