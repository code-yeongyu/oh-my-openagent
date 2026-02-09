import type { PendingCall } from "./types"

const pendingCalls = new Map<string, PendingCall>()
const PENDING_CALL_TTL = 60_000

let cleanupIntervalStarted = false

function cleanupOldPendingCalls(): void {
  const now = Date.now()
  for (const [callID, call] of pendingCalls) {
    if (now - call.timestamp > PENDING_CALL_TTL) {
      pendingCalls.delete(callID)
    }
  }
}

export function startPendingCallCleanup(): void {
  if (cleanupIntervalStarted) return
  cleanupIntervalStarted = true
  setInterval(cleanupOldPendingCalls, 10_000)
}

export function registerPendingCall(callID: string, pendingCall: PendingCall): void {
  pendingCalls.set(callID, pendingCall)
}

export function takePendingCall(callID: string): PendingCall | undefined {
  const pendingCall = pendingCalls.get(callID)
  if (!pendingCall) return undefined
  pendingCalls.delete(callID)
  return pendingCall
}
