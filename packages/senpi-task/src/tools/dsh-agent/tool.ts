import { defineTool, type ToolDefinition } from "@code-yeongyu/senpi"

import { toolResult } from "../control/tool-result"
import { CallDshAgentParams } from "./params"
import type { CallDshAgentDeps, CallDshAgentDetails } from "./types"

export const CALL_DSH_AGENT_TOOL_NAME = "call_dsh_agent"

const DSH_AGENT_DESCRIPTION =
  "Delegate a subtask to a DeepSeek Harness (dsh) agent over the Agent Client Protocol. " +
  "Spawns a fresh dsh ACP child process, sends the prompt, and returns the agent's committed " +
  "final text. Use for self-contained execution subtasks that need no parent conversation " +
  "context. The child starts with no inherited context; give it everything it needs in the prompt."

export function createCallDshAgentTool(deps: CallDshAgentDeps): ToolDefinition<typeof CallDshAgentParams, CallDshAgentDetails> {
  return defineTool({
    name: CALL_DSH_AGENT_TOOL_NAME,
    label: "Call DSH Agent",
    description: DSH_AGENT_DESCRIPTION,
    parameters: CallDshAgentParams,
    execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
      const outcome = await deps.runner.run({
        prompt: params.prompt,
        ...(params.cwd === undefined ? {} : { cwd: params.cwd }),
        ...(params.verify === undefined ? {} : { verify: params.verify }),
        ...(ctx.signal !== undefined ? { abort: ctx.signal } : {}),
      })
      const verifyRequested = params.verify !== undefined
      const title = verifyRequested
        ? `dsh agent (${outcome.verified ? "verified" : "VERIFICATION FAILED"})`
        : `dsh agent (${outcome.stopReason === "completed" ? `exit ${outcome.exitCode ?? "n/a"}` : outcome.stopReason})`
      const details: CallDshAgentDetails = {
        stopReason: outcome.stopReason,
        exitCode: outcome.exitCode,
        verified: outcome.verified,
        ...(outcome.verify === undefined ? {} : { verify: outcome.verify }),
        ...(outcome.evidence === undefined ? {} : { evidence: outcome.evidence }),
      }
      return toolResult(`${title}\n\n${outcome.output}`, details)
    },
  })
}
