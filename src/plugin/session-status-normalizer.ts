type EventInput = { event: { type: string; properties?: Record<string, unknown> } }
type SessionStatus = { type: string }

export function normalizeSessionStatusToIdle(input: EventInput): EventInput | null {
	if (input.event.type !== "session.status") return null

	const props = input.event.properties
	if (!props) return null

	const status = props.status as SessionStatus | undefined
	if (!status || status.type !== "idle") return null

	const sessionID = props.sessionID as string | undefined
	if (!sessionID) return null

	return {
		event: {
			type: "session.idle",
			properties: { sessionID },
		},
	}
}
