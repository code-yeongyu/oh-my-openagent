import { childrenOf, descendants, parentOf, styleOf } from "../../../core/page"
import type { ElementSnapshot, PageSnapshot } from "../../../types"
import { chain, hasRole, ident } from "./geometry"

const hidden = (el: ElementSnapshot): boolean => el.attributes["inert"] !== undefined || el.attributes["aria-hidden"] === "true"
const shown = (s: PageSnapshot, el: ElementSnapshot): boolean =>
	el.rect.width > 0 && el.rect.height > 0 && styleOf(el, "visibility") !== "hidden" && chain(s, el).every((n) => styleOf(n, "display") !== "none")
const squash = (text: string): string => text.replace(/\s/g, "")
const parts = (el: ElementSnapshot): string[] =>
	`${el.attributes["class"] ?? ""} ${el.attributes["id"] ?? ""}`.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[\s_-]+/)

export function declaredMockups(s: PageSnapshot): ReadonlySet<ElementSnapshot> {
	const pageChars = s.elements.filter((n) => shown(s, n)).reduce((sum, n) => sum + squash(n.ownText).length, 0)
	const modals = s.elements.filter((n) => !hidden(n) && shown(s, n) &&
		(n.attributes["aria-modal"] === "true" || hasRole(n, ["dialog", "alertdialog"]) || n.tag === "dialog" && n.attributes["open"] !== undefined))
	return new Set(s.elements.filter((root) => {
		if (!hidden(root) || root.rect.width < 120 || root.rect.height < 80 ||
			/^(html|body|main|header|footer|nav|aside|section|article|form|dialog|li|tr|td|th|tbody|thead|table|details|summary)$/.test(root.tag)) return false
		if ((root.attributes["role"] ?? "").split(/\s+/).some((r) => r !== "" && !["presentation", "none", "img", "figure", "group"].includes(r))) return false
		if (root.attributes["aria-modal"] !== undefined || root.attributes["data-aria-hidden"] !== undefined || /^(fixed|sticky)$/.test(styleOf(root, "position"))) return false
		if (parts(root).some((p) => /^(clone|clones|cloned|copy|duplicate|dup|carousel|embla|flicking|glide|keen|slick|slide|slider|slides|splide|swiper|marquee|ticker|menu|submenu|dropdown|popup|popover|modal|drawer|dialog|tooltip|toast|offcanvas|overlay|nav|navbar|navigation|panel|tab|tabpanel|accordion|collapse|collapsible|intro|splash|loader|preloader|loading|banner|cookie|cookies|consent|sidebar|sidenav|toc)$/.test(p))) return false
		const path = chain(s, root).slice(1)
		if (path.some((n) => /^(h[1-6]|p|a|button|label|summary|legend|caption|figcaption|blockquote|q)$/.test(n.tag))) return false
		const nodes = [root, ...descendants(s, root)]
		if (nodes.length > 3000 || nodes.some((n) => n.tag === "h1")) return false
		const runs = nodes.filter((n) => shown(s, n) && squash(n.ownText) !== "")
		if (runs.length < 3 || runs.reduce((sum, n) => sum + squash(n.ownText).length, 0) * 2 >= pageChars) return false
		const fields = nodes.filter((n) => /^(input|select|textarea)$/.test(n.tag) && !(n.tag === "input" && n.attributes["type"] === "hidden"))
		const links = runs.filter((n) => chain(s, n).some((a) => a.tag === "a" && (a.attributes["href"] ?? "").trim() !== ""))
		if (fields.length >= 2 || fields.length > 0 && nodes.some((n) => n.tag === "label") || links.length * 2 >= runs.length) return false
		if (modals.some((n) => !nodes.includes(n) && !path.includes(n))) return false
		const text = squash(root.text)
		if (text !== "" && path.some((n) => squash(n.attributes["aria-label"] ?? "").includes(text))) return false
		const p = parentOf(s, root)
		return !p || !childrenOf(s, p).some((peer) => {
			if (peer === root) return false
			const classes = (root.attributes["class"] ?? "").split(/\s+/).filter(Boolean)
			const peerClasses = (peer.attributes["class"] ?? "").split(/\s+/).filter(Boolean)
			const sameShape = peer.tag === root.tag && (classes.length === 0) === (peerClasses.length === 0) && classes.every((c) => peerClasses.includes(c))
			if (shown(s, peer) && !hidden(peer) && sameShape || text !== "" && squash(peer.text) === text) return true
			const alternative = peer.rect.width <= 1 || peer.rect.height <= 1 || /sr-only|visually-?hidden|screen-?reader|a11y-hidden|hidden-visually/.test(ident(peer))
			return shown(s, peer) && alternative && peer.text.trim() !== "" &&
				!/\b(demo|demonstration|illustrat\w*|interface|screen ?shots?|mock-?ups?|graphic|animation|animated|preview|image|video|visual|diagram|depict\w*|shows|showing|displayed)\b/i.test(peer.text)
		})
	}))
}
