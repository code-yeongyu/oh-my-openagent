import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { readJsonFile, writeJsonFile } from "./json-cache"

describe("json-cache", () => {
	let tempDir: string

	beforeEach(() => {
		// given a temporary directory for test files
		tempDir = join("/tmp", `json-cache-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		mkdirSync(tempDir, { recursive: true })
	})

	afterEach(() => {
		// cleanup temporary directory
		if (existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true })
		}
	})

	describe("readJsonFile", () => {
		test("returns null when file does not exist", () => {
			// given a non-existent file path
			const filePath = join(tempDir, "nonexistent.json")

			// when reading the file
			const result = readJsonFile<{ key: string }>(filePath)

			// then it returns null
			expect(result).toBeNull()
		})

		test("returns parsed object when file contains valid JSON", () => {
			// given a valid JSON file
			const filePath = join(tempDir, "valid.json")
			const data = { name: "test", count: 42, nested: { value: true } }
			mkdirSync(tempDir, { recursive: true })
			Bun.write(filePath, JSON.stringify(data))

			// when reading the file
			const result = readJsonFile<typeof data>(filePath)

			// then it returns the parsed object
			expect(result).toEqual(data)
		})

		test("returns null when file contains invalid JSON", () => {
			// given a file with invalid JSON
			const filePath = join(tempDir, "invalid.json")
			mkdirSync(tempDir, { recursive: true })
			Bun.write(filePath, "{ invalid json }")

			// when reading the file
			const result = readJsonFile<{ key: string }>(filePath)

			// then it returns null (doesn't throw)
			expect(result).toBeNull()
		})

		test("returns null when file is empty", () => {
			// given an empty file
			const filePath = join(tempDir, "empty.json")
			mkdirSync(tempDir, { recursive: true })
			Bun.write(filePath, "")

			// when reading the file
			const result = readJsonFile<{ key: string }>(filePath)

			// then it returns null
			expect(result).toBeNull()
		})

		test("handles complex nested structures", () => {
			// given a file with complex nested JSON
			const filePath = join(tempDir, "complex.json")
			const data = {
				users: [
					{ id: 1, name: "Alice", roles: ["admin", "user"] },
					{ id: 2, name: "Bob", roles: ["user"] },
				],
				metadata: {
					version: "1.0.0",
					timestamp: "2024-01-01T00:00:00Z",
				},
			}
			mkdirSync(tempDir, { recursive: true })
			Bun.write(filePath, JSON.stringify(data))

			// when reading the file
			const result = readJsonFile<typeof data>(filePath)

			// then it returns the complete structure
			expect(result).toEqual(data)
		})
	})

	describe("writeJsonFile", () => {
		test("writes JSON to file in existing directory", () => {
			// given an existing directory and data to write
			const filePath = join(tempDir, "output.json")
			const data = { key: "value", number: 123 }

			// when writing the file
			writeJsonFile(filePath, data)

			// then the file exists and contains formatted JSON
			expect(existsSync(filePath)).toBe(true)
			const content = readFileSync(filePath, "utf-8")
			expect(JSON.parse(content)).toEqual(data)
			// verify 2-space indentation
			expect(content).toContain('  "key"')
		})

		test("creates parent directory when ensureDir is true", () => {
			// given a non-existent parent directory
			const nestedPath = join(tempDir, "nested", "deep", "file.json")
			const data = { created: true }

			// when writing with ensureDir option
			writeJsonFile(nestedPath, data, { ensureDir: true })

			// then the parent directories are created and file is written
			expect(existsSync(nestedPath)).toBe(true)
			const content = readFileSync(nestedPath, "utf-8")
			expect(JSON.parse(content)).toEqual(data)
		})

		test("throws when parent directory does not exist and ensureDir is false", () => {
			// given a non-existent parent directory
			const nestedPath = join(tempDir, "nonexistent", "file.json")
			const data = { key: "value" }

			// when writing without ensureDir option
			// then it throws an error
			expect(() => writeJsonFile(nestedPath, data)).toThrow()
		})

		test("overwrites existing file", () => {
			// given an existing file with old data
			const filePath = join(tempDir, "overwrite.json")
			const oldData = { old: "data" }
			const newData = { new: "data" }
			Bun.write(filePath, JSON.stringify(oldData))

			// when writing new data
			writeJsonFile(filePath, newData)

			// then the file contains only the new data
			const content = readFileSync(filePath, "utf-8")
			expect(JSON.parse(content)).toEqual(newData)
		})

		test("formats JSON with 2-space indentation", () => {
			// given data to write
			const filePath = join(tempDir, "formatted.json")
			const data = {
				level1: {
					level2: {
						level3: "value",
					},
				},
			}

			// when writing the file
			writeJsonFile(filePath, data)

			// then the file is formatted with 2-space indentation
			const content = readFileSync(filePath, "utf-8")
			expect(content).toContain('  "level1"')
			expect(content).toContain('    "level2"')
			expect(content).toContain('      "level3"')
		})
	})

	describe("round-trip write→read", () => {
		test("preserves data through write and read cycle", () => {
			// given data to persist
			const filePath = join(tempDir, "roundtrip.json")
			const originalData = {
				string: "test",
				number: 42,
				boolean: true,
				null: null,
				array: [1, 2, 3],
				nested: { key: "value" },
			}

			// when writing and then reading
			writeJsonFile(filePath, originalData)
			const readData = readJsonFile<typeof originalData>(filePath)

			// then the data is identical
			expect(readData).toEqual(originalData)
		})

		test("handles empty object round-trip", () => {
			// given an empty object
			const filePath = join(tempDir, "empty-object.json")
			const data = {}

			// when writing and reading
			writeJsonFile(filePath, data)
			const result = readJsonFile<typeof data>(filePath)

			// then it returns the empty object
			expect(result).toEqual({})
		})

		test("handles array round-trip", () => {
			// given an array
			const filePath = join(tempDir, "array.json")
			const data = [1, 2, 3, { nested: true }]

			// when writing and reading
			writeJsonFile(filePath, data)
			const result = readJsonFile<typeof data>(filePath)

			// then the array is preserved
			expect(result).toEqual(data)
		})
	})
})
