import type { ParsedTokenLimitError } from "./types"
import type { ExperimentalConfig } from "../../config"
import type { DeduplicationConfig } from "./pruning-deduplication"
import type { PruningState } from "./pruning-types"
import { executeDeduplication } from "./pruning-deduplication"
import { truncateToolOutputsByCallId } from "./pruning-tool-output-truncation"
import { log } from "../../shared/logger"

function createPruningState(): PruningState {
  return {
    toolIdsToPrune: new Set<string>(),
    currentTurn: 0,
    fileOperations: new Map(),
    toolSignatures: new Map(),
    erroredTools: new Map(),
  }
}

function isPromptTooLongError(parsed: ParsedTokenLimitError): boolean {
  return !parsed.errorType.toLowerCase().includes("non-empty content")
}

function getDeduplicationPlan(
  experimental?: ExperimentalConfig,
): { config: DeduplicationConfig; protectedTools: Set<string> } | null {
  const pruningConfig = experimental?.dynamic_context_pruning
  if (!pruningConfig?.enabled) return null

  const deduplicationEnabled = pruningConfig.strategies?.deduplication?.enabled
  if (deduplicationEnabled === false) return null

  const protectedTools = new Set(pruningConfig.protected_tools ?? [])
  return {
    config: {
      enabled: true,
      protectedTools: pruningConfig.protected_tools ?? [],
    },
    protectedTools,
  }
}

export async function attemptDeduplicationRecovery(
  sessionID: string,
  parsed: ParsedTokenLimitError,
  experimental: ExperimentalConfig | undefined,
): Promise<void> {
  if (!isPromptTooLongError(parsed)) return

  const plan = getDeduplicationPlan(experimental)
  if (!plan) return

  const pruningState = createPruningState()
  const prunedCount = executeDeduplication(
    sessionID,
    pruningState,
    plan.config,
    plan.protectedTools,
  )
  const { truncatedCount } = truncateToolOutputsByCallId(
    sessionID,
    pruningState.toolIdsToPrune,
  )

  if (prunedCount > 0 || truncatedCount > 0) {
    log("[auto-compact] deduplication recovery applied", {
      sessionID,
      prunedCount,
      truncatedCount,
    })
  }
}
