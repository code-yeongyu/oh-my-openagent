type SessionState = {
	isRecovering?: boolean
}

export function createLoopSessionRecovery(options?: { recoveryWindowMs?: number }) {
	const recoveryWindowMs = options?.recoveryWindowMs ?? 5000
	const sessions = new Map<string, SessionState>()

	function getSessionState(sessionID: string): SessionState {
		let state = sessions.get(sessionID)
		if (!state) {
			state = {}
			sessions.set(sessionID, state)
		}
		return state
	}

	return {
		isRecovering(sessionID: string): boolean {
			return getSessionState(sessionID).isRecovering === true
		},
		markRecovering(sessionID: string): void {
			const state = getSessionState(sessionID)
			state.isRecovering = true
			setTimeout(() => {
				state.isRecovering = false
			}, recoveryWindowMs)
		},
		clear(sessionID: string): void {
			sessions.delete(sessionID)
		},
	}
}
