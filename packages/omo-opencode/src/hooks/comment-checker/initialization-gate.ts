let initialized = false

export function ensureCommentCheckerInitialization(initializer: () => void): void {
  if (initialized) return
  initialized = true
  initializer()
}

export function _resetCommentCheckerInitializationForTesting(): void {
  initialized = false
}
