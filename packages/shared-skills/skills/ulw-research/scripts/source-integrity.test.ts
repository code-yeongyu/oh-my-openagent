import { describe, expect, onTestFinished, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { CliError, sha256Of } from "./cli-support.mjs"
import { addRow, readLedger, writeLedger } from "./fact-ledger.mjs"
import { run } from "./report-tools.mjs"
import { writeSnapshot } from "./source-snapshot.mjs"

const BRIEF = readFileSync(join(import.meta.dir, "tests/fixtures/fidelity-brief-locked.md"), "utf8")
const PAGE = '<html><body><p>The main deck spans <span title="9 m">320</span> m in total.</p><table id="sizes"><tr><th>Name</th><th>Length</th></tr><tr><td>Deck</td><td>320 m</td></tr></table></body></html>'

// Plain markup (no inline spans) so the pre-fold locator can build the same session: the fail-closed and refresh cases then fail for their own reason.
const PLAIN = "<html><body><p>The main deck spans 320 m in total.</p></body></html>"

type Defect = { code: string; message: string }

/** {{F1}} -> {{F1:<its ledger label>}}: fill requires the label. */
const labeled = (dir: string) => {
	const labels = new Map(readLedger(dir).rows.map((row: { fact_id: string; label: string }) => [row.fact_id, row.label]))
	return (placeholder: string) => placeholder.replace(/\{\{(\w+)\}\}/, (_, id) => `{{${id}:${labels.get(id)}}}`)
}

function session() {
	const dir = mkdtempSync(join(tmpdir(), "source-integrity-"))
	onTestFinished(() => {
		for (const name of ["S1", "S2"]) if (existsSync(join(dir, "sources", name, "raw.bin"))) chmodSync(join(dir, "sources", name, "raw.bin"), 0o644)
		rmSync(dir, { recursive: true, force: true })
	})
	writeFileSync(join(dir, "brief.md"), BRIEF)
	return dir
}

function file(dir: string, name: string, body: string | Buffer) {
	writeFileSync(join(dir, name), body)
	return join(dir, name)
}

const snapshot = (dir: string, id: string, ...flags: string[]) => run(["source", "snapshot", "--id", id, ...flags, "--session-dir", dir])
const fact = (dir: string, ...args: string[]) => run(["fact", ...args, "--session-dir", dir])

async function report(dir: string, placeholders: string[], extra: string[] = []) {
	const cite = (placeholder: string) => (placeholder.includes("S2") ? "S2" : "S1")
	const body = [
		'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Bridge</title></head><body><h1>Bridge</h1><h2>Findings</h2>',
		...placeholders.map((placeholder) => `<p>The source states ${labeled(dir)(placeholder.replace(/:S\d\}\}$/, "}}"))} [${cite(placeholder)}].</p>`),
		"<h2>How this report was made</h2><p>Collected from cited public pages [S1].</p>",
		'<h2>Sources</h2><ol><li id="s1">[S1] Bridge page, retrieved 2026-10-01.</li><li id="s2">[S2] Second page, retrieved 2026-10-01.</li></ol></body></html>',
	].join("\n")
	file(dir, "report.src.html", body)
	expect((await fact(dir, "fill", join(dir, "report.src.html"), "--out", join(dir, "report.html"))).exitCode).toBe(0)
	return fact(dir, "verify", join(dir, "report.html"), ...extra)
}

/** A legacy text.txt snapshot S1 (no raw.bin, no byte locator) holding "<text>" with row F1, filled and verified clean. */
async function legacySession(text = "Span is 320 m.") {
	const dir = session()
	const sources = join(dir, "sources/S1")
	mkdirSync(sources, { recursive: true })
	writeLegacy(sources, text)
	const ledger = readLedger(dir)
	addRow(ledger, { kind: "measured", value: "320", unit: "m", value_span: [8, 11], raw: "320", quote: text, source_id: "S1", locator: { artifact: "S1/text.txt", line: 1, char_start: 0, char_end: 14 }, snapshot_sha256: sha256Of(text), sentence_id: "S1:s1", extracted_by: "model", observed_at: "2026-01-01T00:00:00.000Z", label: "span" })
	writeLedger(dir, ledger)
	expect((await report(dir, ["{{F1}}"])).exitCode).toBe(0)
	return dir
}

function writeLegacy(sources: string, text: string) {
	writeFileSync(join(sources, "text.txt"), text)
	writeFileSync(join(sources, "meta.json"), JSON.stringify({ source_id: "S1", url: "https://example.invalid/", observed_at: "2026-01-01T00:00:00.000Z", sha256: sha256Of(text), extractor: "model", revision: null, kind: "page", provenance: "unknown" }))
}

const reverify = (dir: string, ...extra: string[]) => fact(dir, "verify", join(dir, "report.html"), ...extra)
const blockers = (json: { defects: Defect[] }) => json.defects.filter((defect) => defect.code === "snapshot_hash_mismatch")

/** A page source S1 with F1 (--find) and Q1 (--match), filled and verified clean. */
async function pageSession() {
	const dir = session()
	expect((await snapshot(dir, "S1", "--html", file(dir, "page.html", PLAIN))).exitCode).toBe(0)
	expect((await fact(dir, "add", "--source", "S1", "--find", "main deck spans", "--json")).exitCode).toBe(0)
	expect((await fact(dir, "quote", "--source", "S1", "--match", "main deck spans 320 m", "--json")).exitCode).toBe(0)
	expect((await report(dir, ["{{F1}}", "{{Q1}}"])).exitCode).toBe(0)
	return dir
}

describe("converted text is never a raw snapshot", () => {
	for (const [name, extra] of [["extracted.txt", ["--extractor", "pdftotext@24.02"]], ["page.md", []]] as const) {
		test(`#given --text ${name} without --raw #when snapshotted #then it is converted-only and refuses measured rows`, async () => {
			const dir = session()
			const snap = await snapshot(dir, "S1", "--text", file(dir, name, "The span is 320 m."), ...extra)
			expect(snap.json.data).toMatchObject({ kind: "converted-only", text_source: "converted" })
			expect(existsSync(join(dir, "sources/S1/raw.bin"))).toBe(false)
			expect((await fact(dir, "add", "--source", "S1", "--find", "span is", "--json")).json.error).toBe("snapshot_not_raw")
			const quoted = await fact(dir, "quote", "--source", "S1", "--match", "The span is 320 m.", "--json")
			expect(quoted.json.defects.map((defect: Defect) => defect.code)).toEqual(["quote_converted_only"])
			expect(quoted.json.data.row.locator).toMatchObject({ artifact: "text.txt", unit: "bytes", char_start: 0, char_end: 18 })
			const text = await fact(dir, "quote", "--source", "S1", "--match", "span is 320")
			expect(text.text).toContain("warning quote_converted_only")
		})
	}

	test("#given --raw page bytes with --text #when --find and --table run #then they use the page's text nodes", async () => {
		const dir = session()
		const snap = await snapshot(dir, "S1", "--raw", file(dir, "page.html", PAGE), "--text", file(dir, "aid.txt", "aid"), "--extractor", "reader@1")
		expect(snap.json.data.text_source).toBe("html")
		expect((await fact(dir, "add", "--source", "S1", "--find", "main deck spans", "--json")).json.data.row.value).toBe("320")
		const cell = await fact(dir, "add", "--source", "S1", "--table", "sizes", "--row", "Deck", "--col", "Length", "--json")
		expect([cell.json.data.row.value, cell.json.data.row.quote]).toEqual(["320", "320 m"])
	})

	test("#given --raw non-HTML bytes with a declared --text extraction #when added, verified, then the extraction edited #then verify blocks", async () => {
		const dir = session()
		const snap = await snapshot(dir, "S1", "--raw", file(dir, "doc.pdf", Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff])), "--text", file(dir, "doc.txt", "The span is 320 m."), "--extractor", "pdftotext@24.02")
		expect(snap.json.data.text_source).toBe("declared")
		const added = await fact(dir, "add", "--source", "S1", "--find", "span is", "--json")
		expect(added.json.data.row.locator).toMatchObject({ artifact: "text.txt", unit: "bytes" })
		expect((await report(dir, ["{{F1}}"])).exitCode).toBe(0)
		writeFileSync(join(dir, "sources/S1/text.txt"), "The span is 330 m.")
		expect(blockers((await reverify(dir)).json).length).toBeGreaterThan(0)
	})

	test("#given --raw with --html or --url #when snapshotted #then it is a usage error, not silently ignored", async () => {
		const dir = session()
		const page = file(dir, "page.html", PAGE)
		await expect(snapshot(dir, "S1", "--html", page, "--raw", page)).rejects.toThrow("--raw goes alone or with --text")
		await expect(snapshot(dir, "S1", "--url", "https://example.invalid/", "--raw", page)).rejects.toThrow("--raw goes alone or with --text")
	})
})

