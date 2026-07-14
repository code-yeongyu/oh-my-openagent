/**
 * MaTrix cost-tracker hook — Native cost tracking.
 *
 * Hooks into `experimental.chat.messages.transform` to detect LLM calls and record costs.
 * Also provides public API functions (recordCost, saveDashboard) for direct use.
 *
 * NOTE: Token counts in messages.transform are approximate. For exact costs,
 * use the `chat.message` hook which sees the full output, or call recordCost()
 * directly with known token counts.
 */

import { recordCost, calculateCost, saveDashboard as saveDashboardFn, readCostLog, summarizeCosts } from "../../shared/cost-tracker"
import type { CostRecord } from "../../shared/cost-tracker"

type TransformPart = {
  type: string
  text?: string
  synthetic?: boolean
  [key: string]: unknown
}

type TransformMessageInfo = {
  role: string
  sessionID?: string
  modelID?: string
  providerID?: string
  tokens?: {
    input?: number
    output?: number
    total?: number
  }
  [key: string]: unknown
}

type MessageWithParts = {
  info: TransformMessageInfo
  parts: TransformPart[]
}

type CostTrackerInput = {
  sessionID?: string
  [key: string]: unknown
}

type CostTrackerOutput = {
  messages: MessageWithParts[]
}

export type CostTrackerHook = {
  "experimental.chat.messages.transform"?: (
    input: CostTrackerInput,
    output: CostTrackerOutput,
  ) => Promise<void>
}

const HOOK_NAME = "cost-tracker"

/**
 * Rough token estimation: 1 token ~= 4 characters for English text.
 * Used as fallback when real token counts aren't available.
 */
function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

/**
 * Create the cost-tracker hook. Captures assistant messages and records costs.
 */
export function createCostTrackerHook(): CostTrackerHook {
  return {
    "experimental.chat.messages.transform": async (input, output) => {
      const sessionID = input.sessionID ?? "unknown"
      // Look at the most recent assistant message
      for (let i = output.messages.length - 1; i >= 0; i--) {
        const msg = output.messages[i]
        if (msg?.info.role !== "assistant") continue
        const info = msg.info
        const modelID = info.modelID ?? "unknown"
        const providerID = info.providerID ?? "unknown"
        // Real tokens if available
        const inputTokens = info.tokens?.input ?? 0
        const outputTokens = info.tokens?.output ?? 0
        // Fall back to estimation
        let inputEst = inputTokens
        let outputEst = outputTokens
        if (inputEst === 0 || outputEst === 0) {
          // Sum text lengths of all parts
          const allText = msg.parts
            .filter((p) => p.type === "text" && typeof p.text === "string")
            .map((p) => p.text ?? "")
            .join("\n")
          outputEst = outputEst || estimateTokens(allText)
        }
        if (outputEst === 0) continue
        const cost = calculateCost(`${providerID}/${modelID}`, inputEst, outputEst)
        recordCost({
          session_id: sessionID,
          agent: "unknown", // Could be enriched via session context
          model: modelID,
          provider: providerID,
          input_tokens: inputEst,
          output_tokens: outputEst,
          input_cost: cost.inputCost,
          output_cost: cost.outputCost,
          total_cost: cost.total,
        })
        break // Only record the most recent assistant message per transform
      }
    },
  }
}

/**
 * Re-export the public API for convenience.
 */
export { recordCost, calculateCost, readCostLog, summarizeCosts }
export type { CostRecord }
export const saveDashboard = saveDashboardFn

export const COST_TRACKER_HOOK_NAME = HOOK_NAME
