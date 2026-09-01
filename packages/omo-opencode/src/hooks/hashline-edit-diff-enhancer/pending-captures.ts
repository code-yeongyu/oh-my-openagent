export const HASHLINE_PENDING_CAPTURE_TTL_MS = 5 * 60 * 1000
const HASHLINE_PENDING_CAPTURE_PRUNE_INTERVAL_MS = HASHLINE_PENDING_CAPTURE_TTL_MS

export type PendingCapture = {
  content: string
  filePath: string
  storedAt: number
}

const pendingCaptures = new Map<string, PendingCapture>()
let cleanupInterval: ReturnType<typeof setInterval> | null = null

function makeKey(sessionID: string, callID: string): string {
  return `${sessionID}:${callID}`
}

export function pruneStalePendingCaptures(now = Date.now()): void {
  for (const [key, entry] of pendingCaptures) {
    if (now - entry.storedAt > HASHLINE_PENDING_CAPTURE_TTL_MS) {
      pendingCaptures.delete(key)
    }
  }
}

function ensureCleanupInterval(): void {
  if (cleanupInterval) return
  cleanupInterval = setInterval(() => pruneStalePendingCaptures(), HASHLINE_PENDING_CAPTURE_PRUNE_INTERVAL_MS)
  if (typeof cleanupInterval === "object" && "unref" in cleanupInterval) {
    cleanupInterval.unref()
  }
}

export function setPendingCapture(
  sessionID: string,
  callID: string,
  capture: { content: string; filePath: string },
): void {
  ensureCleanupInterval()
  pendingCaptures.set(makeKey(sessionID, callID), {
    content: capture.content,
    filePath: capture.filePath,
    storedAt: Date.now(),
  })
}

export function takePendingCapture(sessionID: string, callID: string): PendingCapture | undefined {
  const key = makeKey(sessionID, callID)
  const captured = pendingCaptures.get(key)
  if (!captured) return undefined
  pendingCaptures.delete(key)
  return captured
}

export function stopPendingCaptureCleanup(): void {
  pendingCaptures.clear()
  if (!cleanupInterval) return
  clearInterval(cleanupInterval)
  cleanupInterval = null
}
