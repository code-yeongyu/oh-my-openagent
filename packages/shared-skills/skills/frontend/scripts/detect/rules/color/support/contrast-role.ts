import { parseColor } from "../../../core/color"
import { ancestors, styleOf } from "../../../core/page"
import type { ElementSnapshot, PageSnapshot } from "../../../types"
import { textRect } from "./painted-text"

const handwriting = new Set([
	"allura", "alex brush", "arizonia", "birthstone", "caveat", "cedarville cursive", "cookie", "dawning of a new day",
	"great vibes", "herr von muellerhoff", "homemade apple", "italianno", "la belle aurore", "meddon", "monsieur la doulaise",
	"mr dafoe", "mrs saint delafield", "ms madi", "nothing you could do", "pacifico", "parisienne", "qwigley", "reenie beanie",
	"sacramento", "satisfy", "tangerine", "whisper", "yellowtail", "zeyada",
])

function version(text: string): boolean {
	if (text.length > 64) return false
	let found = false
	const tokens = /\b(?:version|ver\.?|build|release|rev(?:ision)?|commit)\s*[:#]?\s*([0-9a-z][0-9a-z.+_-]*\d[0-9a-z.+_-]*)|(?:^|[\s([])v\d+(?:\.\d+)+(?:[-+][0-9a-z.]+)?|(?:^|[\s([])[a-z]{1,3}\d+\.\d+\.\d+(?:\.\d+)?(?:[-+][0-9a-z.]+)?/gi
	let rest = text.replace(tokens, (whole: string, id: string | undefined) => {
		if (id && (!/^(?:[a-z]?\d+(?:\.\d+)+(?:[-+_][0-9a-z.]+)?|\d+(?:[-+_][0-9a-z.]+)?|[0-9a-f]{7,40})$/i.test(id) || /^(?:19|20)\d\d(?:[-+_]|$)/.test(id))) return whole
		found = true
		return " "
	})
	rest = rest.replace(/(?:^|[\s([])(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:[-+][0-9a-z.]+)?\b/gi, (whole: string, _major: string, minor: string, patch: string) => {
		if ([minor, patch].some((part) => part.length > 1 && part.startsWith("0"))) return whole
		found = true
		return " "
	})
	return found && rest.replace(/\b\d{4}[-./]\d{1,2}[-./]\d{1,2}(?:[\sT]+\d{1,2}(?::\d{2}){0,2})?\b|\b\d{1,2}[-./]\d{1,2}[-./]\d{2,4}\b|\b\d{1,2}:\d{2}(?::\d{2})?\b|\b[0-9a-f]{7,12}\b|[\s\u00b7\u2022|/,()[\]\u2013\u2014-]+/gi, "") === ""
}

function mockup(el: ElementSnapshot): boolean {
	if (["html", "body", "main", "section", "article", "header", "footer", "nav", "aside", "figcaption"].includes(el.tag)) return false
	return [el.attributes["class"], el.attributes["id"]].join(" ").split(/\s+/).some((token) => {
		const parts = token.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/)
		if (parts.some((part) => ["credit", "credits", "caption", "captions", "title", "heading", "description", "copy"].includes(part))) return false
		return parts.some((part) => ["mockup", "mockups", "illustration", "illustrations"].includes(part))
			|| (parts.includes("mock") && parts.some((part) => ["ui", "window", "browser", "screen", "device", "phone", "app"].includes(part)))
	})
}

/** Keeps upstream advisory pairs apart from reading text without changing the project's error severity. */
export function contrastRole(snapshot: PageSnapshot, el: ElementSnapshot): string {
	const chain = [el, ...ancestors(snapshot, el)]
	const text = el.ownText.trim()
	const words = text.split(/\s+/)
	const sentence = words.length >= 8 || (words.length >= 5 && /[.!?\u3002\uff01\uff1f]$/.test(text))
	for (const node of chain) {
		if (node.tag === "figcaption") break
		if (node.attributes["role"] === "img" && !chain.some((n) => n.tag === "svg")) return "decorative"
		if (!sentence && mockup(node)) return "decorative"
	}
	const control = chain.find((node) => ["a", "button", "label", "summary", "select", "option"].includes(node.tag)
		|| ["button", "link", "tab", "menuitem", "option", "checkbox", "radio", "switch"].includes(node.attributes["role"] ?? ""))
	if (control?.text.trim() === text) return "copy"
	if (/^\p{L}{1,2}$/u.test(text) && !["i", "x", "v"].includes(text) && !chain.some((node) => node.tag === "kbd")) {
		const glyph = textRect(el)
		for (const node of chain.slice(0, 3)) {
			if (node.text.trim() !== text) break
			const box = node.rect
			const fill = parseColor(styleOf(node, "background-color"))
			const paints = (fill?.a ?? 0) > 0.1 || styleOf(node, "background-image") !== "none" || node.tag === "svg"
			const centered = Math.abs(glyph.x + glyph.width / 2 - box.x - box.width / 2) <= box.width * 0.15
				&& Math.abs(glyph.y + glyph.height / 2 - box.y - box.height / 2) <= box.height * 0.15
			if (paints && centered && box.width >= 12 && box.width <= 72 && box.height >= 12 && box.height <= 72
				&& box.width / box.height >= 0.8 && box.width / box.height <= 1.25) return "decorative"
		}
	}
	if (chain.some((node) => /^h[1-6]$/.test(node.tag) || node.attributes["role"] === "heading")) return "copy"
	if (version(text)) return "decorative"
	const marked = chain.slice(0, 2).some((node) => [node.attributes["class"], node.attributes["id"]].join(" ").split(/\s+/)
		.some((token) => /^(?:[a-z0-9]+(?:-{1,2}|_{1,2}))?(?:signature|autograph|sign-?off)(?:(?:-{1,2}|_{1,2})(?:name|text|line|block|wrap|wrapper|img|image))?$/i.test(token)))
	const family = (styleOf(el, "font-family").split(",")[0] ?? "").replace(/["']/g, "").trim().toLowerCase()
	const script = family === "cursive" || /script|handwriting/.test(family) || handwriting.has(family)
	if (text.length <= 40 && words.length <= (marked ? 4 : 3) && words.every((word) => /^[\p{L}.'-]+$/u.test(word))
		&& (marked || (script && words.every((word) => /^\p{Lu}/u.test(word))))) return "decorative"
	return "copy"
}
