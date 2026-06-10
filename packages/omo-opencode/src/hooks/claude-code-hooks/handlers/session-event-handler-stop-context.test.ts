import { afterAll, describe, expect, mock, test } from "bun:test"
import { restoreModuleMocksForTestFile } from "../../../testing/module-mock-lifecycle"

const executeStopHooks = mock(async (_context: { transcriptPath?: string }) => ({
	block: false,
}))

mock.module("../config", () => ({
	clearClaudeHooksConfigCache: () => {},
	loadClaudeHooksConfig: async () => ({
		Stop: [{ matcher: "*", hooks: [{ type: "command", command: "true" }] }],
	}),
}))

mock.module("../config-loader", () => ({
	clearPluginExtendedConfigCache: () => {},
	loadPluginExtendedConfig: async () => ({}),
}))

mock.module("../stop", () => ({
	executeStopHooks,
}))

mock.module("../transcript", () => ({
	clearTranscriptCache: () => {},
	getTranscriptPath: (sessionId: string) => `/mocked/transcripts/${sessionId}.jsonl`,
}))

afterAll(() => {
	mock.restore()
	restoreModuleMocksForTestFile(import.meta.url)
})

const { createSessionEventHandler } = await import("./session-event-handler")

describe("createSessionEventHandler stop context", () => {
	test("#given an idle session #when stop hooks are executed #then the context carries the session transcript path", async () => {
		//#given
		const handler = createSessionEventHandler(
			{
				directory: "/repo",
				client: {
					session: {
						get: async () => ({ data: {} }),
						prompt: async () => undefined,
					},
				},
			} as never,
			{},
		)

		//#when
		await handler({
			event: { type: "session.idle", properties: { sessionID: "ses_stop_transcript" } },
		})

		//#then
		expect(executeStopHooks).toHaveBeenCalledTimes(1)
		const stopContext = executeStopHooks.mock.calls[0]?.[0]
		expect(stopContext?.transcriptPath).toBe("/mocked/transcripts/ses_stop_transcript.jsonl")
	})
})
