/**
 * Member ID normalization utilities for consistent council member identification.
 * Ensures member IDs are normalized consistently throughout the pipeline.
 */

/**
 * Normalizes a council member ID to a consistent format.
 * - Converts to lowercase
 * - Replaces spaces with underscores
 * - Removes leading/trailing whitespace
 *
 * @param id - The member ID to normalize
 * @returns Normalized member ID
 */
export function normalizeMemberId(id: string): string {
  return id.trim().toLowerCase().replace(/\s+/g, "_")
}

/**
 * Normalizes a member name for use in agent keys and lookups.
 * Uses the same normalization as member IDs for consistency.
 *
 * @param name - The member name to normalize
 * @returns Normalized member name
 */
export function normalizeMemberName(name: string): string {
  return normalizeMemberId(name)
}

/**
 * Checks if two member IDs are equivalent after normalization.
 *
 * @param id1 - First member ID
 * @param id2 - Second member ID
 * @returns True if normalized IDs are equal
 */
export function areMemberIdsEqual(id1: string, id2: string): boolean {
  return normalizeMemberId(id1) === normalizeMemberId(id2)
}