describe("replacement over retained raw bytes", () => {
	for (const [name, tampered, recaptured] of [
		["healthy retained bytes", false, false],
		["tampered retained bytes", true, false],
		["an explicit new capture after retained drift", true, true],
	] as const) {
		test(`#given ${name} #when text replaces the extraction #then only validated retained bytes keep their original observation`, async () => {
			const dir = session()
			const observedAt = "2026-01-01T00:00:00.000Z"
			const { dir: source } = writeSnapshot(join(dir, "sources"), "S1", {
				url: "https://example.invalid/bridge", html: PLAIN, extractor: "model", observed_at: observedAt,
			})
			if (tampered) writeFileSync(join(source, "raw.bin"), PLAIN.replace("320", "330"))
			const before = Object.fromEntries(readdirSync(source).map((name) => [name, readFileSync(join(source, name))]))
			const raw = recaptured ? "A new capture says 340 m." : PLAIN
			const text = recaptured ? raw : "The corrected extraction says 320 m."
			const replaced = snapshot(dir, "S1", "--text", file(dir, "corrected.txt", text), "--replace",
				...(recaptured ? ["--raw", file(dir, "recaptured.txt", raw)] : []))

			if (tampered && !recaptured) {
				await expect(replaced).rejects.toBeInstanceOf(CliError)
				expect(Object.fromEntries(readdirSync(source).map((name) => [name, readFileSync(join(source, name))]))).toEqual(before)
				return
			}

			expect((await replaced).exitCode).toBe(0)
			expect(readFileSync(join(source, "raw.bin"), "utf8")).toBe(raw)
			expect(readFileSync(join(source, "text.txt"), "utf8")).toBe(text)
			const meta = JSON.parse(readFileSync(join(source, "meta.json"), "utf8"))
			expect(meta).toMatchObject({ sha256: sha256Of(raw), text_source: "declared", text_sha256: sha256Of(text) })
			if (recaptured) expect(meta.observed_at).not.toBe(observedAt)
			else expect(meta.observed_at).toBe(observedAt)
		})
	}
})

