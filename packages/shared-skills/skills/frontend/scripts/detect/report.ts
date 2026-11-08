import type { Finding, Severity } from "./types"

/** @public */
export function summarize(findings: readonly Finding[]): Readonly<Record<Severity, number>> {
	const counts: Record<Severity, number> = { error: 0, warning: 0, advisory: 0 }
	for (const f of findings) counts[f.severity]++
	return counts
}

function where(f: Finding): string {
	const l = f.location
	switch (l.kind) {
		case "source":
			return `${l.file}:${l.line}:${l.column}`
		case "element":
			return `${l.file ?? "page"} @${l.viewport.width}px ${l.selector}`
		case "page":
			return `${l.file ?? "page"} @${l.viewport.width}px`
	}
}

export function formatFindingsText(findings: readonly Finding[]): string {
	const lines = findings.map(
		(f) => `${where(f)}  ${f.severity}  ${f.ruleId}  ${f.message}\n    > ${f.snippet}\n    fix: ${f.fixHint}`,
	)
	const c = summarize(findings)
	lines.push(`frontend-detect: ${findings.length} finding(s): ${c.error} error, ${c.warning} warning, ${c.advisory} advisory`)
	return `${lines.join("\n")}\n`
}
