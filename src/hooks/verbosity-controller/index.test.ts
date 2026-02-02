import { describe, it, expect, beforeEach } from "bun:test"
import { createVerbosityControllerHook } from "./index"

describe("VerbosityControllerHook", () => {
	//#given a verbosity controller hook
	let hook: ReturnType<typeof createVerbosityControllerHook>

	beforeEach(() => {
		hook = createVerbosityControllerHook()
	})

	describe("tool.execute.after", () => {
		//#when token usage is below 70% (normal mode)
		it("should not inject instructions when usage is below 70%", async () => {
			const input = {
				tool: "read",
				sessionID: "test-session",
				callID: "call-1",
			}
			const output = {
				title: "Read File",
				output: "file contents here",
				metadata: {
					usage: { percentage: 0.5 },
				},
			}

			await hook["tool.execute.after"](input, output)

			//#then no instructions should be injected
			expect(output.output).toBe("file contents here")
		})

		//#when token usage is between 70-90% (concise mode)
		it("should inject concise instructions when usage is between 70-90%", async () => {
			const input = {
				tool: "read",
				sessionID: "test-session",
				callID: "call-2",
			}
			const output = {
				title: "Read File",
				output: "file contents here",
				metadata: {
					usage: { percentage: 0.75 },
				},
			}

			await hook["tool.execute.after"](input, output)

			//#then concise mode instructions should be injected
			expect(output.output).toContain("[SYSTEM: CONCISE MODE ACTIVE]")
			expect(output.output).toContain("Token usage is high")
		})

		//#when token usage is above 90% (minimal mode)
		it("should inject minimal instructions when usage is above 90%", async () => {
			const input = {
				tool: "read",
				sessionID: "test-session",
				callID: "call-3",
			}
			const output = {
				title: "Read File",
				output: "file contents here",
				metadata: {
					usage: { percentage: 0.95 },
				},
			}

			await hook["tool.execute.after"](input, output)

			//#then minimal mode instructions should be injected
			expect(output.output).toContain("[SYSTEM: MINIMAL MODE ACTIVE]")
			expect(output.output).toContain("Token usage is critically high")
		})

		//#when metadata has no usage info
		it("should not inject instructions when no usage info available", async () => {
			const input = {
				tool: "read",
				sessionID: "test-session",
				callID: "call-4",
			}
			const output = {
				title: "Read File",
				output: "file contents here",
				metadata: {},
			}

			await hook["tool.execute.after"](input, output)

			//#then no instructions should be injected
			expect(output.output).toBe("file contents here")
		})

		//#when metadata is undefined
		it("should handle undefined metadata gracefully", async () => {
			const input = {
				tool: "read",
				sessionID: "test-session",
				callID: "call-5",
			}
			const output = {
				title: "Read File",
				output: "file contents here",
				metadata: undefined as unknown,
			}

			await hook["tool.execute.after"](input, output)

			//#then no instructions should be injected and no error thrown
			expect(output.output).toBe("file contents here")
		})
	})
})
