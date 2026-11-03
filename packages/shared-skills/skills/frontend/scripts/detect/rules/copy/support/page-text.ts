import { ancestors, isRendered, styleOf } from "../../../core/page"
import type { ElementSnapshot, PageSnapshot } from "../../../types"

export const lineage = (snapshot: PageSnapshot, el: ElementSnapshot): readonly ElementSnapshot[] =>
	[el, ...ancestors(snapshot, el)]

export const displayed = (snapshot: PageSnapshot, el: ElementSnapshot): boolean =>
	lineage(snapshot, el).every((a) => styleOf(a, "display") !== "none" && styleOf(a, "content-visibility") !== "hidden")

export const visibleText = (snapshot: PageSnapshot, el: ElementSnapshot): boolean => {
	if (!isRendered(snapshot, el) || !displayed(snapshot, el)) return false
	return lineage(snapshot, el).every((a) => styleOf(a, "visibility") !== "hidden"
		&& !(a.tag === "dialog" && a.attributes["open"] === undefined))
}

export const pageText = (snapshot: PageSnapshot): string =>
	snapshot.elements.filter((el) => visibleText(snapshot, el) && !["script", "style", "template", "noscript"].includes(el.tag))
		.map((el) => el.ownText).filter(Boolean).join(" ").replace(/\s+/g, " ").trim()

export const paintedText = (snapshot: PageSnapshot, el: ElementSnapshot): boolean => {
	if (!visibleText(snapshot, el)) return false
	let left = el.rect.x
	let top = el.rect.y
	let right = left + el.rect.width
	let bottom = top + el.rect.height
	for (const a of ancestors(snapshot, el)) {
		if (["hidden", "clip", "auto", "scroll"].includes(styleOf(a, "overflow-x"))) {
			left = Math.max(left, a.rect.x)
			right = Math.min(right, a.rect.x + a.rect.width)
		}
		if (["hidden", "clip", "auto", "scroll"].includes(styleOf(a, "overflow-y"))) {
			top = Math.max(top, a.rect.y)
			bottom = Math.min(bottom, a.rect.y + a.rect.height)
		}
	}
	return right > left && bottom > top
}
