import type { SourceRule } from "../../rule"
import { haloOffsets } from "./support/css-effects"
import { componentExtensions, pageSource, sourceHit } from "./support/source-text"

export const radialHalo: SourceRule = {
	meta: { id: "radial-halo", name: "Radial-gradient background halo", category: "slop", severity: "warning", engine: "source", description: "A saturated radial gradient fades into a dark background.", fixHint: "Use a quieter solid background or purposeful imagery." },
	extensions: componentExtensions,
	check: (context) => {
		const text = pageSource(context)
		if (text === null) return []
		const offset = haloOffsets(text)[0]
		return offset === undefined ? [] : [sourceHit(text, offset, "Radial color halo on a dark page")]
	},
}
