import { ancestors, IGNORE_ATTRIBUTES, isIgnored } from "../../../core/page"
import type { ElementSnapshot, PageSnapshot } from "../../../types"

export function pageIgnored(snapshot: PageSnapshot, el: ElementSnapshot, rule: string): boolean {
	return isIgnored(snapshot, el, rule) || [el, ...ancestors(snapshot, el)].some((node) =>
		IGNORE_ATTRIBUTES.some((name) => (node.attributes[name] ?? "").split(/[\s,]+/).includes("*")))
}
