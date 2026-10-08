import { hasCompactionPart, isCompactionAgent } from "./compaction-marker"

const COMPACTION_REGISTRY_TTL_MS = 900_000

export type CompactionInFlight = {
  gen: number
  startedAt: number
  messageID?: string
  endedAt?: number
}

const compactions = new Map<string, CompactionInFlight>()
const generations = new Map<string, number>()

function isExpired(entry: CompactionInFlight, now: number): boolean {
  return now - (entry.endedAt ?? entry.startedAt) >= COMPACTION_REGISTRY_TTL_MS
}

export function recordCompactionStart(sessionID: string, messageID?: string): void {
  const gen = (generations.get(sessionID) ?? 0) + 1
  generations.set(sessionID, gen)
  compactions.set(sessionID, {
    gen,
    startedAt: Date.now(),
    ...(messageID ? { messageID } : {}),
  })
}

function recordCompactionMessageStart(sessionID: string, messageID?: string): void {
  const entry = getCompaction(sessionID)
  if (entry?.endedAt !== undefined) {
    if (messageID !== undefined && entry.messageID === messageID) return
    recordCompactionStart(sessionID, messageID)
    return
  }
  if (!entry) {
    recordCompactionStart(sessionID, messageID)
    return
  }

  if (!entry.messageID && messageID) {
    entry.messageID = messageID
  }
}

export function recordCompactionEnd(
  sessionID: string,
  expectedGeneration?: number,
  expectedMessageID?: string,
): void {
  const entry = compactions.get(sessionID)
  if (!entry) return
  if (expectedGeneration !== undefined && entry.gen !== expectedGeneration) return
  if (expectedMessageID !== undefined && entry.messageID !== expectedMessageID) return
  entry.endedAt = Date.now()
}

export function clearCompaction(sessionID: string): void {
  compactions.delete(sessionID)
  generations.delete(sessionID)
}

export function clearAllCompactions(): void {
  compactions.clear()
  generations.clear()
}

export function getCompaction(sessionID: string): CompactionInFlight | undefined {
  const entry = compactions.get(sessionID)
  if (!entry) return undefined
  if (isExpired(entry, Date.now())) {
    compactions.delete(sessionID)
    generations.delete(sessionID)
    return undefined
  }
  return entry
}

export function isCompactionInFlight(sessionID: string): boolean {
  const entry = getCompaction(sessionID)
  return entry !== undefined && entry.endedAt === undefined
}

export function observeCompactionEvent(
  event: { type: string; properties?: unknown },
): void {
  const properties = typeof event.properties === "object" && event.properties !== null
    ? event.properties as Record<string, unknown>
    : undefined
  const info = typeof properties?.info === "object" && properties.info !== null
    ? properties.info as Record<string, unknown>
    : undefined
  const sessionID = typeof properties?.sessionID === "string"
    ? properties.sessionID
    : typeof info?.sessionID === "string"
      ? info.sessionID
      : typeof info?.id === "string"
        ? info.id
      : typeof properties?.id === "string"
      ? properties.id
      : undefined
  if (!sessionID) return

  if (event.type === "session.created") {
    clearCompaction(sessionID)
    return
  }
  if (event.type === "session.compaction.started") {
    recordCompactionMessageStart(sessionID)
    return
  }
  if (event.type === "session.compacted" || event.type === "session.compaction.ended" || event.type === "session.compaction.failed") {
    // Accepted SDK limitation: real session-level end events carry only { sessionID }, so gen, generation and
    // messageID are normally absent and an uncorrelated end closes whichever entry is current. Only
    // message-correlated ends are generation-safe; the exposure is bounded by serial per-session compaction,
    // the watchdog budget and the registry TTL.
    const generation = typeof properties?.gen === "number"
      ? properties.gen
      : typeof properties?.generation === "number"
        ? properties.generation
        : undefined
    const messageID = typeof properties?.messageID === "string" ? properties.messageID : undefined
    recordCompactionEnd(sessionID, generation, messageID)
    return
  }
  if (event.type === "session.deleted") {
    clearCompaction(sessionID)
    return
  }
  if (event.type !== "message.updated") return

  const messageInfo = info ?? properties
  const messageID = typeof messageInfo?.id === "string" ? messageInfo.id : undefined
  const entry = getCompaction(sessionID)
  const time = typeof messageInfo?.time === "object" && messageInfo.time !== null
    ? messageInfo.time as Record<string, unknown>
    : undefined
  const hasCompletion = time?.completed !== undefined
  const hasError = messageInfo?.error !== undefined
  if (entry?.messageID && entry.messageID === messageID && (hasError || hasCompletion)) {
    recordCompactionEnd(sessionID, entry.gen, messageID)
    return
  }

  if (messageInfo?.role === "assistant" && !hasError && !hasCompletion
    && (isCompactionAgent(messageInfo.agent)
      || messageInfo.mode === "compaction"
      || messageInfo.summary === true
      || hasCompactionPart(
        Array.isArray(properties?.parts) && properties.parts.length > 0
          ? properties.parts
          : messageInfo.parts,
      ))) {
    recordCompactionMessageStart(sessionID, messageID)
  }
}
