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
  executeUserPromptSubmitHooks,
  type UserPromptSubmitContext,
  type MessagePart,
} from "./user-prompt-submit"
import {
  executeStopHooks,
  type StopContext,
} from "./stop"
import { cacheToolInput, getToolInput } from "./tool-input-cache"
import { getTranscriptPath } from "./transcript"
import { log } from "../../shared"
import { injectHookMessage } from "../../features/hook-message-injector"

export function createClaudeCodeHooksHook(ctx: PluginInput) {
  const sessionFirstMessageProcessed = new Set<string>()

  return {
    "chat.message": async (
      input: {
        sessionID: string
        agent?: string
        model?: { providerID: string; modelID: string }
        messageID?: string
      },
      output: {
        message: Record<string, unknown>
        parts: Array<{ type: string; text?: string; [key: string]: unknown }>
      }
    ): Promise<void> => {
      try {
        const claudeConfig = await loadClaudeHooksConfig()
        const extendedConfig = await loadPluginExtendedConfig()

        const textParts = output.parts.filter((p) => p.type === "text" && p.text)
        const prompt = textParts.map((p) => p.text ?? "").join("\n")

        const isFirstMessage = !sessionFirstMessageProcessed.has(input.sessionID)
        sessionFirstMessageProcessed.add(input.sessionID)

        if (isFirstMessage) {
          log("[Claude Hooks] Skipping UserPromptSubmit on first message for title generation")
          return
        }

        let parentSessionId: string | undefined
        try {
          const sessionInfo = await ctx.client.session.get({
            path: { id: input.sessionID },
          })
          parentSessionId = sessionInfo.data?.parentID
        } catch {}

        const messageParts: MessagePart[] = textParts.map((p) => ({
          type: p.type as "text",
          text: p.text,
        }))

        const userPromptCtx: UserPromptSubmitContext = {
          sessionId: input.sessionID,
          parentSessionId,
          prompt,
          parts: messageParts,
          cwd: ctx.directory,
        }

        const result = await executeUserPromptSubmitHooks(
          userPromptCtx,
          claudeConfig,
          extendedConfig
        )

        if (result.block) {
          throw new Error(result.reason ?? "Hook blocked the prompt")
        }

        if (result.messages.length > 0) {
          const hookContent = result.messages.join("\n\n")
          const message = output.message as {
            agent?: string
            model?: { modelID?: string; providerID?: string }
            path?: { cwd?: string; root?: string }
            tools?: Record<string, boolean>
          }

          const success = injectHookMessage(input.sessionID, hookContent, {
            agent: message.agent,
            model: message.model,
            path: message.path ?? { cwd: ctx.directory, root: "/" },
            tools: message.tools,
          })

          log(
            success
              ? "[Claude Hooks] Hook message injected via file system"
              : "[Claude Hooks] File injection failed",
            { sessionID: input.sessionID }
          )
        }
      } catch (error) {
        log("[Claude Hooks] chat.message error:", error)
        throw error
      }
    },

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
