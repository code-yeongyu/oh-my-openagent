import { resolveClaimReceipt, type ClaimReceipt } from "@oh-my-opencode/memory-core"

import type { MemoryIdentityContext } from "./context"
import { pendingConsentExchange } from "./consent-exchange"

export interface MemoryToolProvenanceInput {
  readonly sessionId: string
  readonly userTurns: number
  readonly context: MemoryIdentityContext
  readonly toolCallId: unknown
  readonly input: Record<string, unknown>
  readonly entries: readonly unknown[]
}

export interface InjectedMemoryToolProvenance {
  readonly sessionId: string
  readonly userTurns: number
  readonly identityId: string
  readonly repoPath: string
  readonly toolCallId?: string
  readonly claim: ClaimReceipt
}

// The bridge deletes any model-supplied provenance and writes this object in its place, so neither
// the identity keys nor the claim receipt can be forged from tool arguments. A `user` claim keeps
// its source only when its quote is the user's whole reply to the assistant proposal right before it
// on the active branch; otherwise it is stored as an agent suggestion (#10488).
export function memoryToolProvenance(input: MemoryToolProvenanceInput): InjectedMemoryToolProvenance {
  return {
    sessionId: input.sessionId,
    userTurns: input.userTurns,
    identityId: input.context.identity,
    repoPath: input.context.identityPaths.repo,
    ...(typeof input.toolCallId === "string" && input.toolCallId.length > 0 ? { toolCallId: input.toolCallId } : {}),
    claim: resolveClaimReceipt(
      { source: input.input.source, userQuote: input.input.user_quote },
      pendingConsentExchange(input.entries, input.toolCallId),
    ),
  }
}

/** The live branch only: an abandoned branch's user messages are not what the user said here. */
export function activeBranchEntries(eventCtx: unknown): readonly unknown[] | undefined {
  if (!isRecord(eventCtx) || !isRecord(eventCtx.sessionManager)) return undefined
  const manager = eventCtx.sessionManager
  const getBranch = manager.getBranch
  if (typeof getBranch !== "function") return undefined
  const branch: unknown = Reflect.apply(getBranch, manager, [])
  return Array.isArray(branch) ? branch : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
