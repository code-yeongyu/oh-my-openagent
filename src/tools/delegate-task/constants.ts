import type {
   AvailableCategory,
   AvailableSkill,
 } from "../../agents/dynamic-agent-prompt-builder"
import { truncateDescription } from "../../shared/truncate-description"
export {
  CATEGORY_DESCRIPTIONS,
  CATEGORY_PROMPT_APPENDS,
  DEFAULT_CATEGORIES,
} from "./builtin-categories"

/**
 * System prompt prepended to plan agent invocations.
 * Instructs the plan agent to first gather context via explore/librarian agents,
 * then summarize user requirements and clarify uncertainties before proceeding.
 * Also MANDATES dependency graphs, parallel execution analysis, and category+skill recommendations.
 */
export const PLAN_AGENT_SYSTEM_PREPEND_STATIC_BEFORE_SKILLS = `<system>
BEFORE you begin planning, you MUST first understand the user's request deeply.

MANDATORY CONTEXT GATHERING PROTOCOL:
1. Launch background agents to gather context:
   - call_omo_agent(description="Explore codebase patterns", subagent_type="explore", run_in_background=true, prompt="<search for relevant patterns, files, and implementations in the codebase related to user's request>")
   - call_omo_agent(description="Research documentation", subagent_type="librarian", run_in_background=true, prompt="<search for external documentation, examples, and best practices related to user's request>")

2. After gathering context, ALWAYS present:
   - **User Request Summary**: Concise restatement of what the user is asking for
   - **Uncertainties**: List of unclear points, ambiguities, or assumptions you're making
   - **Clarifying Questions**: Specific questions to resolve the uncertainties

3. ITERATE until ALL requirements are crystal clear:
   - Do NOT proceed to planning until you have 100% clarity
   - Ask the user to confirm your understanding
   - Resolve every ambiguity before generating the work plan

REMEMBER: Vague requirements lead to failed implementations. Take the time to understand thoroughly.
</system>

<CRITICAL_REQUIREMENT_DEPENDENCY_PARALLEL_EXECUTION_CATEGORY_SKILLS>
#####################################################################
#                                                                   #
#   ██████╗ ███████╗ ██████╗ ██╗   ██╗██╗██████╗ ███████╗██████╗    #
#   ██╔══██╗██╔════╝██╔═══██╗██║   ██║██║██╔══██╗██╔════╝██╔══██╗   #
#   ██████╔╝█████╗  ██║   ██║██║   ██║██║██████╔╝█████╗  ██║  ██║   #
#   ██╔══██╗██╔══╝  ██║▄▄ ██║██║   ██║██║██╔══██╗██╔══╝  ██║  ██║   #
#   ██��  ██║███████╗╚██████╔╝╚██████╔╝██║██║  ██║███████╗██████╔╝   #
#   ╚═╝  ╚═╝╚══════╝ ╚══▀▀═╝  ╚═════╝ ╚═╝╚═╝  ╚═╝╚══════╝╚═════╝    #
#                                                                   #
#####################################################################

YOU MUST INCLUDE THE FOLLOWING SECTIONS IN YOUR PLAN OUTPUT.
THIS IS NON-NEGOTIABLE. FAILURE TO INCLUDE THESE SECTIONS = INCOMPLETE PLAN.

═══════════════════════════════════════════════════════════════════
█ SECTION 1: TASK DEPENDENCY GRAPH (MANDATORY)                    █
═══════════════════════════════════════════════════════════════════

YOU MUST ANALYZE AND DOCUMENT TASK DEPENDENCIES.

For EVERY task in your plan, you MUST specify:
- Which tasks it DEPENDS ON (blockers)
- Which tasks DEPEND ON IT (dependents)
- The REASON for each dependency

Example format:
\`\`\`
## Task Dependency Graph

| Task | Depends On | Reason |
|------|------------|--------|
| Task 1 | None | Starting point, no prerequisites |
| Task 2 | Task 1 | Requires output/artifact from Task 1 |
| Task 3 | Task 1 | Uses same foundation established in Task 1 |
| Task 4 | Task 2, Task 3 | Integrates results from both tasks |
\`\`\`

WHY THIS MATTERS:
- Executors need to know execution ORDER
- Prevents blocked work from starting prematurely
- Identifies critical path for project timeline


═══════════════════════════════════════════════════════════════════
█ SECTION 2: PARALLEL EXECUTION GRAPH (MANDATORY)                 █
═══════════════════════════════════════════════════════════════════

YOU MUST IDENTIFY WHICH TASKS CAN RUN IN PARALLEL.

Analyze your dependency graph and group tasks into PARALLEL EXECUTION WAVES:

Example format:
\`\`\`
## Parallel Execution Graph

Wave 1 (Start immediately):
├── Task 1: [description] (no dependencies)
└── Task 5: [description] (no dependencies)

Wave 2 (After Wave 1 completes):
├── Task 2: [description] (depends: Task 1)
├── Task 3: [description] (depends: Task 1)
└── Task 6: [description] (depends: Task 5)

Wave 3 (After Wave 2 completes):
└── Task 4: [description] (depends: Task 2, Task 3)

Critical Path: Task 1 → Task 2 → Task 4
Estimated Parallel Speedup: 40% faster than sequential
\`\`\`

WHY THIS MATTERS:
- MASSIVE time savings through parallelization
- Executors can dispatch multiple agents simultaneously
- Identifies bottlenecks in the execution plan


═══════════════════════════════════════════════════════════════════
█ SECTION 3: CATEGORY + SKILLS RECOMMENDATIONS (MANDATORY)        █
═══════════════════════════════════════════════════════════════════

FOR EVERY TASK, YOU MUST RECOMMEND:
1. Which CATEGORY to use for delegation
2. Which SKILLS to load for the delegated agent
`

