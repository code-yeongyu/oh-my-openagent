import { ancestors, childrenOf, descendants, fontSizePx, parentOf, styleOf } from "../../../core/page"
import type { ElementSnapshot, PageSnapshot } from "../../../types"
import { drawnEnlargement } from "./drawn-enlargement"
import { fadesOutForGood } from "./fading-text"

const squash = (text: string): string => text.replace(/\s/g, "")
const hidden = (e: ElementSnapshot): boolean => e.attributes["inert"] !== undefined || e.attributes["aria-hidden"] === "true"
const classes = (e: ElementSnapshot): readonly string[] => (e.attributes["class"] ?? "").split(/\s+/).filter(Boolean)
const shown = (s: PageSnapshot, e: ElementSnapshot): boolean => [e, ...ancestors(s, e)].every(n => styleOf(n, "display") !== "none") &&
	styleOf(e, "visibility") !== "hidden" && e.rect.width > 0 && e.rect.height > 0
const dialog = (e: ElementSnapshot): boolean => e.attributes["aria-modal"] === "true" ||
	["dialog", "alertdialog"].includes(e.attributes["role"] ?? "") || (e.tag === "dialog" && e.attributes["open"] !== undefined)
const source = (e: ElementSnapshot): boolean => ["script", "style", "noscript", "template"].includes(e.tag)
const structuralTags = ["html", "body", "main", "header", "footer", "nav", "aside", "section", "article", "form",
	"dialog", "li", "tr", "td", "th", "tbody", "thead", "table", "details", "summary"]
const textHosts = ["h1", "h2", "h3", "h4", "h5", "h6", "p", "a", "button", "label", "summary", "legend", "caption", "figcaption", "blockquote", "q"]
const parkedParts = new Set(("clone clones cloned copy duplicate dup carousel embla flicking glide keen slick slide slider slides splide swiper " +
	"marquee ticker menu submenu dropdown popup popover modal drawer dialog tooltip toast offcanvas overlay nav navbar navigation panel tab " +
	"tabpanel accordion collapse collapsible intro splash loader preloader loading banner cookie cookies consent sidebar sidenav toc").split(" "))

function declaredMockup(s: PageSnapshot, e: ElementSnapshot): boolean {
	return [e, ...ancestors(s, e)].some(root => {
		if (!hidden(root) || root.rect.width < 120 || root.rect.height < 80 || structuralTags.includes(root.tag) ||
			["fixed", "sticky"].includes(styleOf(root, "position")) || root.attributes["aria-modal"] !== undefined ||
			root.attributes["data-aria-hidden"] !== undefined ||
			(root.attributes["role"] ?? "").split(/\s+/).some(r => r !== "" && !["presentation", "none", "img", "figure", "group"].includes(r)) ||
			[...ancestors(s, root)].some(n => textHosts.includes(n.tag))) return false
		const parts = `${classes(root).join(" ")} ${root.attributes["id"] ?? ""}`.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase().split(/[\s_-]+/)
		if (parts.some(p => parkedParts.has(p))) return false
		const nodes = [root, ...descendants(s, root)]
		if (nodes.length > 3000 || nodes.some(n => n.tag === "h1")) return false
		const runs = nodes.filter(n => !source(n) && n.ownText.trim() !== "" &&
			styleOf(n, "visibility") !== "hidden" && [n, ...ancestors(s, n)].every(a => styleOf(a, "display") !== "none"))
		if (runs.length < 3) return false
		const fields = nodes.filter(n => ["input", "select", "textarea"].includes(n.tag) && (n.tag !== "input" || n.attributes["type"] !== "hidden"))
		const links = runs.filter(n => [n, ...ancestors(s, n)].some(a => a.tag === "a" && (a.attributes["href"] ?? "").trim() !== ""))
		if (fields.length >= 2 || (fields.length >= 1 && nodes.some(n => n.tag === "label")) || links.length * 2 >= runs.length) return false
		const text = squash(root.text)
		if ([...ancestors(s, root)].some(n => text !== "" && squash(n.attributes["aria-label"] ?? "").includes(text))) return false
		const parent = parentOf(s, root)
		if (parent && childrenOf(s, parent).some(n => {
			if (n.index === root.index) return false
			const theirs = classes(n), own = classes(root)
			const peer = n.tag === root.tag && own.every(c => theirs.includes(c)) && (own.length === 0) === (theirs.length === 0)
			const alternative = !source(n) && !hidden(n) && shown(s, n) &&
				(n.rect.width <= 1 || n.rect.height <= 1 || /sr-only|visually-?hidden/.test(classes(n).join(" "))) &&
				n.text.trim() !== "" && !/\b(?:demo|demonstration|illustrat\w*|interface|screen ?shots?|mock-?ups?|graphic|animation|animated|preview|image|video|visual|diagram|depict\w*|shows|showing|displayed)\b/i.test(n.text)
			return (peer && shown(s, n) && !hidden(n)) || (text !== "" && squash(n.text) === text) || alternative
		})) return false
		if (s.elements.some(n => dialog(n) && !hidden(n) && shown(s, n) &&
			![n, ...ancestors(s, n)].some(a => a.index === root.index) &&
			![root, ...ancestors(s, root)].some(a => a.index === n.index))) return false
		const pageChars = s.elements.filter(n => !source(n) && styleOf(n, "visibility") !== "hidden" &&
			[n, ...ancestors(s, n)].every(a => styleOf(a, "display") !== "none")).reduce((count, n) => count + squash(n.ownText).length, 0)
		const ownChars = runs.reduce((count, n) => count + squash(n.ownText).length, 0)
		return pageChars > 0 && ownChars * 2 < pageChars
	})
}

export function textPainted(s: PageSnapshot, e: ElementSnapshot): boolean {
	if ([e, ...ancestors(s, e)].some(n => fadesOutForGood(s, n))) return false
	if (declaredMockup(s, e)) return false
	for (const a of ancestors(s, e)) {
		if (a.tag === "details" && a.attributes["open"] === undefined) {
			const summary = childrenOf(s, a).find(n => n.tag === "summary")
			if (!summary || ![e, ...ancestors(s, e)].some(n => n.index === summary.index)) return false
		}
	}
	if (fontSizePx(e) <= 1) {
		const size = (n: ElementSnapshot): number | null => {
			const scale = drawnEnlargement(s, n)
			return scale === null ? null : fontSizePx(n) * scale
		}
		const own = size(e)
		if (own !== null && own <= 1 && ![...descendants(s, e)].some(n => {
			const drawn = size(n)
			return n.ownText !== "" && (drawn === null || drawn > 1)
		})) return false
	}
	return true
}
