import { lintSnapshot } from "../../../lint"
import type { PageRule } from "../../../rule"
import type { PageSnapshot } from "../../../types"
import { buildSnapshot, type NodeSpec } from "../../../testing/build-snapshot"

export const marked = (rule: PageRule, nodes: readonly NodeSpec[], options: Parameters<typeof buildSnapshot>[1] = {}): readonly string[] =>
	selectors(rule, buildSnapshot(nodes, options))

export const selectors = (rule: PageRule, snapshot: PageSnapshot): readonly string[] =>
	lintSnapshot(snapshot, { rules: [rule] }).map((f) => f.location.kind === "element" ? f.location.selector : "page")

export const border = {
	"border-top-width": "1px", "border-right-width": "1px", "border-bottom-width": "1px", "border-left-width": "1px",
	"border-top-style": "solid", "border-right-style": "solid", "border-bottom-style": "solid", "border-left-style": "solid",
	"border-top-color": "#333", "border-right-color": "#333", "border-bottom-color": "#333", "border-left-color": "#333",
}

export const rounded = {
	"border-top-left-radius": "12px", "border-top-right-radius": "12px", "border-bottom-right-radius": "12px", "border-bottom-left-radius": "12px",
}

export const lines = (widths: readonly number[], x = 24, y = 24, height = 20) =>
	widths.map((width, i) => ({ x, y: y + i * 24, width, height }))
