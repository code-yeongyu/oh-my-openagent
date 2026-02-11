import { describe, it, expect } from "bun:test"
import { appendToOutput } from "./hook-output-guard"

describe("appendToOutput", () => {
	describe("#given output.output is a normal string", () => {
		it("#then should append text to existing output", () => {
			const output = { output: "original" }
			appendToOutput(output, " appended")
			expect(output.output).toBe("original appended")
		})
	})

	describe("#given output.output is an empty string", () => {
		it("#then should append text directly", () => {
			const output = { output: "" }
			appendToOutput(output, "new text")
			expect(output.output).toBe("new text")
		})
	})

	describe("#given output.output is undefined (MCP tool response)", () => {
		it("#then should initialize with the text instead of crashing", () => {
			const output = { output: undefined as unknown as string }
			appendToOutput(output, "reminder message")
			expect(output.output).toBe("reminder message")
		})
	})

	describe("#given output.output is null", () => {
		it("#then should initialize with the text", () => {
			const output = { output: null as unknown as string }
			appendToOutput(output, "context injection")
			expect(output.output).toBe("context injection")
		})
	})

	describe("#given output.output is a non-string object", () => {
		it("#then should not modify the output to preserve structured data", () => {
			const structured = { key: "value" }
			const output = { output: structured as unknown as string }
			appendToOutput(output, "should not corrupt")
			expect(output.output).toBe(structured as unknown as string)
		})
	})

	describe("#given output.output is a number", () => {
		it("#then should not modify the output", () => {
			const output = { output: 42 as unknown as string }
			appendToOutput(output, " text")
			expect(output.output).toBe(42 as unknown as string)
		})
	})

	describe("#given multiple sequential appends", () => {
		it("#then should accumulate all text", () => {
			const output = { output: "base" }
			appendToOutput(output, "\nfirst")
			appendToOutput(output, "\nsecond")
			expect(output.output).toBe("base\nfirst\nsecond")
		})
	})

	describe("#given multiple appends starting from undefined", () => {
		it("#then should initialize once and accumulate", () => {
			const output = { output: undefined as unknown as string }
			appendToOutput(output, "first")
			appendToOutput(output, " second")
			expect(output.output).toBe("first second")
		})
	})
})
