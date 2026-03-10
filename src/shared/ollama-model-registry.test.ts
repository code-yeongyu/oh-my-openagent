import { describe, it, expect } from "bun:test"

import {
	OLLAMA_MODELS,
	OLLAMA_SMALL_MODEL,
	OLLAMA_MEDIUM_MODEL,
	OLLAMA_LARGE_MODEL,
	OLLAMA_VISION_MODEL,
	getOllamaModelForTier,
} from "./ollama-model-registry"

describe("ollama-model-registry", () => {
	describe("OLLAMA_MODELS", () => {
		describe("#given the model registry", () => {
			describe("#when checking tier coverage", () => {
				it("#then has entries for the small tier", () => {
					const smallModels = OLLAMA_MODELS.filter((m) => m.tier === "small")
					expect(smallModels.length).toBeGreaterThan(0)
				})

				it("#then has entries for the medium tier", () => {
					const mediumModels = OLLAMA_MODELS.filter((m) => m.tier === "medium")
					expect(mediumModels.length).toBeGreaterThan(0)
				})

				it("#then has entries for the large tier", () => {
					const largeModels = OLLAMA_MODELS.filter((m) => m.tier === "large")
					expect(largeModels.length).toBeGreaterThan(0)
				})

				it("#then has entries for the vision tier", () => {
					const visionModels = OLLAMA_MODELS.filter((m) => m.tier === "vision")
					expect(visionModels.length).toBeGreaterThan(0)
				})
			})

			describe("#when inspecting model entry shape", () => {
				it("#then each entry has id, tier, supportsTools, and supportsVision fields", () => {
					for (const entry of OLLAMA_MODELS) {
						expect(entry).toHaveProperty("id")
						expect(entry).toHaveProperty("tier")
						expect(entry).toHaveProperty("supportsTools")
						expect(entry).toHaveProperty("supportsVision")
						expect(typeof entry.id).toBe("string")
						expect(typeof entry.supportsTools).toBe("boolean")
						expect(typeof entry.supportsVision).toBe("boolean")
					}
				})
			})
		})
	})

	describe("model constants", () => {
		describe("#given the exported model ID constants", () => {
			describe("#when reading OLLAMA_SMALL_MODEL", () => {
				it("#then equals llama3.2:8b", () => {
					expect(OLLAMA_SMALL_MODEL).toBe("llama3.2:8b")
				})
			})

			describe("#when reading OLLAMA_MEDIUM_MODEL", () => {
				it("#then equals qwen2.5-coder:32b", () => {
					expect(OLLAMA_MEDIUM_MODEL).toBe("qwen2.5-coder:32b")
				})
			})

			describe("#when reading OLLAMA_LARGE_MODEL", () => {
				it("#then equals llama3.1:70b", () => {
					expect(OLLAMA_LARGE_MODEL).toBe("llama3.1:70b")
				})
			})

			describe("#when reading OLLAMA_VISION_MODEL", () => {
				it("#then equals llama3.2-vision:11b", () => {
					expect(OLLAMA_VISION_MODEL).toBe("llama3.2-vision:11b")
				})
			})
		})
	})

	describe("getOllamaModelForTier", () => {
		describe("#given the small tier", () => {
			describe("#when calling getOllamaModelForTier", () => {
				it("#then returns llama3.2:8b", () => {
					expect(getOllamaModelForTier("small")).toBe("llama3.2:8b")
				})
			})
		})

		describe("#given the medium tier", () => {
			describe("#when calling getOllamaModelForTier", () => {
				it("#then returns qwen2.5-coder:32b", () => {
					expect(getOllamaModelForTier("medium")).toBe("qwen2.5-coder:32b")
				})
			})
		})

		describe("#given the large tier", () => {
			describe("#when calling getOllamaModelForTier", () => {
				it("#then returns llama3.1:70b", () => {
					expect(getOllamaModelForTier("large")).toBe("llama3.1:70b")
				})
			})
		})

		describe("#given the vision tier", () => {
			describe("#when calling getOllamaModelForTier", () => {
				it("#then returns llama3.2-vision:11b", () => {
					expect(getOllamaModelForTier("vision")).toBe("llama3.2-vision:11b")
				})
			})
		})
	})
})
