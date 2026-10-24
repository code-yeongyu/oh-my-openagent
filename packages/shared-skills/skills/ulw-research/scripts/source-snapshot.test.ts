import { describe, expect, onTestFinished, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { snapshotFromHtml, writeSnapshot } from "./source-snapshot.mjs"

const FIXTURES = join(import.meta.dir, "tests", "fixtures", "fidelity", "sources")
const S4_HTML = readFileSync(join(FIXTURES, "S4.html"), "utf8")
const S9_TEXT = readFileSync(join(FIXTURES, "S9.txt"), "utf8")

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "ulw-snapshot-"))
	onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
	return dir
}

type Sentence = { sid: string; start: number; end: number; text: string }

function readSentences(dir: string): Sentence[] {
	return readFileSync(join(dir, "sentences.jsonl"), "utf8")
		.split("\n")
		.filter((line) => line !== "")
		.map((line) => JSON.parse(line))
}

describe("snapshotFromHtml", () => {
	test("#given a page with prose, a table, a script and a comment #when snapshotted #then blocks are lines and each table cell is its own line", () => {
		const lines = snapshotFromHtml(S4_HTML).split("\n")
		expect(lines).toContain("Span length: 320 m")
		expect(lines).toContain("After the delay, we estimate completion no earlier than 2027.")
		const header = lines.indexOf("Metric")
		expect(lines.slice(header, header + 4)).toEqual(["Metric", "Length", "Span", "320 m"])
		const text = lines.join("\n")
		expect(text).not.toContain("not prose")
		expect(text).not.toContain("internal draft comment")
		expect(text).not.toContain("p { margin")
	})
})

describe("writeSnapshot", () => {
	test("#given html #when written #then text.txt, source.html, meta.json, sentences.jsonl and acronyms.json exist and sha256 covers text.txt", () => {
		const sources = tempDir()
		const result = writeSnapshot(sources, "S4", { url: "https://example.test/bridge", html: S4_HTML, extractor: "tool:source-snapshot@1", observed_at: "2026-10-23T00:00:00Z" })
		expect(result.dir).toBe(join(sources, "S4"))
		for (const name of ["text.txt", "source.html", "meta.json", "sentences.jsonl", "acronyms.json"]) expect(existsSync(join(result.dir, name))).toBe(true)
		const text = readFileSync(join(result.dir, "text.txt"))
		expect(result.sha256).toBe(createHash("sha256").update(text).digest("hex"))
		expect(readFileSync(join(result.dir, "source.html"), "utf8")).toBe(S4_HTML)
		const meta = JSON.parse(readFileSync(join(result.dir, "meta.json"), "utf8"))
		expect(meta).toEqual({
			source_id: "S4",
			url: "https://example.test/bridge",
			observed_at: "2026-10-23T00:00:00Z",
			sha256: result.sha256,
			extractor: "tool:source-snapshot@1",
			revision: null,
			kind: "page",
			provenance: "unknown",
		})
	})

	test("#given a written snapshot #when sentences.jsonl is read #then every row slices text.txt and carries an S<n>:s<k> id", () => {
		const sources = tempDir()
		const { dir } = writeSnapshot(sources, "S4", { url: "https://example.test/bridge", html: S4_HTML, extractor: "tool:source-snapshot@1" })
		const text = readFileSync(join(dir, "text.txt"), "utf8")
		const sentences = readSentences(dir)
		expect(sentences.length).toBeGreaterThanOrEqual(4)
		sentences.forEach((row, index) => {
			expect(row.sid).toBe(`S4:s${index + 1}`)
			expect(text.slice(row.start, row.end)).toBe(row.text)
		})
	})

	test("#given both acronym forms #when written #then acronyms.json lists each expansion with its sentence and span", () => {
		const sources = tempDir()
		const text = "The deck uses High Bandwidth Memory (HBM) sensors.\nA second note cites TSV (Through Silicon Via) bonding."
		const { dir, sha256 } = writeSnapshot(sources, "S2", { path: "notes/memo.txt", text, extractor: "model" })
		const acronyms = JSON.parse(readFileSync(join(dir, "acronyms.json"), "utf8"))
		expect(acronyms.source_id).toBe("S2")
		expect(acronyms.snapshot_sha256).toBe(sha256)
		const entries = acronyms.entries.map((entry: { acronym: string; expansion: string; sentence_id: string; span: number[] }) => [entry.acronym, entry.expansion, entry.sentence_id, text.slice(entry.span[0], entry.span[1])])
		expect(entries).toEqual([
			["HBM", "High Bandwidth Memory", "S2:s1", "High Bandwidth Memory (HBM)"],
			["TSV", "Through Silicon Via", "S2:s2", "TSV (Through Silicon Via)"],
		])
		expect(JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")).kind).toBe("document")
		expect(existsSync(join(dir, "source.html"))).toBe(false)
	})

	test("#given pages #when written #then pages are joined by a form feed and no sentence crosses a page", () => {
		const sources = tempDir()
		const { dir } = writeSnapshot(sources, "S7", { path: "report.pdf", pages: ["First page ends here", "second page starts here."], extractor: "extractor:pdftotext" })
		expect(readFileSync(join(dir, "text.txt"), "utf8")).toBe("First page ends here\fsecond page starts here.")
		expect(readSentences(dir).map((row) => row.text)).toEqual(["First page ends here", "second page starts here."])
	})

	test("#given Korean text #when written #then the sentence index covers it", () => {
		const sources = tempDir()
		const { dir } = writeSnapshot(sources, "S9", { path: "S9.txt", text: S9_TEXT, extractor: "tool:source-snapshot@1" })
		expect(readSentences(dir).map((row) => row.sid)).toEqual(["S9:s1"])
	})

	test("#given an invalid extractor, source id, or a different text over an existing snapshot #when written #then it throws", () => {
		const sources = tempDir()
		expect(() => writeSnapshot(sources, "S1", { path: "a.txt", text: "x", extractor: "guess" })).toThrow()
		expect(() => writeSnapshot(sources, "source1", { path: "a.txt", text: "x", extractor: "model" })).toThrow()
		writeSnapshot(sources, "S1", { path: "a.txt", text: "first", extractor: "model" })
		expect(() => writeSnapshot(sources, "S1", { path: "a.txt", text: "first", extractor: "model" })).not.toThrow()
		expect(() => writeSnapshot(sources, "S1", { path: "a.txt", text: "second", extractor: "model" })).toThrow(/snapshot_exists/)
	})
})
