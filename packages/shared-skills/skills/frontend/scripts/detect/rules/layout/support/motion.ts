import { childrenOf, styleOf } from "../../../core/page"
import type { ElementSnapshot, PageSnapshot } from "../../../types"
import { keyframes } from "../../decoration/support/keyframes"
import { bottom, chain, right } from "./geometry"

const list = (el: ElementSnapshot, prop: string): readonly string[] => styleOf(el, prop).split(",").map((v) => v.trim())
const at = (values: readonly string[], index: number): string => values[index % values.length] ?? ""

function tracedToEnd(s: PageSnapshot, el: ElementSnapshot, prop: string): boolean {
	const counts = list(el, "animation-iteration-count")
	const states = list(el, "animation-play-state")
	const timelines = list(el, "animation-timeline")
	let setting = false
	for (const [i, name] of list(el, "animation-name").entries()) {
		if (name === "" || name === "none") continue
		const frames = keyframes(s, name)
		if (!frames) return false
		if (!frames.some((f) => f[prop] !== undefined)) continue
		setting = true
		const count = Number.parseFloat(at(counts, i))
		if (!Number.isFinite(count) || count <= 0 || at(states, i) === "paused" || !["", "auto"].includes(at(timelines, i))) return false
	}
	const durations = list(el, "transition-duration")
	return setting || list(el, "transition-property").some((p, i) => p === prop && Number.parseFloat(at(durations, i)) > 0)
}

export function openingWidth(s: PageSnapshot, el: ElementSnapshot): boolean {
	for (const node of chain(s, el).slice(0, 64)) {
		if (node.tag === "body" || node.tag === "html") return false
		if (node.motion.some((p) => /^(?:(?:min|max)-)?(?:width|inline-size)$/.test(p) && tracedToEnd(s, node, p))) return true
	}
	return false
}

function onlyScales(value: string): boolean {
	let rest = value.trim().replace(/\s*!important\s*$/, "")
	if (rest.toLowerCase() === "none") return true
	let found = false
	while (rest !== "") {
		const match = /^scale(?:[XYZ]|3d)?\(([^)]*)\)\s*/i.exec(rest)
		if (!match || (match[1] ?? "").split(/[\s,]+/).filter(Boolean).some((n) => !Number.isFinite(Number(n)))) return false
		found = true
		rest = rest.slice(match[0].length)
	}
	return found
}

function endlessTranslation(s: PageSnapshot, el: ElementSnapshot): boolean {
	if (!el.motion.some((p) => p === "transform" || p === "translate" || p === "-webkit-transform")) return false
	const counts = list(el, "animation-iteration-count")
	const states = list(el, "animation-play-state")
	return list(el, "animation-name").some((name, i) => {
		if (name === "" || name === "none" || at(counts, i) !== "infinite" || at(states, i) === "paused") return false
		const frames = keyframes(s, name)
		return frames === null || frames.some((f) => Object.entries(f).some(([prop, value]) =>
			prop.replace(/^-webkit-/, "") === "translate" || prop.replace(/^-webkit-/, "") === "transform" && !onlyScales(value)))
	})
}

export function ridesRunningTrack(s: PageSnapshot, el: ElementSnapshot): boolean {
	const parents = chain(s, el).slice(1)
	for (const [index, clip] of parents.entries()) {
		if (clip.tag === "body" || clip.tag === "html") break
		if (!/^(hidden|clip)$/.test(styleOf(clip, "overflow-x")) || clip.scroll.clientWidth <= 0) continue
		if (parents.slice(0, index).some((track) => {
			if (track.scroll.scrollWidth <= clip.scroll.clientWidth + 1 || !["transform", "translate"].some((p) =>
				!["", "none"].includes(styleOf(track, p))) || !endlessTranslation(s, track)) return false
			const kids = childrenOf(s, track).filter((n) => n.rect.width >= 1 && n.rect.height >= 1)
			return kids.some((a, i) => {
				const b = kids[i + 1]
				return b !== undefined && (b.rect.x >= right(a.rect) - 1 || right(b.rect) <= a.rect.x + 1) &&
					Math.min(bottom(a.rect), bottom(b.rect)) - Math.max(a.rect.y, b.rect.y) > 0
			})
		})) return true
	}
	return false
}
