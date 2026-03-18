import { consumeToolMetadata } from "../features/tool-metadata-store"
import type { CreatedHooks } from "../create-hooks"
import { log } from "../shared"
import type { PluginContext } from "./types"
import { readState, writeState } from "../hooks/ralph-loop/storage"

const VERIFICATION_ATTEMPT_PATTERN = /<ulw_verification_attempt_id>(.*?)<\/ulw_verification_attempt_id>/i

function getMetadataString(metadata: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = metadata?.[key]
    if (typeof value === "string") {
      return value
    }
  }

  return undefined
}

function getPluginDirectory(ctx: PluginContext): string | null {
  if (typeof ctx === "object" && ctx !== null && "directory" in ctx && typeof ctx.directory === "string") {
    return ctx.directory
  }

  return null
}

export function createToolExecuteAfterHandler(args: {
  ctx: PluginContext
  hooks: CreatedHooks
}): (
  input: { tool: string; sessionID: string; callID: string },
  output:
    | { title: string; output: string; metadata: Record<string, unknown> }
    | undefined,
) => Promise<void> {
  const { ctx, hooks } = args

  return async (
    input: { tool: string; sessionID: string; callID: string },
    output: { title: string; output: string; metadata: Record<string, unknown> } | undefined,
  ): Promise<void> => {
    if (!output) return

    const stored = consumeToolMetadata(input.sessionID, input.callID)
    if (stored) {
      if (stored.title) {
        output.title = stored.title
      }
      if (stored.metadata) {
        output.metadata = { ...output.metadata, ...stored.metadata }
      }
    }

    if (input.tool === "task") {
      const directory = getPluginDirectory(ctx)
      const sessionId = getMetadataString(output.metadata, ["sessionId", "sessionID", "session_id"])
      const agent = getMetadataString(output.metadata, ["agent"])
      const prompt = getMetadataString(output.metadata, ["prompt"])
      const verificationAttemptId = prompt?.match(VERIFICATION_ATTEMPT_PATTERN)?.[1]?.trim()
      const loopState = directory ? readState(directory) : null
      const isVerificationContext =
        agent === "oracle"
        && !!sessionId
        && !!directory
        && loopState?.active === true
        && loopState.ultrawork === true
        && loopState.verification_pending === true
        && loopState.session_id === input.sessionID

      log("[tool-execute-after] ULW verification tracking check", {
        tool: input.tool,
        agent,
        parentSessionID: input.sessionID,
        oracleSessionID: sessionId,
        hasPromptInMetadata: typeof prompt === "string",
        extractedVerificationAttemptId: verificationAttemptId,
      })

      if (
        isVerificationContext
        && verificationAttemptId
        && loopState.verification_attempt_id === verificationAttemptId
      ) {
        writeState(directory, {
          ...loopState,
          verification_session_id: sessionId,
        })
        log("[tool-execute-after] Stored oracle verification session via attempt match", {
          parentSessionID: input.sessionID,
          oracleSessionID: sessionId,
          verificationAttemptId,
        })
      } else if (isVerificationContext && !verificationAttemptId) {
        writeState(directory, {
          ...loopState,
          verification_session_id: sessionId,
        })
        log("[tool-execute-after] Fallback: stored oracle verification session without attempt match", {
          parentSessionID: input.sessionID,
          oracleSessionID: sessionId,
          hasPromptInMetadata: typeof prompt === "string",
          expectedAttemptId: loopState.verification_attempt_id,
          extractedAttemptId: verificationAttemptId,
        })
      }
    }

    const runToolExecuteAfterHooks = async (): Promise<void> => {
      await hooks.toolOutputTruncator?.["tool.execute.after"]?.(input, output)
      await hooks.claudeCodeHooks?.["tool.execute.after"]?.(input, output)
      await hooks.preemptiveCompaction?.["tool.execute.after"]?.(input, output)
      await hooks.contextWindowMonitor?.["tool.execute.after"]?.(input, output)
      await hooks.commentChecker?.["tool.execute.after"]?.(input, output)
      await hooks.directoryAgentsInjector?.["tool.execute.after"]?.(input, output)
      await hooks.directoryReadmeInjector?.["tool.execute.after"]?.(input, output)
      await hooks.rulesInjector?.["tool.execute.after"]?.(input, output)
      await hooks.emptyTaskResponseDetector?.["tool.execute.after"]?.(input, output)
      await hooks.agentUsageReminder?.["tool.execute.after"]?.(input, output)
      await hooks.categorySkillReminder?.["tool.execute.after"]?.(input, output)
      await hooks.interactiveBashSession?.["tool.execute.after"]?.(input, output)
      await hooks.editErrorRecovery?.["tool.execute.after"]?.(input, output)
      await hooks.delegateTaskRetry?.["tool.execute.after"]?.(input, output)
      await hooks.atlasHook?.["tool.execute.after"]?.(input, output)
      await hooks.taskResumeInfo?.["tool.execute.after"]?.(input, output)
      await hooks.readImageResizer?.["tool.execute.after"]?.(input, output)
      await hooks.hashlineReadEnhancer?.["tool.execute.after"]?.(input, output)
      await hooks.jsonErrorRecovery?.["tool.execute.after"]?.(input, output)
    }

    if (input.tool === "extract" || input.tool === "discard") {
      const originalOutput = {
        title: output.title,
        output: output.output,
        metadata: { ...output.metadata },
      }

      try {
        await runToolExecuteAfterHooks()
      } catch (error) {
        output.title = originalOutput.title
        output.output = originalOutput.output
        output.metadata = originalOutput.metadata
        log("[tool-execute-after] Failed to process extract/discard hooks", {
          tool: input.tool,
          sessionID: input.sessionID,
          callID: input.callID,
          error,
        })
      }

      return
    }

    await runToolExecuteAfterHooks()
  }
}
