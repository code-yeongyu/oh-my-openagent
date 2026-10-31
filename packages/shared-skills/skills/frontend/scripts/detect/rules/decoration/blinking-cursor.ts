import type { PageRule } from "../../rule"
import { parseColor } from "../../core/color"
import { ancestors, shortSnippet, styleOf } from "../../core/page"
import { context, radii, visible } from "./support/appearance"
import { infiniteNames, keyframes, toggles } from "./support/keyframes"
export const blinkingCursor: PageRule = {
	meta: {
		id: "blinking-cursor",
		name: "Decorative blinking cursor",
		category: "slop",
		severity: "advisory",
		engine: "page",
		description: "A fake caret blinks in non-editable landing content.",
		fixHint: "Remove the decorative cursor and let actual editable fields draw their caret.",
	},
	check: ({ snapshot }) =>
		snapshot.elements.flatMap((e) => {
			if (
				e.rect.width <= 0 || e.rect.height <= 0 ||
				styleOf(e, "display") === "none" || e.attributes["hidden"] !== undefined ||
				[...ancestors(snapshot, e)].some(a => !visible(snapshot, a)) ||
				["input", "textarea", "select", "img", "svg", "script", "style"].includes(e.tag) ||
				e.rect.y > 1200 ||
				context(
					snapshot,
					e,
					(a) => a.attributes["role"] === "textbox" || ["", "true", "plaintext-only"].includes(a.attributes["contenteditable"] ?? "false"),
				)
			)
				return []
			const animated = infiniteNames(e.style).some((n) => /blink|caret|cursor/i.test(n) || toggles(keyframes(snapshot, n) ?? []))
			if (!animated) return []
			const text = e.text.trim(),
				{ width: w, height: h } = e.rect
			const glyph = /^[_|\u2580-\u259f\u25a0\u25ae\u2759\u275a\uff5c]$/.test(text)
			const bg = parseColor(styleOf(e, "background-color"))
			const filled =
				(bg !== null && bg.a > 0.2) ||
				["left", "right", "bottom"].some((side) => Number.parseFloat(styleOf(e, "border-" + side + "-width")) >= 1)
			const block =
				text === "" &&
				e.children.length === 0 &&
				filled &&
				((w >= 1 && w <= 24 && h >= 6 && h <= 48 && h >= w) || (h >= 1 && h <= 6 && w >= 4 && w <= 24)) &&
				Math.max(...radii(e)) < 0.4 * Math.min(w, h)
			return glyph || block ? [{ element: e, message: "Blinking decorative cursor in the landing region", snippet: shortSnippet(e) }] : []
		}),
}
