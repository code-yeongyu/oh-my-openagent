import { ancestors, descendants, px, styleOf } from "../../core/page"
import { parseColor } from "../../core/color"
import type { PageHit, PageRule } from "../../rule"
import type { ElementSnapshot, PageSnapshot } from "../../types"
import { lineage, paintedText } from "./support/page-text"

const skip = (snapshot: PageSnapshot, el: ElementSnapshot): boolean => lineage(snapshot, el).some((a) =>
	["table", "select", "datalist", "nav", "menu"].includes(a.tag)
	|| ["navigation", "menu", "menubar", "listbox", "grid", "tablist", "radiogroup"].includes(a.attributes["role"] ?? "")
	|| a.attributes["aria-hidden"] === "true")

export const repeatedContainerText: PageRule = {
	meta: {
		id: "repeated-container-text", name: "Same text repeated inside one container", category: "quality", severity: "warning", engine: "page",
		description: "One card repeats a short string in at least three different structural slots.",
		fixHint: "State the status once; remove redundant labels from the other slots.",
	},
	check: ({ snapshot }) => {
		const containers = snapshot.elements.filter((el) => {
			if (!["div", "section", "article", "aside", "main", "figure", "form", "fieldset", "details", "li"].includes(el.tag) || skip(snapshot, el)) return false
			const shadow = styleOf(el, "box-shadow")
			const border = ["top", "right", "bottom", "left"].filter((side) => (px(styleOf(el, `border-${side}-width`)) ?? 0) >= 1).length >= 3
			const radius = (px(styleOf(el, "border-top-left-radius")) ?? 0) > 0
			const background = (parseColor(styleOf(el, "background-color"))?.a ?? 0) > 0.1
			return (shadow !== "" && shadow !== "none" || border) && (radius || background)
		})
		const containerIds = new Set(containers.map((el) => el.index))
		const hits: PageHit[] = []
		for (const container of containers) {
			if (!paintedText(snapshot, container)) continue
			const nodes = [...descendants(snapshot, container)]
			if (nodes.length > 250) continue
			const groups = new Map<string, string[]>()
			for (const el of nodes) {
				const path = [...ancestors(snapshot, el)]
				const owned = path.slice(0, path.findIndex((a) => a.index === container.index))
				if (owned.some((a) => containerIds.has(a.index)) || skip(snapshot, el) || !paintedText(snapshot, el)) continue
				if (/icon|material-symbols|(?:^|\s)fa[srlbd]?(?:\s|-|$)/i.test(el.attributes["class"] ?? "")) continue
				const text = el.ownText.trim()
				if (text.length < 4 || text.length > 48 || !/[a-zA-Z]/.test(text)) continue
				const signature = [el, ...owned].map((a) => {
					const classes = (a.attributes["class"] ?? "").split(/\s+/).filter((c) => c !== ""
						&& !c.split(/[-_]/).some((part) => part.length >= 4 && /^[a-f\d]+$/i.test(part) && /\d/.test(part))).sort().join(".")
					return `${a.tag}${classes === "" ? "" : `.${classes}`}`
				}).join(">")
				const signatures = groups.get(text) ?? []
				signatures.push(signature)
				groups.set(text, signatures)
			}
			for (const [text, signatures] of groups) if (signatures.length >= 3 && new Set(signatures).size >= 3) hits.push({
				element: container, message: `Same text rendered ${signatures.length} times in distinct slots`, snippet: text.slice(0, 40),
			})
		}
		return hits
	},
}
