import { expect } from "bun:test"
import type { PageRule } from "../../../rule"
import type { DetectConfig } from "../../../types"
import { buildSnapshot, type NodeSpec } from "../../../testing/build-snapshot"
import { lintSnapshot } from "../../../lint"
export function assertCases(
	rule: PageRule,
	nodes: readonly NodeSpec[],
	expected: readonly string[],
	options: { readonly cssText?: readonly string[]; readonly config?: DetectConfig } = {},
): void {
	const snapshot = buildSnapshot(nodes, { cssText: options.cssText ?? [] })
	const findings = lintSnapshot(snapshot, { rules: [rule], config: options.config ?? {} })
	expect(findings.map((f) => (f.location.kind === "element" ? f.location.selector : "page"))).toEqual([...expected])
}
export const round = (radius: string): Readonly<Record<string, string>> =>
	Object.fromEntries(["top-left", "top-right", "bottom-right", "bottom-left"].map((c) => ["border-" + c + "-radius", radius]))
export const border = (width: string, color = "rgb(230, 231, 233)"): Readonly<Record<string, string>> =>
	Object.fromEntries(
		["top", "right", "bottom", "left"].flatMap((s) => [
			["border-" + s + "-width", width],
			["border-" + s + "-style", "solid"],
			["border-" + s + "-color", color],
		]),
	)
