export function clearSessionTimeout(
  timeoutBySession: Map<string, ReturnType<typeof setTimeout>>,
  sessionID: string,
): void {
  const timeoutID = timeoutBySession.get(sessionID)
  if (timeoutID !== undefined) {
    clearTimeout(timeoutID)
    timeoutBySession.delete(sessionID)
  }
}

export function clearAllSessionTimeouts(
  timeoutBySession: Map<string, ReturnType<typeof setTimeout>>,
): void {
  for (const timeoutID of timeoutBySession.values()) {
    clearTimeout(timeoutID)
  }

  timeoutBySession.clear()
}
