export type DraftRuleId = "promo-copy" | "emoji-icon" | "decorative-badge" | "vanity-stat"

export type DraftFinding = {
	readonly file: string
	readonly line: number
	readonly column: number
	readonly rule: DraftRuleId
	readonly excerpt: string
}

export const DRAFT_RULE_MESSAGES: Readonly<Record<DraftRuleId, string>> = {
	"promo-copy": "promotional filler in visible copy; say what the screen does or shows instead",
	"emoji-icon": "emoji used as an icon or bullet; use an SVG icon from the project's icon set, or nothing",
	"decorative-badge": "badge or chip carrying a hype label instead of a state; remove it or show a real status",
	"vanity-stat": "stat tile with a marketing-form number (10x, 500+, 24/7); show the measured figure with its unit and period, or remove the tile",
}
