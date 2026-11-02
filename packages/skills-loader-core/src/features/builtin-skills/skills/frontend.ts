import { loadSharedSkillTemplate } from "../skill-file-loader"
import type { BuiltinSkill } from "../types"

export const frontendSkill: BuiltinSkill = {
	name: "frontend",
	description: "Builds, styles, and polishes anything drawn with HTML, CSS, or SVG: web UI, pages, components, HTML reports rendered to PDF or print, figures, PNG/SVG diagrams, slides, and images for Notion or Slack. Use for any styling, layout, animation, or visual-quality task, or when asked to make something look or feel a certain way.",
	template: loadSharedSkillTemplate("frontend"),
}
