import { styleOf } from "../../../core/page"
import type { ElementSnapshot, PageSnapshot } from "../../../types"
import { keyframeSteps } from "../../decoration/support/keyframes"

const seconds = (value: string): number => {
	const match = /^([-+]?(?:\d*\.)?\d+)(ms|s)$/.exec(value)
	return match ? Number(match[1]) / (match[2] === "ms" ? 1000 : 1) : Number.NaN
}

export function fadesOutForGood(s: PageSnapshot, e: ElementSnapshot): boolean {
	if (!e.motion.includes("opacity")) return false
	const names = styleOf(e, "animation-name").split(",").map(n => n.trim())
	const entries = []
	for (const [index, name] of names.entries()) {
		if (name === "" || name === "none") continue
		const steps = keyframeSteps(s, name)
		if (steps === null) return false
		if (steps.some(step => step.declarations["opacity"] !== undefined)) entries.push({ index, steps })
	}
	const entry = entries[0]
	if (entries.length !== 1 || !entry) return false
	const value = (property: string): string => {
		const list = styleOf(e, "animation-" + property).split(",").map(v => v.trim().toLowerCase())
		return list[entry.index % list.length] ?? ""
	}
	if (value("play-state") !== "running" || !["forwards", "both"].includes(value("fill-mode")) ||
		!["", "auto"].includes(value("timeline")) || value("composition") !== "replace") return false
	const count = Number(value("iteration-count")), duration = seconds(value("duration")), delay = seconds(value("delay"))
	if (!Number.isInteger(count) || count < 1 || !(duration > 0) || !(Math.max(0, delay) + duration * count <= 60)) return false
	const direction = value("direction")
	if (!["normal", "reverse", "alternate", "alternate-reverse"].includes(direction)) return false
	const last = direction === "normal" || (direction === "alternate" && count % 2 === 1) ||
		(direction === "alternate-reverse" && count % 2 === 0)
	let opacity: number | undefined
	for (const step of entry.steps) {
		const endpoint = step.key.split(",").some(key => {
			const trimmed = key.trim().toLowerCase()
			const offset = trimmed === "from" ? 0 : trimmed === "to" ? 1 :
				trimmed.endsWith("%") ? Number(trimmed.slice(0, -1)) / 100 : Number.NaN
			return Math.abs(offset - (last ? 1 : 0)) < 1e-9
		})
		const raw = step.declarations["opacity"]
		if (!endpoint || raw === undefined) continue
		const number = raw.endsWith("%") ? Number(raw.slice(0, -1)) / 100 : Number(raw)
		if (Number.isFinite(number)) opacity = number
	}
	return opacity !== undefined && opacity <= 0.02
}
