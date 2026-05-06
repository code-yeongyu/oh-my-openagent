import type { ToolExecuteProps, ToolResultProps } from "./types"

const DELEGATION_TOOLS = new Set(["call_omo_agent", "task"])
const DIRECT_IMPLEMENTATION_TOOLS = new Set(["edit", "write", "hashline_edit", "apply_patch"])

export interface MetricSnapshot {
  delegationAttempts: number
  delegationSuccesses: number
  directImplementationAttempts: number
  otherToolCalls: number
  totalToolCalls: number
  eventsAnalyzed: number
  firstToolTimestamp: number | null
  lastToolTimestamp: number | null
}

export interface EventMetricCollector {
  onToolExecute: (event: ToolExecuteProps) => void
  onToolResult: (event: ToolResultProps) => void
  getSnapshot: () => MetricSnapshot
}

function normalizeToolName(name: string | undefined): string {
  return name?.trim().toLowerCase() ?? "unknown"
}

function isDelegationTool(name: string | undefined): boolean {
  return DELEGATION_TOOLS.has(normalizeToolName(name))
}

function isDirectImplementationTool(name: string | undefined): boolean {
  return DIRECT_IMPLEMENTATION_TOOLS.has(normalizeToolName(name))
}

function isErrorResult(output: string | undefined): boolean {
  const normalized = output?.trim().toLowerCase() ?? ""
  return normalized.startsWith("error:") || normalized === "error" || normalized.includes('"error"')
}

export function createEventMetricCollector(): EventMetricCollector {
  let delegationAttempts = 0
  let delegationSuccesses = 0
  let directImplementationAttempts = 0
  let otherToolCalls = 0
  let totalToolCalls = 0
  let eventsAnalyzed = 0
  let firstToolTimestamp: number | null = null
  let lastToolTimestamp: number | null = null
  const pendingDelegationTools: string[] = []

  function recordToolTimestamp(): void {
    const timestamp = Date.now()
    firstToolTimestamp ??= timestamp
    lastToolTimestamp = timestamp
  }

  return {
    onToolExecute(event: ToolExecuteProps): void {
      eventsAnalyzed++
      totalToolCalls++
      recordToolTimestamp()

      if (isDelegationTool(event.name)) {
        delegationAttempts++
        pendingDelegationTools.push(normalizeToolName(event.name))
        return
      }

      if (isDirectImplementationTool(event.name)) {
        directImplementationAttempts++
        return
      }

      otherToolCalls++
    },

    onToolResult(event: ToolResultProps): void {
      eventsAnalyzed++
      const resultToolName = normalizeToolName(event.name)
      const resultMatchesDelegation = DELEGATION_TOOLS.has(resultToolName)
      const pendingIndex = resultMatchesDelegation
        ? pendingDelegationTools.indexOf(resultToolName)
        : pendingDelegationTools.findIndex((toolName) => DELEGATION_TOOLS.has(toolName))

      if (pendingIndex < 0) return

      pendingDelegationTools.splice(pendingIndex, 1)
      if (!isErrorResult(event.output)) {
        delegationSuccesses++
      }
    },

    getSnapshot(): MetricSnapshot {
      return {
        delegationAttempts,
        delegationSuccesses,
        directImplementationAttempts,
        otherToolCalls,
        totalToolCalls,
        eventsAnalyzed,
        firstToolTimestamp,
        lastToolTimestamp,
      }
    },
  }
}
