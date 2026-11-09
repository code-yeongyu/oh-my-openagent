import type { SourceRule } from "../../rule"
import { bodyText, componentExtensions, pageSource, sourceHit } from "./support/source-text"

export const aphoristicCadence: SourceRule = {
	meta: { id: "aphoristic-cadence", name: "Aphoristic-cadence copy", category: "slop", severity: "warning", engine: "source", description: "Several clipped rebuttals give page copy a repetitive slogan rhythm.", fixHint: "Replace repeated slogans with specific, naturally paced sentences." },
	extensions: componentExtensions,
	check: (context) => {
		const source = pageSource(context)
		if (source === null) return []
		const text = bodyText(source)
		const count = [...text.matchAll(/\bNot an? [a-z][^.!?]{1,40}[.!]\s+[A-Z][^.!?]{1,60}[.!]/g)].length + [...text.matchAll(/\b[A-Z][^.!?]{4,80}[.!]\s+(No|Just)\s+[a-z][^.!?]{2,60}[.!]/g)].length
		return count >= 3 ? [sourceHit(source, 0, `${count} clipped slogan constructions`)] : []
	},
}
