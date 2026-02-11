import type { AgentOverrides } from "../../config/schema"

/**
 * Runtime state for model switcher functionality.
 * Uses in-memory storage only (no filesystem persistence).
 */
export interface ModelSwitcherState {
  /**
   * Agent name -> active model override
   * When an agent is switched to a specific model, it's stored here.
   */
  activeOverrides: Map<string, string>

  /**
   * Agent name -> list of candidate models from config
   * Loaded from config's model_candidates field.
   */
  candidates: Map<string, string[]>

  /**
   * Get the active model for a specific agent.
   * Returns undefined if no override is set.
   */
  getActiveModel(agentName: string): string | undefined

  /**
   * Set an active model override for a specific agent.
   * This will be used instead of the default fallback chain.
   */
  setActiveModel(agentName: string, model: string): void

  /**
   * Load model candidates from config.
   * Called once during agent initialization.
   */
  loadCandidates(agentOverrides: AgentOverrides): void

  /**
   * Get candidate models for a specific agent.
   * Returns empty array if no candidates defined.
   */
  getCandidates(agentName: string): string[]

  /**
   * Get current model info for all agents with overrides/candidates.
   * Useful for debugging and status display.
   */
  getCurrentModelInfo(): Record<string, { active: string | undefined; candidates: string[] }>
}

/**
 * Internal implementation of ModelSwitcherState.
 * Uses singleton pattern to ensure a single instance across the application.
 */
class ModelSwitcherStateImpl implements ModelSwitcherState {
  activeOverrides: Map<string, string> = new Map()
  candidates: Map<string, string[]> = new Map()

  getActiveModel(agentName: string): string | undefined {
    return this.activeOverrides.get(agentName)
  }

  setActiveModel(agentName: string, model: string): void {
    this.activeOverrides.set(agentName, model)
  }

  loadCandidates(agentOverrides: AgentOverrides): void {
    for (const [agentName, config] of Object.entries(agentOverrides)) {
      if (config?.model_candidates && config.model_candidates.length > 0) {
        this.candidates.set(agentName, config.model_candidates)
      }
    }
  }

  getCandidates(agentName: string): string[] {
    return this.candidates.get(agentName) ?? []
  }

  getCurrentModelInfo(): Record<string, { active: string | undefined; candidates: string[] }> {
    const info: Record<string, { active: string | undefined; candidates: string[] }> = {}

    // Include agents with active overrides
    for (const [agentName, model] of this.activeOverrides.entries()) {
      info[agentName] = {
        active: model,
        candidates: this.candidates.get(agentName) ?? [],
      }
    }

    // Include agents with candidates but no active override
    for (const [agentName, models] of this.candidates.entries()) {
      if (!info[agentName]) {
        info[agentName] = {
          active: undefined,
          candidates: models,
        }
      }
    }

    return info
  }
}

// Singleton instance
let instance: ModelSwitcherState | null = null

/**
 * Get the singleton instance of ModelSwitcherState.
 * Creates a new instance if one doesn't exist.
 */
export function getModelSwitcherState(): ModelSwitcherState {
  if (!instance) {
    instance = new ModelSwitcherStateImpl()
  }
  return instance
}

/**
 * Export convenience functions that delegate to the singleton.
 * This allows consumers to import these functions directly without
 * dealing with the getInstance() pattern.
 */
export function getActiveModel(agentName: string): string | undefined {
  return getModelSwitcherState().getActiveModel(agentName)
}

export function setActiveModel(agentName: string, model: string): void {
  getModelSwitcherState().setActiveModel(agentName, model)
}

export function loadCandidates(agentOverrides: AgentOverrides): void {
  getModelSwitcherState().loadCandidates(agentOverrides)
}

export function getCandidates(agentName: string): string[] {
  return getModelSwitcherState().getCandidates(agentName)
}

export function getCurrentModelInfo(): Record<string, { active: string | undefined; candidates: string[] }> {
  return getModelSwitcherState().getCurrentModelInfo()
}
