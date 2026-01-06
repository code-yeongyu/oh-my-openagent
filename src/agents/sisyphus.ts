import type { AgentConfig } from "@opencode-ai/sdk"
import { getModelCapabilities } from "./model-capabilities"
import { getPromptDialect, type PromptDialect } from "./prompt-dialect"
import { buildClaudeSisyphusPrompt } from "./sisyphus-claude"
import { buildCodexSisyphusPrompt } from "./sisyphus-codex"
import type { AvailableAgent, AvailableTool, AvailableSkill } from "./sisyphus-prompt-builder"
import {
  buildKeyTriggersSection,
  buildToolSelectionTable,
  buildExploreSection,
  buildLibrarianSection,
  buildDelegationTable,
  buildFrontendSection,
  buildOracleSection,
  buildHardBlocksSection,
  buildAntiPatternsSection,
  categorizeTools,
} from "./sisyphus-prompt-builder"

const DEFAULT_MODEL = "anthropic/claude-opus-4-5"

function buildSisyphusRoleSection(dialect: PromptDialect): string {
  return `<Role>
You are "Sisyphus" - Powerful AI Agent with orchestration capabilities from OhMyOpenCode.

**Why Sisyphus?**: Humans roll their boulder every day. So do you. We're not so different—your code should be indistinguishable from a senior engineer's.

**Identity**: SF Bay Area engineer. Work, delegate, verify, ship. No AI slop.

**Core Competencies**:
- Parsing implicit requirements from explicit requests
- Adapting to codebase maturity (disciplined vs chaotic)
- Delegating specialized work to the right subagents
- Parallel execution for maximum throughput
${dialect.implementationPolicy}
${dialect.executionPolicy}

**Operating Mode**: You NEVER work alone when specialists are available. Frontend work → delegate. Deep research → parallel background agents (async subagents). Complex architecture → consult Oracle.

</Role>`
}

const SISYPHUS_DELEGATION_PROMPT_STRUCTURE = `### Delegation Prompt Structure (MANDATORY - ALL 7 sections):

When delegating, your prompt MUST include:

\`\`\`
1. TASK: Atomic, specific goal (one action per delegation)
2. EXPECTED OUTCOME: Concrete deliverables with success criteria
3. REQUIRED SKILLS: Which skill to invoke
4. REQUIRED TOOLS: Explicit tool whitelist (prevents tool sprawl)
5. MUST DO: Exhaustive requirements - leave NOTHING implicit
6. MUST NOT DO: Forbidden actions - anticipate and block rogue behavior
7. CONTEXT: File paths, existing patterns, constraints
\`\`\`

AFTER THE WORK YOU DELEGATED SEEMS DONE, ALWAYS VERIFY THE RESULTS AS FOLLOWING:
- DOES IT WORK AS EXPECTED?
- DOES IT FOLLOWED THE EXISTING CODEBASE PATTERN?
- EXPECTED RESULT CAME OUT?
- DID THE AGENT FOLLOWED "MUST DO" AND "MUST NOT DO" REQUIREMENTS?

**Vague prompts = rejected. Be exhaustive.**`

const SISYPHUS_SOFT_GUIDELINES = `## Soft Guidelines

- Prefer existing libraries over new dependencies
- Prefer small, focused changes over large refactors
- When uncertain about scope, ask
</Constraints>

`

function buildDynamicSisyphusPrompt(
  availableAgents: AvailableAgent[],
  availableTools: AvailableTool[] = [],
  availableSkills: AvailableSkill[] = [],
  dialect: PromptDialect,
  options: { codexOptimized?: boolean } = {}
): string {
  const roleSection = buildSisyphusRoleSection(dialect)
  const keyTriggers = buildKeyTriggersSection(availableAgents, availableSkills)
  const toolSelection = buildToolSelectionTable(availableAgents, availableTools, availableSkills)
  const exploreSection = buildExploreSection(availableAgents)
  const librarianSection = buildLibrarianSection(availableAgents)
  const frontendSection = buildFrontendSection(availableAgents)
  const delegationTable = buildDelegationTable(availableAgents)
  const oracleSection = buildOracleSection(availableAgents)
  const hardBlocks = buildHardBlocksSection(availableAgents)
  const antiPatterns = buildAntiPatternsSection(availableAgents)

  if (options.codexOptimized) {
    return buildCodexSisyphusPrompt({
      roleSection,
      keyTriggers,
      toolSelection,
      exploreSection,
      librarianSection,
      frontendSection,
      delegationTable,
      delegationPromptStructure: SISYPHUS_DELEGATION_PROMPT_STRUCTURE,
      oracleSection,
      hardBlocks,
      antiPatterns,
      softGuidelines: SISYPHUS_SOFT_GUIDELINES,
    })
  }

  return buildClaudeSisyphusPrompt({
    roleSection,
    keyTriggers,
    toolSelection,
    exploreSection,
    librarianSection,
    frontendSection,
    delegationTable,
    delegationPromptStructure: SISYPHUS_DELEGATION_PROMPT_STRUCTURE,
    oracleSection,
    hardBlocks,
    antiPatterns,
    softGuidelines: SISYPHUS_SOFT_GUIDELINES,
  })
}

export function createSisyphusAgent(
  model: string = DEFAULT_MODEL,
  availableAgents?: AvailableAgent[],
  availableToolNames?: string[],
  availableSkills?: AvailableSkill[]
): AgentConfig {
  const tools = availableToolNames ? categorizeTools(availableToolNames) : []
  const skills = availableSkills ?? []
  const dialect = getPromptDialect(model)
  const useCodexOptimized = model.toLowerCase().includes("codex")
  const prompt = availableAgents
    ? buildDynamicSisyphusPrompt(availableAgents, tools, skills, dialect, { codexOptimized: useCodexOptimized })
    : buildDynamicSisyphusPrompt([], tools, skills, dialect, { codexOptimized: useCodexOptimized })

  const base = {
    description:
      "Sisyphus - Powerful AI orchestrator from OhMyOpenCode. Plans obsessively with todos, assesses search complexity before exploration, delegates strategically to specialized agents. Uses explore for internal code (parallel-friendly), librarian only for external docs, and always delegates UI work to frontend engineer.",
    mode: "primary" as const,
    model,
    maxTokens: 64000,
    prompt,
    color: "#00CED1",
  }

  const capabilities = getModelCapabilities(model)
  if (capabilities.supportsReasoningEffort) {
    return { ...base, reasoningEffort: "medium" }
  }

  if (capabilities.supportsThinking) {
    return { ...base, thinking: { type: "enabled", budgetTokens: 32000 } }
  }

  return base
}

export const sisyphusAgent = createSisyphusAgent()
