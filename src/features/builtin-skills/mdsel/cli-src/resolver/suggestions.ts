import { levenshteinDistance } from './levenshtein.js';
import type { Suggestion } from './types.js';

/**
 * Configuration for suggestion engine.
 */
export interface SuggestionOptions {
  /** Maximum number of suggestions to return. Default: 5 */
  maxResults?: number;
  /** Minimum similarity ratio (0-1). Default: 0.4 */
  minRatio?: number;
  /** Whether to include exact matches. Default: true */
  includeExact?: boolean;
}

/**
 * Internal result with metadata for sorting.
 */
interface SuggestionResult extends Suggestion {
  normalizedSelector: string;
}

/**
 * Engine for generating selector suggestions using fuzzy matching.
 *
 * Uses Levenshtein distance to rank candidates by similarity to the query.
 * Suggestions are sorted by:
 * 1. Similarity ratio (descending) - higher is better
 * 2. Edit distance (ascending) - fewer edits is better
 * 3. Selector length (ascending) - shorter is preferred
 */
export class SuggestionEngine {
  private candidates: string[];

  constructor(candidates: string[]) {
    this.candidates = candidates;
  }

  /**
   * Get suggestions for a query selector.
   *
   * @param query - The query selector
   * @param options - Configuration options
   * @returns Ranked array of suggestions
   *
   * @example
   * ```typescript
   * const engine = new SuggestionEngine(['heading:h1[0]', 'heading:h2[0]', 'block:code[0]']);
   * const suggestions = engine.getSuggestions('headng:h1[0]'); // typo in 'heading'
   * // Returns: [{ selector: 'heading:h1[0]', distance: 1, ratio: 0.95, reason: 'typo_correction' }, ...]
   * ```
   */
  getSuggestions(query: string, options: SuggestionOptions = {}): Suggestion[] {
    const { maxResults = 5, minRatio = 0.4, includeExact = true } = options;

    const normalizedQuery = query.toLowerCase().trim();
    const results: SuggestionResult[] = [];

    // Find exact matches
    if (includeExact) {
      const exactMatches = this.candidates.filter(
        (candidate) => candidate.toLowerCase() === normalizedQuery,
      );

      for (const selector of exactMatches) {
        results.push({
          selector,
          distance: 0,
          ratio: 1,
          reason: 'exact_match',
          normalizedSelector: selector.toLowerCase(),
        });
      }
    }

    // Find fuzzy matches - always skip exact matches regardless of includeExact
    // This prevents exact matches from appearing as fuzzy matches when includeExact=false
    const hasExactMatch = results.length > 0;
    const fuzzyMatches = this.findFuzzyMatches(normalizedQuery, hasExactMatch, minRatio);
    results.push(...fuzzyMatches);

    // Sort by multiple criteria and limit results
    return this.sortAndLimitResults(results, maxResults);
  }

  /**
   * Find fuzzy matches using Levenshtein distance.
   */
  private findFuzzyMatches(
    normalizedQuery: string,
    skipExact: boolean,
    minRatio: number,
  ): SuggestionResult[] {
    const results: SuggestionResult[] = [];

    for (const candidate of this.candidates) {
      const normalizedCandidate = candidate.toLowerCase().trim();

      // Skip if exact match (already handled)
      // Always skip exact matches to avoid duplicates in fuzzy results
      if (normalizedCandidate === normalizedQuery) {
        continue;
      }

      const distance = levenshteinDistance(normalizedQuery, normalizedCandidate);
      const maxLen = Math.max(normalizedQuery.length, normalizedCandidate.length);
      const ratio = maxLen === 0 ? 1 : (maxLen - distance) / maxLen;

      // Filter by minimum ratio threshold
      if (ratio >= minRatio) {
        const reason = distance <= 2 ? 'typo_correction' : 'fuzzy_match';
        results.push({
          selector: candidate,
          distance,
          ratio,
          reason,
          normalizedSelector: normalizedCandidate,
        });
      }
    }

    return results;
  }

  /**
   * Sort results by ratio (desc), distance (asc), length (asc) and limit to maxResults.
   */
  private sortAndLimitResults(results: SuggestionResult[], maxResults: number): Suggestion[] {
    return results
      .sort((a, b) => {
        // Primary: ratio (descending) - higher similarity first
        if (Math.abs(b.ratio - a.ratio) > 0.001) {
          return b.ratio - a.ratio;
        }
        // Secondary: distance (ascending) - fewer edits first
        if (a.distance !== b.distance) {
          return a.distance - b.distance;
        }
        // Tertiary: selector length (ascending) - shorter selectors first
        return a.selector.length - b.selector.length;
      })
      .slice(0, maxResults)
      .map(({ normalizedSelector: _, ...suggestion }) => suggestion);
  }
}
