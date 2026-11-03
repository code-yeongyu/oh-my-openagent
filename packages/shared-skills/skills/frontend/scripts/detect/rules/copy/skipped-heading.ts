import { childrenOf, descendants, headingLevel, parentOf } from "../../core/page"
import type { PageHit, PageRule } from "../../rule"
import { displayed, lineage } from "./support/page-text"

export const skippedHeading: PageRule = {
	meta: {
		id: "skipped-heading", name: "Skipped heading level", category: "quality", severity: "warning", engine: "page",
		description: "A heading jumps over a level in the visible content outline.",
		fixHint: "Use the next heading level and style it independently of its semantic rank.",
	},
	check: ({ snapshot }) => {
		const hits: PageHit[] = []
		let previous = 0
		let previousText = ""
		let previousFooter: number | undefined
		let previousOpensFooter = false
		const squash = (text: string): string => text.replace(/\s/g, "")
		const sourceTags = ["script", "style", "noscript", "template"]
		const textChars = snapshot.elements.filter((el) => displayed(snapshot, el) && el.style["visibility"] !== "hidden" && !sourceTags.includes(el.tag))
			.reduce((total, el) => total + [...squash(el.ownText)].length, 0)
		const hidden = (el: typeof snapshot.elements[number]): boolean =>
			el.attributes["inert"] !== undefined || el.attributes["aria-hidden"]?.trim().toLowerCase() === "true"
		const modals = snapshot.elements.filter((el) =>
			(el.attributes["aria-modal"] === "true" || ["dialog", "alertdialog"].includes(el.attributes["role"] ?? "")
				|| el.tag === "dialog" && el.attributes["open"] !== undefined)
			&& !hidden(el) && displayed(snapshot, el) && el.rect.width > 0 && el.rect.height > 0 && el.style["visibility"] !== "hidden")
		const mockups = new Set(snapshot.elements.filter((root) => {
			if (!hidden(root) || root.rect.width < 120 || root.rect.height < 80) return false
			if (["html", "body", "main", "header", "footer", "nav", "aside", "section", "article", "form", "dialog", "li", "tr", "td", "th", "tbody", "thead", "table", "details", "summary"].includes(root.tag)) return false
			if ((root.attributes["role"] ?? "").trim().split(/\s+/).some((r) => r !== "" && !["presentation", "none", "img", "figure", "group"].includes(r))) return false
			if (root.attributes["aria-modal"] !== undefined || root.attributes["data-aria-hidden"] !== undefined || ["fixed", "sticky"].includes(root.style["position"] ?? "")) return false
			const names = `${root.attributes["class"] ?? ""} ${root.attributes["id"] ?? ""}`
			if (/(?:^|[\s_-])(clones?|cloned|copy|duplicate|dup|carousel|embla|flicking|glide|keen|slick|slides?|slider|splide|swiper|marquee|ticker|menu|submenu|dropdown|popup|popover|modal|drawer|dialog|tooltip|toast|offcanvas|overlay|nav|navbar|navigation|panel|tab|tabpanel|accordion|collapse|collapsible|intro|splash|loader|preloader|loading|banner|cookies?|consent|sidebar|sidenav|toc)(?:$|[\s_-])/i.test(names)) return false
			const ancestors = lineage(snapshot, root).slice(1)
			if (ancestors.some((a) => ["h1", "h2", "h3", "h4", "h5", "h6", "p", "a", "button", "label", "summary", "legend", "caption", "figcaption", "blockquote", "q"].includes(a.tag))) return false
			const nodes = [root, ...descendants(snapshot, root)]
			if (nodes.length > 3000 || nodes.some((el) => el.tag === "h1")) return false
			const runs = nodes.filter((el) => displayed(snapshot, el) && el.style["visibility"] !== "hidden"
				&& !sourceTags.includes(el.tag) && squash(el.ownText) !== "")
			const chars = runs.reduce((total, el) => total + [...squash(el.ownText)].length, 0)
			if (runs.length < 3 || textChars === 0 || chars * 2 >= textChars) return false
			const fields = nodes.filter((el) => ["input", "select", "textarea"].includes(el.tag) && !(el.tag === "input" && el.attributes["type"]?.toLowerCase() === "hidden"))
			const linkedRuns = runs.filter((el) => lineage(snapshot, el).some((a) => a.tag === "a" && (a.attributes["href"] ?? "").trim() !== ""))
			if (fields.length >= 2 || fields.length > 0 && nodes.some((el) => el.tag === "label") || linkedRuns.length * 2 >= runs.length) return false
			if (modals.some((modal) => !nodes.includes(modal) && !lineage(snapshot, root).includes(modal))) return false
			const text = squash(root.text)
			if (text !== "" && ancestors.some((a) => squash(a.attributes["aria-label"] ?? "").includes(text))) return false
			const parent = parentOf(snapshot, root)
			const peers = parent ? childrenOf(snapshot, parent).filter((el) => el.index !== root.index) : []
			const classes = (root.attributes["class"] ?? "").split(/\s+/).filter(Boolean)
			return !peers.some((peer) => {
				const peerClasses = (peer.attributes["class"] ?? "").split(/\s+/).filter(Boolean)
				const sameShape = peer.tag === root.tag && (classes.length === 0) === (peerClasses.length === 0) && classes.every((c) => peerClasses.includes(c))
				const shown = displayed(snapshot, peer) && peer.style["visibility"] !== "hidden" && !hidden(peer)
				if (shown && (sameShape && peer.rect.width > 0 && peer.rect.height > 0 || text !== "" && squash(peer.text) === text)) return true
				const alternative = peer.rect.width <= 1 || peer.rect.height <= 1 || /sr-only|visually-?hidden|screen-?reader|a11y-hidden|hidden-visually/i.test(peer.attributes["class"] ?? "")
				return shown && alternative && peer.text.trim() !== "" && !/\b(demo|demonstration|illustrat\w*|interface|screen ?shots?|mock-?ups?|graphic|animation|animated|preview|image|video|visual|diagram|depict\w*|shows|showing|displayed)\b/i.test(peer.text)
			})
		}).map((el) => el.index))
		for (const el of snapshot.elements) {
			const level = headingLevel(el)
			if (level === null || !displayed(snapshot, el) || el.rect.width <= 0 || el.rect.height <= 0) continue
			const path = lineage(snapshot, el)
			if (path.some((a) => mockups.has(a.index))) continue
			if (path.some((a) => a.style["visibility"] === "hidden" || (a.tag === "dialog" && a.attributes["open"] === undefined))) continue
			const footer = path.find((a) => a.tag === "footer" || a.attributes["role"] === "contentinfo" || a.attributes["id"] === "footer")?.index
			const opensFooter = footer !== undefined && footer !== previousFooter
			const intoFooter = footer !== undefined && (opensFooter || previousOpensFooter)
			const skips = previous > 0 && level > previous + 1
			if (skips && !intoFooter) hits.push({
				element: el, message: `h${previous} followed by h${level}; missing h${previous + 1}`,
				snippet: `${previousText.slice(0, 60)} / ${el.text.slice(0, 60)}`,
			})
			previousOpensFooter = opensFooter && previous > 0 && !skips
			previousFooter = footer
			previous = level
			previousText = el.text
		}
		return hits
	},
}
