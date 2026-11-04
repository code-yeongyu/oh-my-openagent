import { EM_DASH } from "../../core/characters"
import { ancestors, descendants, parentOf } from "../../core/page"
import type { PageRule } from "../../rule"
import { lineage, visibleText } from "./support/page-text"

export const emDashOveruse: PageRule = {
	meta: {
		id: "em-dash-overuse", name: "Em-dash overuse", category: "slop", severity: "advisory", engine: "page",
		description: "At least eight prose dashes appear at a density of one per 500 characters or more.",
		fixHint: "Use sentence breaks or commas where the copy repeatedly interrupts itself.",
	},
	check: ({ snapshot }) => {
		const runs = snapshot.elements.filter((el) => visibleText(snapshot, el)
			&& !lineage(snapshot, el).some((a) => ["select", "option", "datalist"].includes(a.tag)))
			.map((el) => el.ownText).filter((text) => text !== "" && !/^[\u2014–\s-]+$/.test(text))
		const text = runs.join(" ").replace(/\s+/g, " ")
		let count = 0
		for (const match of text.matchAll(/\u2014+|-+/g)) {
			const run = match[0]
			if (run.startsWith(EM_DASH)) count += run.length === 2 ? 1 : run.length
			else {
				const next = text[match.index + run.length] ?? ""
				const previous = text[match.index - 1] ?? ""
				if (run.length === 2 && next !== "" && !/\s/.test(next)) count++
				else if (run.length === 3 && /[\p{L}\p{N}]/u.test(previous) && /[\p{L}\p{N}]/u.test(next)) count++
			}
		}
		const groups = new Map<number | null, number>()
		for (const li of snapshot.elements.filter((el) => el.tag === "li").slice(0, 2000)) {
			if (!visibleText(snapshot, li) || [...descendants(snapshot, li)].some((d) => d.tag === "li")) continue
			const parts = li.text.replace(/^[^\p{L}\p{N}]+/u, "").split(EM_DASH)
			const term = (parts[0] ?? "").trim()
			const rest = (parts[1] ?? "").trim()
			if (term === "" || [...term].length > 60 || term.split(/\s+/).length > 6 || /[.!?。！？]/.test(term) || rest === "") continue
			const first = [...rest][0] ?? ""
			const label = [...descendants(snapshot, li)].some((d) => [...ancestors(snapshot, d)].findIndex((a) => a.index === li.index) < 3 && d.text === term)
			if (!(first.toUpperCase() === first && /\p{L}/u.test(first)) && !label) continue
			const key = parentOf(snapshot, parentOf(snapshot, li) ?? li)?.index ?? null
			groups.set(key, (groups.get(key) ?? 0) + 1)
		}
		count = Math.max(0, count - [...groups.values()].filter((n) => n >= 3).reduce((sum, n) => sum + n, 0))
		return count < 8 || text.length > count * 500 ? [] : [{
			element: null, message: `${count} em-dashes in body text`, snippet: `${count} em-dashes in body text`,
		}]
	},
}
