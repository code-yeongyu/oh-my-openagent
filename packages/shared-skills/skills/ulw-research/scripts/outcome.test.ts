import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { DELIVERABLE_FORMATS, GATE_NAMES, validateOutcomeManifest } from "./contracts.mjs"
import {
	MANIFEST_FILENAME,
	OutcomeError,
	addRender,
	briefingFacts,
	buildBriefing,
	deliverableState,
	initManifest,
	readManifest,
	setDeliverable,
	setGate,
	verifyManifest,
	writeManifest,
} from "./outcome.mjs"

const STAMP = "20260101-120000"
const START_LOCAL = new Date(2026, 0, 1, 12, 0, 0)

function sessionDir(): string {
	const dir = join(mkdtempSync(join(tmpdir(), "ulw-outcome-")), STAMP)
	mkdirSync(dir)
	return dir
}

function oneByteFile(dir: string, name: string): string {
	const file = join(dir, name)
	writeFileSync(file, "x")
	return file
}

function codes(problems: { code: string }[]): string[] {
	return problems.map((problem) => problem.code)
}

describe("initManifest", () => {
	test("#given promised pdf and docx #when initialised #then there is one pending row per format and the schema validates", () => {
		// given
		const dir = sessionDir()
		// when
		const manifest = initManifest({ sessionDir: dir, promised: ["pdf", "docx"], lane: "no-format" })
		// then
		expect(manifest.deliverables.map((row) => [row.format, row.status, row.promised])).toEqual([
			["pdf", "pending", true],
			["docx", "pending", true],
		])
		expect(manifest.startedAt).toBe(START_LOCAL.toISOString())
		expect(Object.keys(manifest.gates)).toEqual([...GATE_NAMES])
		expect(Object.values(manifest.gates).every((status) => status === "not_run")).toBe(true)
		expect(validateOutcomeManifest(manifest)).toEqual({ ok: true, errors: [] })
	})

	test("#given a session dir without a YYYYMMDD-HHMMSS basename #when initialised #then it throws a typed error", () => {
		// given
		const dir = mkdtempSync(join(tmpdir(), "ulw-outcome-"))
		// when / then
		expect(() => initManifest({ sessionDir: dir, promised: ["pdf"], lane: null })).toThrow(OutcomeError)
	})
})

