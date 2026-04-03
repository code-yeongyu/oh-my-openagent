import type {
  AvailableAgent,
  AvailableCategory,
  AvailableSkill,
} from "./dynamic-agent-prompt-types"
import type { AvailableTool } from "./dynamic-agent-prompt-types"
import { getToolsPromptDisplay } from "./dynamic-agent-tool-categorization"

export function buildKeyTriggersSection(
  agents: AvailableAgent[],
  _skills: AvailableSkill[] = [],
): string {
  const keyTriggers = agents
    .filter((agent) => agent.metadata.keyTrigger)
    .map((agent) => `- ${agent.metadata.keyTrigger}`)

  if (keyTriggers.length === 0) {
    return ""
  }

  return `### Key Triggers (check BEFORE classification):

${keyTriggers.join("\n")}
- **"Look into" + "create PR"** → Not just research. Full implementation cycle expected.`
}

export function buildToolSelectionTable(
  agents: AvailableAgent[],
  tools: AvailableTool[] = [],
  _skills: AvailableSkill[] = [],
): string {
  const rows: string[] = ["### Tool & Agent Selection:", ""]

  if (tools.length > 0) {
    rows.push(
      `- ${getToolsPromptDisplay(tools)} - **FREE** - Not Complex, Scope Clear, No Implicit Assumptions`,
    )
  }

  const costOrder = { FREE: 0, CHEAP: 1, EXPENSIVE: 2 }
  const sortedAgents = [...agents]
    .filter((agent) => agent.metadata.category !== "utility")
    .sort(
      (left, right) => costOrder[left.metadata.cost] - costOrder[right.metadata.cost],
    )

  for (const agent of sortedAgents) {
    const shortDescription = agent.description.split(".")[0] || agent.description
    rows.push(
      `- \`${agent.name}\` agent - **${agent.metadata.cost}** - ${shortDescription}`,
    )
  }

  rows.push("")
  rows.push("**Default flow**: explore/librarian (background) + tools → oracle (if required)")

  return rows.join("\n")
}

export function buildExploreSection(agents: AvailableAgent[]): string {
  const exploreAgent = agents.find((agent) => agent.name === "explore")
  if (!exploreAgent) {
    return ""
  }

  const useWhen = exploreAgent.metadata.useWhen || []
  const avoidWhen = exploreAgent.metadata.avoidWhen || []

  return `### Explore Agent = Contextual Grep

Use it as a **peer tool**, not a fallback. Fire liberally for discovery, not for files you already know.

**Delegation Trust Rule:** Once you fire an explore agent for a search, do **not** manually perform that same search yourself. Use direct tools only for non-overlapping work or when you intentionally skipped delegation.

**Use Direct Tools when:**
${avoidWhen.map((entry) => `- ${entry}`).join("\n")}

**Use Explore Agent when:**
${useWhen.map((entry) => `- ${entry}`).join("\n")}`
}

export function buildLibrarianSection(agents: AvailableAgent[]): string {
  const librarianAgent = agents.find((agent) => agent.name === "librarian")
  if (!librarianAgent) {
    return ""
  }

  const useWhen = librarianAgent.metadata.useWhen || []

  return `### Librarian Agent = Reference Grep

Search **external references** (docs, OSS, web). Fire proactively when unfamiliar libraries are involved.

**Contextual Grep (Internal)** - search OUR codebase, find patterns in THIS repo, project-specific logic.
**Reference Grep (External)** - search EXTERNAL resources, official API docs, library best practices, OSS implementation examples.

**Trigger phrases** (fire librarian immediately):
${useWhen.map((entry) => `- "${entry}"`).join("\n")}`
}

export function buildDelegationTable(agents: AvailableAgent[]): string {
  const rows: string[] = ["### Delegation Table:", ""]

  for (const agent of agents) {
    for (const trigger of agent.metadata.triggers) {
      rows.push(`- **${trigger.domain}** → \`${agent.name}\` - ${trigger.trigger}`)
    }
  }

  return rows.join("\n")
}

