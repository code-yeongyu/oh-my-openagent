import { resolveSessionEventID } from "../shared/event-session-id"

type EventInput = { event: { type: string; properties?: Record<string, unknown> } }
type SessionStatus = { type: string }

export function normalizeSessionStatusToIdle(input: EventInput): EventInput | null {
	if (input.event.type !== "session.status") return null

	const props = input.event.properties
	if (!props) return null

	const status = props.status as SessionStatus | undefined
	if (!status || status.type !== "idle") return null

	const sessionID = resolveSessionEventID(props)
	if (!sessionID) return null

	return {
		event: {
			type: "session.idle",
			properties: { sessionID },
		},
	}
}
