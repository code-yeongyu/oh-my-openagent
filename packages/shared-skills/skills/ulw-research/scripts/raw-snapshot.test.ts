import { describe, expect, onTestFinished, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { sha256Of } from "./cli-support.mjs"
import { DEFECT_CODES, INTEGRITY_CODES } from "./contracts.mjs"
import { readLedger, writeLedger } from "./fact-ledger.mjs"
import { run } from "./report-tools.mjs"
import { writeSnapshot } from "./source-snapshot.mjs"

const BRIEF = readFileSync(join(import.meta.dir, "tests/fixtures/fidelity-brief-locked.md"), "utf8")

function session(text: string, kind = "document") {
	const dir = mkdtempSync(join(tmpdir(), "raw-snapshot-"))
	onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
	writeFileSync(join(dir, "brief.md"), BRIEF)
	writeSnapshot(join(dir, "sources"), "S1", { path: "source.txt", text, kind, extractor: "tool:source-snapshot@1" })
	return dir
}

const add = (dir: string) => run(["fact", "add", "--session-dir", dir, "--source", "S1", "--find", "Span", "--label", "span", "--json"])

// fact verify needs the edition's fill map under the current brief, so the edition is filled, not hand-written.
async function verify(dir: string) {
	const row = readLedger(dir).rows[0]
	const [source, report] = [join(dir, "report.src.html"), join(dir, "report.html")]
	writeFileSync(source, `<h2>Findings</h2><p>{{${row.fact_id}:${row.label}}} [S1].</p>`)
	await run(["fact", "fill", source, "--out", report, "--session-dir", dir])
	return run(["fact", "verify", report, "--session-dir", dir])
}

function refetch(dir: string, text: string) {
	writeFileSync(join(dir, "sources/S1/raw.bin"), text)
	const metaPath = join(dir, "sources/S1/meta.json")
	const meta = JSON.parse(readFileSync(metaPath, "utf8"))
	meta.sha256 = sha256Of(text)
	writeFileSync(metaPath, JSON.stringify(meta))
	const ledger = readLedger(dir)
	ledger.rows[0].snapshot_sha256 = meta.sha256
	writeLedger(dir, ledger)
}

describe("raw snapshot contract", () => {
	test("text-only source cannot back a measured row", async () => {
		const dir = session("Span is 320 m.")
		const raw = join(dir, "sources/S1/raw.bin")
		try { unlinkSync(raw) } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
		await expect(add(dir)).rejects.toThrow("raw.bin is missing")
	})

	test("raw bytes determine hash and UTF-8 locator offsets before normalization", async () => {
		const text = "\u00e9.\nSpan is 320 m."
		const dir = session(text)
		writeFileSync(join(dir, "sources/S1/text.txt"), "Span is 999 m.")
		const result = await add(dir)
		expect(result.exitCode).toBe(0)
		const row = result.json.data.row
		expect(row.value).toBe("320")
		expect(row.snapshot_sha256).toBe(sha256Of(Buffer.from(text)))
		expect(row.locator).toMatchObject({ unit: "bytes", artifact: "raw.bin", char_start: 4, char_end: Buffer.byteLength(text) })
		expect(row.context).toEqual({ prefix: "\u00e9.\nSpan is ", suffix: "." })
	})

	test("raw drift blocks verification even when quote re-anchors", async () => {
		const dir = session("Span is 320 m.")
		await add(dir)
		writeFileSync(join(dir, "sources/S1/raw.bin"), "   Span is 320 m.")
		const result = await verify(dir)
		expect(result.exitCode).toBe(1)
		expect(result.json.defects.some((d: { code: string }) => d.code === "snapshot_hash_mismatch")).toBe(true)
	})

	test("explicitly repinned refetch re-anchors with old and new byte offsets", async () => {
		const dir = session("Span is 320 m.")
		await add(dir)
		refetch(dir, "   Span is 320 m.")
		const result = await verify(dir)
		expect(result.exitCode).toBe(0)
		expect(result.json.defects).toContainEqual(expect.objectContaining({ code: "relocated", severity: "minor", message: expect.stringContaining("0:14 -> 3:17") }))
	})

	test("context disambiguates two exact quotes", async () => {
		const dir = session("a".repeat(40) + "\nSpan is 320 m.\n" + "b".repeat(40))
		await add(dir)
		refetch(dir, "lead\n" + "c".repeat(40) + "\nSpan is 320 m.\n" + "d".repeat(40) + "\n" + "a".repeat(40) + "\nSpan is 320 m.\n" + "b".repeat(40))
		const result = await verify(dir)
		expect(result.exitCode).toBe(0)
		expect(result.json.defects.some((d: { code: string }) => d.code === "relocated")).toBe(true)
	})

	test("identical contexts refuse ambiguous relocation with existing failure code", async () => {
		const text = "a".repeat(40) + "\nSpan is 320 m.\n" + "b".repeat(40)
		const dir = session(text)
		await add(dir)
		refetch(dir, `lead\n${text}\n${text}`)
		const result = await verify(dir)
		expect(result.exitCode).toBe(1)
		expect(result.json.defects.some((d: { code: string }) => d.code === "quote_not_verbatim")).toBe(true)
		expect(result.json.defects.some((d: { code: string }) => d.code === "relocated")).toBe(false)
	})

	test("snapshot_not_raw is an integrity blocker", () => {
		expect(DEFECT_CODES.snapshot_not_raw).toMatchObject({ severity: "blocker", integrity: true })
		expect(INTEGRITY_CODES.has("snapshot_not_raw")).toBe(true)
	})

	test("HTML snapshots hash unmodified markup rather than extracted prose", () => {
		const dir = session("unused")
		const html = "<p>Span&nbsp;is <b>320</b> m.</p>"
		const saved = writeSnapshot(join(dir, "other"), "S2", { html, path: "source.html", extractor: "model" })
		expect(readFileSync(join(saved.dir, "raw.bin"), "utf8")).toBe(html)
		expect(saved.sha256).toBe(sha256Of(html))
	})

	test("raw table offsets select the labeled cell, not attribute numerals or another value", async () => {
		const dir = session("unused")
		const html = '<!--\u00e9--><table id="sizes"><tr><th>Name</th><th>Length</th></tr><tr><td>Deck</td><td><b title="9">320</b> m</td></tr><tr><td>Other</td><td>320 m</td></tr></table>'
		writeSnapshot(join(dir, "sources"), "S2", { html, path: "source.html", extractor: "model" })
		const result = await run(["fact", "add", "--session-dir", dir, "--source", "S2", "--table", "sizes", "--row", "Deck", "--col", "Length", "--label", "deck", "--json"])
		expect(result.exitCode).toBe(0)
		const row = result.json.data.row
		expect(row.value).toBe("320")
		expect(row.unit).toBe("m")
		expect(row.quote).toBe("320 m")
		expect(Buffer.from(html).subarray(row.locator.char_start, row.locator.char_end).toString()).toBe("320</b> m")
		expect(row.quote.slice(...row.value_span)).toBe(row.raw)
		expect(row.context.prefix).not.toContain("title")
	})

	test("converted-only sources refuse measured facts but allow warned quotations", async () => {
		const dir = session("Span is 320 m.", "converted-only")
		expect((await add(dir)).json.error).toBe("snapshot_not_raw")
		const result = await run(["fact", "quote", "--session-dir", dir, "--source", "S1", "--match", "Span is 320 m.", "--json"])
		expect(result.exitCode).toBe(0)
		expect(result.json.defects).toContainEqual(expect.objectContaining({ code: "quote_converted_only" }))
		expect(result.json.data.row.context).toEqual({ prefix: "", suffix: "" })
	})
})
