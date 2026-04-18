import { describe, expect, test } from "bun:test"
import { parseVariantFromModelID, parseModelString } from "./model-string-parser"

describe("parseVariantFromModelID", () => {
	describe("#given parenthesized variant", () => {
		test("#when model has (high) suffix #then extracts variant", () => {
			// given
			const input = "claude-opus-4-7(high)"

			// when
			const result = parseVariantFromModelID(input)

			// then
			expect(result.modelID).toBe("claude-opus-4-7")
			expect(result.variant).toBe("high")
		})
	})

	describe("#given space-separated known variant", () => {
		test("#when model has ' high' suffix #then extracts variant", () => {
			// given
			const input = "gpt-5.4 high"

			// when
			const result = parseVariantFromModelID(input)

			// then
			expect(result.modelID).toBe("gpt-5.4")
			expect(result.variant).toBe("high")
		})
	})

	describe("#given colon-separated cloud variant", () => {
		test("#when model has :cloud suffix #then strips :cloud and returns cloud variant", () => {
			// given
			const input = "kimi-k2.5:cloud"

			// when
			const result = parseVariantFromModelID(input)

			// then
			expect(result.modelID).toBe("kimi-k2.5")
			expect(result.variant).toBe("cloud")
		})

		test("#when glm-5.1 has :cloud suffix #then strips :cloud and returns cloud variant", () => {
			// given
			const input = "glm-5.1:cloud"

			// when
			const result = parseVariantFromModelID(input)

			// then
			expect(result.modelID).toBe("glm-5.1")
			expect(result.variant).toBe("cloud")
		})

		test("#when model has :thinking suffix #then strips :thinking and returns thinking variant", () => {
			// given
			const input = "glm-5.1:thinking"

			// when
			const result = parseVariantFromModelID(input)

			// then
			expect(result.modelID).toBe("glm-5.1")
			expect(result.variant).toBe("thinking")
		})

		test("#when model has unknown :tag suffix #then keeps tag as part of model ID", () => {
			// given
			const input = "llama-3:instruct"

			// when
			const result = parseVariantFromModelID(input)

			// then
			expect(result.modelID).toBe("llama-3:instruct")
			expect(result.variant).toBeUndefined()
		})

		test("#when model has :cloud with version-like tag #then strips :cloud", () => {
			// given
			const input = "deepseek-r1:cloud"

			// when
			const result = parseVariantFromModelID(input)

			// then
			expect(result.modelID).toBe("deepseek-r1")
			expect(result.variant).toBe("cloud")
		})
	})

	describe("#given plain model ID without variant", () => {
		test("#when model has no variant suffix #then returns model ID as-is", () => {
			// given
			const input = "kimi-k2.5"

			// when
			const result = parseVariantFromModelID(input)

			// then
			expect(result.modelID).toBe("kimi-k2.5")
			expect(result.variant).toBeUndefined()
		})

		test("#when model is empty #then returns empty model ID", () => {
			// given
			const input = ""

			// when
			const result = parseVariantFromModelID(input)

			// then
			expect(result.modelID).toBe("")
		})
	})
})

describe("parseModelString", () => {
	describe("#given ollama-cloud model with :cloud suffix", () => {
		test("#when parsing ollama-cloud/kimi-k2.5:cloud #then extracts provider, model, variant", () => {
			// given
			const input = "ollama-cloud/kimi-k2.5:cloud"

			// when
			const result = parseModelString(input)

			// then
			expect(result).toBeDefined()
			expect(result!.providerID).toBe("ollama-cloud")
			expect(result!.modelID).toBe("kimi-k2.5")
			expect(result!.variant).toBe("cloud")
		})

		test("#when parsing ollama-cloud/glm-5.1:cloud #then extracts provider, model, variant", () => {
			// given
			const input = "ollama-cloud/glm-5.1:cloud"

			// when
			const result = parseModelString(input)

			// then
			expect(result).toBeDefined()
			expect(result!.providerID).toBe("ollama-cloud")
			expect(result!.modelID).toBe("glm-5.1")
			expect(result!.variant).toBe("cloud")
		})
	})

	describe("#given ollama-cloud model without :cloud suffix", () => {
		test("#when parsing ollama-cloud/kimi-k2.5 #then returns model without variant", () => {
			// given
			const input = "ollama-cloud/kimi-k2.5"

			// when
			const result = parseModelString(input)

			// then
			expect(result).toBeDefined()
			expect(result!.providerID).toBe("ollama-cloud")
			expect(result!.modelID).toBe("kimi-k2.5")
			expect(result!.variant).toBeUndefined()
		})
	})

	describe("#given standard provider/model format", () => {
		test("#when parsing anthropic/claude-opus-4-7 #then returns correct provider and model", () => {
			// given
			const input = "anthropic/claude-opus-4-7"

			// when
			const result = parseModelString(input)

			// then
			expect(result).toBeDefined()
			expect(result!.providerID).toBe("anthropic")
			expect(result!.modelID).toBe("claude-opus-4-7")
			expect(result!.variant).toBeUndefined()
		})

		test("#when parsing opencode/gpt-5.4 medium #then returns provider, model, variant", () => {
			// given
			const input = "opencode/gpt-5.4 medium"

			// when
			const result = parseModelString(input)

			// then
			expect(result).toBeDefined()
			expect(result!.providerID).toBe("opencode")
			expect(result!.modelID).toBe("gpt-5.4")
			expect(result!.variant).toBe("medium")
		})
	})

	describe("#given invalid input", () => {
		test("#when parsing empty string #then returns undefined", () => {
			// given
			const input = ""

			// when
			const result = parseModelString(input)

			// then
			expect(result).toBeUndefined()
		})

		test("#when parsing model without provider #then returns undefined", () => {
			// given
			const input = "kimi-k2.5"

			// when
			const result = parseModelString(input)

			// then
			expect(result).toBeUndefined()
		})
	})
})