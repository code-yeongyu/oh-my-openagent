/**
 * In-memory store mapping session+message IDs to brain memory IDs.
 *
 * Populated during Phase 1 write-through (brain-bridge.ts captures large tool
 * outputs to brain and stores the returned memory ID here).
 *
 * Consumed during Phase 2/3 compression (message-compressor.ts looks up brain
 * IDs so compressed messages produce `[brain#N: ...]` markers instead of
 * generic `[compressed: ...]` placeholders).
 */

const brainIdsByMessage = new Map<string, number>()

function makeKey(sessionID: string, messageID: string): string {
  return `${sessionID}:${messageID}`
}

export function storeBrainId(sessionID: string, messageID: string, brainId: number): void {
  brainIdsByMessage.set(makeKey(sessionID, messageID), brainId)
}

export function getBrainId(sessionID: string, messageID: string): number | null {
  return brainIdsByMessage.get(makeKey(sessionID, messageID)) ?? null
}

export function hasBrainId(sessionID: string, messageID: string): boolean {
  return brainIdsByMessage.has(makeKey(sessionID, messageID))
}

export function clearBrainIds(sessionID: string): void {
  for (const key of brainIdsByMessage.keys()) {
    if (key.startsWith(`${sessionID}:`)) {
      brainIdsByMessage.delete(key)
    }
  }
}

export function getBrainIdStoreSize(): number {
  return brainIdsByMessage.size
}
