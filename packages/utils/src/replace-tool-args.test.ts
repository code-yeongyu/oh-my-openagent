import { describe, it, expect } from "bun:test"
import { replaceToolArgs } from "./replace-tool-args"

describe("replaceToolArgs", () => {
	describe("#given a mutable output.args object", () => {
		it("#when patching a single property #then the output.args contains the patched value", () => {
			// given
			const output = { args: { command: "git status", timeout: 30 } as Record<string, unknown> }

			// when
			replaceToolArgs(output, { command: "git log" })

			// then
			expect(output.args.command).toBe("git log")
			expect(output.args.timeout).toBe(30)
		})

		it("#when patching multiple properties #then all patched values are present", () => {
			// given
			const output = { args: { url: "http://old.com", format: "text" } as Record<string, unknown> }

			// when
			replaceToolArgs(output, { url: "http://new.com", format: "markdown" })

			// then
			expect(output.args.url).toBe("http://new.com")
			expect(output.args.format).toBe("markdown")
		})

		it("#when patching #then the original args object is not the same reference", () => {
			// given
			const originalArgs = { command: "echo hi" } as Record<string, unknown>
			const output = { args: originalArgs }

			// when
			replaceToolArgs(output, { command: "echo bye" })

			// then
			expect(output.args).not.toBe(originalArgs)
			expect(originalArgs.command).toBe("echo hi")
		})
	})

	describe("#given a frozen output.args object", () => {
		it("#when patching a single property #then no TypeError is thrown and the value is updated", () => {
			// given
			const output = { args: Object.freeze({ command: "git status", timeout: 30 }) as Record<string, unknown> }

			// when / then
			expect(() => replaceToolArgs(output, { command: "git log" })).not.toThrow()
			expect(output.args.command).toBe("git log")
			expect(output.args.timeout).toBe(30)
		})

		it("#when patching with Object-typed value #then no TypeError is thrown", () => {
			// given
			const output = { args: Object.freeze({ todos: "[]" }) as Record<string, unknown> }
			const parsed = [{ id: "1", content: "test", status: "pending" }]

			// when / then
			expect(() => replaceToolArgs(output, { todos: parsed })).not.toThrow()
			expect(output.args.todos).toEqual(parsed)
		})

		it("#when patching url on frozen webfetch args #then no TypeError is thrown", () => {
			// given
			const output = { args: Object.freeze({ url: "http://old.com", format: "markdown" }) as Record<string, unknown> }

			// when / then
			expect(() => replaceToolArgs(output, { url: "http://redirected.com" })).not.toThrow()
			expect(output.args.url).toBe("http://redirected.com")
			expect(output.args.format).toBe("markdown")
		})

		it("#when patching command with env prefix on frozen bash args #then no TypeError is thrown", () => {
			// given
			const output = { args: Object.freeze({ command: "git rebase --continue" }) as Record<string, unknown> }

			// when / then
			expect(() => replaceToolArgs(output, { command: "GIT_EDITOR=: git rebase --continue" })).not.toThrow()
			expect(output.args.command).toBe("GIT_EDITOR=: git rebase --continue")
		})

		it("#when patching prompt on frozen task args #then no TypeError is thrown", () => {
			// given
			const output = { args: Object.freeze({ prompt: "Do the thing", category: "quick" }) as Record<string, unknown> }

			// when / then
			expect(() => replaceToolArgs(output, { prompt: "[DIRECTIVE] Do the thing" })).not.toThrow()
			expect(output.args.prompt).toBe("[DIRECTIVE] Do the thing")
			expect(output.args.category).toBe("quick")
		})

		it("#when stripping null bytes from frozen command #then no TypeError is thrown", () => {
			// given
			const frozenCommand = "echo \x00hello"
			const output = { args: Object.freeze({ command: frozenCommand }) as Record<string, unknown> }

			// when / then
			expect(() => replaceToolArgs(output, { command: "echo hello" })).not.toThrow()
			expect(output.args.command).toBe("echo hello")
		})

		it("#when replacing truncated question labels on frozen args #then no TypeError is thrown", () => {
			// given
			const output = {
				args: Object.freeze({
					questions: [{ question: "Pick", options: [{ label: "A very long label that should be truncated" }] }],
				}) as Record<string, unknown>,
			}
			const truncated = {
				questions: [{ question: "Pick", options: [{ label: "A very long label that sho..." }] }],
			}

			// when / then
			expect(() => replaceToolArgs(output, truncated)).not.toThrow()
			expect((output.args.questions as Array<{ options: Array<{ label: string }> }>)[0].options[0].label).toBe(
				"A very long label that sho...",
			)
		})

		it("#when replacing modifiedInput from PreToolUse hook on frozen args #then no TypeError is thrown", () => {
			// given
			const output = { args: Object.freeze({ filePath: "/old/path.ts" }) as Record<string, unknown> }

			// when / then
			expect(() => replaceToolArgs(output, { filePath: "/new/path.ts" })).not.toThrow()
			expect(output.args.filePath).toBe("/new/path.ts")
		})

		it("#when replacing todo snapshot on frozen args #then no TypeError is thrown", () => {
			// given
			const output = {
				args: Object.freeze({
					todos: [{ content: "bootstrap", status: "pending" }],
				}) as Record<string, unknown>,
			}
			const snapshot = [
				{ content: "Real task 1", status: "in_progress" },
				{ content: "Real task 2", status: "pending" },
			]

			// when / then
			expect(() => replaceToolArgs(output, { todos: snapshot })).not.toThrow()
			expect(output.args.todos).toEqual(snapshot)
		})
	})
})
