// polish-diff.mjs - whole-document backstop between a pre-polish artifact and its polished result.
//
// diffPolish(beforeHtml, afterHtml, ledger) runs the polish-rules.mjs rule set (the same rules
// polish-apply runs per edit) over the whole document, as multisets, and returns at most one defect
// per code. Severity is looked up in contracts.DEFECT_CODES for every emitted code; a code missing
// there throws. polish-apply checks every edit against this same whole-document baseline (ordered,
// so stricter), so a clean polish-apply run is clean here; this catches hand edits. No IO, no model.
// Plain Node ESM.

import { DEFECT_CODES } from "./contracts.mjs"
import { POLISH_CODES, polishDefects } from "./polish-rules.mjs"

export { churnRatio, TICKER } from "./polish-rules.mjs"

/** The DEFECT_CODES entry of a polish code; refuses a code the registry does not define. */
function registryEntry(code) {
	if (!Object.hasOwn(DEFECT_CODES, code)) throw new Error(`polish code ${code} is not in DEFECT_CODES`)
	return DEFECT_CODES[code]
}

/**
 * @param {string} beforeHtml the pre-polish artifact
 * @param {string} afterHtml the polished artifact
 * @param {{ rows: object[] }} ledger
 * @returns {{ code: string, severity: string, message: string }[]} at most one defect per code
 */
export function diffPolish(beforeHtml, afterHtml, ledger) {
	const found = new Map()
	for (const { code, message } of polishDefects(beforeHtml, afterHtml, ledger)) found.set(code, [...(found.get(code) ?? []), message])
	return POLISH_CODES.filter((code) => found.has(code)).map((code) => ({ code, severity: registryEntry(code).severity, message: found.get(code).join("; ") }))
}
