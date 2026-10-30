import { shortSnippet } from "../../core/page"
import type { PageRule } from "../../rule"
import { clippedChild } from "./support/clipping"

export const clippedOverflowContainer: PageRule = {
	meta: {
		id: "clipped-overflow-container", name: "Positioned child clipped by overflow container", category: "quality", severity: "advisory", engine: "page",
		description: "A container cuts off a positioned menu, tooltip, or dialog that needs to escape it.",
		fixHint: "Render the popup outside the clipping box or remove the clip from its containing block.",
	},
	check: ({ snapshot }) => snapshot.elements.flatMap((el) => {
		const child = clippedChild(snapshot, el)
		return child ? [{ element: el, message: `${el.selector} clips positioned popup ${child.selector}.`, snippet: shortSnippet(el) }] : []
	}),
}
