import { describe, expect, onTestFinished, test } from "bun:test"
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { CliError } from "./cli-support.mjs"
import { DEFECT_CODES } from "./contracts.mjs"
import { run } from "./report-tools.mjs"
import { writeSnapshot } from "./source-snapshot.mjs"

type Json = Record<string, unknown> & { data?: Record<string, unknown>; error?: string }
const PAGE = "<p>USD 4.2<sup>2</sup> billion in revenue.</p><p>Staff grew to 1,250 people.</p>"

function session() {
	const dir = mkdtempSync(join(tmpdir(), "conversion-altered-"))
	onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
	return dir
}

async function snapshot(dir: string, html = PAGE) {
	const file = join(dir, "page.html")
	writeFileSync(file, html)
	return (await run(["source", "snapshot", "--id", "S1", "--html", file, "--session-dir", dir])) as { exitCode: number; json: Json; summary: string }
}

describe("the conversion probe result is consumed", () => {
	test("#given a page whose conversion altered a number #when snapshotted #then the JSON and the summary report it", async () => {
		const result = await snapshot(session())
		expect(result.exitCode).toBe(0)
		expect(result.json.data?.conversion_altered_numbers).toEqual(["4.22"])
		expect(result.summary).toContain("1 altered")
	})

	test("#given an altered 4.22 in conversion.json #when fact add --find locates it #then it refuses with conversion_altered_number and writes no row", async () => {
		const dir = session()
		await snapshot(dir)
		const result = (await run(["fact", "add", "--source", "S1", "--find", "USD", "--label", "usd_bn", "--session-dir", dir, "--json"])) as { exitCode: number; json: Json }
		expect(result.exitCode).toBe(1)
		expect(result.json.error).toBe("conversion_altered_number")
		expect(existsSync(join(dir, "fact-ledger.json"))).toBe(false)
		expect(DEFECT_CODES.conversion_altered_number).toMatchObject({ severity: "blocker", integrity: true })
	})

	test("#given an unaltered number in the same snapshot #when fact add --find locates it #then it registers", async () => {
		const dir = session()
		await snapshot(dir)
		const result = (await run(["fact", "add", "--source", "S1", "--find", "Staff grew to", "--label", "staff", "--session-dir", dir, "--json"])) as { exitCode: number; json: Json }
		expect(result.exitCode).toBe(0)
		expect((result.json.data?.row as { value: string }).value).toBe("1250")
	})

	test("#given a non-ISO observed_at #when writeSnapshot runs #then it throws before writing anything", () => {
		const dir = join(session(), "sources")
		expect(() => writeSnapshot(dir, "S1", { path: "p.html", html: PAGE, extractor: "model", observed_at: "yesterday" })).toThrow(TypeError)
		expect(existsSync(join(dir, "S1"))).toBe(false)
	})

	test("#given an image named chart-109.png beside a glued 10<sup>9</sup> #when fact add --find locates it #then it refuses and registers nothing", async () => {
		const dir = session()
		const snap = await snapshot(dir, '<p>Output reached 10<sup>9</sup> kWh</p><p><img src="chart-109.png"></p>')
		expect(snap.json.data?.conversion_altered_numbers).toEqual(["109"])
		const result = (await run(["fact", "add", "--source", "S1", "--find", "Output reached", "--label", "output", "--session-dir", dir, "--json"])) as { exitCode: number; json: Json }
		expect(result.exitCode).toBe(1)
		expect(result.json.error).toBe("conversion_altered_number")
		expect(existsSync(join(dir, "fact-ledger.json"))).toBe(false)
	})
})

test("#given a genuine 4.22 beside a glued 4.2<sup>2</sup> #when fact add --find locates the genuine one #then the refusal names the --replace recovery", async () => {
	const dir = session()
	await snapshot(dir, "<p>USD 4.2<sup>2</sup> billion in revenue.</p><p>Margin was 4.22 points.</p>")
	const result = (await run(["fact", "add", "--source", "S1", "--find", "Margin was", "--label", "margin", "--session-dir", dir, "--json"])) as { exitCode: number; json: Json & { message?: string } }
	expect(result.exitCode).toBe(1)
	expect(result.json.error).toBe("conversion_altered_number")
	expect(result.json.message).toContain("source snapshot --id S1 --text <verified.txt> --replace")
})

