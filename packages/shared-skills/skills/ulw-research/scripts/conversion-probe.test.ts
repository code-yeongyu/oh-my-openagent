import { describe, expect, onTestFinished, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { numberKey } from "./conversion-probe.mjs"
import { readFidelityRecord } from "./fidelity-records.mjs"
import { writeSnapshot } from "./source-snapshot.mjs"

const CLI = join(import.meta.dir, "report-tools.mjs")
const FIXTURE = readFileSync(join(import.meta.dir, "tests/fixtures/conversion-probe.html"), "utf8")
const FLATTENED = FIXTURE.replace(/<[^>]*>/g, "")
// Superscript boundaries preserve 4.2 + 2, 27.3 + 1 and 10 + 9 in raw.
const ALTERED = ["4.22", "27.31", "109"]

function sandbox(): string {
	const dir = mkdtempSync(join(tmpdir(), "conversion-probe-"))
	onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
	return dir
}

function probe(raw: string, converted: string) {
	const dir = sandbox()
	const rawFile = join(dir, "raw.html")
	const convertedFile = join(dir, "converted.txt")
	writeFileSync(rawFile, raw)
	writeFileSync(convertedFile, converted)
	const proc = spawnSync("node", [CLI, "source", "probe-conversion", rawFile, convertedFile], { encoding: "utf8" })
	expect(proc.error).toBeUndefined()
	expect(proc.stdout, proc.stderr).not.toBe("")
	return { exitCode: proc.status, json: JSON.parse(proc.stdout) }
}

describe("source probe-conversion", () => {
	test("#given the probe page #when naively flattened #then only fabricated numbers are altered", () => {
		const result = probe(FIXTURE, FLATTENED)
		expect(result.exitCode).toBe(1)
		// Stripping the adjacent table tags also joins Total's 2 to the first cell.
		// The flatten glues Total's 2 onto 12,345 and 12,345 onto 15,678: "212,34515,678".
		expect(result.json.altered).toEqual([...ALTERED, "212,34515", "678"])
		expect(result.json.lost).toContain("2026")
		expect(result.json.lost).not.toContain("99.9")
		expect(result.json.altered).not.toContain("99.9")
	})

	test("#given a plain text #when compared to itself #then identity passes without alterations", () => {
		const text = "USD 4.2 billion; 1,234.5 units; 1 234 567 people; -3.5 and 2019-2023."
		const result = probe(text, text)
		expect(result.exitCode).toBe(0)
		expect(result.json.altered).toEqual([])
		expect(result.json.lost).toEqual([])
		expect(result.json.converted_count).toBe(result.json.raw_count)
	})

	test("#given a tag-split decimal #when compared with text #then each side has one number", () => {
		const result = probe("<span>1</span><span>,</span><span>234.5</span>", "1,234.5")
		expect(result).toEqual({ exitCode: 0, json: { altered: [], lost: [], raw_count: 1, converted_count: 1 } })
	})

	test.each(["\u202f", "\u00a0"])("#given %s thousands separators #when converted to spaces #then grouping is equivalent", (separator: string) => {
		const result = probe(`1${separator}234${separator}567`, "1 234 567")
		expect(result).toEqual({ exitCode: 0, json: { altered: [], lost: [], raw_count: 1, converted_count: 1 } })
	})

	test("#given a machine date #when its attribute is removed #then it is lost, not altered", () => {
		const result = probe('<time datetime="2026-10-01T09:00:00Z">1 Oct</time>', "1 Oct")
		expect(result.exitCode).toBe(0)
		expect(result.json.altered).toEqual([])
		expect(result.json.lost).toEqual(["2026", "10", "01", "09", "00", "00"])
	})

	test("#given repeated signed decimals #when one count increases #then multiset subtraction preserves the excess", () => {
		const result = probe("-4.2 +7 2", "-4.2 +7 2; 2")
		expect(result.exitCode).toBe(1)
		expect(result.json.altered).toEqual(["2"])
		expect(result.json.lost).toEqual([])
	})

	test("#given hidden text #when omitted by conversion #then the number is only lost", () => {
		const result = probe('<span style="display:none">99.9</span>', "")
		expect(result.exitCode).toBe(0)
		expect(result.json.altered).toEqual([])
		expect(result.json.lost).toEqual(["99.9"])
	})
})

describe("one grouped-number grammar: a digit glued after the last group is an alteration", () => {
	test("#given a footnote glued onto a grouped number #when probed #then it is altered", () => {
		expect(probe("$1,234<sup>5</sup> million", "$1,2345 million").json.altered).toEqual(["1,2345"])
		expect(probe("<table><tr><td>12,345<sup>1</sup></td></tr></table>", "12,3451").json.altered).toEqual(["12,3451"])
	})

	test("#given the same cell through the built-in snapshot #when written #then conversion.json lists it", () => {
		const { dir } = writeSnapshot(join(sandbox(), "sources"), "S1", { path: "t.html", html: "<table><tr><td>12,345<sup>1</sup></td></tr></table>", extractor: "model", observed_at: "2026-10-25T00:00:00Z" })
		expect(readFidelityRecord(join(dir, "conversion.json"), "source_conversion").conversion_altered_numbers).toEqual(["12,3451"])
	})
})

describe("Markdown-shaped converter output reports only real artifacts", () => {
	const RAW = [
		"<p>Revenue was 4.2<sup>2</sup> billion.<sup><a href=\"#cite_note-7\">[7]</a></sup></p>",
		"<p><a href=\"https://example.com/2024/03/report-4\">Report</a> covers q4-2023.</p>",
		"<p><img src=\"chart-640x480.png\" alt=\"Chart 2023\" title=\"Fig 4\"></p>",
		"<table><tr><td>12,345<sup>1</sup></td><td>1&#8201;234&#8201;567</td></tr></table>",
		"<p>From 2019\u20132023 the index fell \u22123.5 points.</p>",
	].join("\n")
	const MARKDOWN = [
		"Revenue was 4.22 billion.[[7]](#cite_note-7)",
		"",
		"[Report](https://example.com/2024/03/report-4) covers q4-2023.",
		"",
		"![Chart 2023](chart-640x480.png \"Fig 4\")",
		"",
		"| 12,3451 | 1\u2009234\u2009567 |",
		"",
		"From 2019-2023 the index fell -3.5 points.",
	].join("\n")

	test("#given markdownify-shaped text #when probed #then altered is exactly 4.22 and 12,3451", () => {
		expect(probe(RAW, MARKDOWN).json.altered).toEqual(["4.22", "12,3451"])
	})

	test("#given the same page through the built-in snapshot #when written #then only the real artifacts are altered", () => {
		const { dir } = writeSnapshot(join(sandbox(), "sources"), "S1", { path: "m.html", html: RAW, extractor: "model", observed_at: "2026-10-25T00:00:00Z" })
		expect(readFidelityRecord(join(dir, "conversion.json"), "source_conversion").conversion_altered_numbers).toEqual(["4.22", "12,3451"])
	})

	test("#given a converted text that looks like a tag #when probed #then it is never parsed as HTML", () => {
		expect(probe("<p>if a&lt;b then revenue was 4.2<sup>2</sup> billion</p>", "if a<b then revenue was 4.22 billion").json.altered).toEqual(["4.22"])
	})
})

describe("whitespace and separators match the snapshot side", () => {
	for (const [raw, converted] of [
		["<p>1&#8201;234&#8201;567</p>", "1 234 567"],
		["<p>1&#8199;234</p>", "1 234"],
		["<table><tr><td>2,500<br>300</td></tr></table>", "2,500 300"],
		["<ul><li><p>in 2023</p><p>500 sites</p></li></ul>", "in 2023 500 sites"],
		["<p>1,250\n300</p>", "1,250 300"],
		["<p><span>1</span>\n<span>234</span></p>", "1 234"],
	]) {
		test(`#given ${JSON.stringify(raw)} #when converted to ${JSON.stringify(converted)} #then nothing is altered`, () => {
			const result = probe(raw, converted)
			expect(result.json.altered).toEqual([])
			expect(result.exitCode).toBe(0)
		})
	}
})

test("#given HTML snapshot conversion #when written #then source warnings use the fidelity envelope", () => {
	const { dir } = writeSnapshot(join(sandbox(), "sources"), "S1", {
		path: "fixture.html", html: FIXTURE, extractor: "model", observed_at: "2026-10-25T00:00:00Z",
	})
	const record = readFidelityRecord(join(dir, "conversion.json"), "source_conversion")
	expect(record.conversion_altered_numbers).toEqual(ALTERED)
	expect(record.record_kind).toBe("source_conversion")
	expect(record.artifact_sha256).toMatch(/^[0-9a-f]{64}$/)
	expect(record.report).toBe(join(dir, "source.html"))
	expect(record.written_at).toBe("2026-10-25T00:00:00.000Z")
	expect(record.defects).toEqual([])
})

describe("attribute digits cover only a number inside Markdown link or image syntax", () => {
	const GLUED = "<p>Output reached 10<sup>9</sup> kWh</p>"
	const BOOK = '<p><a href="https://books.example/b?id=x&amp;pg=PA109">book</a></p>'

	test("#given an href page number 109 #when the prose shows a glued 10<sup>9</sup> #then 109 is altered in flat and Markdown output", () => {
		expect(probe(`${GLUED}${BOOK}`, "Output reached 109 kWh\n\nbook").json.altered).toEqual(["109"])
		expect(probe(`${GLUED}${BOOK}`, "Output reached 109 kWh\n\n[book](https://books.example/b?id=x&pg=PA109)").json.altered).toEqual(["109"])
	})

	test("#given #ref1..#ref45 links #when 4<sup>2</sup> is glued into 42 #then 42 is altered", () => {
		const links = Array.from({ length: 45 }, (_, k) => `<a href="#ref${k + 1}">note</a>`).join(" ")
		const markdown = Array.from({ length: 45 }, (_, k) => `[note](#ref${k + 1})`).join(" ")
		expect(probe(`<p>Area grew 4<sup>2</sup> times.</p><p>${links}</p>`, `Area grew 42 times.\n\n${markdown}`).json.altered).toEqual(["42"])
	})

	test("#given an image named chart-109.png #when the built-in snapshot writes the page #then 109 is altered", () => {
		const { dir } = writeSnapshot(join(sandbox(), "sources"), "S1", { path: "g.html", html: `${GLUED}<p><img src="chart-109.png"></p>`, extractor: "model", observed_at: "2026-10-25T00:00:00Z" })
		expect(readFidelityRecord(join(dir, "conversion.json"), "source_conversion").conversion_altered_numbers).toEqual(["109"])
	})
})

describe("cell, row, list-item and line breaks never group digits", () => {
	for (const [raw, converted] of [
		["<table><tr><td>3</td><td>250</td><td>100</td></tr></table>", "| 3 | 250 | 100 |"],
		["<table><tr><td>12</td><td>345</td></tr></table>", "| 12 | 345 |"],
		["<ul><li>3</li><li>250</li></ul>", "- 3\n- 250"],
		["<p>3</p><p>250</p>", "3\n250"],
	]) {
		test(`#given ${JSON.stringify(raw)} #when converted to ${JSON.stringify(converted)} #then nothing is altered or lost`, () => {
			expect(probe(raw, converted)).toMatchObject({ exitCode: 0, json: { altered: [], lost: [] } })
		})
	}

	test("#given 1 234 567 inside one cell #when converted to a Markdown row #then it stays one grouped number", () => {
		expect(probe("<table><tr><td>1 234 567</td><td>8</td></tr></table>", "| 1 234 567 | 8 |")).toEqual({ exitCode: 0, json: { altered: [], lost: [], raw_count: 2, converted_count: 2 } })
	})
})

describe("a period group needs an unambiguous shape; a dropped minus is altered", () => {
	test("#given 1.234 and 1,234 #when keyed #then they differ, and 1.234.567 still groups", () => {
		expect(numberKey("1.234")).not.toBe(numberKey("1,234"))
		expect(numberKey("1.234.567")).toBe(numberKey("1,234,567"))
		expect(numberKey("1.234,5")).toBe(numberKey("1,234.5"))
	})

	test("#given a glued 12.34<sup>5</sup> beside a real 12,345 #when flattened #then the glued 12.345 is the altered token", () => {
		expect(probe("<p>12.34<sup>5</sup> and 12,345</p>", "12.345 and 12,345").json.altered).toEqual(["12.345"])
	})

	test("#given a minus touching Hangul or an en dash minus #when the sign is dropped #then the unsigned number is altered", () => {
		expect(probe("\uAC10\uC18C\uC728-3.5%", "\uAC10\uC18C\uC728 3.5%").json.altered).toEqual(["3.5"])
		expect(probe("fell \u20135%", "fell 5%").json.altered).toEqual(["5"])
		expect(probe("cite_note-7 and 2019\u20132023", "cite_note-7 and 2019-2023").json.altered).toEqual([])
	})
})
