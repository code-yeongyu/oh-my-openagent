/**
 * Mock token cache for simulating token usage in compaction tests
 * Simulates the tokenCache Map used in preemptive-compaction-trigger.ts
 */

import type { TokenInfo } from "../../preemptive-compaction-types"

/**
 * Cached compaction state matching the production structure
 */
export interface MockCachedCompactionState {
  providerID: string
  modelID: string
  tokens: TokenInfo
}

/**
 * Mock token cache that simulates the production tokenCache Map
 */
export class MockTokenCache {
  private cache: Map<string, MockCachedCompactionState> = new Map()
  private contextLimits: Map<string, number> = new Map()

  /**
   * Sets token usage for a session
   */
  setTokenUsage(
    sessionID: string,
    providerID: string,
    modelID: string,
    tokens: Partial<TokenInfo>
  ): void {
    const fullTokens: TokenInfo = {
      input: tokens.input ?? 0,
      output: tokens.output ?? 0,
      reasoning: tokens.reasoning ?? 0,
      cache: tokens.cache ?? { read: 0, write: 0 },
    }

    this.cache.set(sessionID, {
      providerID,
      modelID,
      tokens: fullTokens,
    })
  }

  /**
   * Gets cached state for a session
   */
  get(sessionID: string): MockCachedCompactionState | undefined {
    return this.cache.get(sessionID)
  }

  /**
   * Deletes cached state for a session
   */
  delete(sessionID: string): boolean {
    return this.cache.delete(sessionID)
  }

  /**
   * Clears all cached state
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Sets context limit for a model
   */
  setContextLimit(providerID: string, modelID: string, limit: number): void {
    const key = `${providerID}/${modelID}`
    this.contextLimits.set(key, limit)
  }

  /**
   * Gets context limit for a model
   */
  getContextLimit(providerID: string, modelID: string): number | undefined {
    const key = `${providerID}/${modelID}`
    return this.contextLimits.get(key)
  }

  /**
   * Calculates usage ratio for a session
   */
  getUsageRatio(sessionID: string): number | null {
    const cached = this.cache.get(sessionID)
    if (!cached) return null

    const limit = this.getContextLimit(cached.providerID, cached.modelID)
    if (!limit) return null

    const totalInputTokens = (cached.tokens.input ?? 0) + (cached.tokens.cache?.read ?? 0)
    return totalInputTokens / limit
  }

  /**
   * Simulates token growth by adding to input tokens
   */
  addTokens(sessionID: string, additionalTokens: number): void {
    const cached = this.cache.get(sessionID)
    if (!cached) return

    cached.tokens.input += additionalTokens
    this.cache.set(sessionID, cached)
  }

  /**
   * Sets usage ratio directly (useful for testing specific thresholds)
   */
  setUsageRatio(sessionID: string, providerID: string, modelID: string, ratio: number): void {
    const limit = this.getContextLimit(providerID, modelID)
    if (!limit) {
      throw new Error(`Context limit not set for ${providerID}/${modelID}`)
    }

    const targetTokens = Math.floor(limit * ratio)
    this.setTokenUsage(sessionID, providerID, modelID, {
      input: targetTokens,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    })
  }

  /**
   * Simulates compaction by reducing token count
   */
  simulateCompaction(sessionID: string, reductionRatio: number = 0.5): void {
    const cached = this.cache.get(sessionID)
    if (!cached) return

    const currentTotal = cached.tokens.input + (cached.tokens.cache?.read ?? 0)
    const newTotal = Math.floor(currentTotal * reductionRatio)

    cached.tokens.input = newTotal
    cached.tokens.cache = { read: 0, write: 0 }
    this.cache.set(sessionID, cached)
  }

  /**
   * Gets all session IDs in the cache
   */
  getSessionIDs(): string[] {
    return Array.from(this.cache.keys())
  }

  /**
   * Checks if a session is in the cache
   */
  has(sessionID: string): boolean {
    return this.cache.has(sessionID)
  }

  /**
   * Gets the size of the cache
   */
  get size(): number {
    return this.cache.size
  }
}

/**
 * Creates a pre-configured mock token cache with common models
 */
export function createPreconfiguredMockTokenCache(): MockTokenCache {
  const cache = new MockTokenCache()

  // Set up common model context limits
  cache.setContextLimit("anthropic", "claude-3-5-sonnet", 200000)
  cache.setContextLimit("anthropic", "claude-3-opus", 200000)
  cache.setContextLimit("openai", "gpt-4o", 128000)
  cache.setContextLimit("openai", "gpt-4o-mini", 128000)
  cache.setContextLimit("google", "gemini-1.5-pro", 1000000)

  return cache
}

/**
 * Test scenarios for token usage
 */
export const TokenUsageScenarios = {
  /**
   * Creates a session just below the compaction threshold
   */
  belowThreshold(cache: MockTokenCache, sessionID: string, providerID: string, modelID: string): void {
    cache.setUsageRatio(sessionID, providerID, modelID, 0.77)
  },

  /**
   * Creates a session at the compaction threshold
   */
  atThreshold(cache: MockTokenCache, sessionID: string, providerID: string, modelID: string): void {
    cache.setUsageRatio(sessionID, providerID, modelID, 0.78)
  },

  /**
   * Creates a session above the compaction threshold
   */
  aboveThreshold(cache: MockTokenCache, sessionID: string, providerID: string, modelID: string): void {
    cache.setUsageRatio(sessionID, providerID, modelID, 0.85)
  },

  /**
   * Creates a session at maximum capacity
   */
  atCapacity(cache: MockTokenCache, sessionID: string, providerID: string, modelID: string): void {
    cache.setUsageRatio(sessionID, providerID, modelID, 0.99)
  },

  /**
   * Creates a session that has just been compacted
   */
  postCompaction(cache: MockTokenCache, sessionID: string, providerID: string, modelID: string): void {
    cache.setUsageRatio(sessionID, providerID, modelID, 0.30)
  },
}