// chmod 000 does not stop the owner reading a file on Windows (no POSIX mode bits), so there the same
// fail-closed condition is produced the way an unreadable path occurs on win32: raw.bin is replaced by
// a directory, and reading it fails (EISDIR). Both paths must make verify exit 1 with the cause.
const unreadableOn = (platform: string) => (dir: string) => {
	const raw = join(dir, "sources/S1/raw.bin")
	if (platform !== "win32") return chmodSync(raw, 0o000)
	unlinkSync(raw)
	mkdirSync(raw)
}
const unreadable = unreadableOn(process.platform)
const UNREADABLE_CAUSE = process.platform === "win32" ? "raw.bin is not a readable file" : "raw.bin is unreadable (EACCES)"

describe("fact verify fails closed when a cited snapshot cannot be read", () => {
	const cases: [string, (dir: string) => void, string[], string][] = [
		["the sources dir is removed", (dir) => rmSync(join(dir, "sources"), { recursive: true }), [], "meta.json is missing"],
		["meta.json is removed", (dir) => unlinkSync(join(dir, "sources/S1/meta.json")), [], "meta.json is missing"],
		["--sources names a missing dir", () => {}, ["--sources", "/nonexistent/sources"], "meta.json is missing"],
		["raw.bin is unreadable", unreadable, [], UNREADABLE_CAUSE],
	]
	for (const [name, damage, extra, cause] of cases) {
		test(`#given ${name} #when verified #then every cited row gets the blocker with the cause and a record is written`, async () => {
			const dir = await pageSession()
			rmSync(join(dir, "fidelity-defects.json"))
			damage(dir)
			const result = await reverify(dir, ...extra)
			expect(result.exitCode).toBe(1)
			expect(blockers(result.json).map((defect) => defect.message)).toEqual([expect.stringContaining(cause), expect.stringContaining(cause)])
			expect(existsSync(join(dir, "fidelity-defects.json"))).toBe(true)
		})
	}

	test("#given the win32 emulation of an unreadable raw.bin on any platform #when verified #then every cited row gets the blocker", async () => {
		const dir = await pageSession()
		unreadableOn("win32")(dir)
		const result = await reverify(dir)
		expect(result.exitCode).toBe(1)
		expect(blockers(result.json).map((defect) => defect.message)).toEqual([expect.stringContaining("raw.bin is not a readable file"), expect.stringContaining("raw.bin is not a readable file")])
	})

	test("#given one of two sources unreadable #when verified #then only its rows are flagged and the healthy row stays clean", async () => {
		const dir = await pageSession()
		expect((await snapshot(dir, "S2", "--html", file(dir, "two.html", "<p>The side deck spans 210 m.</p>"))).exitCode).toBe(0)
		expect((await fact(dir, "add", "--source", "S2", "--find", "side deck spans", "--json")).exitCode).toBe(0)
		expect((await report(dir, ["{{F1}}", "{{F2:S2}}"])).exitCode).toBe(0)
		unlinkSync(join(dir, "sources/S1/meta.json"))
		const result = await reverify(dir)
		expect(result.json.defects.map((defect: Defect) => defect.message.split(":")[0])).toEqual(["F1"])
	})

	test("#given a legacy text.txt row whose text.txt is deleted #when verified #then it blocks", async () => {
		const dir = await legacySession()
		const sources = join(dir, "sources/S1")
		unlinkSync(join(sources, "text.txt"))
		expect(blockers((await reverify(dir)).json)[0]?.message).toContain("text.txt is missing")
	})

	test("#given a byte-located row whose raw.bin is deleted #when verified #then it blocks naming raw.bin", async () => {
		const dir = await pageSession()
		unlinkSync(join(dir, "sources/S1/raw.bin"))
		expect(blockers((await reverify(dir)).json).map((defect) => defect.message)).toEqual([expect.stringContaining("raw.bin is missing"), expect.stringContaining("raw.bin is missing")])
	})

	test("#given a converted-only quote whose text.txt is deleted #when verified #then it blocks", async () => {
		const dir = session()
		await snapshot(dir, "S1", "--text", file(dir, "aid.txt", "The span is 320 m."))
		await fact(dir, "quote", "--source", "S1", "--match", "The span is 320 m.", "--json")
		const clean = await report(dir, ["{{Q1}}"])
		expect([clean.exitCode, clean.json.defects.map((defect: Defect) => defect.code)]).toEqual([0, ["quote_converted_only"]])
		unlinkSync(join(dir, "sources/S1/text.txt"))
		expect(blockers((await reverify(dir)).json)[0]?.message).toContain("text.txt is missing")
	})
})

