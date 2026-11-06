import type { BuiltinSkill } from "../types"
import hyperplanTemplate from "../hyperplan/SKILL.md" with { type: "text" }

export const hyperplanSkill: BuiltinSkill = {
	name: "hyperplan",
	description:
		"Adversarial multi-agent planning skill. Self-orchestrates 5 hostile category members (unspecified-low, unspecified-high, deep-low, ultrabrain, artistry) via team-mode for ruthless cross-critique debate, distills only the defensible insights, then MANDATORILY hands the distilled insight bundle to the `plan` agent for executable plan formalization. Use when planning needs maximum rigor and surfacing of weak assumptions, blind spots, and over-engineering. Triggers: 'hyperplan', 'hpp', '/hyperplan', 'adversarial plan', 'hostile planning', 'cross-critique plan', '\ud558\uc774\ud37c\ud50c\ub79c', '\uc801\ub300\uc801 \uacc4\ud68d', '\uad50\ucc28 \ube44\ud3c9'.",
	template: hyperplanTemplate,
}
