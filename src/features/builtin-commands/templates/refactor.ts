export const REFACTOR_TEMPLATE = `# Intelligent Refactor Command

## Usage
\`\`\`
/refactor <refactoring-target> [--scope=<file|module|project>] [--strategy=<safe|aggressive>]

Arguments:
  refactoring-target: What to refactor. Can be:
    - File path: src/auth/handler.ts
    - Symbol name: "AuthService class"
    - Pattern: "all functions using deprecated API"
    - Description: "extract validation logic into separate module"

Options:
  --scope: Refactoring scope (default: module)
    - file: Single file only
    - module: Module/directory scope
    - project: Entire codebase

  --strategy: Risk tolerance (default: safe)
    - safe: Conservative, maximum test coverage required
    - aggressive: Allow broader changes with adequate coverage
\`\`\`

## What This Command Does

Performs intelligent, deterministic refactoring with full codebase awareness. Unlike blind search-and-replace, this command:

1. **Understands your intent** - Analyzes what you actually want to achieve
2. **Maps the codebase** - Builds a definitive codemap before touching anything
3. **Assesses risk** - Evaluates test coverage and determines verification strategy
4. **Plans meticulously** - Creates a detailed plan with Plan agent
5. **Executes precisely** - Step-by-step refactoring with LSP and AST-grep
6. **Verifies constantly** - Runs tests after each change to ensure zero regression

---

# PHASE 0: INTENT GATE (MANDATORY FIRST STEP)

**BEFORE ANY ACTION, classify and validate the request.**

## Step 0.1: Parse Request Type

| Signal | Classification | Action |
|--------|----------------|--------|
| Specific file/symbol | Explicit | Proceed to codebase analysis |
| "Refactor X to Y" | Clear transformation | Proceed to codebase analysis |
| "Improve", "Clean up" | Open-ended | **MUST ask**: "What specific improvement?" |
| Ambiguous scope | Uncertain | **MUST ask**: "Which modules/files?" |
| Missing context | Incomplete | **MUST ask**: "What's the desired outcome?" |

## Step 0.2: Validate Understanding

Before proceeding, confirm:
- [ ] Target is clearly identified
- [ ] Desired outcome is understood
- [ ] Scope is defined (file/module/project)
- [ ] Success criteria can be articulated

**If ANY of above is unclear, ASK CLARIFYING QUESTION:**

\`\`\`
I want to make sure I understand the refactoring goal correctly.

**What I understood**: [interpretation]
**What I'm unsure about**: [specific ambiguity]

Options I see:
1. [Option A] - [implications]
2. [Option B] - [implications]

**My recommendation**: [suggestion with reasoning]

Should I proceed with [recommendation], or would you prefer differently?
\`\`\`

## Step 0.3: Create Initial Todos

**IMMEDIATELY after understanding the request, create todos:**

\`\`\`
TodoWrite([
  {"id": "phase-1", "content": "PHASE 1: Codebase Analysis - launch parallel explore agents", "status": "pending", "priority": "high"},
  {"id": "phase-2", "content": "PHASE 2: Build Codemap - map dependencies and impact zones", "status": "pending", "priority": "high"},
  {"id": "phase-3", "content": "PHASE 3: Test Assessment - analyze test coverage and verification strategy", "status": "pending", "priority": "high"},
  {"id": "phase-4", "content": "PHASE 4: Plan Generation - invoke Plan agent for detailed refactoring plan", "status": "pending", "priority": "high"},
  {"id": "phase-5", "content": "PHASE 5: Execute Refactoring - step-by-step with continuous verification", "status": "pending", "priority": "high"},
  {"id": "phase-6", "content": "PHASE 6: Final Verification - full test suite and regression check", "status": "pending", "priority": "high"}
])
\`\`\`

---

# PHASE 1: CODEBASE ANALYSIS (PARALLEL EXPLORATION)

**Mark phase-1 as in_progress.**

## 1.1: Launch Parallel Explore Agents (BACKGROUND)

Fire ALL of these simultaneously using \`call_omo_agent\`:

\`\`\`
// Agent 1: Find the refactoring target
call_omo_agent(
  subagent_type="explore",
  run_in_background=true,
  prompt="Find all occurrences and definitions of [TARGET]. 
  Report: file paths, line numbers, usage patterns."
)

// Agent 2: Find related code
call_omo_agent(
  subagent_type="explore", 
  run_in_background=true,
  prompt="Find all code that imports, uses, or depends on [TARGET].
  Report: dependency chains, import graphs."
)

// Agent 3: Find similar patterns
call_omo_agent(
  subagent_type="explore",
  run_in_background=true,
  prompt="Find similar code patterns to [TARGET] in the codebase.
  Report: analogous implementations, established conventions."
)

// Agent 4: Find tests
call_omo_agent(
  subagent_type="explore",
  run_in_background=true,
  prompt="Find all test files related to [TARGET].
  Report: test file paths, test case names, coverage indicators."
)

// Agent 5: Architecture context
call_omo_agent(
  subagent_type="explore",
  run_in_background=true,
  prompt="Find architectural patterns and module organization around [TARGET].
  Report: module boundaries, layer structure, design patterns in use."
)
\`\`\`

## 1.2: Direct Tool Exploration (WHILE AGENTS RUN)

While background agents are running, use direct tools:

### LSP Tools for Precise Analysis:

\`\`\`typescript
// Find definition(s)
LspGotoDefinition(filePath, line, character)  // Where is it defined?

// Find ALL usages across workspace
LspFindReferences(filePath, line, character, includeDeclaration=true)

// Get file structure
LspDocumentSymbols(filePath)  // Hierarchical outline
LspWorkspaceSymbols(filePath, query="[target_symbol]")  // Search by name

// Get current diagnostics
lsp_diagnostics(filePath)  // Errors, warnings before we start
\`\`\`

### AST-Grep for Pattern Analysis:

\`\`\`typescript
// Find structural patterns
ast_grep_search(
  pattern="function $NAME($$$) { $$$ }",  // or relevant pattern
  lang="typescript",  // or relevant language
  paths=["src/"]
)

// Preview refactoring (DRY RUN)
ast_grep_replace(
  pattern="[old_pattern]",
  rewrite="[new_pattern]",
  lang="[language]",
  dryRun=true  // ALWAYS preview first
)
\`\`\`

### Grep for Text Patterns:

\`\`\`
grep(pattern="[search_term]", path="src/", include="*.ts")
\`\`\`

## 1.3: Collect Background Results

\`\`\`
background_output(task_id="[agent_1_id]")
background_output(task_id="[agent_2_id]")
...
\`\`\`

**Mark phase-1 as completed after all results collected.**

---

# PHASE 2: BUILD CODEMAP (DEPENDENCY MAPPING)

**Mark phase-2 as in_progress.**

## 2.1: Construct Definitive Codemap

Based on Phase 1 results, build:

\`\`\`
## CODEMAP: [TARGET]

### Core Files (Direct Impact)
- \`path/to/file.ts:L10-L50\` - Primary definition
- \`path/to/file2.ts:L25\` - Key usage

### Dependency Graph
\`\`\`
[TARGET] 
├── imports from: 
│   ├── module-a (types)
│   └── module-b (utils)
├── imported by:
│   ├── consumer-1.ts
│   ├── consumer-2.ts
│   └── consumer-3.ts
└── used by:
    ├── handler.ts (direct call)
    └── service.ts (dependency injection)
\`\`\`

### Impact Zones
| Zone | Risk Level | Files Affected | Test Coverage |
|------|------------|----------------|---------------|
| Core | HIGH | 3 files | 85% covered |
| Consumers | MEDIUM | 8 files | 70% covered |
| Edge | LOW | 2 files | 50% covered |

### Established Patterns
- Pattern A: [description] - used in N places
- Pattern B: [description] - established convention
\`\`\`

## 2.2: Identify Refactoring Constraints

Based on codemap:
- **MUST follow**: [existing patterns identified]
- **MUST NOT break**: [critical dependencies]
- **Safe to change**: [isolated code zones]
- **Requires migration**: [breaking changes impact]

**Mark phase-2 as completed.**

---

# PHASE 3: TEST ASSESSMENT (VERIFICATION STRATEGY)

**Mark phase-3 as in_progress.**

## 3.1: Detect Test Infrastructure

\`\`\`bash
# Check for test commands
cat package.json | jq '.scripts | keys[] | select(test("test"))'

# Or for Python
ls -la pytest.ini pyproject.toml setup.cfg

# Or for Go
ls -la *_test.go
\`\`\`

## 3.2: Analyze Test Coverage

\`\`\`
// Find all tests related to target
call_omo_agent(
  subagent_type="explore",
  run_in_background=false,  // Need this synchronously
  prompt="Analyze test coverage for [TARGET]:
  1. Which test files cover this code?
  2. What test cases exist?
  3. Are there integration tests?
  4. What edge cases are tested?
  5. Estimated coverage percentage?"
)
\`\`\`

## 3.3: Determine Verification Strategy

Based on test analysis:

| Coverage Level | Strategy |
|----------------|----------|
| HIGH (>80%) | Run existing tests after each step |
| MEDIUM (50-80%) | Run tests + add safety assertions |
| LOW (<50%) | **PAUSE**: Propose adding tests first |
| NONE | **BLOCK**: Refuse aggressive refactoring |

**If coverage is LOW or NONE, ask user:**

\`\`\`
Test coverage for [TARGET] is [LEVEL].

**Risk Assessment**: Refactoring without adequate tests is dangerous.

Options:
1. Add tests first, then refactor (RECOMMENDED)
2. Proceed with extra caution, manual verification required
3. Abort refactoring

Which approach do you prefer?
\`\`\`

## 3.4: Document Verification Plan

\`\`\`
## VERIFICATION PLAN

### Test Commands
- Unit: \`bun test\` / \`npm test\` / \`pytest\` / etc.
- Integration: [command if exists]
- Type check: \`tsc --noEmit\` / \`pyright\` / etc.

### Verification Checkpoints
After each refactoring step:
1. lsp_diagnostics → zero new errors
2. Run test command → all pass
3. Type check → clean

### Regression Indicators
- [Specific test that must pass]
- [Behavior that must be preserved]
- [API contract that must not change]
\`\`\`

**Mark phase-3 as completed.**

---

# PHASE 4: PLAN GENERATION (PLAN AGENT)

**Mark phase-4 as in_progress.**

## 4.1: Invoke Plan Agent

\`\`\`
Task(
  subagent_type="plan",
  prompt="Create a detailed refactoring plan:

  ## Refactoring Goal
  [User's original request]

  ## Codemap (from Phase 2)
  [Insert codemap here]

  ## Test Coverage (from Phase 3)
  [Insert verification plan here]

  ## Constraints
  - MUST follow existing patterns: [list]
  - MUST NOT break: [critical paths]
  - MUST run tests after each step

  ## Requirements
  1. Break down into atomic refactoring steps
  2. Each step must be independently verifiable
  3. Order steps by dependency (what must happen first)
  4. Specify exact files and line ranges for each step
  5. Include rollback strategy for each step
  6. Define commit checkpoints"
)
\`\`\`

## 4.2: Review and Validate Plan

After receiving plan from Plan agent:

1. **Verify completeness**: All identified files addressed?
2. **Verify safety**: Each step reversible?
3. **Verify order**: Dependencies respected?
4. **Verify verification**: Test commands specified?

## 4.3: Register Detailed Todos

Convert Plan agent output into granular todos:

\`\`\`
TodoWrite([
  // Each step from the plan becomes a todo
  {"id": "refactor-1", "content": "Step 1: [description]", "status": "pending", "priority": "high"},
  {"id": "verify-1", "content": "Verify Step 1: run tests", "status": "pending", "priority": "high"},
  {"id": "refactor-2", "content": "Step 2: [description]", "status": "pending", "priority": "medium"},
  {"id": "verify-2", "content": "Verify Step 2: run tests", "status": "pending", "priority": "medium"},
  // ... continue for all steps
])
\`\`\`

**Mark phase-4 as completed.**

---

# PHASE 5: EXECUTE REFACTORING (DETERMINISTIC EXECUTION)

**Mark phase-5 as in_progress.**

## 5.1: Execution Protocol

For EACH refactoring step:

### Pre-Step
1. Mark step todo as \`in_progress\`
2. Read current file state
3. Verify lsp_diagnostics is baseline

### Execute Step
Use appropriate tool:

**For Symbol Renames:**
\`\`\`typescript
lsp_prepare_rename(filePath, line, character)  // Validate rename is possible
lsp_rename(filePath, line, character, newName)  // Execute rename
\`\`\`

**For Pattern Transformations:**
\`\`\`typescript
// Preview first
ast_grep_replace(pattern, rewrite, lang, dryRun=true)

// If preview looks good, execute
ast_grep_replace(pattern, rewrite, lang, dryRun=false)
\`\`\`

**For Structural Changes:**
\`\`\`typescript
// Use Edit tool for precise changes
edit(filePath, oldString, newString)
\`\`\`

### Post-Step Verification (MANDATORY)

\`\`\`typescript
// 1. Check diagnostics
lsp_diagnostics(filePath)  // Must be clean or same as baseline

// 2. Run tests
bash("bun test")  // Or appropriate test command

// 3. Type check
bash("tsc --noEmit")  // Or appropriate type check
\`\`\`

### Step Completion
1. If verification passes → Mark step todo as \`completed\`
2. If verification fails → **STOP AND FIX**

## 5.2: Failure Recovery Protocol

If ANY verification fails:

1. **STOP** immediately
2. **REVERT** the failed change
3. **DIAGNOSE** what went wrong
4. **OPTIONS**:
   - Fix the issue and retry
   - Skip this step (if optional)
   - Consult oracle agent for help
   - Ask user for guidance

**NEVER proceed to next step with broken tests.**

## 5.3: Commit Checkpoints

After each logical group of changes:

\`\`\`bash
git add [changed-files]
git commit -m "refactor(scope): description

[details of what was changed and why]"
\`\`\`

**Mark phase-5 as completed when all refactoring steps done.**

---

# PHASE 6: FINAL VERIFICATION (REGRESSION CHECK)

**Mark phase-6 as in_progress.**

## 6.1: Full Test Suite

\`\`\`bash
# Run complete test suite
bun test  # or npm test, pytest, go test, etc.
\`\`\`

## 6.2: Type Check

\`\`\`bash
# Full type check
tsc --noEmit  # or equivalent
\`\`\`

## 6.3: Lint Check

\`\`\`bash
# Run linter
eslint .  # or equivalent
\`\`\`

## 6.4: Build Verification (if applicable)

\`\`\`bash
# Ensure build still works
bun run build  # or npm run build, etc.
\`\`\`

## 6.5: Final Diagnostics

\`\`\`typescript
// Check all changed files
for (file of changedFiles) {
  lsp_diagnostics(file)  // Must all be clean
}
\`\`\`

## 6.6: Generate Summary

\`\`\`markdown
## Refactoring Complete

### What Changed
- [List of changes made]

### Files Modified
- \`path/to/file.ts\` - [what changed]
- \`path/to/file2.ts\` - [what changed]

### Verification Results
- Tests: PASSED (X/Y passing)
- Type Check: CLEAN
- Lint: CLEAN
- Build: SUCCESS

### No Regressions Detected
All existing tests pass. No new errors introduced.
\`\`\`

**Mark phase-6 as completed.**

---

# CRITICAL RULES

## NEVER DO
- Skip lsp_diagnostics check after changes
- Proceed with failing tests
- Make changes without understanding impact
- Use \`as any\`, \`@ts-ignore\`, \`@ts-expect-error\`
- Delete tests to make them pass
- Commit broken code
- Refactor without understanding existing patterns

## ALWAYS DO
- Understand before changing
- Preview before applying (ast_grep dryRun=true)
- Verify after every change
- Follow existing codebase patterns
- Keep todos updated in real-time
- Commit at logical checkpoints
- Report issues immediately

## ABORT CONDITIONS
If any of these occur, **STOP and consult user**:
- Test coverage is zero for target code
- Changes would break public API
- Refactoring scope is unclear
- 3 consecutive verification failures
- User-defined constraints violated

---

# Tool Usage Philosophy

You already know these tools. Use them intelligently:

## LSP Tools
Leverage LSP tools for precision analysis. Key patterns:
- **Understand before changing**: \`LspGotoDefinition\` to grasp context
- **Impact analysis**: \`LspFindReferences\` to map all usages before modification
- **Safe refactoring**: \`lsp_prepare_rename\` → \`lsp_rename\` for symbol renames
- **Continuous verification**: \`lsp_diagnostics\` after every change

## AST-Grep
Use \`ast_grep_search\` and \`ast_grep_replace\` for structural transformations.
**Critical**: Always \`dryRun=true\` first, review, then execute.

## Agents
- \`explore\`: Parallel codebase pattern discovery
- \`plan\`: Detailed refactoring plan generation
- \`oracle\`: Read-only consultation for complex architectural decisions and debugging
- \`librarian\`: **Use proactively** when encountering deprecated methods or library migration tasks. Query official docs and OSS examples for modern replacements.

## Deprecated Code & Library Migration
When you encounter deprecated methods/APIs during refactoring:
1. Fire \`librarian\` to find the recommended modern alternative
2. **DO NOT auto-upgrade to latest version** unless user explicitly requests migration
3. If user requests library migration, use \`librarian\` to fetch latest API docs before making changes

---

**Remember: Refactoring without tests is reckless. Refactoring without understanding is destructive. This command ensures you do neither.**

<user-request>
$ARGUMENTS
</user-request>
`

