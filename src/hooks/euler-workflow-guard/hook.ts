import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared"
import {
  loadWorkflowState,
  validatePhasePrerequisites,
  type WorkflowPhase,
} from "../../features/euler-workflow-state"

const CREDIT_AGENTS = [
  "credit-planner",
  "credit-plan-reviewer",
  "credit-executor",
  "credit-tester",
  "credit-server",
] as const

type CreditAgent = (typeof CREDIT_AGENTS)[number]

const AGENT_TO_PHASE: Record<CreditAgent, WorkflowPhase> = {
  "credit-planner": "planning",
  "credit-plan-reviewer": "reviewing",
  "credit-executor": "executing",
  "credit-server": "deploying",
  "credit-tester": "testing",
}

function isCreditAgent(agentType: string): agentType is CreditAgent {
  return CREDIT_AGENTS.includes(agentType as CreditAgent)
}

function getPhaseForAgent(agentType: CreditAgent): WorkflowPhase {
  return AGENT_TO_PHASE[agentType]
}

export function createEulerWorkflowGuardHook(ctx: PluginInput): Hooks {
  return {
    "tool.execute.before": async (input, output) => {
      const toolName = input.tool?.toLowerCase()

      if (toolName !== "call_omo_agent") {
        return
      }

      const args = output.args as { subagent_type?: string } | undefined
      const agentType = args?.subagent_type?.toLowerCase()

      if (!agentType || !isCreditAgent(agentType)) {
        return
      }

      const targetPhase = getPhaseForAgent(agentType)
      const state = loadWorkflowState(ctx.directory)

      log("[euler-workflow-guard] Validating phase transition:", {
        agent: agentType,
        targetPhase,
        currentPhase: state.phase,
      })

      const validation = validatePhasePrerequisites(ctx.directory, targetPhase)

      if (!validation.valid) {
        const error = `WORKFLOW GUARD: Cannot invoke ${agentType}. Missing prerequisites: ${validation.missing.join(", ")}`
        log("[euler-workflow-guard] BLOCKED:", { error })
        throw new Error(error)
      }

      log("[euler-workflow-guard] ALLOWED:", { agent: agentType, phase: targetPhase })
    },
  }
}
