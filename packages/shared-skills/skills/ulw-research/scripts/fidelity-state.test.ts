import { describe, expect, onTestFinished, test } from "bun:test"
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { failureCount, markReplaced, readState, recordFailure, sentenceKey, writeState } from "./fidelity-state.mjs"

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "ulw-fidelity-"))
	onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
	return dir
}

describe("fidelity state", () => {
	test("sentenceKey is order-independent on ids", () => {
		expect(sentenceKey("findings", ["F3", "Q1", "F12"])).toBe(sentenceKey("findings", ["F12", "F3", "Q1"]))
		expect(sentenceKey("findings", ["F2", "F1"])).toBe("findings#F1,F2")
		expect(sentenceKey("findings", ["F1"])).not.toBe(sentenceKey("other", ["F1"]))
	})

	test("failureCount increments per key", () => {
		const dir = tempDir()
		const state = readState(dir)
		const key = sentenceKey("findings", ["F1"])
		expect(failureCount(state, key)).toBe(0)
		recordFailure(state, key)
		recordFailure(state, key)
		expect(failureCount(state, key)).toBe(2)
		expect(failureCount(state, sentenceKey("findings", ["F2"]))).toBe(0)
	})

	test("markReplaced records the key and survives a write/read", () => {
		const dir = tempDir()
		const state = readState(dir)
		const key = sentenceKey("findings", ["Q1"])
		recordFailure(state, key)
		markReplaced(state, key)
		markReplaced(state, key)
		expect(state.replaced).toEqual([key])
		writeState(dir, state)
		expect(readdirSync(dir)).toEqual(["fidelity-state.json"])
		const loaded = readState(dir)
		expect(loaded).toEqual(state)
		expect(failureCount(loaded, key)).toBe(1)
	})
})
