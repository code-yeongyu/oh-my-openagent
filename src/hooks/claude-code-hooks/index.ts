import type { PluginInput } from "@opencode-ai/plugin"
import { loadClaudeHooksConfig } from "./config"
import { loadPluginExtendedConfig } from "./config-loader"
import {
  executePreToolUseHooks,
  type PreToolUseContext,
} from "./pre-tool-use"
import {
  executePostToolUseHooks,
  type PostToolUseContext,
  type PostToolUseClient,
} from "./post-tool-use"
import {
  executeStopHooks,
  type StopContext,
} from "./stop"
import { cacheToolInput, getToolInput } from "./tool-input-cache"
import { getTranscriptPath } from "./transcript"
import { log } from "../../shared"

export function createClaudeCodeHooksHook(ctx: PluginInput) {

  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> }
    ): Promise<void> => {
      try {
        const claudeConfig = await loadClaudeHooksConfig()
        const extendedConfig = await loadPluginExtendedConfig()

        const preCtx: PreToolUseContext = {
          sessionId: input.sessionID,
          toolName: input.tool,
          toolInput: output.args,
          cwd: ctx.directory,
          transcriptPath: getTranscriptPath(input.sessionID),
          toolUseId: input.callID,
        }

        cacheToolInput(input.sessionID, input.tool, input.callID, output.args)

        const result = await executePreToolUseHooks(preCtx, claudeConfig, extendedConfig)

        if (result.decision === "deny") {
          throw new Error(result.reason || "Tool execution denied by PreToolUse hook")
        }

        if (result.decision === "ask") {
          log(`[Claude Hooks] PreToolUse hook returned "ask" decision, but OpenCode doesn't support interactive prompts. Allowing by default.`)
        }

        if (result.modifiedInput) {
          output.args = result.modifiedInput
        }
      } catch (error) {
        log(`[Claude Hooks] PreToolUse error:`, error)
        throw error
      }
    },

    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: unknown }
    ): Promise<void> => {
      try {
        const claudeConfig = await loadClaudeHooksConfig()
        const extendedConfig = await loadPluginExtendedConfig()

        const cachedInput = getToolInput(input.sessionID, input.tool, input.callID) || {}

        const postClient: PostToolUseClient = {
          session: {
            messages: (opts) => ctx.client.session.messages(opts),
          },
        }

        const postCtx: PostToolUseContext = {
          sessionId: input.sessionID,
          toolName: input.tool,
          toolInput: cachedInput,
          toolOutput: {
            title: output.title,
            output: output.output,
            metadata: output.metadata,
          },
          cwd: ctx.directory,
          transcriptPath: getTranscriptPath(input.sessionID),
          toolUseId: input.callID,
          client: postClient,
        }

        const result = await executePostToolUseHooks(postCtx, claudeConfig, extendedConfig)

        if (result.message) {
          output.output += `\n\n${result.message}`
        }

        if (result.block) {
          throw new Error(result.reason || "Tool execution blocked by PostToolUse hook")
        }
      } catch (error) {
        log(`[Claude Hooks] PostToolUse error:`, error)
      }
    },

    event: async (input: { event: { type: string; properties?: unknown } }) => {
      const { event } = input

      if (event.type === "session.idle") {
        try {
          const claudeConfig = await loadClaudeHooksConfig()
          const extendedConfig = await loadPluginExtendedConfig()

          const props = event.properties as Record<string, unknown> | undefined
          const sessionID = props?.sessionID as string | undefined

          if (!sessionID) return

          const stopCtx: StopContext = {
            sessionId: sessionID,
            cwd: ctx.directory,
            transcriptPath: getTranscriptPath(sessionID),
          }

          const result = await executeStopHooks(stopCtx, claudeConfig, extendedConfig)

          if (result.injectPrompt) {
            await ctx.client.session.prompt({
              path: { id: sessionID },
              body: {
                parts: [{ type: "text", text: result.injectPrompt }],
              },
              query: { directory: ctx.directory },
            }).catch((err) => {
              log(`[Claude Hooks] Failed to inject prompt from Stop hook:`, err)
            })
          }
        } catch (error) {
          log(`[Claude Hooks] Stop hook error:`, error)
        }
      }
    },
  }
}
