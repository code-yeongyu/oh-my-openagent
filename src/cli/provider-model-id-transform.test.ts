import { describe, expect, test } from "bun:test"

import { transformModelForProvider } from "./provider-model-id-transform"

describe("transformModelForProvider", () => {
	describe("github-copilot provider", () => {
		test("transforms claude-opus-4-6 to claude-opus-4.6", () => {
			// #given github-copilot provider and claude-opus-4-6 model
			const provider = "github-copilot"
			const model = "claude-opus-4-6"

			// #when transformModelForProvider is called
			const result = transformModelForProvider(provider, model)

			// #then should transform to claude-opus-4.6
			expect(result).toBe("claude-opus-4.6")
		})

		test("transforms claude-sonnet-4-5 to claude-sonnet-4.5", () => {
			// #given github-copilot provider and claude-sonnet-4-5 model
			const provider = "github-copilot"
			const model = "claude-sonnet-4-5"

			// #when transformModelForProvider is called
			const result = transformModelForProvider(provider, model)

			// #then should transform to claude-sonnet-4.5
			expect(result).toBe("claude-sonnet-4.5")
		})

		test("transforms claude-haiku-4-5 to claude-haiku-4.5", () => {
			// #given github-copilot provider and claude-haiku-4-5 model
			const provider = "github-copilot"
			const model = "claude-haiku-4-5"

			// #when transformModelForProvider is called
			const result = transformModelForProvider(provider, model)

			// #then should transform to claude-haiku-4.5
			expect(result).toBe("claude-haiku-4.5")
		})

		test("transforms gemini-3-pro to gemini-3-pro-preview", () => {
			// #given github-copilot provider and gemini-3-pro model
			const provider = "github-copilot"
			const model = "gemini-3-pro"

			// #when transformModelForProvider is called
			const result = transformModelForProvider(provider, model)

			// #then should transform to gemini-3-pro-preview
			expect(result).toBe("gemini-3-pro-preview")
		})

		test("transforms gemini-3-flash to gemini-3-flash-preview", () => {
			// #given github-copilot provider and gemini-3-flash model
			const provider = "github-copilot"
			const model = "gemini-3-flash"

			// #when transformModelForProvider is called
			const result = transformModelForProvider(provider, model)

			// #then should transform to gemini-3-flash-preview
			expect(result).toBe("gemini-3-flash-preview")
		})
	})

	describe("google provider", () => {
		test("transforms gemini-3-flash to gemini-3-flash-preview", () => {
			// #given google provider and gemini-3-flash model
			const provider = "google"
			const model = "gemini-3-flash"

			// #when transformModelForProvider is called
			const result = transformModelForProvider(provider, model)

			// #then should transform to gemini-3-flash-preview
			expect(result).toBe("gemini-3-flash-preview")
		})

		test("transforms gemini-3-pro to gemini-3-pro-preview", () => {
			// #given google provider and gemini-3-pro model
			const provider = "google"
			const model = "gemini-3-pro"

			// #when transformModelForProvider is called
			const result = transformModelForProvider(provider, model)

			// #then should transform to gemini-3-pro-preview
			expect(result).toBe("gemini-3-pro-preview")
		})

		test("passes through other gemini models unchanged", () => {
			// #given google provider and gemini-2.5-flash model
			const provider = "google"
			const model = "gemini-2.5-flash"

			// #when transformModelForProvider is called
			const result = transformModelForProvider(provider, model)

			// #then should pass through unchanged
			expect(result).toBe("gemini-2.5-flash")
		})

		test("prevents double transformation of gemini-3-flash-preview", () => {
			// #given google provider and gemini-3-flash-preview model (already transformed)
			const provider = "google"
			const model = "gemini-3-flash-preview"

			// #when transformModelForProvider is called
			const result = transformModelForProvider(provider, model)

			// #then should NOT become gemini-3-flash-preview-preview
			expect(result).toBe("gemini-3-flash-preview")
		})

		test("prevents double transformation of gemini-3-pro-preview", () => {
			// #given google provider and gemini-3-pro-preview model (already transformed)
			const provider = "google"
			const model = "gemini-3-pro-preview"

			// #when transformModelForProvider is called
			const result = transformModelForProvider(provider, model)

			// #then should NOT become gemini-3-pro-preview-preview
			expect(result).toBe("gemini-3-pro-preview")
		})

		test("does not transform claude models for google provider", () => {
			// #given google provider and claude-opus-4-6 model
			const provider = "google"
			const model = "claude-opus-4-6"

			// #when transformModelForProvider is called
			const result = transformModelForProvider(provider, model)

			// #then should pass through unchanged (google doesn't use claude)
			expect(result).toBe("claude-opus-4-6")
		})
	})

	describe("unknown provider", () => {
		test("passes model through unchanged for unknown provider", () => {
			// #given unknown provider and any model
			const provider = "unknown-provider"
			const model = "some-model"

			// #when transformModelForProvider is called
			const result = transformModelForProvider(provider, model)

			// #then should pass through unchanged
			expect(result).toBe("some-model")
		})

		test("passes gemini-3-flash through unchanged for unknown provider", () => {
			// #given unknown provider and gemini-3-flash model
			const provider = "unknown-provider"
			const model = "gemini-3-flash"

			// #when transformModelForProvider is called
			const result = transformModelForProvider(provider, model)

			// #then should pass through unchanged (no transformation for unknown provider)
			expect(result).toBe("gemini-3-flash")
		})
	})
})
