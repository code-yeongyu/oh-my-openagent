/// <reference types="bun-types" />
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { detectCompletionInTranscript } from "./completion-promise-detector"

const temporaryDirectories: string[] = []

function createTranscriptFile(lines: string[]): string {
	const directoryPath = mkdtempSync(join(tmpdir(), "ralph-loop-transcript-"))
	temporaryDirectories.push(directoryPath)
	const transcriptPath = join(directoryPath, "session.jsonl")
	writeFileSync(transcriptPath, `${lines.join("\n")}\n`)
	return transcriptPath
}

afterEach(() => {
	for (const directoryPath of temporaryDirectories.splice(0)) {
		rmSync(directoryPath, { force: true, recursive: true })
	}
})

describe("detectCompletionInTranscript", () => {
	describe("#given transcript entries after loop start", () => {
		test("#when assistant content includes explicit DONE promise #then should detect completion", () => {
			// #given
			const transcriptPath = createTranscriptFile([
				JSON.stringify({ type: "assistant", timestamp: "2026-03-28T10:00:00.000Z", content: "Still working" }),
				JSON.stringify({ type: "assistant", timestamp: "2026-03-28T10:01:00.000Z", content: "Finished <promise>DONE</promise>" }),
			])

			// #when
			const detected = detectCompletionInTranscript(transcriptPath, "DONE", "2026-03-28T09:59:59.000Z")

			// #then
			expect(detected).toBe(true)
		})

		test("#when explicit DONE appears only before startedAt #then should NOT detect completion", () => {
			// #given
			const transcriptPath = createTranscriptFile([
				JSON.stringify({ type: "assistant", timestamp: "2026-03-28T10:00:00.000Z", content: "Finished <promise>DONE</promise>" }),
				JSON.stringify({ type: "assistant", timestamp: "2026-03-28T10:01:00.000Z", content: "Working on the new task" }),
			])

			// #when
			const detected = detectCompletionInTranscript(transcriptPath, "DONE", "2026-03-28T10:00:30.000Z")

			// #then
			expect(detected).toBe(false)
		})
	})

	describe("#given transcript content without explicit assistant promise text", () => {
		test("#when assistant uses only natural language completion text #then should NOT detect completion", () => {
			// #given
			const transcriptPath = createTranscriptFile([
				JSON.stringify({ type: "assistant", timestamp: "2026-03-28T10:01:00.000Z", content: "The task is complete. All work has been finished." }),
			])

			// #when
			const detected = detectCompletionInTranscript(transcriptPath, "DONE")

			// #then
			expect(detected).toBe(false)
		})

		test("#when tool output contains DONE promise without assistant entry type #then should NOT detect completion", () => {
			// #given
			const transcriptPath = createTranscriptFile([
				JSON.stringify({ type: "tool_result", timestamp: "2026-03-28T10:01:00.000Z", tool_output: "Background task <promise>DONE</promise>" }),
			])

			// #when
			const detected = detectCompletionInTranscript(transcriptPath, "DONE")

			// #then
			expect(detected).toBe(false)
		})

		test("#when oracle tool output contains VERIFIED promise #then should detect verification completion", () => {
			// #given
			const transcriptPath = createTranscriptFile([
				JSON.stringify({
					type: "tool_result",
					timestamp: "2026-03-28T10:01:00.000Z",
					tool_output: "Task completed.\n\nAgent: oracle\n\n<promise>VERIFIED</promise>\n\n<task_metadata>\nsession_id: ses_oracle_123\n</task_metadata>",
				}),
			])

			// #when
			const detected = detectCompletionInTranscript(transcriptPath, "VERIFIED")

			// #then
			expect(detected).toBe(true)
		})
	})
})
