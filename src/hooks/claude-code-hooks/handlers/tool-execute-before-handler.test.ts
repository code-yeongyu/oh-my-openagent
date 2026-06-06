import { afterAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import { restoreModuleMocksForTestFile } from "../../../testing/module-mock-lifecycle"

type PreToolUseMockResult = {
	readonly decision?: "deny" | "allow"
	readonly reason?: string
	readonly toolName?: string
	readonly hookName?: string
	readonly elapsedMs?: number
	readonly inputLines?: string
	readonly modifiedInput?: Record<string, unknown>
}

let preToolUseResult: PreToolUseMockResult = { decision: "allow" }

mock.module("../config", () => ({
	loadClaudeHooksConfig: async () => ({}),
}))

mock.module("../config-loader", () => ({
	loadPluginExtendedConfig: async () => ({}),
}))

mock.module("../pre-tool-use", () => ({
	executePreToolUseHooks: async () => preToolUseResult,
}))

afterAll(() => {
	mock.restore()
	restoreModuleMocksForTestFile(import.meta.url)
})

const { createToolExecuteBeforeHandler } = await import("./tool-execute-before-handler")

describe("createToolExecuteBeforeHandler", () => {
	beforeEach(() => {
		preToolUseResult = { decision: "allow" }
	})

	it("#given todowrite JSON parsing throws a non-Error value #when handler runs #then it reports the same parse error", async () => {
		// given
		const thrownValue = "parse failed"
		const parseSpy = spyOn(JSON, "parse").mockImplementation(() => {
			throw thrownValue
		})
		const handler = createToolExecuteBeforeHandler(
			{
				client: {
					tui: {
						showToast: async () => ({}),
					},
				},
				directory: "/repo",
			} as never,
			{},
		)

		try {
			// when
			const action = handler(
				{ tool: "todowrite", sessionID: "ses_test", callID: "call_test" },
				{ args: { todos: "[]" } },
			)

			// then
			await expect(action).rejects.toThrow("[todowrite ERROR] Failed to parse todos string as JSON")
		} finally {
			parseSpy.mockRestore()
		}
	})

	it("#given denial toast rejects with a non-Error value #when hook denies #then the hook denial still wins", async () => {
		// given
		const thrownValue = "toast failed"
		preToolUseResult = {
			decision: "deny",
			reason: "blocked by hook",
			toolName: "Write",
			hookName: "guard",
		}
		const handler = createToolExecuteBeforeHandler(
			{
				client: {
					tui: {
						showToast: async () => {
							throw thrownValue
						},
					},
				},
				directory: "/repo",
			} as never,
			{},
		)

		// when
		const action = handler(
			{ tool: "write", sessionID: "ses_test", callID: "call_test" },
			{ args: { filePath: "a.ts" } },
		)

		// then
		await expect(action).rejects.toThrow("blocked by hook")
	})
})