describe("source refresh is the one explicit repin", () => {
	test("#given a re-captured page with the quote moved #when source refresh runs #then verify reports relocated with old and new offsets", async () => {
		const dir = await pageSession()
		const moved = PLAIN.replace("<body>", "<body><p>A new preface paragraph.</p>")
		expect((await snapshot(dir, "S1", "--html", file(dir, "page2.html", moved))).json.error).toBe("snapshot_exists")
		const refreshed = await run(["source", "refresh", "S1", "--html", join(dir, "page2.html"), "--session-dir", dir])
		expect(refreshed.exitCode).toBe(0)
		expect(refreshed.json.data.rows.map((row: { status: string }) => row.status)).toEqual(["relocated", "relocated"])
		const result = await reverify(dir)
		expect(result.exitCode).toBe(0)
		const offset = Buffer.byteLength("<p>A new preface paragraph.</p>")
		const before = readLedger(dir).rows[0].locator
		expect(result.json.defects).toContainEqual(expect.objectContaining({ code: "relocated", severity: "minor", message: expect.stringContaining(`${before.char_start}:${before.char_end} -> ${before.char_start + offset}:${before.char_end + offset}`) }))
	})

	test("#given a re-captured page whose value changed #when source refresh runs #then the row is not re-anchored and verify blocks", async () => {
		const dir = await pageSession()
		const refreshed = await run(["source", "refresh", "S1", "--html", file(dir, "page3.html", PLAIN.replace("320", "330")), "--session-dir", dir])
		expect(refreshed.exitCode).toBe(1)
		expect(refreshed.json.defects.map((defect: Defect) => defect.code)).toEqual(["quote_not_verbatim", "quote_not_verbatim"])
		expect(blockers((await reverify(dir)).json).length).toBe(2)
	})

	test("#given a legacy row whose source is refreshed to a page that no longer says it #when refresh then verify run #then both exit 1 naming F1", async () => {
		const dir = await legacySession()
		const refreshed = await run(["source", "refresh", "S1", "--html", file(dir, "page999.html", "<p>Span is 999 m.</p>"), "--session-dir", dir])
		expect(refreshed.exitCode).toBe(1)
		expect(refreshed.json.data.rows).toEqual([{ fact_id: "F1", status: "legacy_not_reanchored" }])
		const result = await reverify(dir)
		expect(result.exitCode).toBe(1)
		expect(blockers(result.json).map((defect) => [defect.message.split(":")[0], defect.message.includes("no longer the legacy text.txt snapshot")])).toEqual([["F1", true]])
	})

	test("#given a legacy row whose legacy snapshot is replaced by another consistent one #when verified #then the pin mismatch blocks F1", async () => {
		const dir = await legacySession()
		writeLegacy(join(dir, "sources/S1"), "Span is 999 m.")
		const result = await reverify(dir)
		expect(result.exitCode).toBe(1)
		expect(blockers(result.json).map((defect) => defect.message)).toEqual([expect.stringMatching(/^F1: snapshot S1 holds \w+ but the legacy row pins \w+/)])
	})
})