describe("setDeliverable and verifyManifest", () => {
	test("#given a fresh pdf+docx manifest #when verified #then both pending rows are missing_promised_deliverable", () => {
		// given
		const manifest = initManifest({ sessionDir: sessionDir(), promised: ["pdf", "docx"], lane: "no-format" })
		// when
		const result = verifyManifest(manifest)
		// then
		expect(result.ok).toBe(false)
		expect(codes(result.problems)).toEqual(["missing_promised_deliverable", "missing_promised_deliverable"])
	})

	test("#given pdf delivered as a 1-byte file and docx blocked with a reason #when verified #then it passes", () => {
		// given
		const dir = sessionDir()
		const initial = initManifest({ sessionDir: dir, promised: ["pdf", "docx"], lane: "no-format" })
		// when
		const afterPdf = setDeliverable(initial, "pdf", "delivered", { path: oneByteFile(dir, "report.pdf") })
		const afterDocx = setDeliverable(afterPdf, "docx", "blocked_capability", { reason: "no docx renderer" })
		// then
		expect(afterPdf.deliverables.find((row) => row.format === "docx")?.status).toBe("pending")
		expect(codes(verifyManifest(afterPdf).problems)).toEqual(["missing_promised_deliverable"])
		expect(verifyManifest(afterDocx)).toEqual({ ok: true, problems: [] })
		expect(initial.deliverables.every((row) => row.status === "pending")).toBe(true)
	})

	test("#given a delivered row whose file is missing or empty #when verified #then each path is named in problems", () => {
		// given
		const dir = sessionDir()
		const missing = join(dir, "gone.pdf")
		const empty = join(dir, "empty.html")
		writeFileSync(empty, "")
		let manifest = initManifest({ sessionDir: dir, promised: ["pdf", "html"], lane: "no-format" })
		manifest = setDeliverable(manifest, "pdf", "delivered", { path: missing })
		manifest = setDeliverable(manifest, "html", "delivered", { path: empty })
		// when
		const result = verifyManifest(manifest)
		// then
		expect(result.ok).toBe(false)
		expect(result.problems.map((problem) => problem.path)).toEqual([missing, empty])
	})

	test("#given a skipped row without a reason #when verified #then it is a problem", () => {
		// given
		const base = initManifest({ sessionDir: sessionDir(), promised: ["md"], lane: null })
		// when
		const result = verifyManifest(setDeliverable(base, "md", "skipped", {}))
		// then
		expect(codes(result.problems)).toEqual(["missing_promised_deliverable"])
	})

	test("#given an unpromised format #when set #then a non-promised row is appended and the promised rows survive", () => {
		// given
		const dir = sessionDir()
		const base = initManifest({ sessionDir: dir, promised: ["pdf"], lane: null })
		// when
		const next = setDeliverable(base, "html", "delivered", { path: oneByteFile(dir, "r.html"), bytes: 1, pages: 1 })
		// then
		expect(next.deliverables.map((row) => [row.format, row.status, row.promised])).toEqual([
			["pdf", "pending", true],
			["html", "delivered", false],
		])
		expect(validateOutcomeManifest(next).ok).toBe(true)
	})

	test("#given an unknown format #when set #then it throws a typed error naming the allowed list", () => {
		// given
		const base = initManifest({ sessionDir: sessionDir(), promised: ["pdf"], lane: null })
		// when
		let caught: unknown
		try {
			setDeliverable(base, "epub", "delivered", { path: "x" })
		} catch (error) {
			caught = error
		}
		// then
		expect(caught).toBeInstanceOf(OutcomeError)
		const error = caught as OutcomeError
		expect(error.code).toBe("unknown_format")
		expect(error.allowed).toEqual([...DELIVERABLE_FORMATS])
		for (const format of DELIVERABLE_FORMATS) expect(error.message).toContain(format)
	})
})

describe("setGate and addRender", () => {
	test("#given a manifest #when a gate and renders are recorded #then they land without mutating the input", () => {
		// given
		const base = initManifest({ sessionDir: sessionDir(), promised: ["pdf"], lane: null })
		// when
		const gated = setGate(base, "static", "pass")
		const rendered = addRender(addRender(addRender(gated, "p1.png", 1), "p2.png", 2), "p1.png", 1)
		// then
		expect(base.gates.static).toBe("not_run")
		expect(rendered.gates.static).toBe("pass")
		expect(rendered.renders).toEqual([
			{ path: "p1.png", page: 1 },
			{ path: "p2.png", page: 2 },
		])
		expect(() => setGate(base, "spelling", "pass")).toThrow(OutcomeError)
		expect(() => setGate(base, "static", "ok")).toThrow(OutcomeError)
		expect(() => addRender(base, "p0.png", 0)).toThrow(OutcomeError)
	})
})

describe("deliverableState", () => {
	test("#given the draft marker, no marker, and a sibling manifest #when read #then state follows the file and the manifest", () => {
		// given
		const dir = sessionDir()
		const report = join(dir, "report.md")
		// when / then
		expect(deliverableState(report, null)).toBe("none")
		writeFileSync(report, "")
		expect(deliverableState(report, null)).toBe("none")
		writeFileSync(report, "# Report\nSTATUS: draft \u2014 3 sections open\n\nbody\n")
		expect(deliverableState(report, null)).toBe("partial")
		writeFileSync(report, "# Report\n\nbody\n")
		expect(deliverableState(report, null)).toBe("complete")
		const pending = initManifest({ sessionDir: dir, promised: ["md"], lane: null })
		writeManifest(join(dir, MANIFEST_FILENAME), pending)
		expect(deliverableState(report, null)).toBe("partial")
		const done = setDeliverable(pending, "md", "delivered", { path: report })
		expect(deliverableState(report, done)).toBe("complete")
		writeManifest(join(dir, MANIFEST_FILENAME), done)
		expect(deliverableState(report, null)).toBe("complete")
	})
})

