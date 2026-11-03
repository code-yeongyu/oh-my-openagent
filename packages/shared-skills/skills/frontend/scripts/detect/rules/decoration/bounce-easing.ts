import type { PageHit, PageRule } from "../../rule"
import { shortSnippet, styleOf } from "../../core/page"
import { borderSafe, splitTop, visible } from "./support/appearance"
import { keyframes, onlyUnitPulse, overshoot } from "./support/keyframes"
import { pageIgnored } from "../color/support/page-ignore"
import { textPainted } from "../color/support/painted-text"
import { bounceEasing as sourceBounce } from "../source/bounce-easing"
import { cssBlocks } from "../../core/source"
import { matchesSelector } from "./support/css-candidates"
import type { ElementSnapshot } from "../../types"

function easingKey(value: string): string {
	const curve = /cubic-bezier\(([^)]+)\)/i.exec(value)
	if (curve) return `cubic-bezier(${(curve[1] ?? "").split(",").map(Number).join(",")})`
	return value.replace(/\s/g, "").toLowerCase()
}
export const bounceEasing: PageRule = {
	meta: {
		id: "bounce-easing",
		name: "Bounce or elastic easing",
		category: "slop",
		severity: "advisory",
		engine: "page",
		description: "Animation names or timing curves imply overshooting motion.",
		fixHint: "Use a smooth deceleration or document an intentional easing in allowEasings.",
	},
	check: ({ snapshot, config }) => {
		const covered = new Set<string>()
		const hits: PageHit[] = []
		const allowed = (value: string): boolean =>
			(config.allowEasings ?? []).some((easing) => easingKey(easing) === easingKey(value))
		const painted = (el: ElementSnapshot): boolean => visible(snapshot, el) && textPainted(snapshot, el)
			&& el.rect.x + el.rect.width > 0 && el.rect.x < snapshot.document.scrollWidth
			&& el.rect.y + el.rect.height > 0 && el.rect.y < snapshot.document.scrollHeight
		for (const e of snapshot.elements) {
			if (!painted(e) || borderSafe.has(e.tag) || e.tag === "label" || pageIgnored(snapshot, e, "bounce-easing")) continue
			const names = splitTop(styleOf(e, "animation-name")).filter((n) => /bounce|elastic|wobble|jiggle|spring/i.test(n))
			const named = names.filter((n) => {
				const f = keyframes(snapshot, n)
				return !allowed(n) && (f === null || !onlyUnitPulse(f))
			})
			const curves = [styleOf(e, "animation-timing-function"), styleOf(e, "transition-timing-function")]
				.flatMap((v) => splitTop(v))
				.filter((v) => !allowed(v) && overshoot(v))
			const tailwind = /(?:^|\s)animate-bounce(?:$|\s)/.test(e.attributes["class"] ?? "") && !allowed("animate-bounce")
			if (named.length === 0 && !tailwind && curves.length === 0) continue
			hits.push({ element: e, message: "Overshooting motion: " + (curves[0] ?? (named.join(",") || "animate-bounce")), snippet: shortSnippet(e) })
			for (const name of named) covered.add(easingKey(`animation: ${name}`))
			for (const curve of curves) covered.add(easingKey(curve))
			if (tailwind) {
				covered.add(easingKey("animate-bounce"))
				covered.add(easingKey("animation: bounce"))
			}
		}
		const original = snapshot.cssText.join("\n")
		const css = original.replace(/(^|[;{}])\s*(--[\w-]+)\s*:\s*([^;{}]+)/g, (whole: string, _prefix: string, name: string) =>
			new RegExp(`var\\(\\s*${name}\\s*[,)]`).test(original) ? whole : whole.replace(/[^{}\n;]/g, " "))
		const blocks = cssBlocks(css)
		const lines = css.split("\n")
		const forms = sourceBounce.check({ file: { path: "captured.css", text: css }, config })
		for (const form of forms) {
			const name = form.message.startsWith("animation: ") ? form.message.slice("animation: ".length) : null
			if (allowed(name ?? form.message)) continue
			if (name) {
				const frames = keyframes(snapshot, name)
				if (frames !== null && onlyUnitPulse(frames)) continue
			}
			const key = easingKey(form.message)
			if (covered.has(key)) continue
			const offset = lines.slice(0, form.line - 1).reduce((sum, line) => sum + line.length + 1, 0) + form.column - 1
			const block = blocks.find((candidate) => offset >= candidate.offset && offset < candidate.offset + candidate.body.length)
			if (block && !block.selector.split(",").every((part) => /^(?:from|to|[\d.]+%)$/i.test(part.trim()))) {
				const matches = snapshot.elements.filter((el) => block.selector.split(",").some((selector) => matchesSelector(snapshot, el, selector.trim())))
				const applies = (el: ElementSnapshot): boolean => name
					? splitTop(styleOf(el, "animation-name")).some((value) => easingKey(`animation: ${value}`) === key)
					: [styleOf(el, "animation-timing-function"), styleOf(el, "transition-timing-function")].flatMap((value) => splitTop(value)).some((value) => easingKey(value) === key)
				if (!matches.some((el) => painted(el) && !pageIgnored(snapshot, el, "bounce-easing") && applies(el))) continue
			}
			hits.push({ element: null, message: form.message, snippet: form.snippet })
		}
		return hits
	},
}
