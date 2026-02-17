import type { TaxonomyEntry, Provenance, AuthorityTierType } from "./schema";

const TIER_RANK: Record<AuthorityTierType, number> = {
  "tier-1-ground-truth": 1,
  "tier-2-validated-reference": 2,
  "tier-3-battle-tested": 3,
  "tier-4-community": 4,
};

export function rankSources(sources: Provenance[]): Provenance[] {
  return [...sources].sort((a, b) => {
    const tierDiff = TIER_RANK[a.tier] - TIER_RANK[b.tier];
    if (tierDiff !== 0) return tierDiff;
    return b.confidence - a.confidence;
  });
}

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
}

export function validateProvenance(
  entry: TaxonomyEntry
): ValidationResult {
  const warnings: string[] = [];

  for (const solution of entry.solutions) {
    if (solution.sources.length === 0) {
      return {
        valid: false,
        warnings: [
          ...warnings,
          `Solution '${solution.name}' has no provenance sources`,
        ],
      };
    }

    const hasHigherTier = solution.sources.some(
      (s) => TIER_RANK[s.tier] < 4
    );

    if (!hasHigherTier) {
      warnings.push(
        `Solution '${solution.name}' has only community-tier sources`
      );
    }
  }

  const allSolutionsOnlyTier4 = entry.solutions.every((solution) =>
    solution.sources.every((s) => s.tier === "tier-4-community")
  );

  if (allSolutionsOnlyTier4) {
    warnings.push(
      `Entry '${entry.category}' relies entirely on community sources`
    );
  }

  return {
    valid: true,
    warnings,
  };
}
