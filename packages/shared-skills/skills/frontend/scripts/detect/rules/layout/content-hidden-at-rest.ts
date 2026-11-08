import { childrenOf, descendants, styleOf } from "../../core/page"
import type { PageRule } from "../../rule"
import type { ElementSnapshot, PageSnapshot } from "../../types"
import { bottom, chain, hasRole, right } from "./support/geometry"
import { classWords, closedClass, unstartedSlider } from "./support/hidden-interface"

function closed(s: PageSnapshot, el: ElementSnapshot): boolean {
	const controls = s.elements.filter((n) => (n.attributes["aria-controls"] ?? "").split(/\s+/).includes(el.attributes["id"] ?? "\u0000"))
	const labels = (el.attributes["aria-labelledby"] ?? "").split(/\s+/)
	const selected = (hasRole(el, ["tabpanel"]) || classWords(el).some((word) => ["tab", "tabs", "tabpanel", "tabpane"].includes(word))) &&
		(controls.some((n) => n.attributes["aria-selected"] === "true" || n.attributes["aria-expanded"] === "true") ||
		s.elements.some((n) => labels.includes(n.attributes["id"] ?? "\u0000") && n.attributes["aria-selected"] === "true"))
	if (!selected && controls.some((n) => n.attributes["aria-selected"] === "false" || n.attributes["aria-expanded"] === "false")) return true
	if (!selected && (hasRole(el, ["dialog", "alertdialog", "tabpanel"]) || closedClass(el))) return true
	if (styleOf(el, "position") === "fixed" && (right(el.rect) <= 0 || el.rect.x >= s.viewport.width)) return true
	const path = chain(s, el)
	if (path.some((n) => n.attributes["inert"] !== undefined || n.tag === "nav" || hasRole(n, ["navigation", "menu", "menubar"]))) return true
	if (styleOf(el, "position") === "fixed" && /^(hidden|collapse)$/.test(styleOf(el, "visibility")) &&
		el.rect.x <= 1 && el.rect.y <= 1 && right(el.rect) >= s.viewport.width - 1 && bottom(el.rect) >= s.viewport.height - 1) {
		const nodes = [el, ...descendants(s, el)]
		const chars = nodes.reduce((sum, n) => sum + n.ownText.length, 0)
		const pageChars = s.elements.reduce((sum, n) => sum + n.ownText.length, 0)
		if (chars * 2 < pageChars && !nodes.some((n) => n.tag === "main" || n.tag === "h1" || hasRole(n, ["main"]))) return true
	}
	if (path.some((n) => /^(absolute|fixed)$/.test(styleOf(n, "position")) &&
		!["", "none", "matrix(1, 0, 0, 1, 0, 0)"].includes(styleOf(n, "transform")) &&
		/\b(?:transform|all)\b/.test(styleOf(n, "transition-property")) &&
		(right(n.rect) <= 0 || n.rect.x >= s.viewport.width))) return true
	const p = el.parent === null ? undefined : s.elements[el.parent]
	const siblings = p ? childrenOf(s, p) : []
	const previous = siblings[siblings.indexOf(el) - 1]
	if (previous && (previous.attributes["aria-expanded"] === "false" ||
		childrenOf(s, previous).length === 1 && childrenOf(s, previous)[0]?.attributes["aria-expanded"] === "false")) return true
	return path.slice(1).some((n) => {
		const triggers = s.elements.filter((t) => (t.attributes["aria-controls"] ?? "").split(/\s+/).includes(n.attributes["id"] ?? "\u0000"))
		return triggers.some((t) => t.attributes["aria-expanded"] === "false" || t.attributes["aria-selected"] === "false") &&
			!triggers.some((t) => t.attributes["aria-expanded"] === "true" || t.attributes["aria-selected"] === "true")
	})
}

export const contentHiddenAtRest: PageRule = {
	meta: {
		id: "content-hidden-at-rest", name: "Content invisible at rest", category: "quality", severity: "error", engine: "page",
		description: "A large share of page text remains transparent or hidden instead of appearing as content.",
		fixHint: "Show content by default and enhance its entrance without making visibility depend on a reveal script.",
	},
	check: ({ snapshot }) => {
		let total = 0
		let hidden = 0
		for (const el of snapshot.elements) {
			if (el.ownText === "") continue
			const path = chain(snapshot, el)
			if (path.some((n) => /^(script|style|noscript|template|title|head|meta|link|option|optgroup|select|datalist|dialog)$/.test(n.tag) ||
				n.attributes["hidden"] !== undefined || n.attributes["aria-hidden"] === "true" || styleOf(n, "display") === "none")) continue
			const invisible = [...path].reverse().find((n) => Number.parseFloat(styleOf(n, "opacity")) <= 0.02 || /^(hidden|collapse)$/.test(styleOf(n, "visibility")))
			if (invisible && (closed(snapshot, invisible) || unstartedSlider(snapshot, invisible))) continue
			total += el.ownText.length
			if (invisible) hidden += el.ownText.length
		}
		if (total < 200 || hidden < 150 || hidden / total <= 0.3) return []
		return [{ element: null, message: `${hidden} of ${total} characters (${Math.round(hidden / total * 100)}%) remain hidden.`, snippet: `${hidden}/${total} hidden characters` }]
	},
}
