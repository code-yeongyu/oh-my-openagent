/**
 * Agent Chains
 *
 * Predefined agent collaboration sequences for common workflows (Bugfix/Refactor)
 */

/**
 * Chain type enumeration
 */
export enum ChainType {
  BUGFIX = "bugfix",
  REFACTOR = "refactor",
}

/**
 * Agent chain step definition
 */
export interface AgentChainStep {
  agent: string
  purpose: string
  tools: string[]
}

/**
 * Agent chain definition
 */
export interface AgentChain {
  type: ChainType
  name: string
  description: string
  steps: AgentChainStep[]
}

/**
 * Execution context input
 */
export interface ExecutionContextInput {
  issue?: string
  files?: string[]
  description?: string
}

/**
 * Predefined chains
 */
const CHAINS: Record<ChainType, AgentChain> = {
  [ChainType.BUGFIX]: {
    type: ChainType.BUGFIX,
    name: "Bugfix Chain",
    description: "Systematic bug diagnosis and fix workflow",
    steps: [
      {
        agent: "explore",
        purpose: "Locate relevant code and understand the codebase structure",
        tools: ["grep", "glob", "ast_grep_search", "lsp_find_references"],
      },
      {
        agent: "oracle",
        purpose: "Diagnose the root cause and propose fix strategy",
        tools: ["read", "lsp_diagnostics"],
      },
      {
        agent: "implementer",
        purpose: "Implement the fix following TDD principles",
        tools: ["write", "edit", "bash"],
      },
      {
        agent: "verifier",
        purpose: "Verify the fix works and no regressions introduced",
        tools: ["bash", "lsp_diagnostics"],
      },
    ],
  },
  [ChainType.REFACTOR]: {
    type: ChainType.REFACTOR,
    name: "Refactor Chain",
    description: "Safe code refactoring with LSP-assisted transformations",
    steps: [
      {
        agent: "explore",
        purpose: "Locate all usages and understand impact scope",
        tools: ["grep", "lsp_find_references", "ast_grep_search"],
      },
      {
        agent: "oracle",
        purpose: "Analyze refactoring strategy and identify risks",
        tools: ["read", "lsp_diagnostics"],
      },
      {
        agent: "implementer",
        purpose: "Execute refactoring using LSP tools for safe renames",
        tools: ["lsp", "lsp_rename", "edit", "ast_grep_replace"],
      },
      {
        agent: "verifier",
        purpose: "Verify all tests pass and no type errors introduced",
        tools: ["bash", "lsp_diagnostics"],
      },
    ],
  },
}

/**
 * Agent Chain Manager interface
 */
export interface AgentChainManager {
  /** Check if a chain exists */
  hasChain(type: ChainType): boolean
  /** Get chain definition */
  getChain(type: ChainType): AgentChain
  /** Get chain with additional custom steps */
  getChainWithCustomSteps(type: ChainType, customSteps: AgentChainStep[]): AgentChain
  /** Get chain with skipped steps */
  getChainWithSkippedSteps(type: ChainType, skipAgents: string[]): AgentChain
  /** List all available chains */
  listChains(): ChainType[]
  /** Generate execution context for a chain */
  generateExecutionContext(type: ChainType, input: ExecutionContextInput): string
}

/**
 * Agent Chain Manager implementation
 */
class AgentChainManagerImpl implements AgentChainManager {
  hasChain(type: ChainType): boolean {
    return type in CHAINS
  }

  getChain(type: ChainType): AgentChain {
    if (!this.hasChain(type)) {
      const available = this.listChains().join(", ")
      throw new Error(`Unknown chain type: "${type}". Available chains: ${available}`)
    }
    return {
      ...CHAINS[type],
      steps: [...CHAINS[type].steps],
    }
  }

  getChainWithCustomSteps(type: ChainType, customSteps: AgentChainStep[]): AgentChain {
    const chain = this.getChain(type)
    return {
      ...chain,
      steps: [...chain.steps, ...customSteps],
    }
  }

  getChainWithSkippedSteps(type: ChainType, skipAgents: string[]): AgentChain {
    const chain = this.getChain(type)
    return {
      ...chain,
      steps: chain.steps.filter((step) => !skipAgents.includes(step.agent)),
    }
  }

  listChains(): ChainType[] {
    return Object.values(ChainType)
  }

  generateExecutionContext(type: ChainType, input: ExecutionContextInput): string {
    const chain = this.getChain(type)
    const lines: string[] = []

    lines.push(`## ${chain.name} Execution Plan`)
    lines.push("")

    if (input.issue) {
      lines.push(`**Issue**: ${input.issue}`)
    }
    if (input.files && input.files.length > 0) {
      lines.push(`**Target Files**: ${input.files.join(", ")}`)
    }
    if (input.description) {
      lines.push(`**Description**: ${input.description}`)
    }

    lines.push("")
    lines.push("### Execution Steps")
    lines.push("")

    for (let i = 0; i < chain.steps.length; i++) {
      const step = chain.steps[i]
      lines.push(`${i + 1}. **${step.agent}**: ${step.purpose}`)
      lines.push(`   - Tools: ${step.tools.join(", ")}`)
    }

    return lines.join("\n")
  }
}

/**
 * Create a new Agent Chain Manager instance
 */
export function createAgentChainManager(): AgentChainManager {
  return new AgentChainManagerImpl()
}
