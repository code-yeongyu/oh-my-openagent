/**
 * Risk Validator
 *
 * Determines Risk Tier for files and whether edits should be blocked.
 * Adapted from superpowers-fusion/lib/risk-validator.ts
 */

import type { RiskTier, RiskTierResult, BlockResult } from "./types"
import { TIER_0_PATTERNS, TIER_1_PATTERNS, TIER_3_PATTERNS } from "./constants"

/**
 * Determine Risk Tier for a given file path
 */
export function determineRiskTier(filePath: string): RiskTierResult {
  // Normalize path separators to forward slashes for Windows compatibility
  const normalizedPath = filePath.replace(/\\/g, "/")

  // Check Tier 0 (always allowed)
  if (TIER_0_PATTERNS.some((p) => p.test(normalizedPath))) {
    return {
      tier: 0,
      requiresTest: false,
      allowsExemption: false,
      description: "Always allowed (docs, config)",
    }
  }

  // Check Tier 1 (allowed with logging)
  if (TIER_1_PATTERNS.some((p) => p.test(normalizedPath))) {
    return {
      tier: 1,
      requiresTest: false,
      allowsExemption: false,
      description: "Allowed with logging (styles, config)",
    }
  }

  // Check Tier 3 (strict TDD)
  if (TIER_3_PATTERNS.some((p) => p.test(normalizedPath))) {
    return {
      tier: 3,
      requiresTest: true,
      allowsExemption: false,
      description: "Strict TDD required (core logic)",
    }
  }

  // Default to Tier 2 (test or exemption)
  return {
    tier: 2,
    requiresTest: true,
    allowsExemption: true,
    description: "Test or exemption required",
  }
}

/**
 * Check if an edit should be blocked based on Risk Tier and test status
 */
export function shouldBlockEdit(
  tier: RiskTierResult,
  hasFailingTest: boolean,
  hasExemption: boolean
): BlockResult {
  // Tier 0-1: Never block
  if (tier.tier <= 1) {
    return { blocked: false }
  }

  // Tier 2: Block if no test AND no exemption
  if (tier.tier === 2) {
    if (!hasFailingTest && !hasExemption) {
      return {
        blocked: true,
        reason: "Tier 2: Requires failing test or TDD-EXEMPT comment",
      }
    }
    return { blocked: false }
  }

  // Tier 3: Block if no failing test (exemption not allowed)
  if (tier.tier === 3) {
    if (!hasFailingTest) {
      return {
        blocked: true,
        reason: "Tier 3: Strict TDD - must have failing test first",
      }
    }
    return { blocked: false }
  }

  return { blocked: false }
}

/**
 * Check if a file path matches any of the ignore patterns
 */
export function matchesIgnorePattern(filePath: string, ignorePatterns: string[]): boolean {
  const normalizedPath = filePath.replace(/\\/g, "/")
  
  for (const pattern of ignorePatterns) {
    // Simple glob matching: *.ext or exact match
    if (pattern.startsWith("*.")) {
      const ext = pattern.slice(1) // Get ".ext"
      if (normalizedPath.endsWith(ext)) {
        return true
      }
    } else if (normalizedPath.includes(pattern) || normalizedPath.endsWith(pattern)) {
      return true
    }
  }
  
  return false
}
