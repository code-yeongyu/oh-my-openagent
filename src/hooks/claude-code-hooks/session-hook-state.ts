export const sessionFirstMessageProcessed = new Set<string>()

export const sessionErrorState = new Map<string, { hasError: boolean; errorMessage?: string }>()

export const sessionInterruptState = new Map<string, { interrupted: boolean }>()

export function clearSessionHookState(sessionID: string): void {
	sessionErrorState.delete(sessionID)
	sessionInterruptState.delete(sessionID)
	sessionFirstMessageProcessed.delete(sessionID)
}
