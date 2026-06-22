import type { CreatedHooks } from "../create-hooks"
import { consumeToolMetadata } from "../features/tool-metadata-store"

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

    await hooks.toolOutputTruncator?.["tool.execute.after"]?.(input, output)

    // Run preemptiveCompaction in parallel with remaining hooks — it has a 60s timeout
    // on session.summarize() and should not block the other 16 hooks in the chain.
    // Total time: max(prepaction, remaining) instead of preemption + remaining.
    const remainingHooks = async () => {
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
      await hooks.hashlineReadEnhancer?.["tool.execute.after"]?.(input, output)
      await hooks.jsonErrorRecovery?.["tool.execute.after"]?.(input, output)
      await hooks.readImageResizer?.["tool.execute.after"]?.(input, output)
      await hooks.taskNotepad?.["tool.execute.after"]?.(input, output)
    }

    await Promise.all([
      hooks.preemptiveCompaction?.["tool.execute.after"]?.(input, output),
      hooks.qualityGate?.["tool.execute.after"]?.(input, output),
      remainingHooks(),
    ])
  }
}