describe("briefingFacts and buildBriefing", () => {
	test("#given 2 [S<n>] lines and 1 [Source 3] line on 2 hosts and now = start + 61 min #when briefed #then sources 3, domains 2, minutes 61", () => {
		// given
		const dir = sessionDir()
		const manifest = setDeliverable(
			initManifest({ sessionDir: dir, promised: ["pdf", "docx"], lane: "no-format" }),
			"docx",
			"skipped",
			{ reason: "chat delivery" },
		)
		const ledger = [
			"# Sources ledger",
			"[S1] https://alpha.example/one - primary",
			"[S2] https://www.beta.example/two",
			"[Source 3] https://alpha.example/three",
			"note: https://gamma.example/not-a-source",
			"",
		].join("\n")
		const now = new Date(2026, 0, 1, 13, 1, 0)
		// when
		const facts = briefingFacts(manifest, ledger, now)
		const text = buildBriefing(manifest, ledger, now)
		// then
		expect(facts.sources).toBe(3)
		expect(facts.domains).toBe(2)
		expect(facts.minutes).toBe(61)
		expect(facts.deliverables).toEqual([
			{ format: "pdf", status: "pending", reason: null, path: null },
			{ format: "docx", status: "skipped", reason: "chat delivery", path: null },
		])
		expect(facts.gates).toEqual(manifest.gates)
		expect(facts.residualDefects).toBe(0)
		expect(facts.repair).toBeNull()
		expect(typeof text).toBe("string")
		for (const token of ["pdf", "docx", "chat delivery"]) expect(text).toContain(token)
	})
})

describe("readManifest and writeManifest", () => {
	test("#given an existing manifest file #when overwritten #then it round-trips and leaves no temp file", () => {
		// given
		const dir = sessionDir()
		const file = join(dir, MANIFEST_FILENAME)
		const first = initManifest({ sessionDir: dir, promised: ["pdf"], lane: null })
		writeManifest(file, first)
		// when
		const second = setGate(first, "visual", "fail")
		writeManifest(file, second)
		// then
		expect(readManifest(file)).toEqual(second)
		expect(readdirSync(dir)).toEqual([MANIFEST_FILENAME])
	})

	test("#given an invalid manifest #when written or read #then it throws a typed error and writes nothing", () => {
		// given
		const dir = sessionDir()
		const file = join(dir, MANIFEST_FILENAME)
		// when / then
		expect(() => writeManifest(file, { schemaVersion: 99 })).toThrow(OutcomeError)
		expect(existsSync(file)).toBe(false)
		writeFileSync(file, "{not json")
		expect(() => readManifest(file)).toThrow(OutcomeError)
	})
})

describe("round trip in a stamped session dir", () => {
	test("#given session dir 20260101-120000 #when init, set, gate, render, verify, brief through the file #then verify passes and the briefing is computed", () => {
		// given
		const dir = sessionDir()
		const file = join(dir, MANIFEST_FILENAME)
		writeManifest(file, initManifest({ sessionDir: dir, promised: ["html", "post"], lane: "no-format" }))
		expect(verifyManifest(readManifest(file)).ok).toBe(false)
		// when
		let manifest = readManifest(file)
		manifest = setDeliverable(manifest, "html", "delivered", { path: oneByteFile(dir, "report.html"), bytes: 1 })
		manifest = setDeliverable(manifest, "post", "skipped", { reason: "chat delivery" })
		manifest = addRender(setGate(manifest, "static", "pass"), join(dir, "page-1.png"), 1)
		writeManifest(file, manifest)
		const reread = readManifest(file)
		const ledger = join(dir, "sources-ledger.md")
		writeFileSync(ledger, "[S1] https://a.example/\n")
		const facts = briefingFacts(reread, readFileSync(ledger, "utf8"), new Date(2026, 0, 1, 12, 30, 0))
		// then
		expect(verifyManifest(reread)).toEqual({ ok: true, problems: [] })
		expect(facts.sources).toBe(1)
		expect(facts.minutes).toBe(30)
		expect(facts.gates.static).toBe("pass")
		expect(deliverableState(join(dir, "report.html"), null)).toBe("complete")
	})
})
