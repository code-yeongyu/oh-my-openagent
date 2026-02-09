import { consumeToolMetadata } from "../features/tool-metadata-store"
import type { CreatedHooks } from "../create-hooks"

export function createToolExecuteAfterHandler(args: {
  hooks: CreatedHooks
}): (
  input: { tool: string; sessionID: string; callID: string },
  output:
    | { title: string; output: string; metadata: Record<string, unknown> }
    | undefined,
) => Promise<void> {
  const { hooks } = args

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
  }
}
