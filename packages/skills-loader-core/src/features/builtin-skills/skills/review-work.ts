import { loadSharedSkillTemplate } from "../skill-file-loader"
import type { BuiltinSkill } from "../types"

export const reviewWorkSkill: BuiltinSkill = {
	name: "review-work",
	description:
		"Post-implementation review orchestrator. Launches 5 parallel background sub-agents: Oracle (goal/constraint verification), Oracle (code quality), Oracle (security), unspecified-high (hands-on QA execution), unspecified-high (context mining from GitHub/git/Slack/Notion). All must pass for review to pass. MUST USE before a PR handoff or when the user explicitly asks to review completed work. Triggers: 'review work', 'review my work', 'review changes', 'QA my work', 'verify implementation', 'check my work', 'validate changes', 'post-implementation review'.",
	template: loadSharedSkillTemplate("review-work"),
}
