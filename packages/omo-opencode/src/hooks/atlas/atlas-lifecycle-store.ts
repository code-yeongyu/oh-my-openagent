import type { PendingTaskRef, SessionState } from "./types"

export const ATLAS_SESSION_STATE_TTL_MS = 10 * 60 * 1000
export const ATLAS_SESSION_PRUNE_INTERVAL_MS = 2 * 60 * 1000

type PendingAtlasCall =
  | { readonly kind: "file"; readonly sessionID?: string; readonly filePath: string; readonly planSnapshot?: string }
  | { readonly kind: "task"; readonly sessionID?: string; readonly task: PendingTaskRef }

export class AtlasLifecycleStore {
  readonly sessions = new Map<string, SessionState>()
  readonly pendingFilePaths = new Map<string, string>()
  readonly pendingTaskRefs = new Map<string, PendingTaskRef>()
  readonly pendingPlanSnapshots = new Map<string, string>()
  readonly pendingCalls = new Map<string, PendingAtlasCall>()
  readonly sessionCallIDs = new Map<string, Set<string>>()
  private readonly lastAccessedAt = new Map<string, number>()
  private pruneInterval: ReturnType<typeof setInterval> | undefined
  private disposed = false
  private readonly disposedState: SessionState = { promptFailureCount: 0 }

  getExistingState(sessionID: string): SessionState | undefined {
    const tracked = this.sessions.get(sessionID)
    if (!tracked) return undefined
    this.lastAccessedAt.set(sessionID, Date.now())
    return tracked
  }

  getOrCreateState(sessionID: string): SessionState {
    if (this.disposed) return this.disposedState
    const existing = this.getExistingState(sessionID)
    if (existing) return existing
    const state = { promptFailureCount: 0, lifecycleActive: true }
    this.sessions.set(sessionID, state)
    this.lastAccessedAt.set(sessionID, Date.now())
    this.ensurePruneInterval()
    return state
  }

  trackFileCall(callID: string, sessionID: string | undefined, filePath: string): void {
    this.pendingFilePaths.set(callID, filePath)
    this.replaceCall(callID, { kind: "file", sessionID, filePath })
  }

  trackTaskCall(callID: string, sessionID: string | undefined, task: PendingTaskRef): void {
    this.pendingTaskRefs.set(callID, task)
    this.replaceCall(callID, { kind: "task", sessionID, task })
  }

  trackPlanSnapshot(callID: string, snapshot: string): void {
    this.pendingPlanSnapshots.set(callID, snapshot)
  }

  consumeFileCall(callID: string | undefined): Extract<PendingAtlasCall, { kind: "file" }> | undefined {
    const pending = this.pendingCalls.get(callID ?? "")
    if (!pending || pending.kind !== "file") return undefined
    this.clearPendingCall(callID)
    return pending
  }

  consumeTaskCall(callID: string | undefined): Extract<PendingAtlasCall, { kind: "task" }> | undefined {
    const pending = this.pendingCalls.get(callID ?? "")
    if (!pending || pending.kind !== "task") return undefined
    this.clearPendingCall(callID)
    return pending
  }

  clearPendingCall(callID: string | undefined): void {
    if (!callID) return
    const pending = this.pendingCalls.get(callID)
    if (!pending) return
    this.pendingCalls.delete(callID)
    this.pendingFilePaths.delete(callID)
    this.pendingTaskRefs.delete(callID)
    this.pendingPlanSnapshots.delete(callID)
    if (pending.sessionID) this.removeSessionCallID(pending.sessionID, callID)
  }

  cleanupSession(sessionID: string): void {
    const state = this.sessions.get(sessionID)
    if (state) state.lifecycleActive = false
    if (state?.pendingRetryTimer) clearTimeout(state.pendingRetryTimer)
    this.sessions.delete(sessionID)
    this.lastAccessedAt.delete(sessionID)
    for (const callID of this.sessionCallIDs.get(sessionID) ?? []) this.clearPendingCall(callID)
    this.sessionCallIDs.delete(sessionID)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.pruneInterval) clearInterval(this.pruneInterval)
    this.pruneInterval = undefined
    for (const sessionID of this.sessions.keys()) this.cleanupSession(sessionID)
    this.pendingCalls.clear()
    this.pendingFilePaths.clear()
    this.pendingTaskRefs.clear()
    this.pendingPlanSnapshots.clear()
    this.sessionCallIDs.clear()
  }

  get sizes(): { readonly sessions: number; readonly pendingCalls: number; readonly sessionIndexes: number; readonly hasPruneInterval: boolean } {
    return { sessions: this.sessions.size, pendingCalls: this.pendingCalls.size, sessionIndexes: this.sessionCallIDs.size, hasPruneInterval: this.pruneInterval !== undefined }
  }

  private replaceCall(callID: string, call: PendingAtlasCall): void {
    this.clearPendingCall(callID)
    this.pendingCalls.set(callID, call)
    if (!call.sessionID) return
    const callIDs = this.sessionCallIDs.get(call.sessionID) ?? new Set<string>()
    callIDs.add(callID)
    this.sessionCallIDs.set(call.sessionID, callIDs)
  }

  private removeSessionCallID(sessionID: string, callID: string): void {
    const callIDs = this.sessionCallIDs.get(sessionID)
    if (!callIDs) return
    callIDs.delete(callID)
    if (callIDs.size === 0) this.sessionCallIDs.delete(sessionID)
  }

  private ensurePruneInterval(): void {
    if (this.pruneInterval || this.disposed) return
    this.pruneInterval = setInterval(() => this.prune(), ATLAS_SESSION_PRUNE_INTERVAL_MS)
    this.pruneInterval.unref()
  }

  private prune(): void {
    const now = Date.now()
    for (const sessionID of this.sessions.keys()) {
      const lastAccessedAt = this.lastAccessedAt.get(sessionID)
      if (lastAccessedAt !== undefined && now - lastAccessedAt > ATLAS_SESSION_STATE_TTL_MS) this.cleanupSession(sessionID)
    }
  }
}
