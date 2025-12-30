import type { DynamicContextPruningConfig } from "../../config"
import type { PruningState, PruningResult } from "./pruning-types"
import { executeDeduplication } from "./pruning-deduplication"
import { executeSupersedeWrites } from "./pruning-supersede"
import { executePurgeErrors } from "./pruning-purge-errors"
import { applyPruning } from "./pruning-storage"
import { log } from "../../shared/logger"

const DEFAULT_PROTECTED_TOOLS = new Set([
  "task",
  "todowrite",
  "todoread",
  "lsp_rename",
  "lsp_code_action_resolve",
  "session_read",
  "session_write",
  "session_search",
])

function createPruningState(): PruningState {
  return {
    toolIdsToPrune: new Set<string>(),
    currentTurn: 0,
    fileOperations: new Map(),
    toolSignatures: new Map(),
    erroredTools: new Map(),
  }
}

export async function executeDynamicContextPruning(
  sessionID: string,
  config: DynamicContextPruningConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any
): Promise<PruningResult> {
  const state = createPruningState()
  
  const protectedTools = new Set([
    ...DEFAULT_PROTECTED_TOOLS,
    ...(config.protected_tools || []),
  ])
  
  log("[pruning-executor] starting DCP", {
    sessionID,
    notification: config.notification,
    turnProtection: config.turn_protection,
  })
  
  let dedupCount = 0
  let supersedeCount = 0
  let purgeCount = 0
  
  if (config.strategies?.deduplication?.enabled !== false) {
    dedupCount = executeDeduplication(
      sessionID,
      state,
      { enabled: true },
      protectedTools
    )
  }
  
  if (config.strategies?.supersede_writes?.enabled !== false) {
    supersedeCount = executeSupersedeWrites(
      sessionID,
      state,
      {
        enabled: true,
        aggressive: config.strategies?.supersede_writes?.aggressive || false,
      },
      protectedTools
    )
  }
  
  if (config.strategies?.purge_errors?.enabled !== false) {
    purgeCount = executePurgeErrors(
      sessionID,
      state,
      {
        enabled: true,
        turns: config.strategies?.purge_errors?.turns || 5,
      },
      protectedTools
    )
  }
  
  const totalPruned = state.toolIdsToPrune.size
  const tokensSaved = await applyPruning(sessionID, state)
  
  log("[pruning-executor] DCP complete", {
    totalPruned,
    tokensSaved,
    deduplication: dedupCount,
    supersede: supersedeCount,
    purge: purgeCount,
  })
  
  const result: PruningResult = {
    itemsPruned: totalPruned,
    totalTokensSaved: tokensSaved,
    strategies: {
      deduplication: dedupCount,
      supersedeWrites: supersedeCount,
      purgeErrors: purgeCount,
    },
  }
  
  if (config.notification !== "off" && totalPruned > 0) {
    const message =
      config.notification === "detailed"
        ? `Pruned ${totalPruned} tool outputs (~${Math.round(tokensSaved / 1000)}k tokens). Dedup: ${dedupCount}, Supersede: ${supersedeCount}, Purge: ${purgeCount}`
        : `Pruned ${totalPruned} tool outputs (~${Math.round(tokensSaved / 1000)}k tokens)`
    
    await client.tui
      .showToast({
        body: {
          title: "Dynamic Context Pruning",
          message,
          variant: "success",
          duration: 3000,
        },
      })
      .catch(() => {})
  }
  
  return result
}
