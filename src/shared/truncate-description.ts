/**
 * Truncates a description string to a maximum character length.
 * If truncated, appends "..." to indicate continuation.
 *
 * @param description - The description string to truncate
 * @param maxLength - Maximum character length (default: 120)
 * @returns Truncated description with "..." appended if it was truncated
 */
export function truncateDescription(description: string, maxLength: number = 120): string {
  if (!description) {
    return description
  }

  if (description.length <= maxLength) {
    return description
  }

  return description.slice(0, maxLength) + "..."
}
