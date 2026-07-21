import { describe, expect, test } from "bun:test"

import { fuzzyMatchModel } from "./model-availability"

describe("fuzzyMatchModel", () => {
	test("#given kimi dash and dot variants #when matching #then normalizes the version separator symmetrically", () => {
		const available = new Set(["moonshot/kimi-k2-6"])
		const result = fuzzyMatchModel("kimi-k2.6", available, ["moonshot"])
		expect(result).toBe("moonshot/kimi-k2-6")
	})

	test("#given glm dash and dot variants #when matching #then normalizes the version separator symmetrically", () => {
		const available = new Set(["zai/glm-5.1"])
		const result = fuzzyMatchModel("glm-5-1", available, ["zai"])
		expect(result).toBe("zai/glm-5.1")
	})

	test("#given gpt dash and dot variants #when matching #then normalizes the version separator symmetrically", () => {
		const available = new Set(["openai/gpt-5-4"])
		const result = fuzzyMatchModel("gpt-5.4", available, ["openai"])
		expect(result).toBe("openai/gpt-5-4")
	})

	test("#given a stable model and only a preview candidate #when matching #then rejects the preview alias", () => {
		const available = new Set(["google/gemini-3.6-flash-preview"])
		const result = fuzzyMatchModel("google/gemini-3.6-flash", available, ["google"])
		expect(result).toBeNull()
	})
})
