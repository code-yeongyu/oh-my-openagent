// Node CLI cases of the #11290 fold: the pre-polish fill map stays authoritative for
// `fact pairs --changed-since` (in place and out of place), a fill map that does not record the
// polished bytes is refused, `fact derive` takes its time from --now only, and a missing fill map
// is named by brief_changed.
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { NOW, codesOf, fidelitySession, nodeJson, polishSession, sha256, verdicts, verify } from "./tests/report-tools-support"

type Written = { pairs: { pair_id: string; sentence: string }[]; changed_since?: unknown }

const WORDING = [{ before: "The operator wrote", after: "The operator stated", reason: "wording" }]

function polish(dir: string, s: string[], out: string) {
	const edits = join(dir, "wording.json")
	writeFileSync(edits, JSON.stringify(WORDING))
	return nodeJson(["fact", "polish-apply", join(dir, "report.html"), "--edits", edits, "--out", out, ...s])
}

/** A hand edit of F1's rendered value after polish (the converted row's "(320 m)" stays). */
function editValue(path: string) {
	const html = readFileSync(path, "utf8")
	expect(html.split(">320 m</data>").length).toBe(2)
	writeFileSync(path, html.replace(">320 m</data>", ">321 m</data>"))
}

function pairs(dir: string, s: string[], report: string, map: string) {
	const out = join(dir, "pairs-changed.json")
	rmSync(out, { force: true })
	const run = nodeJson(["fact", "pairs", report, "--changed-since", map, "--out", out, ...s])
	const written = (run.code === 0 ? JSON.parse(readFileSync(out, "utf8")) : { pairs: [] }) as Written
	return { run, written, sentences: written.pairs.map((pair) => pair.sentence) }
}

