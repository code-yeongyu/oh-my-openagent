import { consumeToolMetadata } from "../features/tool-metadata-store"
import type { CreatedHooks } from "../create-hooks"
import { deepSanitizeSurrogates, sanitizeSurrogates } from "../shared/sanitize-surrogates"

type StandardToolOutput = { title: string; output: string; metadata: Record<string, unknown> }
type McpToolOutput = { content: Array<{ type: string; text?: string; [key: string]: unknown }> }
type ToolOutput = StandardToolOutput | McpToolOutput

export function createToolExecuteAfterHandler(args: {
  hooks: CreatedHooks
}): (
  input: { tool: string; sessionID: string; callID: string },
  output: ToolOutput | undefined,
) => Promise<void> {
  const { hooks } = args

  return async (
    input: { tool: string; sessionID: string; callID: string },
    output: ToolOutput | undefined,
  ): Promise<void> => {
    if (!output) return

    if ("content" in output) {
      // MCP tool results use a content array instead of an output string
      output.content = deepSanitizeSurrogates(output.content) as McpToolOutput["content"]
    } else {
      output.title = sanitizeSurrogates(output.title)
      output.output = sanitizeSurrogates(output.output)
      output.metadata = deepSanitizeSurrogates(output.metadata) as Record<string, unknown>

      const stored = consumeToolMetadata(input.sessionID, input.callID)
      if (stored) {
        if (stored.title) {
          output.title = sanitizeSurrogates(stored.title)
        }
        if (stored.metadata) {
          output.metadata = deepSanitizeSurrogates({
            ...output.metadata,
            ...stored.metadata,
          }) as Record<string, unknown>
        }
      }
    }

    await hooks.claudeCodeHooks?.["tool.execute.after"]?.(input, output as StandardToolOutput)
    await hooks.toolOutputTruncator?.["tool.execute.after"]?.(input, output as StandardToolOutput)
    await hooks.preemptiveCompaction?.["tool.execute.after"]?.(input, output as StandardToolOutput)
    await hooks.contextWindowMonitor?.["tool.execute.after"]?.(input, output as StandardToolOutput)
    await hooks.commentChecker?.["tool.execute.after"]?.(input, output as StandardToolOutput)
    await hooks.directoryAgentsInjector?.["tool.execute.after"]?.(input, output as StandardToolOutput)
    await hooks.directoryReadmeInjector?.["tool.execute.after"]?.(input, output as StandardToolOutput)
    await hooks.rulesInjector?.["tool.execute.after"]?.(input, output as StandardToolOutput)
    await hooks.emptyTaskResponseDetector?.["tool.execute.after"]?.(input, output as StandardToolOutput)
    await hooks.agentUsageReminder?.["tool.execute.after"]?.(input, output as StandardToolOutput)
    await hooks.categorySkillReminder?.["tool.execute.after"]?.(input, output as StandardToolOutput)
    await hooks.interactiveBashSession?.["tool.execute.after"]?.(input, output as StandardToolOutput)
    await hooks.editErrorRecovery?.["tool.execute.after"]?.(input, output as StandardToolOutput)
    await hooks.jsonErrorRecovery?.["tool.execute.after"]?.(input, output as StandardToolOutput)
    await hooks.delegateTaskRetry?.["tool.execute.after"]?.(input, output as StandardToolOutput)
    await hooks.atlasHook?.["tool.execute.after"]?.(input, output as StandardToolOutput)
    await hooks.taskResumeInfo?.["tool.execute.after"]?.(input, output as StandardToolOutput)
    await hooks.hashlineReadEnhancer?.["tool.execute.after"]?.(input, output as StandardToolOutput)
  }
}
