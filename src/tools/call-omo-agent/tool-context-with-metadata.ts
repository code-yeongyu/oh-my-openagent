export type ToolContextWithMetadata = {
	sessionID: string
	messageID: string
	agent: string
	directory?: string
	abort: AbortSignal
	metadata?: (input: {
		title?: string
		metadata?: Record<string, unknown>
	}) => void
}
