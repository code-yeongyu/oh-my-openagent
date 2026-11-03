import { descendants, styleOf } from "../../../core/page"
import type { ElementSnapshot, PageSnapshot } from "../../../types"
import { chain } from "./geometry"

export const classWords = (el: ElementSnapshot): readonly string[] =>
	(el.attributes["class"] ?? "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

export function closedClass(el: ElementSnapshot): boolean {
	return (el.attributes["class"] ?? "").split(/\s+/).some((token) => {
		const words = classWords({ ...el, attributes: { class: token } })
		const pair = (a: string, b: string): boolean => words.some((word, i) => word === a && words[i + 1] === b)
		return words.some((word) => ["offcanvas", "drawer", "megamenu", "submenu", "dropdown", "flyout", "modal", "tabpanel", "tabpane"].includes(word)) ||
			pair("off", "canvas") || pair("mega", "menu") || pair("sub", "menu") ||
			words.some((word) => ["content", "panel", "pane", "body"].includes(word)) && words.some((word) => ["tab", "tabs", "accordion"].includes(word))
	})
}

export function unstartedSlider(s: PageSnapshot, el: ElementSnapshot): boolean {
	const slider = chain(s, el).slice(0, 7).find((n) => (n.attributes["class"] ?? "").split(/\s+/).some((token) => {
		const words = classWords({ ...n, attributes: { class: token } })
		return words.some((word) => ["slider", "carousel", "swiper", "slick", "splide", "glide", "flickity", "slideshow", "revslider"].includes(word)) &&
			!words.some((word) => ["slide", "item", "cell", "card", "pane", "caption"].includes(word))
	}))
	if (!slider) return false
	return ![slider, ...descendants(s, slider)].some((n) => {
		if (/^(hidden|collapse)$/.test(styleOf(n, "visibility"))) return false
		const path = chain(s, n)
		const upto = path.slice(0, path.indexOf(slider) + 1)
		const shows = (aria: boolean): boolean => upto.every((a) => styleOf(a, "display") !== "none" &&
			Number.parseFloat(styleOf(a, "opacity")) > 0.02 && !(aria && a.attributes["aria-hidden"] === "true"))
		if (n.ownText.trim() !== "" && shows(true)) return true
		return n !== slider && n.rect.width >= Math.max(1, slider.rect.width * 0.5) && n.rect.height >= 1 &&
			(/^(img|picture|video|canvas|svg)$/.test(n.tag) || styleOf(n, "background-image").includes("url(")) && shows(false)
	})
}
