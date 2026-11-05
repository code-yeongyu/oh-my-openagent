import type { SourceRule } from "../../rule"
import { cssScopes } from "./support/css-scopes"
import { sourceExtensions, sourceHit, sourcePasses } from "./support/source-text"

export const codexGridBackground: SourceRule = {
	meta: { id: "codex-grid-background", name: "Decorative grid-line background", category: "slop", severity: "advisory", engine: "source", description: "Two tiled hairline gradients draw a decorative background grid.", fixHint: "Remove the grid unless it communicates structure or data." },
	extensions: sourceExtensions,
	check: (context) => {
		const text = sourcePasses(context)[0]?.text ?? ""
		const blocks = [...cssScopes(text).map((s) => ({ body: s.body, offset: text.indexOf("{", s.start) })), ...[...text.matchAll(/\bstyle\s*=\s*["']([^"']*)["']/gi)].map((m) => ({ body: m[1] ?? "", offset: m.index ?? 0 }))]
		for (const block of blocks) {
			const backgrounds = [...block.body.matchAll(/\bbackground(?:-image)?\s*:\s*([^;{}"']*)/gi)].map((m) => m[1] ?? "").join(";")
			const lines = [...backgrounds.matchAll(/\b\d{1,3}px\s*,\s*transparent\s+\d{1,3}px|transparent\s+calc\(100%\s*-\s*\d{1,3}px\)/gi)].length
			if (lines >= 2 && (/background-size\s*:[^;{}"']*\b\d{1,3}px\b/i.test(block.body) || /\/\s*\d{1,3}px\b/.test(backgrounds))) return [sourceHit(context.file.text, block.offset, "Two-axis gradient background grid")]
		}
		return []
	},
}
