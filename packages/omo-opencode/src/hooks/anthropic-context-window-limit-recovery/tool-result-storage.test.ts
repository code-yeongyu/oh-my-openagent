import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const tempDir = mkdtempSync(join(tmpdir(), "tool-result-storage-"))
const partDir = join(tempDir, "part", "msg1")
const partPath = join(partDir, "part1.json")

mock.module("./storage-paths", () => ({
	PART_STORAGE_DIR: join(tempDir, "part"),
	TRUNCATION_MESSAGE: "[TRUNCATED]",
}))
mock.module("./message-storage-directory", () => ({
	getMessageIds: () => ["msg1"],
}))
mock.module("../../shared/opencode-storage-detection", () => ({
	isSqliteBackend: () => false,
}))
mock.module("../../shared/logger", () => ({ log: () => {} }))

const { truncateToolResult, recoverTruncatedOutput, cleanupTruncationBackups } =
	await import("./tool-result-storage")

describe("tool-result-storage non-destructive truncation", () => {
	beforeEach(() => {
		mkdirSync(partDir, { recursive: true })
	})

	afterEach(() => {
		rmSync(partDir, { recursive: true, force: true })
	})

	afterAll(() => {
		mock.restore()
		rmSync(tempDir, { recursive: true, force: true })
	})

	function writePartFile(path: string, output: string): void {
		const part = {
			id: "part1",
			sessionID: "ses_test",
			messageID: "msg1",
			type: "tool" as const,
			callID: "call1",
			tool: "test-tool",
			state: {
				status: "completed" as const,
				input: {},
				output,
			},
		}
		writeFileSync(path, JSON.stringify(part, null, 2))
	}

	it("writes an .original backup when truncating", () => {
		const originalOutput = "original output content"

		writePartFile(partPath, originalOutput)
		const result = truncateToolResult(partPath)

		expect(result.success).toBe(true)
		expect(existsSync(`${partPath}.original`)).toBe(true)
		expect(readFileSync(`${partPath}.original`, "utf-8")).toBe(originalOutput)
	})

	it("recovers the original output from the .original backup", () => {
		const originalOutput = "recoverable original output"

		writePartFile(partPath, originalOutput)
		truncateToolResult(partPath)

		const recovered = recoverTruncatedOutput(partPath)
		expect(recovered).toBe(originalOutput)
	})

	it("cleans up .original backups and returns the deleted count", () => {
		const originalOutput = "output to be cleaned up"

		writePartFile(partPath, originalOutput)
		truncateToolResult(partPath)

		expect(existsSync(`${partPath}.original`)).toBe(true)

		const deletedCount = cleanupTruncationBackups("ses_test")

		expect(deletedCount).toBe(1)
		expect(existsSync(`${partPath}.original`)).toBe(false)
	})
})
