import { isIgnored } from "./core/page"
import { extensionOf } from "./core/source"
import type { PageRule, Rule, SourceRule } from "./rule"
import { ALL_RULES } from "./rules"
import type { DetectConfig, Finding, PageSnapshot, RuleMeta, Severity, SourceFile } from "./types"

export type LintOptions = {
	readonly config?: DetectConfig
	/** Rules to run; defaults to every built-in rule. */
	readonly rules?: readonly Rule[]
	/** File the snapshot was rendered from, carried into element locations. */
	readonly file?: string
}

/** Severity after the project's override, or null when the rule is switched off. @public */
export function effectiveSeverity(meta: RuleMeta, config: DetectConfig | undefined): Severity | null {
	const setting = config?.rules?.[meta.id]
	if (setting === "off") return null
	return setting ?? meta.severity
}

const isPageRule = (r: Rule): r is PageRule => r.meta.engine === "page"
const isSourceRule = (r: Rule): r is SourceRule => r.meta.engine === "source"

export function lintSnapshot(snapshot: PageSnapshot, options: LintOptions = {}): readonly Finding[] {
	const config = options.config ?? {}
	const findings: Finding[] = []
	for (const rule of (options.rules ?? ALL_RULES).filter(isPageRule)) {
		const severity = effectiveSeverity(rule.meta, config)
		if (severity === null) continue
		const overridden = config.rules?.[rule.meta.id] !== undefined
		for (const hit of rule.check({ snapshot, config })) {
			if (hit.element && isIgnored(snapshot, hit.element, rule.meta.id)) continue
			findings.push({
				ruleId: rule.meta.id,
				name: rule.meta.name,
				category: rule.meta.category,
				severity: hit.severityFixed && hit.severity ? hit.severity : overridden ? severity : (hit.severity ?? severity),
				message: hit.message,
				fixHint: rule.meta.fixHint,
				snippet: hit.snippet,
				location: hit.element
					? { kind: "element", selector: hit.element.selector, rect: hit.element.rect, viewport: snapshot.viewport, ...(options.file ? { file: options.file } : {}) }
					: { kind: "page", viewport: snapshot.viewport, ...(options.file ? { file: options.file } : {}) },
			})
		}
	}
	return findings
}

export function lintSources(files: readonly SourceFile[], options: LintOptions = {}): readonly Finding[] {
	const config = options.config ?? {}
	const findings: Finding[] = []
	const rules = (options.rules ?? ALL_RULES).filter(isSourceRule)
	for (const file of files) {
		const ext = extensionOf(file.path)
		for (const rule of rules) {
			if (!rule.extensions.includes(ext)) continue
			const severity = effectiveSeverity(rule.meta, config)
			if (severity === null) continue
			for (const hit of rule.check({ file, config })) {
				findings.push({
					ruleId: rule.meta.id,
					name: rule.meta.name,
					category: rule.meta.category,
					severity,
					message: hit.message,
					fixHint: rule.meta.fixHint,
					snippet: hit.snippet,
					location: { kind: "source", file: file.path, line: hit.line, column: hit.column },
				})
			}
		}
	}
	return findings
}

const SEVERITY_ORDER: Readonly<Record<Severity, number>> = { error: 0, warning: 1, advisory: 2 }

export function sortFindings(findings: readonly Finding[]): readonly Finding[] {
	const key = (f: Finding): string => {
		const l = f.location
		switch (l.kind) {
			case "source":
				return `${l.file}:${String(l.line).padStart(8, "0")}:${String(l.column).padStart(6, "0")}`
			case "element":
				return `${l.file ?? ""}@${l.viewport.width}:${String(Math.round(l.rect.y)).padStart(8, "0")}:${l.selector}`
			case "page":
				return `${l.file ?? ""}@${l.viewport.width}`
		}
	}
	return [...findings].sort(
		(a, b) => key(a).localeCompare(key(b)) || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.ruleId.localeCompare(b.ruleId),
	)
}

/** True when any finding is an error or a warning; advisories never fail a gate. */
export const hasFailures = (findings: readonly Finding[]): boolean => findings.some((f) => f.severity !== "advisory")