describe("the pre-polish fill map stays authoritative for --changed-since", () => {
	test("#given a report polished in place #when a value is edited and fact pairs runs --changed-since on the fill map #then the reworded and the edited sentences are re-checked and meaning-check runs", () => {
		// given
		const { dir, s } = polishSession()
		const report = join(dir, "report.html")
		const fillMap = `${report}.fill-map.json`
		const before = readFileSync(fillMap, "utf8")
		const applied = polish(dir, s, report)
		// when
		const reworded = pairs(dir, s, report, fillMap)
		editValue(report)
		const edited = pairs(dir, s, report, fillMap)
		const ok = edited.written.pairs.map((pair) => ({ pair_id: pair.pair_id, verdict: "ok" }))
		const readers = ["cheap", "strong"].flatMap((tier) => ["--verdicts", verdicts(dir, `${tier}.json`, tier, ok)])
		const checked = nodeJson(["fact", "meaning-check", "--pairs", join(dir, "pairs-changed.json"), ...readers, ...s])
		// then
		expect([applied.code, applied.json.data.applied, applied.json.data.rejected]).toEqual([0, 1, 0])
		expect(readFileSync(fillMap, "utf8")).toBe(before)
		expect(reworded.run.code).toBe(0)
		expect(reworded.sentences.some((text) => text.includes("The operator stated"))).toBe(true)
		expect(edited.run.code).toBe(0)
		expect(edited.sentences.some((text) => text.includes("321 m"))).toBe(true)
		expect(edited.sentences.some((text) => text.includes("The operator stated"))).toBe(true)
		expect(edited.written.changed_since).toEqual({ fill_map: fillMap, narrowed: false })
		expect(checked.code).toBe(0)
		const record = JSON.parse(readFileSync(join(dir, "fidelity-meaning-defects.json"), "utf8"))
		expect(record).toMatchObject({ record_kind: "meaning", status: "pass", report, artifact_sha256: sha256(report) })
	})

	test("#given a report polished to a new file #when fact pairs runs --changed-since on either map #then only the reworded sentence, and after a value edit also the edited one", () => {
		// given
		const { dir, s } = polishSession()
		const report = join(dir, "report.html")
		const fillMap = `${report}.fill-map.json`
		const out = join(dir, "report.polished.html")
		const polishedMap = `${out}.polished.fill-map.json`
		const before = readFileSync(fillMap, "utf8")
		const applied = polish(dir, s, out)
		// when
		const viaPolished = pairs(dir, s, out, polishedMap)
		const viaFill = pairs(dir, s, out, fillMap)
		editValue(out)
		const edited = pairs(dir, s, out, polishedMap)
		// then
		expect(applied.code).toBe(0)
		expect(readFileSync(fillMap, "utf8")).toBe(before)
		expect(existsSync(`${out}.fill-map.json`)).toBe(false)
		expect(JSON.parse(readFileSync(polishedMap, "utf8"))).toMatchObject({
			artifact: out,
			brief_sha256: JSON.parse(before).brief_sha256,
			polishedFrom: { map: fillMap, sha256: sha256(fillMap) },
		})
		for (const run of [viaPolished, viaFill]) {
			expect(run.run.code).toBe(0)
			expect(run.sentences).toEqual([expect.stringContaining("The operator stated")])
			expect(run.written.changed_since).toEqual({ fill_map: fillMap, narrowed: true })
		}
		expect(edited.sentences).toEqual([expect.stringContaining("321 m"), expect.stringContaining("The operator stated")])
	})

	test("#given a fill map that does not record the report's bytes #when fact polish-apply runs #then it exits 2 and writes nothing", () => {
		// given
		const { dir, s } = polishSession()
		const fillMap = join(dir, "report.html.fill-map.json")
		const out = join(dir, "report.polished.html")
		writeFileSync(fillMap, JSON.stringify({ ...JSON.parse(readFileSync(fillMap, "utf8")), artifact_sha256: "0".repeat(64) }))
		// when
		const tampered = polish(dir, s, out)
		// then
		expect(tampered.code).toBe(2)
		expect(tampered.stderr).toContain(fillMap)
		expect([out, `${out}.polished.fill-map.json`, `${out}.fill-map.json`].map(existsSync)).toEqual([false, false, false])
	})

	test("#given the pre-polish fill map rewritten after polish #when fact pairs follows the polished map #then it exits 2", () => {
		// given
		const { dir, s } = polishSession()
		const fillMap = join(dir, "report.html.fill-map.json")
		const out = join(dir, "report.polished.html")
		polish(dir, s, out)
		writeFileSync(fillMap, JSON.stringify({ ...JSON.parse(readFileSync(fillMap, "utf8")), entries: [] }))
		// when
		const followed = pairs(dir, s, out, `${out}.polished.fill-map.json`)
		// then
		expect(followed.run.code).toBe(2)
		expect(followed.run.stderr).toContain(fillMap)
	})
})

describe("fact derive takes its time from the caller", () => {
	test("#given no --now #when fact derive runs #then it exits 2 with missing_now and appends nothing; with --now the row carries that time", () => {
		// given
		const { dir, s } = fidelitySession()
		const rows = () => JSON.parse(readFileSync(join(dir, "fact-ledger.json"), "utf8")).rows.length
		const count = rows()
		// when
		const missing = nodeJson(["fact", "derive", "--op", "convert", "F1", "--to", "km", "--label", "span_km", "--json", ...s])
		const after = rows()
		const stamped = nodeJson(["fact", "derive", "--op", "convert", "F1", "--to", "km", "--label", "span_km", "--now", NOW, "--json", ...s])
		// then
		expect(missing.code).toBe(2)
		expect(missing.stderr).toContain("missing_now")
		expect(after).toBe(count)
		expect(stamped.code).toBe(0)
		expect(stamped.json.data.row).toMatchObject({ observed_at: "2026-10-23T08:00:00.000Z" })
	})
})

describe("fact verify names a missing fill map", () => {
	test("#given an HTML edition with no fill map #when fact verify runs #then brief_changed says no fill map at its path", () => {
		// given
		const { dir, s } = fidelitySession()
		nodeJson(["fact", "fill", join(dir, "report.src.html"), "--out", join(dir, "report.html"), ...s])
		const map = join(dir, "report.html.fill-map.json")
		rmSync(map)
		// when
		const checked = verify(dir, "report.html")
		// then
		expect([checked.code, codesOf(checked.json)]).toEqual([1, ["brief_changed"]])
		expect((checked.json.defects[0] as { message?: string }).message).toContain(`no fill map at ${map}`)
	})
})
