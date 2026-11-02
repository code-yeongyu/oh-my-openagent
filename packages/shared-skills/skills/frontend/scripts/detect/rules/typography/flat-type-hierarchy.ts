import { childrenOf, fontSizePx, isHeading } from "../../core/page"
import type { PageRule } from "../../rule"
import { readingTags, visibleText } from "./support/text-context"
import { flatHierarchy } from "./support/type-hierarchy"

export const flatTypeHierarchy: PageRule = {
	meta: {
		id: "flat-type-hierarchy", name: "Flat type hierarchy", category: "slop", severity: "warning", engine: "page",
		description: "Heading and body roles have no adjacent size step of at least 1.25.",
		fixHint: "Add a stronger size step between at least two heading or body roles.",
	},
	check: ({ snapshot }) => {
		const sampled = (tag: string): boolean => /^h[1-6]$/.test(tag) || readingTags.includes(tag)
		const ownChars = (e: (typeof snapshot.elements)[number]): number =>
			e.ownText.replace(/\s/g, "").length + childrenOf(snapshot, e)
				.filter(n => sampled(n.tag) === false && visibleText(snapshot, n))
				.reduce((count, n) => count + ownChars(n), 0)
		const samples = snapshot.elements.filter(e => sampled(e.tag) && e.text.trim() !== "" && visibleText(snapshot, e) &&
			fontSizePx(e) >= 8 && fontSizePx(e) < 200 &&
			(isHeading(e) || [1, 2].includes(ownChars(e)) === false))
			.map(e => ({ role: isHeading(e) ? e.tag : "body", size: fontSizePx(e), weight: Number.parseFloat(e.style["font-weight"] ?? "400") }))
		const roles = flatHierarchy(samples)
		if (roles.length === 0) return []
		return [{ element: null, message: `Flat role sizes: ${roles.map(([r, size]) => `${r} ${size}px`).join(", ")}`, snippet: "All adjacent type steps are below 1.25" }]
	},
}
