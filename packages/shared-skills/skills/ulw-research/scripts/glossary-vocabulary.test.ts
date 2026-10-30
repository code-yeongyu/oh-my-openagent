import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { DEFECT_CODES, GATE_STATUSES, LINEAGE_MODES } from "./contracts.mjs"

describe("report-gates glossary vocabulary parity", () => {
	test("#given the defect codes #when the glossary is loaded #then every exported code appears as a backticked table cell", () => {
		const glossaryPath = join(import.meta.dir, "../references/report-gates.md")
		const glossary = readFileSync(glossaryPath, "utf8")

		const missing: string[] = []
		for (const code of Object.keys(DEFECT_CODES)) {
			if (!glossary.includes(`\`${code}\``)) {
				missing.push(code)
			}
		}

		expect(missing, `Missing codes: ${missing.join(", ")}`).toEqual([])
	})

	test("#given the glossary #when scanned for backticked tokens #then no extra defect code appears that is not exported", () => {
		const glossaryPath = join(import.meta.dir, "../references/report-gates.md")
		const glossary = readFileSync(glossaryPath, "utf8")

		const defectCodeSet = new Set(Object.keys(DEFECT_CODES))
		const validTokens = new Set([...defectCodeSet, ...GATE_STATUSES, ...LINEAGE_MODES])
		const backtickRegex = /`([a-z_][a-z0-9_]*)`/g
		const extras: string[] = []

		let match
		while ((match = backtickRegex.exec(glossary)) !== null) {
			const token = match[1]
			// Only flag tokens that look like defect codes (underscore-separated)
			// and aren't already exported from contracts
			if (!validTokens.has(token) && token.includes("_") && token.length > 3) {
				if (!extras.includes(token)) extras.push(token)
			}
		}

		expect(extras, `Extra codes not in contracts: ${extras.join(", ")}`).toEqual([])
	})
})
