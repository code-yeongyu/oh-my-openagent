import type { TranscriptProjection } from "@oh-my-opencode/memory-core"

import type { SenpiExtensionAPI } from "../../extension/types"
import type { MemoryIdentityContext } from "./context"
import { projectSessionEntries, readBranchSurface } from "./journal-wiring"
import { sessionIdFrom } from "./wiring-context"

interface JournalSettleDeliveryInput {
  readonly resolveContext: (sessionId: string) => MemoryIdentityContext | undefined
  readonly lastEventCtx: { current?: unknown }
  readonly activeSession: { current?: string }
  readonly deliver?: (sessionId: string, entries: readonly TranscriptProjection[]) => void | Promise<void>
}

// Senpi awaits this read-only delivery before agent_settled/agent_idle. It captures the completed
// branch only; journal locks, facts and reflection work stay under the bounded observer.
export function registerJournalSettleDelivery(pi: SenpiExtensionAPI, input: JournalSettleDeliveryInput): void {
  pi.on("agent_settled", async (_payload, eventCtx) => {
    input.lastEventCtx.current = eventCtx
    const sessionId = sessionIdFrom(eventCtx)
    if (sessionId === undefined || input.resolveContext(sessionId) === undefined) return
    input.activeSession.current = sessionId
    const branch = readBranchSurface(eventCtx)
    await input.deliver?.(sessionId, branch === undefined ? [] : projectSessionEntries(branch.entries))
  }, { hookLabel: "onSettled.journal.delivery", settleDelivery: true })
}
