import { ancestors, childrenOf, descendants, isRendered, styleOf } from "../../../core/page"
import type { ElementSnapshot, PageSnapshot } from "../../../types"

const skippedTags = new Set(["html", "body", "main", "header", "footer", "nav", "aside", "section", "article", "form", "dialog", "li", "tr", "td", "th", "tbody", "thead", "table", "details", "summary"])
const textTags = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "a", "button", "label", "summary", "legend", "caption", "figcaption", "blockquote", "q"])
const skippedParts = new Set([
	"clone", "clones", "cloned", "copy", "duplicate", "dup", "carousel", "embla", "flicking", "glide", "keen", "slick", "slide", "slider", "slides", "splide", "swiper", "marquee", "ticker",
	"menu", "submenu", "dropdown", "popup", "popover", "modal", "drawer", "dialog", "tooltip", "toast", "offcanvas", "overlay", "nav", "navbar", "navigation", "panel", "tab", "tabpanel",
	"accordion", "collapse", "collapsible", "intro", "splash", "loader", "preloader", "loading", "banner", "cookie", "cookies", "consent", "sidebar", "sidenav", "toc",
])
const hidden = (el: ElementSnapshot): boolean => el.attributes["inert"] !== undefined || el.attributes["aria-hidden"]?.trim().toLowerCase() === "true"
const squash = (text: string): string => text.replace(/\s/g, "")
const dialog = (el: ElementSnapshot): boolean => el.attributes["aria-modal"] === "true" || /^(?:alert)?dialog$/.test(el.attributes["role"] ?? "")
	|| (el.tag === "dialog" && el.attributes["open"] !== undefined)

function structural(el: ElementSnapshot): boolean {
	if (skippedTags.has(el.tag) || el.attributes["aria-modal"] !== undefined || el.attributes["data-aria-hidden"] !== undefined
		|| ["fixed", "sticky"].includes(styleOf(el, "position"))) return false
	const roles = (el.attributes["role"] ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean)
	if (!roles.every((role) => ["presentation", "none", "img", "figure", "group"].includes(role))) return false
	const parts = [el.attributes["class"], el.attributes["id"]].join(" ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/)
	return !parts.some((part) => skippedParts.has(part))
}

function hasPeer(snapshot: PageSnapshot, el: ElementSnapshot): boolean {
	const text = squash(el.text)
	if (text && ancestors(snapshot, el).some((node) => squash(node.attributes["aria-label"] ?? "").includes(text))) return true
	const parent = el.parent === null ? undefined : snapshot.elements[el.parent]
	if (!parent) return false
	const classes = (el.attributes["class"] ?? "").split(/\s+/).filter(Boolean)
	return childrenOf(snapshot, parent).some((peer) => {
		if (peer === el) return false
		const same = peer.tag === el.tag && classes.every((c) => (peer.attributes["class"] ?? "").split(/\s+/).includes(c))
			&& (classes.length === 0) === ((peer.attributes["class"] ?? "").trim() === "")
		if (same && isRendered(snapshot, peer) && !hidden(peer)) return true
		if (text && squash(peer.text) === text) return true
		const picture = /\b(?:demo|demonstration|illustrat\w*|interface|screen ?shots?|mock-?ups?|graphic|animation|animated|preview|image|video|visual|diagram|depict\w*|shows|showing|displayed)\b/i.test(peer.text)
		return !hidden(peer) && isRendered(snapshot, peer) && peer.text.trim() !== "" && !picture && (peer.rect.width <= 1 || peer.rect.height <= 1)
	})
}

export function mockupRoots(snapshot: PageSnapshot): ReadonlyMap<number, "declared" | "labelled"> {
	const roots = new Map<number, "declared" | "labelled">()
	const pageChars = snapshot.elements.filter((el) => isRendered(snapshot, el)).reduce((sum, el) => sum + squash(el.ownText).length, 0)
	const modals = snapshot.elements.filter((el) => dialog(el) && !hidden(el) && isRendered(snapshot, el))
	for (const el of snapshot.elements) {
		if (el.rect.width < 120 || el.rect.height < 80 || !structural(el)) continue
		if (/\b(?:screen ?shots?|screen ?captures?|screencaps?|illustrations?|mock-?ups?)\b|\bpreview of\b/i.test(el.attributes["aria-label"] ?? "")) {
			roots.set(el.index, "labelled")
		}
		if (!hidden(el) || ancestors(snapshot, el).some((node) => textTags.has(node.tag))) continue
		const nodes = [el, ...descendants(snapshot, el)]
		if (nodes.length > 3000 || nodes.some((node) => node.tag === "h1")) continue
		const fields = nodes.filter((node) => ["input", "select", "textarea"].includes(node.tag) && node.attributes["type"] !== "hidden").length
		const runs = nodes.filter((node) => isRendered(snapshot, node) && node.ownText.trim() !== "")
		const links = runs.filter((node) => [node, ...ancestors(snapshot, node)].some((host) => nodes.includes(host) && host.tag === "a" && (host.attributes["href"] ?? "").trim() !== "")).length
		if (runs.length < 3 || fields >= 2 || (fields >= 1 && nodes.some((node) => node.tag === "label")) || links * 2 >= runs.length || hasPeer(snapshot, el)) continue
		if (modals.some((modal) => !nodes.includes(modal) && ![...ancestors(snapshot, el)].includes(modal))) continue
		const chars = runs.reduce((sum, node) => sum + squash(node.ownText).length, 0)
		if (pageChars > 0 && chars * 2 < pageChars) roots.set(el.index, "declared")
	}
	return roots
}
