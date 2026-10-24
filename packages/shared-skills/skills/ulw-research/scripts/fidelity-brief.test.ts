import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { FIDELITY_FIELDS, isLocked, parseFidelityBlock, requireLockedBrief } from "./fidelity-brief.mjs"

const fixture = (name: string) => join(import.meta.dir, "tests", "fixtures", name)
const lockedMd = await Bun.file(fixture("fidelity-brief-locked.md")).text()
const pendingMd = await Bun.file(fixture("fidelity-brief-pending.md")).text()

function withoutLine(markdown: string, prefix: string): string {
	return markdown
		.split("\n")
		.filter((line) => !line.startsWith(prefix))
		.join("\n")
}

describe("parseFidelityBlock", () => {
	test("#given a complete block #when parsed #then seven fields are read and the brief is locked", () => {
		// when
		const parsed = parseFidelityBlock(lockedMd)
		// then
		expect(parsed.errors).toEqual([])
		expect(Object.keys(parsed.fields).sort()).toEqual([...FIDELITY_FIELDS].sort())
		expect(parsed.fields["as of"]).toBe("latest at run start, 2026-10-23")
		expect(parsed.fields.languages).toBe("report ko; sources ko, en; quotes original with translation beside")
		expect(parsed.answered_by["derived numbers"]).toBe("user")
		expect(parsed.answered_by.fallback).toBe("request")
		expect(parsed.asked).toEqual(["derived numbers"])
		expect(isLocked(parsed)).toBe(true)
	})

	test("#given a block missing as of #when parsed #then it is not locked and the missing field is named", () => {
		// when
		const parsed = parseFidelityBlock(withoutLine(lockedMd, "as of:"))
		// then
		expect(isLocked(parsed)).toBe(false)
		expect(parsed.missing).toEqual(["as of"])
		expect(parsed.errors).toEqual([])
	})

	test("#given a field answered_by pending #when parsed #then it is not locked and not malformed", () => {
		// when
		const parsed = parseFidelityBlock(pendingMd)
		// then
		expect(parsed.errors).toEqual([])
		expect(parsed.answered_by["derived numbers"]).toBe("pending")
		expect(parsed.pending).toEqual(["derived numbers"])
		expect(isLocked(parsed)).toBe(false)
	})

	test("#given a malformed field line #when parsed #then errors name the line as malformed", () => {
		// given
		const markdown = lockedMd.replace("meaning check: on (answered_by: default)", "meaning check: on")
		// when
		const parsed = parseFidelityBlock(markdown)
		// then
		expect(parsed.errors.length).toBe(1)
		expect(parsed.errors[0]).toContain("malformed")
		expect(parsed.errors[0]).toContain("meaning check: on")
		expect(isLocked(parsed)).toBe(false)
	})

	test("#given grammar violations #when parsed #then each is a malformed error", () => {
		const cases = [
			lockedMd.replace("fallback: block-quote (answered_by: request)", "fallback: block-quote (answered_by: someone)"),
			lockedMd.replace("meaning check: on (answered_by: default)", "meaning check: on (maybe) (answered_by: default)"),
			lockedMd.replace("meaning check: on (answered_by: default)", "meaning check: on (answered_by: pending)"),
			lockedMd.replace("asked: derived numbers", "asked: derived numbers\ntone: formal (answered_by: user)"),
			lockedMd.replace("asked: derived numbers", "asked: derived numbers\nfallback: omit (answered_by: user)"),
			lockedMd.replace("asked: derived numbers", "asked: tone"),
		]
		for (const markdown of cases) expect(parseFidelityBlock(markdown).errors.length).toBe(1)
	})

	test("#given a brief with no Fidelity block #when parsed #then it is not locked and every field is missing", () => {
		// when
		const parsed = parseFidelityBlock("# Brief\n\n## Deliverable\nformat: pdf (answered_by: request)\n")
		// then
		expect(parsed.present).toBe(false)
		expect(parsed.missing).toEqual([...FIDELITY_FIELDS])
		expect(isLocked(parsed)).toBe(false)
	})

	test("#given field lines after the next heading #when parsed #then they are outside the block", () => {
		// given
		const markdown = withoutLine(lockedMd, "fallback:") + "\nfallback: omit (answered_by: user)\n"
		// then
		expect(parseFidelityBlock(markdown).missing).toEqual(["fallback"])
	})

	test("#given a second Fidelity block #when parsed #then the duplicate is an error", () => {
		// given
		const markdown = lockedMd + "\n## Fidelity\nas of: x (answered_by: user)\n"
		// when
		const parsed = parseFidelityBlock(markdown)
		// then
		expect(parsed.errors.length).toBe(1)
		expect(parsed.errors[0]).toContain("duplicate")
		expect(parsed.fields["as of"]).toBe("latest at run start, 2026-10-23")
		expect(isLocked(parsed)).toBe(false)
	})
})

