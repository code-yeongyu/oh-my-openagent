import type { PageRule } from "../../rule"
import { fontSizePx, shortSnippet, styleOf } from "../../core/page"
import { context, length, visible } from "./support/appearance"
import { application, caps, cardContext, headingLevel, heroLabel, labelBefore, labelType, nearAbove } from "./support/labels"
export const kickerAboveHeading: PageRule = {
	meta: {
		id: "kicker-above-heading",
		name: "Kicker / eyebrow label above heading",
		category: "slop",
		severity: "warning",
		engine: "page",
		description: "A separate tracked uppercase label repeats the heading hierarchy.",
		fixHint: "Delete the kicker or work meaningful words into the heading or body.",
	},
	check: ({ snapshot }) =>
		snapshot.elements.flatMap((h) => {
			const level = headingLevel(h),
				size = fontSizePx(h)
			if (
				level < 1 ||
				level > 4 ||
				size < 20 ||
				h.text.length < 3 ||
				/^\s*["']?\//.test(h.text) ||
				application(snapshot, h) ||
				!visible(snapshot, h)
			)
				return []
			const found = labelBefore(snapshot, h)
			if (!found) return []
			const label = found.label,
				ty = labelType(snapshot, label),
				text = label.text.trim(),
				fs = fontSizePx(ty)
			const variant = styleOf(ty, "font-variant") + styleOf(ty, "font-variant-caps")
			const smallCaps = /small-caps/.test(variant)
			if (
				!visible(snapshot, label) ||
				!["p", "span", "div", "small"].includes(label.tag) ||
				text.length < 2 ||
				text.length > 34 ||
				!(caps(ty) || smallCaps) ||
				fs <= 0 ||
				fs > Math.max(14, Math.min(16, size * 0.45)) ||
				!(length(styleOf(ty, "letter-spacing")) >= fs * 0.06)
			)
				return []
			if (
				!nearAbove(ty, h) ||
				/[·•|]|\b(?:19|20)\d{2}\b|\s[\/›»>]\s|^(?:step\s*\d|\d{1,2}$|§|\d+(?:\.\d+)+\b|(?:section|article|clause|appendix|exhibit|schedule|chapter|part|rule|title)\s+(?:[0-9ivxlc]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b)/i.test(text) ||
				cardContext(snapshot, h, label)
			)
				return []
			if (h.tag === "h1" && size >= 48 &&
				(length(styleOf(ty, "letter-spacing")) >= 1.6 || (found.levels === 0 && fs <= 14 && heroLabel(snapshot, h)))) return []
			if (
				context(
					snapshot,
					h,
					(a) =>
						["nav", "form", "figure", "footer", "header", "pre", "code"].includes(a.tag) ||
						a.attributes["data-impeccable-allow-kickers"] !== undefined ||
						a.attributes["aria-hidden"] === "true",
				)
			)
				return []
			return [{ element: label, message: "Tracked kicker above " + h.tag, snippet: shortSnippet(label) }]
		}),
}
