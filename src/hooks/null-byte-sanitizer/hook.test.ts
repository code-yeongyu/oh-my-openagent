import { describe, it, expect } from "bun:test"
import { sanitizeToolArgsNullBytes } from "./hook"

describe("sanitizeToolArgsNullBytes", () => {
	describe("#given tool args with null bytes", () => {
		it("#then strips null bytes from string args", () => {
			const input = { tool: "bash" }
			const output = { args: { command: "echo\x00 hello\x00" } }

			sanitizeToolArgsNullBytes(input, output)

			expect(output.args.command).toBe("echo hello")
		})
	})

	describe("#given tool args without null bytes", () => {
		it("#then leaves args unchanged", () => {
			const input = { tool: "bash" }
			const output = { args: { command: "echo hello" } }

			sanitizeToolArgsNullBytes(input, output)

			expect(output.args.command).toBe("echo hello")
		})
	})

	describe("#given non-string args", () => {
		it("#then skips non-string values", () => {
			const input = { tool: "bash" }
			const output = { args: { timeout: 5000, command: "ls\x00" } as Record<string, unknown> }

			sanitizeToolArgsNullBytes(input, output)

			expect(output.args.timeout).toBe(5000)
			expect(output.args.command).toBe("ls")
		})
	})

	describe("#given multiple string args with null bytes", () => {
		it("#then strips null bytes from all string args", () => {
			const input = { tool: "write" }
			const output = {
				args: {
					filePath: "/tmp/\x00test.ts",
					content: "const x\x00 = 1",
				},
			}

			sanitizeToolArgsNullBytes(input, output)

			expect(output.args.filePath).toBe("/tmp/test.ts")
			expect(output.args.content).toBe("const x = 1")
		})
	})
})
