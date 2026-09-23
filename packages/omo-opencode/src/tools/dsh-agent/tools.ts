import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { PluginContext } from "../../plugin/types"
import type { DshConfig } from "../../config/schema/dsh"
import { runDshAcpAgent } from "./acp-client"
import { runDshHeadless } from "./headless-runner"
import { runVerificationGate } from "./verify"
import { resolveDshAuth } from "./auth"
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
      verify: tool.schema
        .string()
        .optional()
        .describe("Deterministic verification command to run after the agent finishes, e.g. 'bun test' or 'bun run typecheck'"),
    },
    async execute(args, toolContext) {
      const cwd = args.cwd ?? (config.cwd || ctx.directory)
      const startedAt = Date.now()
      const auth = resolveDshAuth()
      const childEnv: Record<string, string | undefined> = {}
      if (auth.apiKey) {
        childEnv.DEEPSEEK_API_KEY = auth.apiKey
      }
      if (auth.baseUrl) {
        childEnv.DEEPSEEK_BASE_URL = auth.baseUrl
      }
      if (auth.model) {
        childEnv.DSH_MODEL = auth.model
      }
      log("[dsh-agent] starting run", {
        sessionID: toolContext.sessionID,
        cwd,
        mode: config.mode,
        command: config.command,
        auth: auth.apiKey ? "resolved" : "none",
      })

      let outputText = ""
      let stopReason = "completed"
      let exitCode: number | null = null

      if (config.mode === "acp") {
        const result = await runDshAcpAgent({
          command: config.command,
          args: [...config.args, "acp"],
          cwd,
          prompt: args.prompt,
          permission: config.permission,
          timeoutMs: config.timeout_ms,
          abort: toolContext.abort,
          env: childEnv,
        })
        outputText = result.output
        stopReason = result.stopReason
        log("[dsh-agent] ACP run settled", {
          sessionID: toolContext.sessionID,
          stopReason: result.stopReason,
          elapsedMs: Date.now() - startedAt,
          outputChars: result.output.length,
        })
      } else {
        const result = await runDshHeadless({
          command: config.command,
          args: config.args,
          cwd,
          prompt: args.prompt,
          timeoutMs: config.timeout_ms,
          abort: toolContext.abort,
          env: childEnv,
        })
        outputText = result.output
        exitCode = result.exitCode
        log("[dsh-agent] headless run settled", {
          sessionID: toolContext.sessionID,
          exitCode: result.exitCode,
          elapsedMs: Date.now() - startedAt,
          outputChars: result.output.length,
        })
      }

      if (!args.verify) {
        return {
          title: `dsh agent (${config.mode === "acp" ? stopReason : `exit ${exitCode ?? "n/a"}`})`,
          output: outputText,
          metadata: config.mode === "acp" ? { stopReason } : { exitCode },
        }
      }

      const verification = await runVerificationGate({
        cwd,
        command: args.verify,
        timeoutMs: config.timeout_ms,
        abort: toolContext.abort,
      })
      log("[dsh-agent] verification gate settled", {
        sessionID: toolContext.sessionID,
        verified: verification.verified,
        gate: args.verify,
        evidenceChars: verification.evidence.length,
      })
      const evidence = verification.evidence.slice(0, 1500)
      return {
        title: `dsh agent (${verification.verified ? "verified" : "VERIFICATION FAILED"})`,
        output: verification.verified
          ? outputText
          : `${outputText}\n\n--- VERIFICATION FAILED ---\n${evidence}\n--- END VERIFICATION ---`,
        metadata: {
          ...(config.mode === "acp" ? { stopReason } : { exitCode }),
          verified: verification.verified,
          verify: args.verify,
        },
      }
    },
  })
}
