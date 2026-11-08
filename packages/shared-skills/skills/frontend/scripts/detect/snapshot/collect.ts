import type { ElementSnapshot, PageSnapshot, PseudoSnapshot, Rect } from "../types"

// Runs inside the page: the renderer serializes this function with toString() and evaluates it there,
// so it must stay self-contained (no imports at runtime, no references to module scope).
export function collectPageSnapshot(props: readonly string[], maxElements: number): PageSnapshot {
	const collapse = (s: string): string => s.replace(/\s+/g, " ").trim()
	const toRect = (r: DOMRect): Rect => ({
		x: Math.round(r.x * 100) / 100,
		y: Math.round(r.y * 100) / 100,
		width: Math.round(r.width * 100) / 100,
		height: Math.round(r.height * 100) / 100,
	})
	const readStyle = (style: CSSStyleDeclaration): Record<string, string> => {
		const out: Record<string, string> = {}
		for (const p of props) out[p] = style.getPropertyValue(p)
		return out
	}
	const pseudo = (el: Element, which: "::before" | "::after"): PseudoSnapshot | null => {
		const style = getComputedStyle(el, which)
		const content = style.getPropertyValue("content")
		if (content === "none" || content === "normal" || content === "") return null
		return { style: readStyle(style), rect: null }
	}
	const cssEscape = (s: string): string => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : s)
	const selectorOf = (el: Element): string => {
		const parts: string[] = []
		let node: Element | null = el
		while (node && node.nodeType === 1 && parts.length < 6) {
			if (node.id) {
				parts.unshift(`#${cssEscape(node.id)}`)
				break
			}
			const tag = node.tagName.toLowerCase()
			const parentEl: Element | null = node.parentElement
			if (!parentEl) {
				parts.unshift(tag)
				break
			}
			const current: Element = node
			const same = Array.from(parentEl.children).filter((c) => c.tagName === current.tagName)
			parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(current) + 1})` : tag)
			node = parentEl
		}
		return parts.join(" > ")
	}
	const lineRectsOf = (el: Element): Rect[] => {
		const rects: Rect[] = []
		for (const child of Array.from(el.childNodes)) {
			if (child.nodeType !== 3 || !child.textContent || child.textContent.trim() === "") continue
			const range = document.createRange()
			range.selectNodeContents(child)
			for (const r of Array.from(range.getClientRects())) {
				if (r.width === 0 && r.height === 0) continue
				const last = rects[rects.length - 1]
				if (last && Math.abs(last.y - r.y) < 2) {
					const right = Math.max(last.x + last.width, r.x + r.width)
					const x = Math.min(last.x, r.x)
					rects[rects.length - 1] = { x, y: last.y, width: right - x, height: Math.max(last.height, r.height) }
				} else rects.push(toRect(r))
			}
		}
		return rects
	}
	const kebab = (p: string): string => (p === "cssOffset" ? "offset" : p.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`))
	const motionOf = (el: Element): string[] => {
		const moving = new Set<string>()
		for (const anim of el.getAnimations()) {
			if (anim.playState !== "running") continue
			if (typeof CSSTransition !== "undefined" && anim instanceof CSSTransition) moving.add(anim.transitionProperty)
			const effect = anim.effect
			if (!(effect instanceof KeyframeEffect)) continue
			for (const frame of effect.getKeyframes()) {
				for (const key of Object.keys(frame)) if (!["offset", "computedOffset", "easing", "composite"].includes(key)) moving.add(kebab(key))
			}
		}
		return [...moving].sort()
	}
	const all = Array.from(document.querySelectorAll("body, body *"))
		.filter((el) => !["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "META", "LINK"].includes(el.tagName))
		.slice(0, maxElements)
	const indexOf = new Map<Element, number>()
	all.forEach((el, i) => indexOf.set(el, i))
	const elements: ElementSnapshot[] = all.map((el, index) => {
		const attributes: Record<string, string> = {}
		for (const a of Array.from(el.attributes)) attributes[a.name] = a.value.slice(0, 500)
		const parentIndex = el.parentElement ? indexOf.get(el.parentElement) : undefined
		const ownText = collapse(
			Array.from(el.childNodes)
				.filter((n) => n.nodeType === 3)
				.map((n) => n.textContent ?? "")
				.join(" "),
		)
		return {
			index,
			parent: parentIndex === undefined ? null : parentIndex,
			children: Array.from(el.children)
				.map((c) => indexOf.get(c))
				.filter((i): i is number => i !== undefined),
			tag: el.tagName.toLowerCase(),
			selector: selectorOf(el),
			attributes,
			rect: toRect(el.getBoundingClientRect()),
			ownText,
			textRuns: Array.from(el.childNodes)
				.filter((n) => n.nodeType === 3)
				.map((n) => collapse(n.textContent ?? ""))
				.filter((t) => t !== ""),
			text: collapse(el.textContent ?? "").slice(0, 2000),
			lineRects: ownText === "" ? [] : lineRectsOf(el),
			style: readStyle(getComputedStyle(el)),
			before: pseudo(el, "::before"),
			after: pseudo(el, "::after"),
			scroll: { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight },
			motion: motionOf(el),
			placeholder: el.matches(":placeholder-shown") ? { style: readStyle(getComputedStyle(el, "::placeholder")), rect: null } : null,
			modal: (() => {
				try {
					return el.matches(":modal")
				} catch (error) {
					if (error instanceof DOMException) return false
					throw error
				}
			})(),
		}
	})
	const cssText: string[] = []
	for (const sheet of Array.from(document.styleSheets)) {
		const rules = (() => {
			try {
				return Array.from(sheet.cssRules)
			} catch (error) {
				if (error instanceof DOMException) return []
				throw error
			}
		})()
		cssText.push(rules.map((r) => r.cssText).join("\n"))
	}
	const root = document.documentElement
	const errors: unknown = Reflect.get(globalThis, "__detectScriptErrors")
	return {
		viewport: { width: window.innerWidth, height: window.innerHeight },
		url: location.href,
		title: document.title,
		lang: root.lang,
		document: { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth, scrollHeight: root.scrollHeight },
		elements,
		cssText,
		scriptErrors: Array.isArray(errors) ? errors.filter((e): e is string => typeof e === "string") : [],
		scriptErrorsCaptured: Array.isArray(errors),
	}
}

/** Installed before page scripts run, so errors thrown during load reach the snapshot's scriptErrors. */
export const SCRIPT_ERROR_PROBE = `(() => {
	const sink = (globalThis.__detectScriptErrors = []);
	addEventListener("error", (e) => sink.push(String(e.message || e.error || "error")));
	addEventListener("unhandledrejection", (e) => sink.push(String(e.reason && e.reason.message || e.reason)));
})();`
