import { describe, expect, it } from "bun:test"
import { readRuntimeModelModalities } from "./runtime-model-readers"

describe("readRuntimeModelModalities", () => {
	describe("object-shaped modalities (OpenCode schema)", () => {
		it("#given modalities with input/output string arrays #when reading runtime model #then returns normalized modalities", () => {
			const runtimeModel = {
				id: "test-model",
				modalities: {
					input: ["text", "image", "pdf"],
					output: ["text"],
				},
			}

			const result = readRuntimeModelModalities(runtimeModel as Record<string, unknown>)

			expect(result).toBeDefined()
			expect(result?.input).toEqual(["text", "image", "pdf"])
			expect(result?.output).toEqual(["text"])
		})

		it("#given modalities with mixed-case strings #when reading runtime model #then lowercases all entries", () => {
			const runtimeModel = {
				id: "test-model",
				modalities: {
					input: ["Text", "IMAGE", "Pdf"],
					output: ["TEXT"],
				},
			}

			const result = readRuntimeModelModalities(runtimeModel as Record<string, unknown>)

			expect(result?.input).toEqual(["text", "image", "pdf"])
			expect(result?.output).toEqual(["text"])
		})

		it("#given modalities nested in capabilities #when reading runtime model #then finds and normalizes them", () => {
			const runtimeModel = {
				id: "test-model",
				capabilities: {
					modalities: {
						input: ["text", "audio"],
						output: ["text"],
					},
				},
			}

			const result = readRuntimeModelModalities(runtimeModel as Record<string, unknown>)

			expect(result).toBeDefined()
			expect(result?.input).toEqual(["text", "audio"])
			expect(result?.output).toEqual(["text"])
		})
	})

	describe("flat string array modalities", () => {
		it("#given modalities as boolean map at top level #when reading runtime model #then returns undefined (not supported at this level)", () => {
			const runtimeModel = {
				id: "test-model",
				modalities: {
					text: true,
					image: true,
					audio: false,
				},
			}

			const result = readRuntimeModelModalities(runtimeModel as Record<string, unknown>)

			// Boolean maps are only recognized inside input/output keys, not at the modalities root
			expect(result).toBeUndefined()
		})
	})

	describe("no crash on unexpected shapes", () => {
		it("#given modalities is undefined #when reading runtime model #then returns undefined", () => {
			const runtimeModel = { id: "test-model" }

			const result = readRuntimeModelModalities(runtimeModel as Record<string, unknown>)

			expect(result).toBeUndefined()
		})

		it("#given modalities contains nested arrays #when reading runtime model #then does not throw", () => {
			const runtimeModel = {
				id: "test-model",
				modalities: {
					input: [["text", "image"], ["pdf"]],
					output: [["text"]],
				},
			}

			expect(() => {
				readRuntimeModelModalities(runtimeModel as Record<string, unknown>)
			}).not.toThrow()
		})

		it("#given modalities values are non-string non-array #when reading runtime model #then does not throw", () => {
			const runtimeModel = {
				id: "test-model",
				modalities: {
					input: 42,
					output: null,
				},
			}

			expect(() => {
				readRuntimeModelModalities(runtimeModel as Record<string, unknown>)
			}).not.toThrow()
		})
	})
})
