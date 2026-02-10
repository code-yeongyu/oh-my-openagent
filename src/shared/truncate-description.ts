export function truncateDescription(description: string, maxLength: number = 120): string {
  if (!description) {
    return description
  }

  if (description.length <= maxLength) {
    return description
  }

  return description.slice(0, maxLength - 3) + "..."
}
