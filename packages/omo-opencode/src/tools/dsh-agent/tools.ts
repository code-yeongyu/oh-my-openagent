import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { PluginContext } from "../../plugin/types"
import type { DshConfig } from "../../config/schema/dsh"
import { runDshAcpAgent } from "./acp-client"
import { log } from "../../shared"

const DSH_AGENT_DESCRIPTION =
  "Delegate a subtask to a DeepSeek Harness (dsh) agent over the Agent Client Protocol. " +
  "Spawns a fresh dsh ACP child process, sends the prompt, and returns the agent's committed " +
  "final text. Use for self-contained execution subtasks that need no parent conversation " +
  "context. The child starts with no inherited context; give it everything it needs in the prompt."

export type DshAgentDeps = {
  readonly ctx: PluginContext
  readonly config: DshConfig
}

export function createDshAgentTool(deps: DshAgentDeps): ToolDefinition {
  const { ctx, config } = deps

  return tool({
    description: DSH_AGENT_DESCRIPTION,
    args: {
      prompt: tool.schema.string().describe("Standalone task content for the dsh agent"),
      cwd: tool.schema
        .string()
        .optional()
        .describe("Working directory for the dsh agent; defaults to the session directory"),
    },
    async execute(args, toolContext) {
      const cwd = args.cwd ?? (config.cwd || ctx.directory)
      const startedAt = Date.now()
      log("[dsh-agent] starting ACP run", {
        sessionID: toolContext.sessionID,
        cwd,
        command: config.command,
      })

      const result = await runDshAcpAgent({
        command: config.command,
        args: config.args,
        cwd,
        prompt: args.prompt,
        permission: config.permission,
        timeoutMs: config.timeout_ms,
        abort: toolContext.abort,
      })

      log("[dsh-agent] ACP run settled", {
        sessionID: toolContext.sessionID,
        stopReason: result.stopReason,
        elapsedMs: Date.now() - startedAt,
        outputChars: result.output.length,
      })

      return {
        title: `dsh agent (${result.stopReason})`,
        output: result.output,
        metadata: { stopReason: result.stopReason },
      }
    },
  })
}
