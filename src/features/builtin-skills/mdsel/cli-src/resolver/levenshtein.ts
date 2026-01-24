/**
 * Calculate Levenshtein distance between two strings.
 *
 * Uses space-optimized dynamic programming with two rows.
 * Time complexity: O(m*n) where m, n are string lengths
 * Space complexity: O(min(m,n)) using two-row optimization
 *
 * @param str1 - First string
 * @param str2 - Second string
 * @returns Edit distance (number of single-character edits)
 *
 * @example
 * ```typescript
 * levenshteinDistance('kitten', 'sitting'); // Returns: 3
 * levenshteinDistance('hello', 'hello');   // Returns: 0
 * levenshteinDistance('', 'abc');          // Returns: 3
 * ```
 */
export function levenshteinDistance(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;

  // Use shorter string for inner array (space optimization)
  if (len1 < len2) {
    return levenshteinDistance(str2, str1);
  }

  // Handle empty string cases
  if (len2 === 0) {
    return len1;
  }

  // Create two rows for DP
  // prevRow represents the previous row in the DP matrix
  // currRow represents the current row being computed
  let prevRow: number[] = Array.from({ length: len2 + 1 }, (_, i) => i);
  let currRow: number[] = Array.from({ length: len2 + 1 }, () => 0);

  // Fill the DP matrix row by row
  for (let i = 1; i <= len1; i++) {
    currRow[0] = i;

    for (let j = 1; j <= len2; j++) {
      // Cost is 0 if characters match, 1 otherwise
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;

      // Compute minimum of three operations:
      // - currRow[j - 1] + 1: insertion
      // - prevRow[j] + 1: deletion
      // - prevRow[j - 1] + cost: substitution (or match if cost is 0)
      const prevRowVal = prevRow[j] ?? 0;
      const prevRowPrevVal = prevRow[j - 1] ?? 0;
      currRow[j] = Math.min(
        (currRow[j - 1] ?? 0) + 1, // insertion
        prevRowVal + 1, // deletion
        prevRowPrevVal + cost, // substitution
      );
    }

    // Swap rows for next iteration (reuses arrays instead of allocating new ones)
    [prevRow, currRow] = [currRow, prevRow];
  }

  // After the final swap, prevRow contains the last computed row
  return prevRow[len2] ?? 0;
}
