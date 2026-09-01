export const designpowersUpstreamName = "designpowers";

export const includedDesignpowersSkills = [
	"accessible-content",
	"adaptive-interfaces",
	"cognitive-accessibility",
	"design-debate",
	"design-debt-tracker",
	"design-handoff",
	"design-md",
	"design-retrospective",
	"design-review",
	"design-system-alignment",
	"designpowers-critique",
	"heuristic-evaluation",
	"inclusive-personas",
	"inspiration-scouting",
	"interaction-design",
	"motion-choreography",
	"research-planning",
	"responsive-patterns",
	"synthetic-user-testing",
	"taste-feedback",
	"taste-report",
	"token-architecture",
	"ui-composition",
	"usability-testing",
	"verification-before-shipping",
	"voice-and-tone",
	"writing-design-plans",
];

export const excludedDesignpowersSkills = [
	"figma-bridge",
	"design-express",
	"design-library",
	"using-designpowers",
	"design-discovery",
	"design-memory",
	"design-state",
	"design-strategy",
	"design-taste",
];

export const designpowersAgentFiles = [
	"accessibility-reviewer.md",
	"content-writer.md",
	"design-builder.md",
	"design-critic.md",
	"design-lead.md",
	"design-scout.md",
	"design-strategist.md",
	"heuristic-evaluator.md",
	"inspiration-scout.md",
	"motion-designer.md",
];

export function designpowersMaterializeMap() {
	const map = {
		"references/designpowers/vendor/LICENSE": {
			upstream: designpowersUpstreamName,
			source: "LICENSE",
		},
	};
	for (const name of includedDesignpowersSkills) {
		map[`references/designpowers/vendor/skills/${name}/reference.md`] = {
			upstream: designpowersUpstreamName,
			source: `skills/${name}/SKILL.md`,
		};
	}
	for (const file of designpowersAgentFiles) {
		map[`references/designpowers/vendor/agents/${file}`] = {
			upstream: designpowersUpstreamName,
			source: `agents/${file}`,
		};
	}
	return map;
}

export function designpowersRelativePaths() {
	return Object.keys(designpowersMaterializeMap()).sort();
}
