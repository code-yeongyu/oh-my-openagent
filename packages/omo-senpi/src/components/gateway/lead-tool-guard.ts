import type { ToolCallEventResult } from "@code-yeongyu/senpi"

import type { ComponentLogger, SenpiExtensionAPI } from "../../extension/types"
import { THREAD_TOOL_SEARCH_METADATA } from "../thread/metadata"
import { gatewaySessionId, type GatewayScopeAccess } from "./scope-access"

const LEAD_TOOL_NAMES = new Set([
  ...THREAD_TOOL_SEARCH_METADATA.map(({ name }) => name),
  "memory", "memory_apply_patch", "gateway_learning",
  "read", "grep", "find", "ls", "glob",
])

export function registerGatewayLeadToolGuard(
  pi: SenpiExtensionAPI,
  access: GatewayScopeAccess,
  logger: ComponentLogger,
): void {
  // The scope each session led at its last successful lookup (null: it did not lead). A lookup that fails keeps a
  // known lead restricted: the allowlist must not lift exactly when the store is down. A session never seen as a
  // lead, or seen released, keeps its tools; a lead claim is made by the gateway CLI in another process, so only a
  // successful lookup here can make a session known as a lead.
  const lastKnownLead = new Map<string, string | null>()
  pi.on("tool_call", async (payload, eventCtx): Promise<ToolCallEventResult | undefined> => {
    const sessionId = gatewaySessionId(eventCtx)
    if (sessionId === undefined || payload === null || typeof payload !== "object") return undefined
    const toolName: unknown = Reflect.get(payload, "toolName")
    if (typeof toolName !== "string") return undefined
    const allowed = LEAD_TOOL_NAMES.has(toolName) || /^ext_omo_gateway_[a-z][a-z0-9_]{1,40}$/.test(toolName)

    let member
    try {
      member = await access.member(sessionId)
    } catch (error) {
      const scope = lastKnownLead.get(sessionId) ?? null
      const reason = error instanceof Error ? error.message : String(error)
      if (scope === null) {
        logger.warn(`gateway scope lead lookup failed for a session not known as a lead; tool call proceeds: ${reason}`)
        return undefined
      }
      logger.warn(`gateway scope lead lookup failed for the lead of scope ${scope}; its tools stay restricted: ${reason}`)
      if (allowed) return undefined
      return { block: true, reason: `lead tools restricted: membership lookup failed (this session led gateway scope ${scope} at its last lookup); ${toolName} stays refused until the gateway store answers` }
    }
    lastKnownLead.set(sessionId, member?.role === "lead" ? member.scope : null)
    if (member?.role !== "lead" || allowed) return undefined
    return {
      block: true,
      reason: `this session leads gateway scope ${member.scope}: it routes work to sessions instead of running tools like ${toolName}; open a work item`,
    }
  })
}