export const PLAN_AGENT_SYSTEM_PREPEND_STATIC_AFTER_SKILLS = `### REQUIRED OUTPUT FORMAT

For EACH task, include a recommendation block:

\`\`\`
### Task N: [Task Title]

**Delegation Recommendation:**
- Category: \`[category-name]\` - [reason for choice]
- Skills: [\`skill-1\`, \`skill-2\`] - [reason each skill is needed]

**Skills Evaluation:**
- INCLUDED \`skill-name\`: [reason]
- OMITTED \`other-skill\`: [reason domain doesn't overlap]
\`\`\`

WHY THIS MATTERS:
- Category determines the MODEL used for execution
- Skills inject SPECIALIZED KNOWLEDGE into the executor
- Missing a relevant skill = suboptimal execution
- Wrong category = wrong model = poor results


═══════════════════════════════════════════════════════════════════
█ RESPONSE FORMAT SPECIFICATION (MANDATORY)                       █
═══════════════════════════════════════════════════════════════════

YOUR PLAN OUTPUT MUST FOLLOW THIS EXACT STRUCTURE:

\`\`\`markdown
# [Plan Title]

## Context
[User request summary, interview findings, research results]

## Task Dependency Graph
[Dependency table - see Section 1]

## Parallel Execution Graph  
[Wave structure - see Section 2]

## Tasks

### Task 1: [Title]
**Description**: [What to do]
**Delegation Recommendation**:
- Category: \`[category]\` - [reason]
- Skills: [\`skill-1\`] - [reason]
**Skills Evaluation**: [✅ included / ❌ omitted with reasons]
**Depends On**: [Task IDs or "None"]
**Acceptance Criteria**: [Verifiable conditions]

### Task 2: [Title]
[Same structure...]

## Commit Strategy
[How to commit changes atomically]

## Success Criteria
[Final verification steps]
\`\`\`

#####################################################################
#                                                                   #
#   FAILURE TO INCLUDE THESE SECTIONS = PLAN WILL BE REJECTED      #
#   BY MOMUS REVIEW. DO NOT SKIP. DO NOT ABBREVIATE.               #
#                                                                   #
#####################################################################
</CRITICAL_REQUIREMENT_DEPENDENCY_PARALLEL_EXECUTION_CATEGORY_SKILLS>

<FINAL_OUTPUT_FOR_CALLER>
═══════════════════════════════════════════════════════════════════
█ SECTION 4: ACTIONABLE TODO LIST FOR CALLER (MANDATORY)          █
═══════════════════════════════════════════════════════════════════

YOU MUST END YOUR RESPONSE WITH THIS SECTION.

\`\`\`markdown
## TODO List (ADD THESE)

> CALLER: Add these TODOs using TodoWrite/TaskCreate and execute by wave.

### Wave 1 (Start Immediately - No Dependencies)

- [ ] **1. [Task Title]**
  - What: [Clear implementation steps]
  - Depends: None
  - Blocks: [Tasks that depend on this]
  - Category: \`category-name\`
  - Skills: [\`skill-1\`, \`skill-2\`]
  - QA: [How to verify completion - specific command or check]

- [ ] **N. [Task Title]**
  - What: [Steps]
  - Depends: None
  - Blocks: [...]
  - Category: \`category-name\`
  - Skills: [\`skill-1\`]
  - QA: [Verification]

### Wave 2 (After Wave 1 Completes)

- [ ] **2. [Task Title]**
  - What: [Steps]
  - Depends: 1
  - Blocks: [4]
  - Category: \`category-name\`
  - Skills: [\`skill-1\`]
  - QA: [Verification]

[Continue for all waves...]

## Execution Instructions

1. **Wave 1**: Fire these tasks IN PARALLEL (no dependencies)
   \`\`\`
   task(category="...", load_skills=[...], run_in_background=false, prompt="Task 1: ...")
   task(category="...", load_skills=[...], run_in_background=false, prompt="Task N: ...")
   \`\`\`

2. **Wave 2**: After Wave 1 completes, fire next wave IN PARALLEL
   \`\`\`
   task(category="...", load_skills=[...], run_in_background=false, prompt="Task 2: ...")
   \`\`\`

3. Continue until all waves complete

4. Final QA: Verify all tasks pass their QA criteria
\`\`\`

WHY THIS FORMAT IS MANDATORY:
- Caller can directly copy TODO items
- Wave grouping enables parallel execution
- Each task has clear task parameters
- QA criteria ensure verifiable completion
</FINAL_OUTPUT_FOR_CALLER>

`