export const REFACTOR_TEAM_MODE_ADDENDUM = `
---

# Team Mode Protocol (active when team_* tools are present)

Team mode is enabled for this session. The rules below **override Phase 4-6** above. Follow this protocol instead of the in-session step-by-step execution.

## Phase 4 override: Plan agent staffing requirement

When invoking the Plan agent in Phase 4.1, append this additional requirement to the prompt:

\`\`\`
7. (REQUIRED when team mode is active) Output a Team Staffing Recommendation section with these fields — missing fields fail Phase 5.0:
   - total_atomic_steps: integer
   - file_independent_steps: integer (parallelizable, no cross-file blocker)
   - cross_file_dependent_steps: integer (has blockers)
   - per_step_assignment: [{step_id, assigned_to: 'quick' | 'unspecified-low', blockedBy: [step_ids], rationale}]
   - dispatch_path_recommendation: 'team' | 'legacy' with reason
   - rationale for the composition
\`\`\`

**Classification rules** the plan agent must apply to each step:
- \`quick\`: mechanical edits — LSP rename, extract variable, inline, simple move, signature change without call-site logic.
- \`unspecified-low\`: logic-preserving refactors that need reasoning — extract function, restructure conditional, pattern transformation, cross-file API change.
- Recommend \`team\` path when \`file_independent_steps >= 3\`; recommend \`legacy\` otherwise.

## Phase 5 override: Dispatch path selection

Read the Team Staffing Recommendation from Phase 4. If any required field is missing, fail here and re-request the plan with the exact missing field names. Do not proceed with a partial plan.

Then choose the path:

- **Team path (5.1-T)**: when the plan recommends \`team\` AND \`file_independent_steps >= 3\`. Members execute in parallel, Lead orchestrates, a \`deep\` verifier lives outside the team.
- **Legacy path (5.1-L)**: otherwise. Use the original 5.1 / 5.2 / 5.3 flow from above.

Record the chosen path in the TodoWrite list.

## Phase 5.1-T: \`refactor-squad\` team execution

**Precondition checks** (fail hard if any step fails):

1. Load the \`team-mode\` skill via the \`skill\` tool for lifecycle, message protocol, and limits.
2. Call \`team_list\` and verify no active \`refactor-squad\` run exists; if one does, shutdown + delete the orphan before proceeding.
3. If \`~/.omo/teams/refactor-squad/config.json\` is missing, write it using the spec below.

**Team spec** (\`~/.omo/teams/refactor-squad/config.json\`):

\`\`\`json
{
  "name": "refactor-squad",
  "lead": { "kind": "subagent_type", "subagent_type": "sisyphus" },
  "members": [
    {
      "kind": "category",
      "category": "quick",
      "prompt": "You handle mechanical refactoring steps (LSP rename, extract variable, inline, simple move, signature change). Use LSP tools for correctness. Apply the task description's per-step instructions verbatim — no scope expansion. After edits, run lsp_diagnostics on touched files. Report via team_send_message(teamRunId=<id>, to=\"lead\", summary=<files touched>, body=<lsp status + diff summary>) + team_task_update(status=completed). Never run tests — the external verifier handles that. Never git add, never --continue."
    },
    { "kind": "category", "category": "quick", "prompt": "Same contract as peer quick worker." },
    {
      "kind": "category",
      "category": "unspecified-low",
      "prompt": "You handle logic-preserving refactors that need reasoning (extract function, restructure conditional, pattern transformation, cross-file API change). Read the task description's plan step carefully. Use ast_grep_replace with dryRun=true first, review the preview, then execute. If the step is ambiguous or would require out-of-scope changes, STOP and send team_send_message(teamRunId=<id>, to=\"lead\", summary=\"UNCLEAR\", body=<reason>) + team_task_update(status=pending). Same reporting contract as peer quick workers. Never run tests."
    },
    { "kind": "category", "category": "unspecified-low", "prompt": "Same contract as peer unspecified-low worker." }
  ]
}
\`\`\`

Rationale for this composition:
- **4 workers = team mode's parallel cap.** 5+ just queues.
- **No verifier team member.** Verification needs \`deep\` reasoning (or \`unspecified-high\` fallback). In-team category routing downcasts to sisyphus-junior, which is weaker than required — the verifier runs OUTSIDE the team as a \`task(category="deep")\`.
- **quick × 2** for mechanical edits, **unspecified-low × 2** for reasoning edits — mirrors the plan's split.

**Team lifecycle** (one team, reused until Phase 6 cleanup):

1. \`team_create(teamName="refactor-squad")\`. Record \`teamRunId\`.
2. Broadcast the refactor Intent Card ONCE (keep task descriptions slim):
   \`\`\`
   team_send_message(
     teamRunId=<id>, to="*", kind="announcement",
     summary="refactor-intent",
     body=<codemap summary + constraints + established patterns from Phase 2>
   )
   \`\`\`
3. Broadcast the verification spec ONCE:
   \`\`\`
   team_send_message(
     teamRunId=<id>, to="*", kind="announcement",
     summary="verify-spec",
     body=<exact test/typecheck/lint commands + expected pass counts + regression indicators from Phase 3.4>
   )
   \`\`\`
4. For each plan step, \`team_task_create(teamRunId=<id>, subject="refactor step <N>: <short>", description=<per-step instructions from plan, including target files and line ranges, rollback strategy>, blockedBy=<from plan's per_step_assignment>)\`.

**Lead monitoring loop**:

While any team task is \`pending | claimed | in_progress\`:

- Wait for \`<system-reminder>\` or member messages. Avoid tight polling; a single \`team_status\` check is acceptable if no notification arrives within roughly 10 seconds of expected completion.
- On a worker completion report, immediately dispatch an **external verifier** — verification runs OUTSIDE the team because team-member category routing downcasts to sisyphus-junior:
  \`\`\`
  task(
    category="deep",
    load_skills=[],
    run_in_background=true,
    description="verify step <N>",
    prompt=<files touched + verify-spec commands + instruction to return "PASS" or "FAIL:<failing test + specific error + suggested revert hunks>">
  )
  \`\`\`
  If \`deep\` is unavailable, fall back to \`category="unspecified-high"\`. Do not create a commit checkpoint until the verifier returns PASS.
- On a verifier PASS: make the commit checkpoint for that step (see original 5.3). Proceed.
- On a verifier FAIL: Lead decides:
  - **Retry with fix hint**: \`team_task_update(status=pending)\` on the original step + \`team_send_message(teamRunId=<id>, to=<original member>, summary="retry", body=<specific failure from verifier>)\`. Runtime reassigns.
  - **Escalate**: after three FAIL cycles on the same step, STOP and consult the user with full evidence.
- On a member UNCLEAR message: re-harvest context via a targeted \`task()\` outside the team, broadcast an updated Intent Card fragment, then reassign.

Proceed to Phase 6 only when every team task is \`completed\` AND every paired verifier task returned PASS.

## Phase 6 override: Team cleanup before summary

If Phase 5 used the team path, dismantle \`refactor-squad\` BEFORE producing the 6.6 summary. Every exit path — success, escalation, abort — must cleanup; orphan teams poison the next session's precondition check.

1. \`team_shutdown_request\` for each member, then \`team_approve_shutdown\` if members do not self-approve within a reasonable window.
2. \`team_delete(teamRunId=<id>)\`.
3. \`team_list\` to confirm no residual \`refactor-squad\` run.

The \`~/.omo/teams/refactor-squad/config.json\` declaration stays on disk; next session reuses it.

Append to the 6.6 summary a "Dispatch path" line and, when team path was used, team metrics (teamRunId, tasks created, verifier runs, team lifetime).

## MUST NOT (team mode)

- Lead never edits files directly — orchestrate only.
- Do not inline the Intent Card or verify-spec into task descriptions — rely on the broadcasts.
- Do not recreate the team mid-session.
- Do not run tests from Lead — the external verifier owns that lane.
- Do not put \`oracle\` / \`librarian\` / \`deep\` into the team spec — oracle/librarian are team-ineligible, and \`deep\` under category routing downcasts to sisyphus-junior. Use them via \`task()\` outside the team when needed.
`
