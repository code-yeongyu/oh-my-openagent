export const sessionFirstMessageProcessed = new Set<string>()

export const sessionErrorState = new Map<string, { hasError: boolean; errorMessage?: string }>()

export const sessionInterruptState = new Map<string, { interrupted: boolean }>()

export function clearSessionHookState(sessionID: string): void {
	sessionErrorState.delete(sessionID)
	sessionInterruptState.delete(sessionID)
	// sessionFirstMessageProcessed must NOT be cleared on idle.
	// It tracks whether the first message of a session has been processed,
	// so that SessionStart hooks fire only once per session. Clearing it
	// on idle (which fires after every model response) makes isFirstMessage
	// always return true, causing SessionStart hooks to fire on every
	// prompt instead of only the first one.
}

export function clearAllSessionHookState(): void {
	sessionErrorState.clear()
	sessionInterruptState.clear()
	sessionFirstMessageProcessed.clear()
}
