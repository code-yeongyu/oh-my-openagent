import { ancestors, isIgnored } from "../../../core/page"
import type { PageHit } from "../../../rule"
import type { ElementSnapshot, PageSnapshot } from "../../../types"
import { bareText } from "./color-path"
import { textWhole } from "./painted-text"

export type ContrastHit = PageHit & { readonly element: ElementSnapshot; readonly pair: string }

const vendors = [
	{ name: "Taboola", subtree: true, ids: ["taboola-", "internal_trc_"], prefixes: ["trc_rbox"], classes: ["trc_related_container"] },
	{ name: "Swiper", subtree: false, ids: ["swiper-wrapper-"], prefixes: [], classes: ["swiper", "swiper-container", "swiper-wrapper", "swiper-slide"] },
	{ name: "Slick", subtree: false, ids: [], prefixes: [], classes: ["slick-slider", "slick-list", "slick-track", "slick-slide", "slick-arrow"] },
	{ name: "Slick", subtree: true, ids: [], prefixes: [], classes: ["slick-dots"] },
	{ name: "SuperSlide", subtree: false, ids: [], prefixes: [], classes: ["tempWrap"] },
	{ name: "react-fast-marquee", subtree: true, ids: [], prefixes: ["rfm-"], classes: [] },
	{ name: "Kaltura", subtree: true, ids: [], prefixes: ["playkit-"], classes: ["kaltura-player", "kaltura-player-container"] },
] as const

function vendorOf(snapshot: PageSnapshot, el: ElementSnapshot): string | null {
	for (const vendor of vendors) for (const node of vendor.subtree ? [el, ...ancestors(snapshot, el)] : [el]) {
		const classes = (node.attributes["class"] ?? "").split(/\s+/)
		if (vendor.ids.some((prefix) => (node.attributes["id"] ?? "").startsWith(prefix))
			|| classes.some((token) => vendor.classes.some((name) => name === token) || vendor.prefixes.some((prefix) => token.startsWith(prefix)))) return vendor.name
	}
	return null
}

export function distinctPairs(snapshot: PageSnapshot, hits: readonly ContrastHit[]): readonly PageHit[] {
	const groups = new Map<string, ContrastHit[]>()
	const safeOwners = new Map<string, string | null>()
	for (const hit of hits) {
		if (isIgnored(snapshot, hit.element, "low-contrast")) continue
		const vendor = vendorOf(snapshot, hit.element)
		if (bareText(hit.element)) {
			if (safeOwners.has(hit.pair) && safeOwners.get(hit.pair) !== vendor) continue
			safeOwners.set(hit.pair, vendor)
		}
		const key = `${hit.pair}|${vendor ?? "page"}`
		const group = groups.get(key) ?? []
		group.push(hit)
		groups.set(key, group)
	}
	return [...groups.values()].flatMap((group) => {
		const whole = group.find((hit) => textWhole(snapshot, hit.element)) ?? group[0]
		const owner = (whole?.element.ownText.match(/\p{L}/gu)?.length ?? 0) >= 2 ? whole
			: group.find((hit) => textWhole(snapshot, hit.element) && (hit.element.ownText.match(/\p{L}/gu)?.length ?? 0) >= 2) ?? whole
		if (!owner) return []
		return [{
			element: owner.element,
			message: `${owner.message}${group.length > 1 ? ` (and ${group.length - 1} more)` : ""}`,
			snippet: owner.snippet,
		}]
	})
}
