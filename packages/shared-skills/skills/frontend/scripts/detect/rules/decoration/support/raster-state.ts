import { ancestors, childrenOf, parentOf, styleOf } from "../../../core/page"
import type { ElementSnapshot, PageSnapshot } from "../../../types"

const tokens = (e: ElementSnapshot): readonly string[] => [...new Set((e.attributes["class"] ?? "").toLowerCase().split(/\s+/).filter(Boolean))]
const opacity = (s: PageSnapshot, e: ElementSnapshot): number =>
	[e, ...ancestors(s, e)].reduce((value, n) => {
		const own = Number.parseFloat(styleOf(n, "opacity"))
		return value * (Number.isFinite(own) ? own : 1)
	}, 1)
const transitionsOpacity = (e: ElementSnapshot): boolean => {
	const times = styleOf(e, "transition-duration").split(",")
	return styleOf(e, "transition-property").split(",").some((p, i) =>
		["opacity", "all"].includes(p.trim()) && Number.parseFloat(times[i % times.length] ?? "0") > 0)
}

export function pendingRaster(s: PageSnapshot, e: ElementSnapshot): boolean {
	if (e.motion.includes("opacity")) return true
	const chain = [e, ...ancestors(s, e)]
	if (chain.slice(1).some(n => Number.parseFloat(styleOf(n, "opacity")) <= 0.02) ||
		chain.some(n => styleOf(n, "display") === "none" || styleOf(n, "visibility") === "hidden")) return true
	const attrs = e.attributes
	if (attrs["data-loaded"]?.trim().toLowerCase() === "false" ||
		(attrs["data-ll-status"] !== undefined && attrs["data-ll-status"].trim().toLowerCase() !== "loaded")) return true
	if (["data-src", "data-srcset", "data-lazy", "data-lazy-src", "data-lazy-srcset", "data-original", "data-original-src"]
		.some(name => attrs[name] !== undefined) && (attrs["src"] ?? "").trim() === "") return true
	const parent = parentOf(s, e)
	const classes = [e, ...(parent ? [parent] : [])].flatMap(tokens)
	if (classes.some(t => t.includes("lazy")) && !classes.some(t => t.includes("loaded")) &&
		(opacity(s, e) <= 0.02 || /(?:^|;)\s*opacity\s*:/i.test(attrs["style"] ?? ""))) return true
	if (parent && opacity(s, e) <= 0.02) {
		const videoOver = (n: ElementSnapshot, depth: number): boolean => {
			const w = Math.min(e.rect.x + e.rect.width, n.rect.x + n.rect.width) - Math.max(e.rect.x, n.rect.x)
			const h = Math.min(e.rect.y + e.rect.height, n.rect.y + n.rect.height) - Math.max(e.rect.y, n.rect.y)
			if (n.tag === "video" && opacity(s, n) > 0.02 && [n, ...ancestors(s, n)].every(a =>
				styleOf(a, "display") !== "none" && styleOf(a, "visibility") !== "hidden") &&
				w > 0 && h > 0 && w * h >= e.rect.width * e.rect.height * 0.5) return true
			return depth > 0 && childrenOf(s, n).some(child => videoOver(child, depth - 1))
		}
		if (parent.tag === "video" || childrenOf(s, parent).some(n => n.index !== e.index && videoOver(n, 3))) return true
	}
	if (e.tag !== "img" || opacity(s, e) > 0.02) return false
	const own = tokens(e)
	const peers = s.elements.filter(other => {
		if (other.index === e.index || other.tag !== "img" || Number.parseFloat(styleOf(other, "opacity")) < 0.5 ||
			opacity(s, other) <= 0.02 || !transitionsOpacity(other)) return false
		const theirs = tokens(other)
		const shared = own.filter(t => theirs.includes(t)).length
		return shared > 0 && own.length - shared <= 1 && theirs.filter(t => !own.includes(t)).length === 1
	})
	return peers.length >= 2
}
