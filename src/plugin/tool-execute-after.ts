import { recoverToolMetadata } from "../features/tool-metadata-store"
import type { CreatedHooks } from "../create-hooks"
import { log } from "../shared/logger"
import { stripInvisibleAgentCharacters } from "../shared/agent-display-names"
import type { PluginContext } from "./types"

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

  // OpenCode injects tool call ids into execute() context and after-hook input via undocumented runtime fields.
  // We must treat their identity as a best-effort correlation key, not a guaranteed public contract.

  return async (
    input: { tool: string; sessionID: string; callID?: string; callId?: string; call_id?: string },
    output: { title: string; output: string; metadata: Record<string, unknown> } | undefined,
  ): Promise<void> => {
    if (!output) return

    const hookInput = {
      tool: input.tool,
      sessionID: input.sessionID,
      callID: input.callID ?? input.callId ?? input.call_id ?? "",
    }

    const nativeSessionId = getMetadataString(output.metadata, ["sessionId", "sessionID", "session_id"])
    const stored = recoverToolMetadata(input.sessionID, input)
    if (stored) {
      if (stored.title) {
        output.title = stored.title
      }
      if (stored.metadata) {
        if (nativeSessionId) {
          log("[tool-execute-after] Native output metadata already includes session linkage; skipping stored metadata overwrite", {
            tool: input.tool,
            sessionID: input.sessionID,
            callID: input.callID ?? input.callId ?? input.call_id,
            nativeSessionId,
          })
        } else {
          output.metadata = { ...output.metadata, ...stored.metadata }
        }
      }
    } else if (!nativeSessionId) {
      log("[tool-execute-after] Unable to recover stored metadata and no native session linkage was present", {
        tool: input.tool,
        sessionID: input.sessionID,
        callID: input.callID ?? input.callId ?? input.call_id,
      })
    }

    if (input.tool === "task") {
      const directory = getPluginDirectory(ctx)
      const sessionId = getMetadataString(output.metadata, ["sessionId", "sessionID", "session_id"])
      const agent = getMetadataString(output.metadata, ["agent"])
      const prompt = getMetadataString(output.metadata, ["prompt"])
      const verificationAttemptId = prompt?.match(VERIFICATION_ATTEMPT_PATTERN)?.[1]?.trim()
      const loopState = directory
        ? (await import("../hooks/ralph-loop/storage")).readState(directory)
        : null
      const isVerificationContext =
        (agent ? stripInvisibleAgentCharacters(agent) : agent) === "oracle"
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
        ;(await import("../hooks/ralph-loop/storage")).writeState(directory, {
          ...loopState,
          verification_session_id: sessionId,
        })
        log("[tool-execute-after] Stored oracle verification session via attempt match", {
          parentSessionID: input.sessionID,
          oracleSessionID: sessionId,
          verificationAttemptId,
        })
      } else if (isVerificationContext && !verificationAttemptId) {
        ;(await import("../hooks/ralph-loop/storage")).writeState(directory, {
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
      await hooks.toolOutputTruncator?.["tool.execute.after"]?.(hookInput, output)
      await hooks.claudeCodeHooks?.["tool.execute.after"]?.(hookInput, output)
      await hooks.preemptiveCompaction?.["tool.execute.after"]?.(hookInput, output)
      await hooks.contextWindowMonitor?.["tool.execute.after"]?.(hookInput, output)
      await hooks.commentChecker?.["tool.execute.after"]?.(hookInput, output)
      await hooks.directoryAgentsInjector?.["tool.execute.after"]?.(hookInput, output)
      await hooks.directoryReadmeInjector?.["tool.execute.after"]?.(hookInput, output)
      await hooks.rulesInjector?.["tool.execute.after"]?.(hookInput, output)
      await hooks.emptyTaskResponseDetector?.["tool.execute.after"]?.(hookInput, output)
      await hooks.agentUsageReminder?.["tool.execute.after"]?.(hookInput, output)
      await hooks.categorySkillReminder?.["tool.execute.after"]?.(hookInput, output)
      await hooks.interactiveBashSession?.["tool.execute.after"]?.(hookInput, output)
      await hooks.editErrorRecovery?.["tool.execute.after"]?.(hookInput, output)
      await hooks.delegateTaskRetry?.["tool.execute.after"]?.(hookInput, output)
      await hooks.atlasHook?.["tool.execute.after"]?.(hookInput, output)
      await hooks.taskResumeInfo?.["tool.execute.after"]?.(hookInput, output)
      await hooks.readImageResizer?.["tool.execute.after"]?.(hookInput, output)
      await hooks.hashlineReadEnhancer?.["tool.execute.after"]?.(hookInput, output)
      await hooks.webfetchRedirectGuard?.["tool.execute.after"]?.(hookInput, output)
      await hooks.jsonErrorRecovery?.["tool.execute.after"]?.(hookInput, output)
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
          callID: input.callID ?? input.callId ?? input.call_id,
          error,
        })
      }

      return
    }

    await runToolExecuteAfterHooks()
  }
}
