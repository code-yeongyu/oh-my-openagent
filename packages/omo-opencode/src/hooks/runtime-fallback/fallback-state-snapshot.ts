import type { FallbackState } from "./types"

type FallbackStateSnapshot = {
  readonly originalModel: string
  readonly currentModel: string
  readonly fallbackIndex: number
  readonly failedModels: Map<string, number>
  readonly failedProviders: Map<string, number>
  readonly attemptCount: number
  readonly pendingFallbackModel: string | undefined
  readonly pendingFallbackPromptMayHaveBeenAccepted: boolean | undefined
}

export function snapshotFallbackState(state: FallbackState): FallbackStateSnapshot {
  return {
    originalModel: state.originalModel,
    currentModel: state.currentModel,
    fallbackIndex: state.fallbackIndex,
    failedModels: new Map(state.failedModels),
    failedProviders: new Map(state.failedProviders),
    attemptCount: state.attemptCount,
    pendingFallbackModel: state.pendingFallbackModel,
    pendingFallbackPromptMayHaveBeenAccepted: state.pendingFallbackPromptMayHaveBeenAccepted,
  }
}

export function restoreFallbackState(state: FallbackState, snapshot: FallbackStateSnapshot): void {
  state.originalModel = snapshot.originalModel
  state.currentModel = snapshot.currentModel
  state.fallbackIndex = snapshot.fallbackIndex
  state.failedModels = new Map(snapshot.failedModels)
  state.failedProviders = new Map(snapshot.failedProviders)
  state.attemptCount = snapshot.attemptCount
  state.pendingFallbackModel = snapshot.pendingFallbackModel
  state.pendingFallbackPromptMayHaveBeenAccepted = snapshot.pendingFallbackPromptMayHaveBeenAccepted
}
