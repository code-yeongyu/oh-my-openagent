import { describe, expect, onTestFinished, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { readLedger } from "./fact-ledger.mjs"
import { run } from "./report-tools.mjs"

const BRIEF = readFileSync(join(import.meta.dir, "tests/fixtures/fidelity-brief-locked.md"), "utf8")

type Row = { fact_id: string; value: string; unit: string; quote: string; raw: string; sentence_id: string; locator: { artifact: string; unit: string; char_start: number; char_end: number } }
type Defect = { code: string; message: string }

/** {{F1}} -> {{F1:<its ledger label>}}: fill requires the label. */
const labeled = (dir: string) => {
	const labels = new Map(readLedger(dir).rows.map((row: { fact_id: string; label: string }) => [row.fact_id, row.label]))
	return (placeholder: string) => placeholder.replace(/\{\{(\w+)\}\}/, (_, id) => `{{${id}:${labels.get(id)}}}`)
}

function session() {
	const dir = mkdtempSync(join(tmpdir(), "page-source-"))
	onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
	writeFileSync(join(dir, "brief.md"), BRIEF)
	return dir
}

async function snapshotPage(dir: string, bytes: Buffer | string, id = "S1") {
	const file = join(dir, `${id}.capture.html`)
	writeFileSync(file, bytes)
	const result = await run(["source", "snapshot", "--id", id, "--html", file, "--session-dir", dir])
	expect(result.exitCode).toBe(0)
	return Buffer.from(bytes)
}

const find = (dir: string, anchor: string, id = "S1") => run(["fact", "add", "--session-dir", dir, "--source", id, "--find", anchor, "--json"])
const quote = (dir: string, match: string) => run(["fact", "quote", "--session-dir", dir, "--source", "S1", "--match", match, "--json"])

/** Fill a report citing every given placeholder, then verify it; returns the verify result and the filled html. */
async function fillAndVerify(dir: string, placeholders: string[]) {
	const body = [
		'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Bridge</title></head><body><h1>Bridge</h1>',
		"<h2>Findings</h2>",
		...placeholders.map(labeled(dir)).map((placeholder) => `<p>The source states ${placeholder} [S1].</p>`),
		"<h2>How this report was made</h2><p>Collected from one cited public page [S1].</p>",
		'<h2>Sources</h2><ol><li id="s1">[S1] Bridge page, retrieved 2026-10-01.</li></ol></body></html>',
	].join("\n")
	writeFileSync(join(dir, "report.src.html"), body)
	const filled = await run(["fact", "fill", join(dir, "report.src.html"), "--out", join(dir, "report.html"), "--session-dir", dir])
	expect(filled.exitCode).toBe(0)
	const verified = await run(["fact", "verify", join(dir, "report.html"), "--session-dir", dir])
	return { verified, html: readFileSync(join(dir, "report.html"), "utf8") }
}

const codes = (json: { defects: Defect[] }) => json.defects.map((defect) => defect.code)

const PAGE = [
	"<!doctype html><html><head><title>Deck 9 m</title><style>.deck{font-size:14px}</style><script>var span = 9;</script></head><body>",
	'<p>The main deck spans <span title="9 m" data-v="320">320</span> m in total.</p>',
	'<p>The upper deck spans <span style="font-size:14px">330</span> m.</p>',
	"</body></html>",
].join("")

describe("page sources locate on visible text nodes only", () => {
	test("#given numbers in title, data and style attributes #when fact add --find runs #then the text-node value is recorded and verifies", async () => {
		const dir = session()
		const raw = await snapshotPage(dir, PAGE)
		const main = await find(dir, "main deck spans")
		const upper = await find(dir, "upper deck spans")
		expect(main.exitCode).toBe(0)
		const row: Row = main.json.data.row
		expect([row.value, row.unit, row.quote]).toEqual(["320", "m", "The main deck spans 320 m in total."])
		expect(row.locator).toMatchObject({ artifact: "raw.bin", unit: "bytes" })
		const span = raw.subarray(row.locator.char_start, row.locator.char_end).toString("utf8")
		expect(span).toBe('The main deck spans <span title="9 m" data-v="320">320</span> m in total.')
		expect([upper.json.data.row.value, upper.json.data.row.unit]).toEqual(["330", "m"])
		const { verified, html } = await fillAndVerify(dir, ["{{F1}}", "{{F2}}"])
		expect(verified.exitCode).toBe(0)
		expect(html).toContain("320 m")
		expect(html).not.toContain(">9 m<")
	})

	test("#given the same anchor in a hidden element and a visible paragraph #when --find runs #then only the visible number is located", async () => {
		const dir = session()
		const hidden = [
			'<div style="display:none"><p>Visible length is 999 m.</p></div>',
			'<div style="color:red; visibility: hidden"><p>Shadow length is 998 m.</p></div>',
			'<p aria-hidden="true">Ghost length is 997 m.</p>',
			"<p hidden>Secret length is 996 m.</p>",
			"<noscript>Script length is 995 m.</noscript>",
			"<template><p>Template length is 994 m.</p></template>",
		].join("")
		await snapshotPage(dir, `<html><head><script>Inline length is 993 m.</script><style>.x{}</style></head><body>${hidden}<p>Visible length is 410 m.</p></body></html>`)
		const visible = await find(dir, "Visible length is")
		expect(visible.exitCode).toBe(0)
		expect(visible.json.data.row.value).toBe("410")
		for (const anchor of ["Shadow length is", "Ghost length is", "Secret length is", "Script length is", "Template length is", "Inline length is"]) {
			const result = await find(dir, anchor)
			expect([anchor, result.json.error]).toEqual([anchor, "fact_not_located"])
		}
		expect(readFileSync(join(dir, "sources/S1/text.txt"), "utf8")).toBe("Visible length is 410 m.")
	})

	test("#given elements hidden by <style> rules on a class, an id, or a tag #when --find runs #then they are not located", async () => {
		const dir = session()
		const style = "<style>.d-none, .sr-only { display: none } #gone{visibility:hidden} footer{color:red;display:none} div p.keep{display:none}</style>"
		const body = '<p class="lead d-none">Class length is 999 m.</p><p id="gone">Id length is 998 m.</p><footer>Tag length is 997 m.</footer><p class="keep">Kept length is 410 m.</p>'
		await snapshotPage(dir, `<html><head>${style}</head><body>${body}</body></html>`)
		for (const anchor of ["Class length is", "Id length is", "Tag length is"]) expect([anchor, (await find(dir, anchor)).json.error]).toEqual([anchor, "fact_not_located"])
		expect((await find(dir, "Kept length is")).json.data.row.value).toBe("410")
	})

	test("#given rules inside @media (a responsive or a print copy) #when --find runs #then the text is located, and an unconditional rule still hides", async () => {
		const dir = session()
		const style = "<style>@media (max-width:600px){.desk{display:none}} @media print{.screen{display:none}} .d-none{display:none}</style>"
		const body = '<p class="desk">Desktop length is 410 m.</p><p class="screen">Screen length is 411 m.</p><p class="d-none">Mobile length is 412 m.</p>'
		await snapshotPage(dir, `<html><head>${style}</head><body>${body}</body></html>`)
		const desktop = await find(dir, "Desktop length is")
		expect(desktop.exitCode).toBe(0)
		expect(desktop.json.data.row.value).toBe("410")
		expect((await find(dir, "Screen length is")).json.data.row.value).toBe("411")
		expect((await find(dir, "Mobile length is")).json.error).toBe("fact_not_located")
	})

	test("#given a quote across inline markup #when fact quote --match runs #then the quotation is that sentence, indexed like sentences.jsonl", async () => {
		const dir = session()
		await snapshotPage(dir, "<!doctype html><html><head><script>var x = 1;</script></head><body><p>Construction opens <em>no earlier</em> than 2027. Funding is pending.</p></body></html>")
		const result = await quote(dir, "opens no earlier than 2027")
		expect(result.exitCode).toBe(0)
		const row: Row = result.json.data.row
		expect(row.quote).toBe("Construction opens no earlier than 2027.")
		const sentences = readFileSync(join(dir, "sources/S1/sentences.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line))
		expect(sentences.find((entry: { sid: string }) => entry.sid === row.sentence_id)?.text).toBe(row.quote)
		const { verified, html } = await fillAndVerify(dir, ["{{Q1}}"])
		expect(verified.exitCode).toBe(0)
		expect(html).toContain("Construction opens no earlier than 2027.")
		expect(html).not.toContain("&lt;")
	})

	test("#given a table cell without </td> #when --table runs #then the quote is the cell text, not the rest of the document", async () => {
		const dir = session()
		const raw = await snapshotPage(dir, '<table id="sizes"><tr><th>Name</th><th>Length</th></tr><tr><td>Deck</td><td><b title="9">320</b> m</tr></table><p>Appendix 9 holds notes.</p>')
		const result = await run(["fact", "add", "--session-dir", dir, "--source", "S1", "--table", "sizes", "--row", "Deck", "--col", "Length", "--json"])
		expect(result.exitCode).toBe(0)
		const row: Row = result.json.data.row
		expect([row.value, row.unit, row.quote]).toEqual(["320", "m", "320 m"])
		expect(raw.subarray(row.locator.char_start, row.locator.char_end).toString()).toBe('320</b> m')
		expect((await fillAndVerify(dir, ["{{F1}}"])).verified.exitCode).toBe(0)
	})
})

describe("byte offsets count the source's own encoding", () => {
	const latin1 = (text: string) => Buffer.from(text, "latin1")

	test("#given a declared ISO-8859-1 page with Caf\\xE9 before the value #when added and verified unchanged #then offsets hit the real bytes and verify is clean", async () => {
		const dir = session()
		const raw = await snapshotPage(dir, latin1('<html><head><meta charset="iso-8859-1"></head><body><p>Caf\u00e9. The span is 320 m.</p></body></html>'))
		const result = await find(dir, "The span is")
		const row: Row = result.json.data.row
		expect(raw.subarray(row.locator.char_start, row.locator.char_end).toString("latin1")).toBe("The span is 320 m.")
		const { verified } = await fillAndVerify(dir, ["{{F1}}"])
		expect(verified.exitCode).toBe(0)
		expect(codes(verified.json)).not.toContain("relocated")
	})

	test("#given an undeclared Latin-1 byte with more than 32 characters before the value #when verified unchanged #then no false relocation", async () => {
		const dir = session()
		await snapshotPage(dir, latin1("<p>Caf\u00e9 au lait is served here all day long. The span is 320 m.</p>"))
		await find(dir, "The span is")
		const { verified } = await fillAndVerify(dir, ["{{F1}}"])
		expect(verified.exitCode).toBe(0)
		expect(codes(verified.json)).toEqual([])
	})

	test("#given an EUC-KR page #when added and verified unchanged #then the locator spans the EUC-KR bytes and verify is clean", async () => {
		const dir = session()
		const bytes = Buffer.from("3c68746d6c3e3c686561643e3c6d65746120636861727365743d226575632d6b72223e3c2f686561643e3c626f64793e3c703ec1d620b1b3b7aec0c720b1e6c0ccb4c220333230206d20c0ccb4d92e3c2f703e3c2f626f64793e3c2f68746d6c3e", "hex")
		const raw = await snapshotPage(dir, bytes)
		const result = await find(dir, "\uae38\uc774\ub294")
		expect(result.exitCode).toBe(0)
		const row: Row = result.json.data.row
		expect(row.value).toBe("320")
		expect(raw.subarray(row.locator.char_start, row.locator.char_end).toString("hex")).toBe("c1d620b1b3b7aec0c720b1e6c0ccb4c220333230206d20c0ccb4d92e")
		const { verified } = await fillAndVerify(dir, ["{{F1}}"])
		expect(verified.exitCode).toBe(0)
		expect(codes(verified.json)).toEqual([])
	})
})
