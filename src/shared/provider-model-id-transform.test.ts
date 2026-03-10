import { describe, it, expect } from "bun:test"

import { transformModelForProvider } from "./provider-model-id-transform"

describe("transformModelForProvider", () => {
	describe("ollama provider", () => {
		describe("#given the ollama provider and a small model", () => {
			describe("#when transformModelForProvider is called", () => {
				it("#then passes llama3.2:8b through unchanged", () => {
					const result = transformModelForProvider("ollama", "llama3.2:8b")
					expect(result).toBe("llama3.2:8b")
				})
			})
		})

		describe("#given the ollama provider and a medium model", () => {
			describe("#when transformModelForProvider is called", () => {
				it("#then passes qwen2.5-coder:32b through unchanged", () => {
					const result = transformModelForProvider("ollama", "qwen2.5-coder:32b")
					expect(result).toBe("qwen2.5-coder:32b")
				})
			})
		})

		describe("#given the ollama provider and a vision model", () => {
			describe("#when transformModelForProvider is called", () => {
				it("#then passes llama3.2-vision:11b through unchanged", () => {
					const result = transformModelForProvider("ollama", "llama3.2-vision:11b")
					expect(result).toBe("llama3.2-vision:11b")
				})
			})
		})
	})

	describe("github-copilot provider", () => {
		describe("#given the github-copilot provider and a claude model with dashes", () => {
			describe("#when transformModelForProvider is called", () => {
				it("#then transforms claude-opus-4-6 to claude-opus-4.6", () => {
					const result = transformModelForProvider("github-copilot", "claude-opus-4-6")
					expect(result).toBe("claude-opus-4.6")
				})
			})
		})
	})

	describe("google provider", () => {
		describe("#given the google provider and a gemini model requiring preview suffix", () => {
			describe("#when transformModelForProvider is called", () => {
				it("#then transforms gemini-3-flash to gemini-3-flash-preview", () => {
					const result = transformModelForProvider("google", "gemini-3-flash")
					expect(result).toBe("gemini-3-flash-preview")
				})
			})
		})
	})
})
