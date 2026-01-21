import type { ProviderState, ProviderStatus } from "./types"

export class ProviderStatusManager {
  private static instance: ProviderStatusManager
  private states = new Map<string, ProviderState>()

  private constructor() {}

  static getInstance(): ProviderStatusManager {
    if (!ProviderStatusManager.instance) {
      ProviderStatusManager.instance = new ProviderStatusManager()
    }
    return ProviderStatusManager.instance
  }

  getState(model: string): ProviderState | undefined {
    return this.states.get(model)
  }

  getStatus(model: string): ProviderStatus {
    const state = this.states.get(model)
    if (!state) return "HEALTHY"

    if (state.status === "COOLING") {
      if (Date.now() >= state.resumeAt) {
        return "PROBATION"
      }
      return "COOLING"
    }

    return state.status
  }

  isAvailable(model: string): boolean {
    const status = this.getStatus(model)
    return status === "HEALTHY" || status === "PROBATION"
  }

  markCooling(model: string, durationMs: number, reason: string) {
    const current = this.states.get(model)
    this.states.set(model, {
      status: "COOLING",
      resumeAt: Date.now() + durationMs,
      reason,
      retryCount: (current?.retryCount ?? 0) + 1
    })
  }

  markLocked(model: string, reason: string) {
    const current = this.states.get(model)
    this.states.set(model, {
      status: "LOCKED",
      resumeAt: Infinity,
      reason,
      retryCount: (current?.retryCount ?? 0) + 1
    })
  }

  markHealthy(model: string) {
    this.states.delete(model)
  }

  reset() {
    this.states.clear()
  }
}
