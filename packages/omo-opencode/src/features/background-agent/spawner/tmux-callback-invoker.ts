import type { OnSubagentSessionCreated } from "../constants"

export interface TmuxCallbackInvocation {
	callback: OnSubagentSessionCreated | undefined
	tmuxEnabled: boolean
	suppress: boolean
	sessionID: string
	parentID: string
	title: string
	log: (message: string, data?: unknown) => void
}

export function invokeTmuxSessionCreatedCallback(
	invocation: TmuxCallbackInvocation,
): void {
	const {
		callback,
		tmuxEnabled,
		suppress,
		sessionID,
		parentID,
		title,
		log,
	} = invocation

	log("[background-agent] Checking tmux callback", {
		hasCallback: Boolean(callback),
		tmuxEnabled,
		suppress,
	})

	if (callback && tmuxEnabled && !suppress) {
		void callback({ sessionID, parentID, title }).catch((error) => {
			log("[background-agent] tmux spawn failed:", error)
		})
		return
	}

	log("[background-agent] Skipping tmux callback - condition not met")
}
