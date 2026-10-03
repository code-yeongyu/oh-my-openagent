const MAX_BACKGROUND_NOTIFICATION_ERROR_LENGTH = 2_000

export function formatBackgroundNotificationError(error: string): string {
  if (error.length <= MAX_BACKGROUND_NOTIFICATION_ERROR_LENGTH) {
    return error
  }

  const truncationMarker = `... [truncated from ${error.length} characters]`
  const prefixLength = MAX_BACKGROUND_NOTIFICATION_ERROR_LENGTH - truncationMarker.length

  return `${error.slice(0, prefixLength)}${truncationMarker}`
}
