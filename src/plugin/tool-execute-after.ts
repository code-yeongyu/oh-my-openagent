import { consumeToolMetadata } from "../features/tool-metadata-store"
import type { CreatedHooks } from "../create-hooks"
import type { PluginContext } from "./types"
import { readState, writeState } from "../hooks/ralph-loop/storage"

const VERIFICATION_ATTEMPT_PATTERN = /<ulw_verification_attempt_id>(.*?)<\/ulw_verification_attempt_id>/i

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
      const sessionId = typeof output.metadata?.sessionId === "string" ? output.metadata.sessionId : undefined
      const agent = typeof output.metadata?.agent === "string" ? output.metadata.agent : undefined
      const prompt = typeof output.metadata?.prompt === "string" ? output.metadata.prompt : undefined
      const verificationAttemptId = prompt?.match(VERIFICATION_ATTEMPT_PATTERN)?.[1]?.trim()
      const loopState = readState(ctx.directory)

      if (
        agent === "oracle"
        && sessionId
        && verificationAttemptId
        && loopState?.active === true
        && loopState.ultrawork === true
        && loopState.verification_pending === true
        && loopState.session_id === input.sessionID
        && loopState.verification_attempt_id === verificationAttemptId
      ) {
        writeState(ctx.directory, {
          ...loopState,
          verification_session_id: sessionId,
        })
      }
    }

    await hooks.claudeCodeHooks?.["tool.execute.after"]?.(input, output)
    await hooks.toolOutputTruncator?.["tool.execute.after"]?.(input, output)
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
}
