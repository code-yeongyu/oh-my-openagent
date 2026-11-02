const MAX_NOTIFICATION_ERROR_CHARS = 2_000

export function formatNotificationError(error: string): string {
  if (error.length <= MAX_NOTIFICATION_ERROR_CHARS) return error
  const lastKept = error.charCodeAt(MAX_NOTIFICATION_ERROR_CHARS - 1)
  const end = lastKept >= 0xd800 && lastKept <= 0xdbff ? MAX_NOTIFICATION_ERROR_CHARS - 1 : MAX_NOTIFICATION_ERROR_CHARS
  return `${error.slice(0, end)}... (truncated, ${error.length} chars)`
}
