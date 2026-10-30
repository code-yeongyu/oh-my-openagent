import { ancestors, styleOf } from "../../../core/page"
import { cssBlocks } from "../../../core/source"
import type { ElementSnapshot, PageSnapshot } from "../../../types"
import { opacity } from "./gradients"

function opacityFrames(snapshot: PageSnapshot, name: string): readonly { readonly at: number; readonly opacity: number }[] {
	const frames: { at: number; opacity: number }[] = []
	for (const css of snapshot.cssText) {
		const marker = new RegExp(`@(?:-webkit-)?keyframes\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`).exec(css)
		if (!marker || marker.index === undefined) continue
		const open = marker.index + marker[0].length - 1
		let depth = 1
		let end = open + 1
		for (; end < css.length && depth > 0; end++) {
			if (css[end] === "{") depth++
			if (css[end] === "}") depth--
		}
		for (const block of cssBlocks(css.slice(open + 1, end - 1))) {
			const value = /(?:^|;)\s*opacity\s*:\s*([\d.]+)/.exec(block.body)
			if (!value) continue
			for (const selector of block.selector.split(",")) {
				const at = selector.trim() === "to" ? 100 : selector.trim() === "from" ? 0 : Number.parseFloat(selector)
				if (Number.isFinite(at)) frames.push({ at, opacity: Number(value[1]) })
			}
		}
	}
	return frames.sort((a, b) => a.at - b.at)
}

function settled(snapshot: PageSnapshot, node: ElementSnapshot): number {
	let value = opacity(node)
	const names = styleOf(node, "animation-name").split(",").map((n) => n.trim())
	const entries = names.flatMap((name, index) => {
		const frames = !name || name === "none" ? [] : opacityFrames(snapshot, name)
		return frames.length ? [{ name, index, frames }] : []
	})
	const at = (property: string, index: number, missing: string): string => {
		const list = styleOf(node, property).split(",").map((n) => n.trim())
		return list[index % list.length] || missing
	}
	for (const entry of entries) {
		const count = at("animation-iteration-count", entry.index, "1")
		const paused = at("animation-play-state", entry.index, "running") === "paused"
		const composition = at("animation-composition", entry.index, "replace")
		const vanishes = entry.frames.some((frame) => frame.opacity <= 0.1)
		if (count === "infinite" && paused && value < 0.999 && composition === "replace" && vanishes) return 0
	}
	if (node.motion.includes("opacity")) {
		const entry = entries.length === 1 ? entries[0] : undefined
		if (!entry) return 0
		const count = Number(at("animation-iteration-count", entry.index, "1"))
		const fill = at("animation-fill-mode", entry.index, "none")
		const composition = at("animation-composition", entry.index, "replace")
		const duration = at("animation-duration", entry.index, "0s")
		const delay = at("animation-delay", entry.index, "0s")
		const seconds = (time: string): number => /^-?[\d.]+m?s$/.test(time) ? Number.parseFloat(time) / (time.endsWith("ms") ? 1000 : 1) : Number.NaN
		if (!["forwards", "both"].includes(fill) || composition !== "replace" || !Number.isInteger(count) || count < 1
			|| at("animation-play-state", entry.index, "running") !== "running"
			|| !(seconds(duration) > 0 && Math.max(0, seconds(delay)) + seconds(duration) * count <= 60)) return 0
		const direction = at("animation-direction", entry.index, "normal")
		if (!["normal", "reverse", "alternate", "alternate-reverse"].includes(direction)) return 0
		const last = direction === "normal" || (direction === "alternate" && count % 2 === 1) || (direction === "alternate-reverse" && count % 2 === 0)
		const frame = entry.frames.find((candidate) => candidate.at === (last ? 100 : 0))
		return frame?.opacity ?? 0
	}
	for (const entry of entries) {
		const final = entry.frames.at(-1)
		const count = at("animation-iteration-count", entry.index, "1")
		if (count === "infinite" && final?.at === 100 && final.opacity <= 0.02) return 0
		if (styleOf(node, "animation-fill-mode") === "" && count !== "infinite" && final?.at === 100
			&& at("animation-play-state", entry.index, "running") !== "paused") value = final.opacity
	}
	return value
}

export function textOpacity(snapshot: PageSnapshot, el: ElementSnapshot): number {
	return [el, ...ancestors(snapshot, el)].reduce((value, node) => value * settled(snapshot, node), 1)
}
