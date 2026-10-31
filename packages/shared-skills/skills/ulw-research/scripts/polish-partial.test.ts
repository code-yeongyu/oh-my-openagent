import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

describe("polish partial-apply CLI contract", () => {
	test.each([
		["boundary rejection", [{ before: "Fine <em>words", after: "Better words" }], false, 0, 1, 0],
		["accepted wording", [{ before: "Fine", after: "Good" }], true, 1, 0, 0],
		["mixed edits", [{ before: "Fine", after: "Good" }, { before: "<em>words", after: "words" }], false, 1, 1, 0],
		["unlocated wording", [{ before: "Missing", after: "Better" }], false, 0, 0, 1],
	] as const)("#given %s #when partially applied #then JSON distinguishes full application from output success", (_label, editsInput, applied, count, rejected, unlocated) => {
		const dir = mkdtempSync(join(tmpdir(), "polish-boundary-"))
		try {
			const report = join(dir, "report.html")
			const edits = join(dir, "edits.json")
			const ledger = join(dir, "ledger.json")
			const out = join(dir, "out.html")
			const html = "<p>Fine <em>words</em> here.</p>"
			writeFileSync(report, html)
			writeFileSync(edits, JSON.stringify(editsInput))
			writeFileSync(ledger, JSON.stringify({ schemaVersion: 1, rows: [], events: [] }))
			const result = spawnSync("node", [
				join(import.meta.dir, "report-tools.mjs"), "fact", "polish-apply", report,
				"--edits", edits, "--ledger", ledger, "--out", out,
				"--brief", join(import.meta.dir, "tests/fixtures/fidelity-brief-locked.md"),
			], { encoding: "utf8" })
			expect(result.error).toBeUndefined()
			const json = JSON.parse(result.stdout)
			expect(json.data).toMatchObject({ applied: count, rejected, unlocated })
			expect(json.defects.map((defect: { code: string }) => defect.code)).toEqual(
				rejected > 0 ? ["polish_edit_rejected"] : unlocated > 0 ? ["polish_edit_unlocated"] : [],
			)
			expect(readFileSync(out, "utf8")).toBe(count > 0 ? html.replace("Fine", "Good") : html)
			expect(result.status).toBe(0)
			expect(json.applied).toBe(applied)
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})
})
