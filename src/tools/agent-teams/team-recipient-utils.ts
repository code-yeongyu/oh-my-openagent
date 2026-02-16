export function normalizeTeamRecipient(recipient: string): string {
  const trimmed = recipient.trim()
  const atIndex = trimmed.indexOf("@")
  if (atIndex <= 0) {
    return trimmed
  }

  return trimmed.slice(0, atIndex)
}
