import { extensionOf } from "../../core/source"
import type { SourceRule } from "../../rule"
import { imageTags, missingImageSource } from "./support/image-tags"
import { sheetExtensions, sourceExtensions, sourceHit, stripComments } from "./support/source-text"

export const brokenImage: SourceRule = {
	meta: { id: "broken-image", name: "Broken or placeholder image", category: "quality", severity: "warning", engine: "source", description: "An image tag has no statically usable source or source set.", fixHint: "Supply a real image source or remove the unused image element." },
	extensions: sourceExtensions,
	check: ({ file }) => {
		const ext = extensionOf(file.path)
		if (sheetExtensions.includes(ext)) return []
		const script = ["js", "jsx", "ts", "tsx", "mjs", "cjs"].includes(ext)
		const text = stripComments(file.text, script)
		return imageTags(text, script).filter((hit) => missingImageSource(hit.tag, ext)).map((hit) => sourceHit(file.text, hit.offset, "Image has no source", hit.tag.slice(0, 100)))
	},
}
