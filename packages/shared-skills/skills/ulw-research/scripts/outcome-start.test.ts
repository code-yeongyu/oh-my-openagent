import { describe, expect, onTestFinished, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { validateOutcomeManifest } from "./contracts.mjs"
import { initManifest } from "./outcome.mjs"
import { sampleManifest } from "./tests/contracts-support"

const START = "2026-10-25T12:52:01.832Z"
const cli = join(import.meta.dir, "report-tools.mjs")

function directory(name = "E") {
	const root = mkdtempSync(join(tmpdir(), "outcome-start-"))
	onTestFinished(() => rmSync(root, { recursive: true, force: true }))
	const dir = join(root, name)
	mkdirSync(dir)
	return dir
}

function init(dir: string, ...extra: string[]) {
	return spawnSync("node", [cli, "outcome", "init", "--session-dir", dir, "--promised", "html", "--now", START, ...extra], { encoding: "utf8" })
}
const startedAt = (dir: string) => JSON.parse(readFileSync(join(dir, "outcome.json"), "utf8")).startedAt
const manifestAt = (dir: string, value: string) => writeFileSync(join(dir, "outcome.json"), JSON.stringify({ ...sampleManifest(), sessionDir: dir, startedAt: value }))

describe("outcome init is the one writer of the run clock", () => {
	test("#given --started-at from the orchestrator #when init runs in an unstamped dir #then that value is recorded", () => {
		const dir = directory()
		expect(init(dir, "--started-at", START).status).toBe(0)
		expect(startedAt(dir)).toBe(START)
	})

	test("#given a supervisor's terminal-state.json #when init runs #then started_at is recorded", () => {
		const dir = directory()
		writeFileSync(join(dir, "terminal-state.json"), JSON.stringify({ started_at: START }))
		expect(init(dir).status).toBe(0)
		expect(startedAt(dir)).toBe(START)
	})

	test("#given no flag, no metadata, and no stamped dir name #when init runs #then it refuses and names every source", () => {
		const result = init(directory())
		expect(result.status).toBe(1)
		expect(result.stderr).toMatch(/--started-at/)
	})

	test("#given only a stamped dir name #when init runs #then the dir name is the fallback clock", () => {
		const dir = directory("20260101-120000")
		expect(init(dir).status).toBe(0)
		expect(startedAt(dir)).toMatch(/^2026-01-01T/)
	})

	test("#given a valid manifest from an earlier init #when init runs again #then the recorded clock survives", () => {
		const dir = directory("20261025-120000")
		const first = "2026-10-25T03:00:00.000Z"
		manifestAt(dir, first)
		expect(init(dir).status).toBe(0)
		expect(startedAt(dir)).toBe(first)
	})
})

describe("a recorded run clock is validated, never trusted raw", () => {
	test("#given a manifest copied with a 2020 startedAt into a 20260104-120000 dir #when init runs #then it refuses", () => {
		const dir = directory("20260104-120000")
		manifestAt(dir, "2020-01-01T00:00:00.000Z")
		const result = init(dir)
		expect(result.status).toBe(1)
		expect(result.stderr).toMatch(/outcome\.json\.startedAt/)
	})

	for (const value of ["not-a-time", "2099-01-01T00:00:00Z", "2026-02-30T12:00:00Z", "2026-10-25T24:00:00Z", "2026-10-25 12:00:00"]) {
		test(`#given started_at ${value} with --now ${START} #when init runs #then it refuses without falling back`, () => {
			const dir = directory("20261025-120000")
			writeFileSync(join(dir, "terminal-state.json"), JSON.stringify({ started_at: value }))
			const result = init(dir)
			expect(result.status).toBe(1)
			expect(result.stderr).toMatch(/terminal-state\.json\.started_at/)
		})
	}

	test("#given a valid manifest copied from another session into an unstamped dir #when init runs #then its clock is not reused", () => {
		const dir = directory()
		writeFileSync(join(dir, "outcome.json"), JSON.stringify({ ...sampleManifest(), sessionDir: "/elsewhere/E", startedAt: "2020-01-01T00:00:00.000Z" }))
		const result = init(dir)
		expect(result.status).toBe(1)
		expect(result.stderr).toMatch(/--started-at/)
	})

	test("#given a corrupt terminal-state.json #when init runs #then the error names the file", () => {
		const dir = directory("20261025-120000")
		writeFileSync(join(dir, "terminal-state.json"), "{")
		const result = init(dir)
		expect(result.status).toBe(1)
		expect(result.stderr).toContain("terminal-state.json")
	})

	test("#given a corrupt outcome.json #when init runs #then init overwrites it, as before", () => {
		const dir = directory("20261025-120000")
		writeFileSync(join(dir, "outcome.json"), "{")
		expect(init(dir).status).toBe(0)
		expect(validateOutcomeManifest(JSON.parse(readFileSync(join(dir, "outcome.json"), "utf8"))).ok).toBe(true)
	})

	test("#given the legacy library call with a stamped dir #when initialized #then the manifest validates", () => {
		const manifest = initManifest({ sessionDir: "/nonexistent/20260101-120000", promised: [], lane: null })
		expect(validateOutcomeManifest(manifest)).toEqual({ ok: true, errors: [] })
	})
})