describe("requireLockedBrief", () => {
	function briefFile(contents: string | null): { path: string; cleanup: () => void } {
		const dir = mkdtempSync(join(tmpdir(), "fidelity-brief-"))
		const path = join(dir, "brief.md")
		if (contents !== null) writeFileSync(path, contents)
		return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
	}

	test("#given a locked brief #when required #then exit 0 and no defect", () => {
		const brief = briefFile(lockedMd)
		try {
			expect(requireLockedBrief(brief.path)).toMatchObject({ locked: true, exitCode: 0, defects: [], errors: [] })
		} finally {
			brief.cleanup()
		}
	})

	test("#given field lines with trailing spaces, a tab, and CRLF endings #when required #then they parse like trimmed lines", () => {
		// given
		const markdown = lockedMd
			.replace("meaning check: on (answered_by: default)", "meaning check: on (answered_by: default)  ")
			.replace("fallback: block-quote (answered_by: request)", "fallback: block-quote (answered_by: request)\t")
			.replace("as of: latest at run start, 2026-10-23 (answered_by: default)\n", "as of: latest at run start, 2026-10-23 (answered_by: default)  \r\n")
		const brief = briefFile(markdown)
		try {
			// when
			const result = requireLockedBrief(brief.path)
			// then
			expect(result).toMatchObject({ locked: true, exitCode: 0, defects: [], errors: [] })
			expect(result.parsed.fields.fallback).toBe("block-quote")
		} finally {
			brief.cleanup()
		}
	})

	test("#given a second Fidelity block #when required #then exit 2 naming the duplicate", () => {
		const brief = briefFile(lockedMd + "\n## Fidelity\nas of: x (answered_by: user)\n")
		try {
			const result = requireLockedBrief(brief.path)
			expect(result).toMatchObject({ locked: false, exitCode: 2, defects: [] })
			expect(result.errors[0]).toContain("duplicate ## Fidelity block")
		} finally {
			brief.cleanup()
		}
	})

	test("#given a pending, partial, or absent brief #when required #then exit 1 with the single lock defect", () => {
		for (const contents of [pendingMd, withoutLine(lockedMd, "as of:"), "# Brief\n", null]) {
			const brief = briefFile(contents)
			try {
				const result = requireLockedBrief(brief.path)
				expect(result.locked).toBe(false)
				expect(result.exitCode).toBe(1)
				expect(result.defects.length).toBe(1)
				expect(result.defects[0]).toMatchObject({ code: "fidelity_interview_incomplete", severity: "blocker", integrity: true })
				expect(typeof result.defects[0].message).toBe("string")
				expect(typeof result.defects[0].hint).toBe("string")
			} finally {
				brief.cleanup()
			}
		}
	})

	test("#given a malformed brief #when required #then exit 2 with the parse errors and no defect", () => {
		const brief = briefFile(lockedMd.replace("meaning check: on (answered_by: default)", "meaning check: on"))
		try {
			const result = requireLockedBrief(brief.path)
			expect(result).toMatchObject({ locked: false, exitCode: 2, defects: [] })
			expect(result.errors[0]).toContain("malformed")
		} finally {
			brief.cleanup()
		}
	})
})
