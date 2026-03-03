import { consumeToolMetadata } from "../features/tool-metadata-store"
import type { OhMyOpenCodeConfig } from "../config"
import { safeCompress, shouldCompress, DEFAULT_COMPRESSION_CONFIG } from "../shared/toon-compression"
import type { CreatedHooks } from "../create-hooks"

const TRUNCATION_MARKERS = [
  "[truncated]",
  "[output truncated",
  "[content truncated",
  "[tool result truncated",
]

function isAlreadyTruncatedOutput(output: string): boolean {
  const normalized = output.toLowerCase()
  return TRUNCATION_MARKERS.some((marker) => normalized.includes(marker))
}

function parseJsonOutput(output: string): unknown | null {
  try {
    return JSON.parse(output)
  } catch {
    return null
  }
}

function compressOutputIfEligible(output: string, config: { enabled: boolean; threshold: number }): string {
  if (!config.enabled || isAlreadyTruncatedOutput(output)) {
    return output
  }

  const parsed = parseJsonOutput(output)
  if (parsed === null || !shouldCompress(parsed, config.threshold)) {
    return output
  }

  try {
     return safeCompress(parsed, "tool-execute-after")
   } catch {
     return output
   }
}

export function createToolExecuteAfterHandler(args: {
  hooks: CreatedHooks
  pluginConfig: OhMyOpenCodeConfig
}): (
  input: { tool: string; sessionID: string; callID: string },
  output:
    | { title: string; output: string; metadata: Record<string, unknown> }
    | undefined,
) => Promise<void> {
  const { hooks, pluginConfig } = args
  const compressionConfig = pluginConfig.toon_compression ?? DEFAULT_COMPRESSION_CONFIG

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

    output.output = compressOutputIfEligible(output.output, compressionConfig)

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
