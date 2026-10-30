import { ancestors, childrenOf, descendants, styleOf } from "../../../core/page"
import type { ElementSnapshot, PageSnapshot, Rect } from "../../../types"
import { bottom, chain, clipsX, hasRole, ident, outOfFlow, painted, right, scrollsX } from "./geometry"

export function trackCuts(s: PageSnapshot, el: ElementSnapshot, text: Rect): boolean {
	const path = [...ancestors(s, el)]
	return path.some((clip, index) => {
		if (clip.tag === "body" || !clipsX(clip) || text.x >= clip.rect.x - 1 && right(text) <= right(clip.rect) + 1) return false
		if (scrollsX(clip) && clip.scroll.scrollWidth > clip.scroll.clientWidth) return true
		return path.slice(0, index).some((track) => {
			if (["", "none"].includes(styleOf(track, "transform")) || track.scroll.scrollWidth <= clip.scroll.clientWidth + 1) return false
			const kids = childrenOf(s, track).filter((n) => n.rect.width > 0 && n.rect.height > 0)
			return kids.some((a, i) => kids.slice(i + 1).some((b) =>
				Math.min(bottom(a.rect), bottom(b.rect)) - Math.max(a.rect.y, b.rect.y) >= Math.min(a.rect.height, b.rect.height) * 0.5 &&
				(a.rect.x >= right(b.rect) - 1 || b.rect.x >= right(a.rect) - 1)))
		})
	})
}

const viewportTrack = (el: ElementSnapshot): boolean =>
	/(?:^|[\s_-])(?:carousel|comparison|compare|fisheye|flickity|marquee|owl|preview|reel|rolling|scroller|slick|slider|slideshow|splide|split|swiper|tempwrap|ticker|viewport)(?:$|[\s_-])/.test(
		`${el.attributes["class"] ?? ""} ${el.attributes["id"] ?? ""}`.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()) ||
	/\b(?:carousel|slider)\b/i.test(el.attributes["aria-roledescription"] ?? "") ||
	/(?:^|[\s_-])demo[\s_-]+(?:area|stage|viewport)(?:$|[\s_-])/.test(ident(el))

export const shell = (s: PageSnapshot, el: ElementSnapshot): boolean =>
	el.tag === "body" || el.rect.x <= 1 && el.rect.y <= 1 && el.rect.width >= s.viewport.width * 0.98 && el.rect.height >= s.document.scrollHeight * 0.98

function clippedAxes(el: ElementSnapshot): readonly [boolean, boolean] | null {
	if (["contents", "none"].includes(styleOf(el, "display")) || el.rect.width <= 0 || el.rect.height <= 0 ||
		scrollsX(el) || /^(auto|scroll)$/.test(styleOf(el, "overflow-y"))) return null
	const x = /^(hidden|clip)$/.test(styleOf(el, "overflow-x"))
	const y = /^(hidden|clip)$/.test(styleOf(el, "overflow-y"))
	return x || y ? [x, y] : null
}

function traps(s: PageSnapshot, clip: ElementSnapshot, el: ElementSnapshot): boolean {
	if (el.modal) return false
	const axes = clippedAxes(clip)
	if (!axes) return false
	const parents = [...ancestors(s, el)]
	const between = parents.slice(0, parents.indexOf(clip) + 1)
	if (styleOf(el, "position") === "fixed" && !between.some((n) =>
		!["", "none"].includes(styleOf(n, "transform")) || /paint|layout|strict|content/.test(styleOf(n, "contain")) ||
		!["", "none"].includes(styleOf(n, "filter")))) return false
	if (styleOf(el, "position") === "absolute") {
		const cb = parents.find((n) => styleOf(n, "position") !== "static" || !["", "none"].includes(styleOf(n, "transform")))
		if (cb && !between.includes(cb)) return false
	}
	return axes[0] && (el.rect.x < clip.rect.x - 2 || right(el.rect) > right(clip.rect) + 2) ||
		axes[1] && (el.rect.y < clip.rect.y - 2 || bottom(el.rect) > bottom(clip.rect) + 2)
}

const popover = (el: ElementSnapshot): boolean =>
	hasRole(el, ["menu", "menubar", "listbox", "tooltip", "dialog"]) ||
	el.tag === "dialog" && el.attributes["open"] !== undefined || el.attributes["popover"] !== undefined

export function clippedChild(s: PageSnapshot, clip: ElementSnapshot): ElementSnapshot | undefined {
	if (!clippedAxes(clip) || shell(s, clip) || viewportTrack(clip) || childrenOf(s, clip).some(viewportTrack) || !painted(s, clip)) return undefined
	return [...descendants(s, clip)].find((el) => {
		if (chain(s, el).some((n) => n.attributes["aria-hidden"] === "true") || hasRole(el, ["none", "presentation"]) ||
			/^(img|svg|canvas|video)$/.test(el.tag)) return false
		if (!outOfFlow(el) || viewportTrack(el) || !(popover(el) || [...descendants(s, el)].some(popover))) return false
		if (!traps(s, clip, el)) return false
		const parents = [...ancestors(s, el)]
		const between = parents.slice(0, parents.indexOf(clip))
		if (between.some((n) => traps(s, n, el) || scrollsX(n) || /^(auto|scroll)$/.test(styleOf(n, "overflow-y")))) return false
		return chain(s, el).every((n) => styleOf(n, "display") !== "none" && styleOf(n, "visibility") !== "hidden" &&
			!(Number.parseFloat(styleOf(n, "opacity")) <= 0.01))
	})
}