describe("the documented recovery: source snapshot --replace with a verified text", () => {
	const s = (dir: string) => ["--session-dir", dir]

	test("#given a refused 4.22 #when the verified text replaces S1 #then fact add registers 4.2 billion and the filled report verifies clean", async () => {
		const dir = session()
		await snapshot(dir)
		const verified = join(dir, "verified.txt")
		writeFileSync(verified, "USD 4.2 billion in revenue.\nStaff grew to 1,250 people.\n")
		const replaced = (await run(["source", "snapshot", "--id", "S1", "--text", verified, "--replace", ...s(dir)])) as { exitCode: number; json: Json }
		expect(replaced.exitCode).toBe(0)
		expect(existsSync(join(dir, "sources", "S1", "conversion.json"))).toBe(false)
		const added = (await run(["fact", "add", "--source", "S1", "--find", "USD", "--label", "usd_bn", ...s(dir), "--json"])) as { exitCode: number; json: Json }
		expect(added.exitCode).toBe(0)
		expect((added.json.data?.row as { value: string }).value).toBe("4200000000")
		copyFileSync(join(import.meta.dir, "tests", "fixtures", "fidelity-brief-locked.md"), join(dir, "brief.md"))
		writeFileSync(join(dir, "report.src.html"), [
			'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Revenue</title></head><body><h1>Revenue</h1>',
			"<h2>Findings</h2><p>Revenue was {{F1:usd_bn}} [S1].</p>",
			"<h2>How this report was made</h2><p>Collected from one cited public page [S1].</p>",
			'<h2>Sources</h2><ol><li id="s1">[S1] Revenue page, retrieved 2026-10-01.</li></ol></body></html>',
		].join("\n"))
		const filled = (await run(["fact", "fill", join(dir, "report.src.html"), "--out", join(dir, "report.html"), ...s(dir)])) as { exitCode: number }
		expect(filled.exitCode).toBe(0)
		const verifiedReport = (await run(["fact", "verify", join(dir, "report.html"), "--sources", join(dir, "sources"), "--brief", join(dir, "brief.md"), ...s(dir)])) as { exitCode: number; json: { defects?: unknown[] } }
		expect(verifiedReport.json.defects).toEqual([])
		expect(verifiedReport.exitCode).toBe(0)
	})

	test("#given an active row pinning S1 #when --replace runs #then it refuses with snapshot_pinned and keeps the old text", async () => {
		const dir = session()
		await snapshot(dir)
		await run(["fact", "add", "--source", "S1", "--find", "Staff grew to", "--label", "staff", ...s(dir), "--json"])
		const verified = join(dir, "verified.txt")
		writeFileSync(verified, "USD 4.2 billion in revenue.\n")
		const replaced = (await run(["source", "snapshot", "--id", "S1", "--text", verified, "--replace", ...s(dir)])) as { exitCode: number; json: Json }
		expect(replaced.exitCode).toBe(1)
		expect(replaced.json.error).toBe("snapshot_pinned")
		expect(existsSync(join(dir, "sources", "S1", "conversion.json"))).toBe(true)
	})
})

test("#given --html whose conversion altered 4.22 #when fact add is refused, the verified text replaces S1, and the row is added, filled and verified #then the replacement is declared text over the kept raw.bin and every step passes", async () => {
	const dir = session()
	const s = ["--session-dir", dir]
	await snapshot(dir)
	const refused = (await run(["fact", "add", "--source", "S1", "--find", "USD", "--label", "usd_bn", ...s, "--json"])) as { exitCode: number; json: Json }
	expect([refused.exitCode, refused.json.error]).toEqual([1, "conversion_altered_number"])
	const verified = join(dir, "verified.txt")
	writeFileSync(verified, "USD 4.2 billion in revenue.\nStaff grew to 1,250 people.\n")
	const replaced = (await run(["source", "snapshot", "--id", "S1", "--text", verified, "--replace", ...s])) as { exitCode: number; json: Json }
	expect([replaced.exitCode, replaced.json.data?.text_source, replaced.json.data?.kind]).toEqual([0, "declared", "page"])
	expect(existsSync(join(dir, "sources", "S1", "raw.bin"))).toBe(true)
	const added = (await run(["fact", "add", "--source", "S1", "--find", "USD", "--label", "usd_bn", ...s, "--json"])) as { exitCode: number; json: Json & { message?: string } }
	expect([added.exitCode, added.json.error, added.json.message]).toEqual([0, undefined, undefined])
	const row = added.json.data?.row as { value: string; locator: { artifact: string; unit: string } }
	expect([row.value, row.locator.artifact, row.locator.unit]).toEqual(["4200000000", "text.txt", "bytes"])
	copyFileSync(join(import.meta.dir, "tests", "fixtures", "fidelity-brief-locked.md"), join(dir, "brief.md"))
	writeFileSync(join(dir, "report.src.html"), [
		'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Revenue</title></head><body><h1>Revenue</h1>',
		"<h2>Findings</h2><p>Revenue was {{F1:usd_bn}} [S1].</p>",
		"<h2>How this report was made</h2><p>Collected from one cited public page [S1].</p>",
		'<h2>Sources</h2><ol><li id="s1">[S1] Revenue page, retrieved 2026-10-01.</li></ol></body></html>',
	].join("\n"))
	expect(((await run(["fact", "fill", join(dir, "report.src.html"), "--out", join(dir, "report.html"), ...s])) as { exitCode: number }).exitCode).toBe(0)
	const report = (await run(["fact", "verify", join(dir, "report.html"), "--sources", join(dir, "sources"), "--brief", join(dir, "brief.md"), ...s])) as { exitCode: number; json: { defects?: unknown[] } }
	expect([report.exitCode, report.json.defects]).toEqual([0, []])
	expect((JSON.parse(readFileSync(join(dir, "fidelity-defects.json"), "utf8")) as { defects: { code: string }[] }).defects.map((d) => d.code)).not.toContain("snapshot_not_raw")
})

test("#given a malformed conversion.json #when fact add reads it #then it is a usage error naming the file, not a crash", async () => {
	const dir = session()
	await snapshot(dir)
	writeFileSync(join(dir, "sources", "S1", "conversion.json"), "{not json")
	const added = run(["fact", "add", "--source", "S1", "--find", "Staff grew to", "--label", "staff", "--session-dir", dir, "--json"])
	await expect(added).rejects.toBeInstanceOf(CliError)
	await expect(added).rejects.toThrow(/conversion\.json/)
})
