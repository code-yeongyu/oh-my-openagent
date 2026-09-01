import type { BuiltinSkill } from "../types"
import securityResearchTemplate from "../security-research/SKILL.md" with { type: "text" }

export const securityResearchSkill: BuiltinSkill = {
	name: "security-research",
	description:
		"Team Mode security research skill. Orchestrates 3 vulnerability hunters and 2 PoC engineers to audit a codebase in parallel, prove exploitability, classify root causes, and calibrate severity by actual exploitability. Use for security review, vulnerability research, exploitability audit, pre-release security check, threat model validation, and `/security-research`. Triggers: 'security-research', 'security research', 'security review', 'vulnerability audit', 'exploitability audit', '보안 리뷰', '취약점 감사'.",
	template: securityResearchTemplate,
}
