import type { SourceRule } from "../../rule"
import { lineCheck, sourceExtensions } from "./support/source-text"

export const bounceEasing: SourceRule = {
	meta: { id: "bounce-easing", name: "Bounce or elastic easing", category: "slop", severity: "advisory", engine: "source", description: "A named bounce animation or overshooting timing curve adds elastic motion.", fixHint: "Use a smooth deceleration, or allow an intentional timing function." },
	extensions: sourceExtensions,
	check: lineCheck([/\banimate-bounce\b/g, /animation(?:-name)?\s*:\s*([^;{}]*(?:bounce|elastic|wobble|jiggle|spring)[^;{}]*)/gi, /cubic-bezier\(\s*([0-9.-]+)\s*,\s*([0-9.-]+)\s*,\s*([0-9.-]+)\s*,\s*([0-9.-]+)\s*\)/g], ({ match, context }) => {
		const canonical = (s: string): string => s.replace(/\s/g, "").toLowerCase()
		const names = match[4] === undefined ? match[1]?.split(/[,\s]+/).filter((s) => /bounce|elastic|wobble|jiggle|spring/i.test(s)) ?? [] : []
		const name = names.find((candidate) => !context.config.allowEasings?.some((easing) => canonical(easing) === canonical(candidate)))
		if (context.config.allowEasings?.some((easing) => [match[0], match[1] ?? ""].some((value) => canonical(easing) === canonical(value)))
			|| (names.length > 0 && name === undefined)) return null
		if (match[4] !== undefined) {
			const y1 = Number(match[2])
			const y2 = Number(match[4])
			return y1 < -0.1 || y1 > 1.1 || y2 < -0.1 || y2 > 1.1 ? `cubic-bezier(${match.slice(1).join(", ")})` : null
		}
		if (match[1]) return `animation: ${name ?? match[1].trim()}`
		return "animate-bounce (Tailwind)"
	}),
}