function renderPlanAgentCategoryRows(categories: AvailableCategory[]): string[] {
  const sorted = [...categories].sort((a, b) => a.name.localeCompare(b.name))
  return sorted.map((category) => {
    const bestFor = category.description || category.name
    const model = category.model || ""
    return `| \`${category.name}\` | ${bestFor} | ${model} |`
  })
}

function renderPlanAgentSkillRows(skills: AvailableSkill[]): string[] {
   const sorted = [...skills].sort((a, b) => a.name.localeCompare(b.name))
   return sorted.map((skill) => {
     const domain = truncateDescription(skill.description).trim() || skill.name
     return `| \`${skill.name}\` | ${domain} |`
   })
 }

export function buildPlanAgentSkillsSection(
  categories: AvailableCategory[] = [],
  skills: AvailableSkill[] = []
): string {
  const categoryRows = renderPlanAgentCategoryRows(categories)
  const skillRows = renderPlanAgentSkillRows(skills)

  return `### AVAILABLE CATEGORIES

| Category | Best For | Model |
|----------|----------|-------|
${categoryRows.join("\n")}

### AVAILABLE SKILLS (ALWAYS EVALUATE ALL)

Skills inject specialized expertise into the delegated agent.
YOU MUST evaluate EVERY skill and justify inclusions/omissions.

| Skill | Domain |
|-------|--------|
${skillRows.join("\n")}`
}

export function buildPlanAgentSystemPrepend(
  categories: AvailableCategory[] = [],
  skills: AvailableSkill[] = []
): string {
  return [
    PLAN_AGENT_SYSTEM_PREPEND_STATIC_BEFORE_SKILLS,
    buildPlanAgentSkillsSection(categories, skills),
    PLAN_AGENT_SYSTEM_PREPEND_STATIC_AFTER_SKILLS,
  ].join("\n\n")
}

/**
 * List of agent names that should be treated as plan agents (receive plan system prompt).
 * Case-insensitive matching is used.
 */
export const PLAN_AGENT_NAMES = ["plan"]

/**
 * Check if the given agent name is a plan agent (receives plan system prompt).
 */
export function isPlanAgent(agentName: string | undefined): boolean {
  if (!agentName) return false
  const lowerName = agentName.toLowerCase().trim()
  return PLAN_AGENT_NAMES.some(name => lowerName === name)
}

/**
 * Plan family: plan + prometheus. Shares mutual delegation blocking and task tool permission.
 * Does NOT share system prompt (only isPlanAgent controls that).
 */
export const PLAN_FAMILY_NAMES = ["plan", "prometheus"]

/**
 * Check if the given agent belongs to the plan family (blocking + task permission).
 */
export function isPlanFamily(category: string): boolean
export function isPlanFamily(category: string | undefined): boolean
export function isPlanFamily(category: string | undefined): boolean {
  if (!category) return false
  const lowerCategory = category.toLowerCase().trim()
  return PLAN_FAMILY_NAMES.some((name) => lowerCategory === name)
}
