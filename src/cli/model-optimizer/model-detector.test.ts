import { describe, expect, it, mock, spyOn, beforeEach, afterEach } from "bun:test"
import {
	parseModelsOutput,
	classifyTier,
	extractProvider,
	detectAvailableModels,
} from "./model-detector"
import type { ModelInfo, ModelTier } from "./types"

describe("model-detector", () => {
	describe("extractProvider", () => {
		it("#given a standard model ID #when extracting provider #then returns provider name", () => {
			expect(extractProvider("anthropic/claude-opus-4-5")).toBe("anthropic")
		})

		it("#given openai model ID #when extracting provider #then returns openai", () => {
			expect(extractProvider("openai/gpt-5.2")).toBe("openai")
		})

		it("#given google model ID #when extracting provider #then returns google", () => {
			expect(extractProvider("google/gemini-3-pro-preview")).toBe("google")
		})

		it("#given opencode model ID #when extracting provider #then returns opencode", () => {
			expect(extractProvider("opencode/grok-code")).toBe("opencode")
		})

		it("#given model ID without slash #when extracting provider #then returns empty string", () => {
			expect(extractProvider("claude-opus-4-5")).toBe("")
		})

		it("#given empty string #when extracting provider #then returns empty string", () => {
			expect(extractProvider("")).toBe("")
		})

		it("#given model ID with multiple slashes #when extracting provider #then returns first part", () => {
			expect(extractProvider("provider/model/version")).toBe("provider")
		})
	})

	describe("classifyTier", () => {
		describe("flagship tier", () => {
			it("#given opus model #when classifying tier #then returns flagship", () => {
				expect(classifyTier("claude-opus-4-5")).toBe("flagship")
			})

			it("#given gpt-5 model #when classifying tier #then returns flagship", () => {
				expect(classifyTier("gpt-5.2")).toBe("flagship")
			})

			it("#given gpt-4 model #when classifying tier #then returns flagship", () => {
				expect(classifyTier("gpt-4")).toBe("flagship")
			})

			it("#given pro model #when classifying tier #then returns flagship", () => {
				expect(classifyTier("gemini-3-pro-preview")).toBe("flagship")
			})

			it("#given o1 model #when classifying tier #then returns flagship", () => {
				expect(classifyTier("o1-preview")).toBe("flagship")
			})

			it("#given o3 model #when classifying tier #then returns flagship", () => {
				expect(classifyTier("o3-mini")).toBe("flagship")
			})
		})

		describe("standard tier", () => {
			it("#given sonnet model #when classifying tier #then returns standard", () => {
				expect(classifyTier("claude-sonnet-4-5")).toBe("standard")
			})

			it("#given flash model (not flash-lite) #when classifying tier #then returns standard", () => {
				expect(classifyTier("gemini-3-flash")).toBe("standard")
			})

			it("#given gpt-4o-mini model #when classifying tier #then returns standard", () => {
				expect(classifyTier("gpt-4o-mini")).toBe("standard")
			})

			it("#given turbo model #when classifying tier #then returns standard", () => {
				expect(classifyTier("gpt-4-turbo")).toBe("standard")
			})

			it("#given mistral-large model #when classifying tier #then returns standard", () => {
				expect(classifyTier("mistral-large")).toBe("standard")
			})
		})

		describe("lite tier", () => {
			it("#given haiku model #when classifying tier #then returns lite", () => {
				expect(classifyTier("claude-haiku-4-5")).toBe("lite")
			})

			it("#given nano model #when classifying tier #then returns lite", () => {
				expect(classifyTier("gemini-nano")).toBe("lite")
			})

			it("#given mini model (not gpt-4o-mini) #when classifying tier #then returns lite", () => {
				expect(classifyTier("some-mini-model")).toBe("lite")
			})

			it("#given flash-lite model #when classifying tier #then returns lite", () => {
				expect(classifyTier("gemini-flash-lite")).toBe("lite")
			})

			it("#given gpt-3.5 model #when classifying tier #then returns lite", () => {
				expect(classifyTier("gpt-3.5-turbo")).toBe("lite")
			})
		})

		describe("default tier", () => {
			it("#given unknown model #when classifying tier #then returns standard as default", () => {
				expect(classifyTier("unknown-model-xyz")).toBe("standard")
			})

			it("#given empty string #when classifying tier #then returns standard as default", () => {
				expect(classifyTier("")).toBe("standard")
			})
		})
	})

	describe("parseModelsOutput", () => {
		it("#given empty output #when parsing #then returns empty array", () => {
			expect(parseModelsOutput("")).toEqual([])
		})

		it("#given whitespace-only output #when parsing #then returns empty array", () => {
			expect(parseModelsOutput("   \n   \n   ")).toEqual([])
		})

		it("#given single model #when parsing #then returns array with one ModelInfo", () => {
			const output = "anthropic/claude-opus-4-5"
			const result = parseModelsOutput(output)

			expect(result).toHaveLength(1)
			expect(result[0]).toEqual({
				id: "anthropic/claude-opus-4-5",
				provider: "anthropic",
				name: "claude-opus-4-5",
				tier: "flagship",
			})
		})

		it("#given multiple models #when parsing #then returns correct ModelInfo array", () => {
			const output = `anthropic/claude-opus-4-5
anthropic/claude-sonnet-4-5
anthropic/claude-haiku-4-5
openai/gpt-5.2`
			const result = parseModelsOutput(output)

			expect(result).toHaveLength(4)
			expect(result[0].tier).toBe("flagship")
			expect(result[1].tier).toBe("standard")
			expect(result[2].tier).toBe("lite")
			expect(result[3].tier).toBe("flagship")
		})

		it("#given output with empty lines #when parsing #then skips empty lines", () => {
			const output = `anthropic/claude-opus-4-5

openai/gpt-5.2

`
			const result = parseModelsOutput(output)
			expect(result).toHaveLength(2)
		})

		it("#given output with whitespace around model IDs #when parsing #then trims whitespace", () => {
			const output = "  anthropic/claude-opus-4-5  \n  openai/gpt-5.2  "
			const result = parseModelsOutput(output)

			expect(result).toHaveLength(2)
			expect(result[0].id).toBe("anthropic/claude-opus-4-5")
			expect(result[1].id).toBe("openai/gpt-5.2")
		})

		it("#given malformed lines without slash #when parsing #then skips those lines", () => {
			const output = `anthropic/claude-opus-4-5
malformed-no-slash
openai/gpt-5.2`
			const result = parseModelsOutput(output)

			expect(result).toHaveLength(2)
			expect(result[0].id).toBe("anthropic/claude-opus-4-5")
			expect(result[1].id).toBe("openai/gpt-5.2")
		})

		it("#given 50+ models #when parsing #then handles efficiently", () => {
			const models = Array.from(
				{ length: 60 },
				(_, i) => `provider-${i}/model-${i}`
			)
			const output = models.join("\n")
			const result = parseModelsOutput(output)

			expect(result).toHaveLength(60)
			expect(result[0].id).toBe("provider-0/model-0")
			expect(result[59].id).toBe("provider-59/model-59")
		})

		it("#given real-world output format #when parsing #then correctly processes all models", () => {
			const output = `anthropic/claude-opus-4-5
anthropic/claude-sonnet-4-5
anthropic/claude-haiku-4-5
openai/gpt-5.2
openai/gpt-4o
google/gemini-3-pro-preview
google/gemini-3-flash
opencode/grok-code
opencode/glm-4.7-free`
			const result = parseModelsOutput(output)

			expect(result).toHaveLength(9)

			const opus = result.find((m) => m.id === "anthropic/claude-opus-4-5")
			expect(opus).toBeDefined()
			expect(opus?.tier).toBe("flagship")
			expect(opus?.provider).toBe("anthropic")
			expect(opus?.name).toBe("claude-opus-4-5")

			const flash = result.find((m) => m.id === "google/gemini-3-flash")
			expect(flash).toBeDefined()
			expect(flash?.tier).toBe("standard")

			const haiku = result.find((m) => m.id === "anthropic/claude-haiku-4-5")
			expect(haiku).toBeDefined()
			expect(haiku?.tier).toBe("lite")
		})

		it("#given output with tabs and special whitespace #when parsing #then handles correctly", () => {
			const output = "\tanthropic/claude-opus-4-5\t\n\topenai/gpt-5.2\t"
			const result = parseModelsOutput(output)

			expect(result).toHaveLength(2)
			expect(result[0].id).toBe("anthropic/claude-opus-4-5")
		})
	})

	describe("detectAvailableModels", () => {
		let originalSpawn: typeof Bun.spawn

		beforeEach(() => {
			originalSpawn = Bun.spawn
		})

		afterEach(() => {
			Bun.spawn = originalSpawn
		})

		it("#given successful command execution #when detecting models #then returns parsed models", async () => {
			const mockOutput = `anthropic/claude-opus-4-5
openai/gpt-5.2`
			// @ts-expect-error - mocking Bun.spawn
			Bun.spawn = mock(() => ({
				stdout: new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode(mockOutput))
						controller.close()
					},
				}),
				stderr: new ReadableStream({
					start(controller) {
						controller.close()
					},
				}),
				exited: Promise.resolve(0),
			}))

			const result = await detectAvailableModels()

			expect(result).toHaveLength(2)
			expect(result[0].id).toBe("anthropic/claude-opus-4-5")
			expect(result[1].id).toBe("openai/gpt-5.2")
		})

		it("#given command returns empty output #when detecting models #then returns empty array", async () => {
			// @ts-expect-error - mocking Bun.spawn
			Bun.spawn = mock(() => ({
				stdout: new ReadableStream({
					start(controller) {
						controller.close()
					},
				}),
				stderr: new ReadableStream({
					start(controller) {
						controller.close()
					},
				}),
				exited: Promise.resolve(0),
			}))

			const result = await detectAvailableModels()
			expect(result).toEqual([])
		})

		it("#given command fails with non-zero exit #when detecting models #then returns empty array", async () => {
			// @ts-expect-error - mocking Bun.spawn
			Bun.spawn = mock(() => ({
				stdout: new ReadableStream({
					start(controller) {
						controller.close()
					},
				}),
				stderr: new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode("Command not found"))
						controller.close()
					},
				}),
				exited: Promise.resolve(1),
			}))

			const result = await detectAvailableModels()
			expect(result).toEqual([])
		})

		it("#given command throws error #when detecting models #then returns empty array", async () => {
			Bun.spawn = mock(() => {
				throw new Error("Spawn failed")
			})

			const result = await detectAvailableModels()
			expect(result).toEqual([])
		})
	})
})
