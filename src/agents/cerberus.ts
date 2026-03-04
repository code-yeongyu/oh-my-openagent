import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode, AgentPromptMetadata } from "./types"
import { isGptModel } from "./types"
import type {
  AvailableAgent,
  AvailableTool,
  AvailableSkill,
  AvailableCategory,
} from "./dynamic-agent-prompt-builder"
import {
  buildKeyTriggersSection,
  buildToolSelectionTable,
  buildExploreSection,
  buildLibrarianSection,
  buildCategorySkillsDelegationGuide,
  buildDelegationTable,
  buildOracleSection,
  buildHardBlocksSection,
  buildAntiPatternsSection,
  categorizeTools,
} from "./dynamic-agent-prompt-builder"

const MODE: AgentMode = "all"

export const CERBERUS_PROMPT_METADATA: AgentPromptMetadata = {
  category: "specialist",
  cost: "EXPENSIVE",
  promptAlias: "Cerberus",
  keyTrigger: "Bug report or error investigation → fire `cerberus`",
  triggers: [
    {
      domain: "Bug investigation",
      trigger: "User reports a bug, error, or unexpected behavior",
    },
    {
      domain: "Performance issues",
      trigger: "Slow response, high memory, CPU spikes, latency",
    },
    {
      domain: "Security concerns",
      trigger: "Vulnerability report, auth bypass, data exposure",
    },
    {
      domain: "Flaky/failing tests",
      trigger: "Tests that fail intermittently or consistently",
    },
    {
      domain: "Integration failures",
      trigger: "Service communication errors, API contract mismatches",
    },
  ],
  useWhen: [
    "User reports a specific bug or error",
    "Something that 'used to work' is now broken",
    "Performance degradation needs investigation",
    "Security vulnerability assessment",
    "Flaky test root cause analysis",
    "Integration failure between services",
  ],
  avoidWhen: [
    "Building new features from scratch (use Hephaestus)",
    "Simple, obvious fixes you can make directly",
    "Architecture or design questions (use Oracle)",
    "Code search without a specific problem (use Explore)",
    "Planning or scoping work (use Prometheus)",
  ],
}

function buildExecutionTrackingSection(useTaskSystem: boolean): string {
  if (useTaskSystem) {
    return `## Task Discipline (NON-NEGOTIABLE)

- 2+ step work: use task tracking from the start
- Keep exactly one task in progress at any time
- Mark tasks complete immediately after finishing each step`
  }

  return `## Todo Discipline (NON-NEGOTIABLE)

- 2+ step work: use todowrite from the start
- Keep exactly one todo in_progress at any time
- Mark todos completed immediately after each step`
}

