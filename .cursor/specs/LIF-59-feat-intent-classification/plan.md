# LIF-59: Implementation Plan

**Linear Issue**: [LIF-59](https://linear.app/lifelogger/issue/LIF-59)
**Created**: 2025-12-17
**Author**: Orchestrator

## Architecture

This is a **prompt-only change** to `src/agents/omo.ts`. No new code, hooks, or tools required.

### Component: OmO System Prompt

Add/modify sections in OmO's system prompt:
1. Add `<Intent_Classification>` section (new)
2. Update `<Intent_Gate>` section (enhance existing)
3. Update `<Todo_Management>` to reference classification

## Implementation Approach

### Phase 1: Intent Classification Section

Add new `<Intent_Classification>` section:

```markdown
<Intent_Classification>
## Task Type Detection

On EVERY user request, classify:

| Type | Keywords | Approach |
|------|----------|----------|
| TRIVIAL | "quick", single file, known location | Direct tools, no todos |
| BUG_FIX | "fix", "bug", "error", "broken" | Minimal todos (2-4), surgical fix |
| ENHANCEMENT | "add", "improve", "update" | Standard todos, may need spec |
| NEW_FEATURE | "new", "create", "implement" + scope | Spec workflow if >4h |
| REFACTOR | "refactor", "restructure", "clean up" | Plan first, then todos |
| PERFORMANCE | "slow", "optimize", "speed" | Profile → Plan → Implement |

### Classification Output
When responding, briefly indicate classification:
"Detected: BUG_FIX - Creating minimal todos for surgical fix"
</Intent_Classification>
```

### Phase 2: Workflow Selection Logic

Add workflow selection to `<Intent_Gate>`:

```markdown
### Step 4: Select Workflow

Based on classification:

IF task_type == TRIVIAL:
  → Direct execution, no todos needed
  → Just do the work with appropriate tools
  
ELIF task_type == BUG_FIX:
  → Create 2-4 todos: locate, understand, fix, verify
  → Skip spec folder
  → Focus on minimal, surgical changes
  
ELIF task_type == NEW_FEATURE:
  IF estimated_time > 4h:
    → Check for existing spec folder
    → If none and user confirms: create_spec_folder
    → Read tasks.md → Create todos
  ELSE:
    → Create todos directly
    → Skip spec folder (too small)
    
ELIF task_type == REFACTOR:
  → Plan first (understand scope)
  → Then create todos
  → Consider spec folder for large refactors
  
ELIF task_type == PERFORMANCE:
  → Profile first (understand bottleneck)
  → Plan optimization approach
  → Then implement
```

### Phase 3: Ambiguity Handling

Add ambiguity detection:

```markdown
### Ambiguity Handling

If request is vague ("fix it", "do this", "handle that"):
- DO NOT guess what user means
- DO NOT search for issues to fix
- Ask specific clarifying questions:

"I need more information to proceed:
- What specifically needs to be [fixed/done/handled]?
- What is the current behavior vs expected behavior?
- Is there a Linear issue or error message I should reference?"
```

### Phase 4: Update Todo Management

Modify `<Todo_Management>` to reference classification:

```markdown
### When to Create Todos

Based on intent classification:
- TRIVIAL: Skip todos entirely
- BUG_FIX: 2-4 todos max
- ENHANCEMENT: Standard todos
- NEW_FEATURE (>4h): Todos from spec
- NEW_FEATURE (≤4h): Direct todos
- REFACTOR: Planning todos first
- PERFORMANCE: Profile → Plan → Implement todos
```

## Data Flow

```
User Request
    ↓
Intent Classification (keywords + context)
    ↓
Task Type: TRIVIAL | BUG_FIX | ENHANCEMENT | NEW_FEATURE | REFACTOR | PERFORMANCE
    ↓
Workflow Selection
    ↓
Execute with appropriate todo strategy
```

## Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Misclassification | Medium | Low | User can override, ask for clarification |
| Keyword conflicts | Low | Low | Use context + keywords, not just keywords |
| Over-classification | Low | Medium | Default to standard workflow if unsure |

## Testing Strategy

1. **Manual Testing**:
   - Test each task type with representative requests
   - Test ambiguous requests
   - Test edge cases (mixed keywords)

2. **Example Test Cases**:
   - "fix the null pointer in auth.ts" → BUG_FIX
   - "add a new user dashboard" → NEW_FEATURE
   - "quick, what's in config.ts?" → TRIVIAL
   - "optimize the slow query" → PERFORMANCE
   - "fix it" → AMBIGUOUS (ask for clarification)

## Rollback Strategy

If issues arise:
1. Remove `<Intent_Classification>` section
2. Revert `<Intent_Gate>` changes
3. OmO reverts to standard todo-for-everything approach
