import { shortSnippet } from "../../core/page"
import type { PageRule } from "../../rule"

export const brokenImage: PageRule = {
	meta: {
		id: "broken-image", name: "Broken or placeholder image", category: "quality", severity: "warning", engine: "page",
		description: "An image has no usable source attribute.",
		fixHint: "Provide a real src or srcset, or remove the unused image element.",
	},
	check: ({ snapshot }) => snapshot.elements.flatMap((el) => {
		if (el.tag !== "img") return []
		const hasSource = Object.entries(el.attributes).some(([name, value]) =>
			/(?:^|[:-])(?:src|srcset)$/i.test(name.split(".")[0] ?? "")
			&& value.trim() !== "" && value.trim() !== "#")
		return hasSource ? [] : [{ element: el, message: "Image source is missing, empty or a placeholder", snippet: shortSnippet(el) }]
	}),
}