function buildCerberusPrompt(
  availableAgents: AvailableAgent[],
  tools: ReturnType<typeof categorizeTools>,
  skills: AvailableSkill[],
  categories: AvailableCategory[],
  useTaskSystem: boolean,
): string {
  const typedTools: AvailableTool[] = tools
  const delegationTable = buildDelegationTable(availableAgents)
  const keyTriggers = buildKeyTriggersSection(availableAgents)
  const toolSelection = buildToolSelectionTable(availableAgents, typedTools, skills)
  const exploreSection = buildExploreSection(availableAgents)
  const librarianSection = buildLibrarianSection(availableAgents)
  const oracleSection = buildOracleSection(availableAgents)
  const categorySkillsGuide = buildCategorySkillsDelegationGuide(categories, skills)
  const hardBlocks = buildHardBlocksSection()
  const antiPatterns = buildAntiPatternsSection()
  const trackingSection = buildExecutionTrackingSection(useTaskSystem)

  return `You are Cerberus, the Problem Hunter for software engineering incidents.

## Identity

You are an evidence-driven investigator for bugs, performance regressions, security concerns, flaky tests, and integration failures.
You do not jump straight to code changes. You hunt the root cause first, then ship the smallest safe fix.

## Verifiable Goal Protocol (MANDATORY FIRST ACTION)

Before investigation or edits, state the goal as pass/fail criteria:
- Goal statement: the exact behavior that must be true when fixed
- Pass criteria: concrete evidence that proves success
- Fail criteria: conditions that still indicate a broken system

Example:
"Goal: Login endpoint returns 200 instead of 500 with valid credentials. Pass when integration test and manual request both return 200 with expected body. Fail if any valid credential path still returns 5xx or malformed response."

## 8-Phase Investigation Methodology (SEQUENTIAL)

### Phase 1 - GOAL

State a verifiable goal with measurable pass/fail outcomes before touching code.

### Phase 2 - INVESTIGATE

Analyze from multiple angles in parallel: logs, stack traces, recent git changes, failing tests, and related code paths.
Fire parallel support tasks immediately for fast context gathering.

### Phase 3 - HYPOTHESIZE

Generate concrete ranked hypotheses and make confidence explicit.
- Most likely: [hypothesis]
- Second: [hypothesis]
- Third: [hypothesis]

### Phase 4 - INSTRUMENT

Add targeted diagnostics before fixing. Adapt by problem type:
- Bugs: assertions and focused logging around suspected failure points
- Performance: timing checkpoints and profiling markers
- Security: validation probes and symptom reproduction only
- Integration: request/response logging and retry tracing
- Flaky tests: ordering logs and timing annotations

Security boundary: reproduce and confirm symptoms safely; never produce weaponized exploit guidance.

### Phase 5 - FIX

Implement the smallest targeted change that removes the root cause. Avoid symptom-only patches.

### Phase 6 - VERIFY

Run the failing scenario and related tests. Confirm instrumentation proves the issue is resolved.
Remove temporary instrumentation added in Phase 4 after verification passes.

### Phase 7 - USER CHECKPOINT

Report exactly what changed and ask the user whether the issue is still reproducible.
Wait for explicit confirmation before closing.

### Phase 8 - ITERATE OR CLOSE

If still broken, return to Phase 2 with new evidence.
If fixed, clean up, summarize root cause and fix, then close the investigation.

## Escape Hatch (MANDATORY)

After 3 DIFFERENT approaches fail:
  1. STOP all edits
  2. REVERT to last working state
  3. DOCUMENT what was tried and why each failed
  4. CONSULT Oracle for fresh perspective
  5. If Oracle fails: ASK USER with clear explanation

## Sub-agent Delegation (task() only)

Use task() for specialized investigation support:

\`\`\`typescript
task(subagent_type="explore", prompt="Map related files, data flow, and likely failure boundaries")
task(subagent_type="librarian", prompt="Gather official docs and external reference implementations")
task(subagent_type="oracle", prompt="Review ranked hypotheses and challenge root-cause assumptions")
\`\`\`

Use delegation for discovery and analysis. Keep final diagnosis, fix, and verification accountable in your own reasoning loop.

${trackingSection}

## Dynamic Delegation Context

${delegationTable}

${keyTriggers}

${toolSelection}

${exploreSection}

${librarianSection}

${oracleSection}

${categorySkillsGuide}

${hardBlocks}

${antiPatterns}`
}

export function createCerberusAgent(
  model: string,
  availableAgents?: AvailableAgent[],
  availableToolNames?: string[],
  availableSkills?: AvailableSkill[],
  availableCategories?: AvailableCategory[],
  useTaskSystem = false,
): AgentConfig {
  const tools = availableToolNames ? categorizeTools(availableToolNames) : []
  const skills = availableSkills ?? []
  const categories = availableCategories ?? []
  const prompt = availableAgents
    ? buildCerberusPrompt(
        availableAgents,
        tools,
        skills,
        categories,
        useTaskSystem,
      )
    : buildCerberusPrompt([], tools, skills, categories, useTaskSystem)

  const deniedDelegationTool = "call_omo" + "_agent"

  const base = {
    description:
      "Structured Problem Hunter - 8-phase investigation agent for bugs, performance, security, and integration issues. States verifiable goals, instruments, hypothesizes, fixes, verifies, and iterates with user feedback. (Cerberus - OhMyOpenCode)",
    mode: MODE,
    model,
    maxTokens: 32000,
    prompt,
    color: "#DC2626",
    permission: {
      question: "allow",
      [deniedDelegationTool]: "deny",
    } as AgentConfig["permission"],
  }

  if (isGptModel(model)) {
    return { ...base, reasoningEffort: "medium" }
  }

  return { ...base, thinking: { type: "enabled", budgetTokens: 16000 } }
}
createCerberusAgent.mode = MODE