export function buildOracleSection(agents: AvailableAgent[]): string {
  const oracleAgent = agents.find((agent) => agent.name === "oracle")
  if (!oracleAgent) {
    return ""
  }

  const useWhen = oracleAgent.metadata.useWhen || []
  const avoidWhen = oracleAgent.metadata.avoidWhen || []

  return `<Oracle_Usage>
## Oracle - Read-Only High-IQ Consultant

Oracle is a read-only, expensive, high-quality reasoning model for debugging and architecture. Consultation only.

### WHEN to Consult (Oracle FIRST, then implement):

${useWhen.map((entry) => `- ${entry}`).join("\n")}

### WHEN NOT to Consult:

${avoidWhen.map((entry) => `- ${entry}`).join("\n")}

### Usage Pattern:
Briefly announce "Consulting Oracle for [reason]" before invocation.

**Exception**: This is the ONLY case where you announce before acting. For all other work, start immediately without status updates.

### Oracle Background Task Policy:

**Collect Oracle results before your final answer. No exceptions.**

**Oracle-dependent implementation is BLOCKED until Oracle finishes.**

- If you asked Oracle for architecture/debugging direction that affects the fix, do not implement before Oracle result arrives.
- While waiting, only do non-overlapping prep work. Never ship implementation decisions Oracle was asked to decide.
- Never "time out and continue anyway" for Oracle-dependent tasks.

- Oracle takes minutes. When done with your own work: **end your response** - wait for the \`<system-reminder>\`.
- Do NOT poll \`background_output\` on a running Oracle. The notification will come.
- Never cancel Oracle.
</Oracle_Usage>`
}

export function buildNonClaudePlannerSection(model: string): string {
  const isNonClaude = !model.toLowerCase().includes("claude")
  if (!isNonClaude) {
    return ""
  }

  return `### Plan Agent Dependency (Non-Claude)

Multi-step task? **ALWAYS consult Plan Agent first.** Do NOT start implementation without a plan.

- Single-file fix or trivial change → proceed directly
- Anything else (2+ steps, unclear scope, architecture) → \`task(subagent_type="plan", ...)\` FIRST
- Use \`session_id\` to resume the same Plan Agent - ask follow-up questions aggressively
- If ANY part of the task is ambiguous, ask Plan Agent before guessing

Plan Agent returns a structured work breakdown with parallel execution opportunities. Follow it.`
}

export function buildParallelDelegationSection(
  model: string,
  categories: AvailableCategory[],
): string {
  const isNonClaude = !model.toLowerCase().includes("claude")
  const hasDelegationCategory = categories.some(
    (category) => category.name === "deep" || category.name === "unspecified-high",
  )

  if (!isNonClaude || !hasDelegationCategory) {
    return ""
  }

  return `### DECOMPOSE AND DELEGATE - YOU ARE NOT AN IMPLEMENTER

**YOUR FAILURE MODE: You attempt to do work yourself instead of decomposing and delegating.** When you implement directly, the result is measurably worse than when specialized subagents do it. Subagents have domain-specific configurations, loaded skills, and tuned prompts that you lack.

**MANDATORY - for ANY implementation task:**

1. **ALWAYS decompose** the task into independent work units. No exceptions. Even if the task "feels small", decompose it.
2. **ALWAYS delegate** EACH unit to a \`deep\` or \`unspecified-high\` agent in parallel (\`run_in_background=true\`).
3. **NEVER work sequentially.** If 4 independent units exist, spawn 4 agents simultaneously. Not 1 at a time. Not 2 then 2.
4. **NEVER implement directly** when delegation is possible. You write prompts, not code.

**YOUR PROMPT TO EACH AGENT MUST INCLUDE:**
- GOAL with explicit success criteria (what "done" looks like)
- File paths and constraints (where to work, what not to touch)
- Existing patterns to follow (reference specific files the agent should read)
- Clear scope boundary (what is IN scope, what is OUT of scope)

**Vague delegation = failed delegation.** If your prompt to the subagent is shorter than 5 lines, it is too vague.

| You Want To Do | You MUST Do Instead |
|---|---|
| Write code yourself | Delegate to \`deep\` or \`unspecified-high\` agent |
| Handle 3 changes sequentially | Spawn 3 agents in parallel |
| "Quickly fix this one thing" | Still delegate - your "quick fix" is slower and worse than a subagent's |

**Your value is orchestration, decomposition, and quality control. Delegating with crystal-clear prompts IS your work.**`
}
