import type { PageRule } from "../../rule"
import { borderHits } from "./support/borders"
export const borderAccentOnRounded: PageRule = {
	meta: {
		id: "border-accent-on-rounded",
		name: "Border accent on rounded element",
		category: "slop",
		severity: "warning",
		engine: "page",
		description: "A heavy accent band competes with rounded corners.",
		fixHint: "Remove the accent border or square the container.",
	},
	check: ({ snapshot }) => snapshot.elements.flatMap((e) => borderHits(snapshot, e, "border-accent-on-rounded")),
}
